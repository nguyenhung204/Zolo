# Chat Core Service

**Port**: 3004 (TCP Microservice)
**Technology**: NestJS + TCP Transport
**Database**: None — Chat Core does not own any database tables
**Cache**: Redis (membership sets, role cache, idempotency, rate limiting)

---

## Purpose

Chat Core is the business validation engine for all message operations. It enforces all access control rules and business constraints before any message is accepted or operation is executed. It does not persist messages; it publishes `MESSAGE_ACCEPTED` to Kafka after validation passes.

---

## Architecture: ACL Rule Chain

The service implements a layered validation architecture built on three patterns:

- **Chain of Responsibility** (ACL rules in priority order)
- **Strategy Pattern** (conversation-kind-specific validation)
- **Orchestrators** (per-operation workflow coordination)

### Validation Pipeline

Each message operation flows through an orchestrator that assembles context and executes the validation chain:

```
Request (TCP)
  → Orchestrator (assemble PermissionContext)
    → Validators (fetch user, membership, media from cache/TCP)
      → ACL Rule Chain (execute 4 rules, fail-fast)
        → If OK: publish to Kafka
        → If Error: throw RpcException with specific error code
```

---

## ACL Rule Chain

Four rules execute in priority order (highest first). Execution stops at the first failure:

| Priority | Rule | File | Error Codes |
|----------|------|------|-------------|
| CRITICAL | `AccountStatusRule` | `rules/account-status.rule.ts` | `FORBIDDEN_ACCOUNT_BANNED` |
| HIGH | `MembershipRule` | `rules/membership.rule.ts` | `FORBIDDEN_NOT_MEMBER` |
| HIGH | `TimeWindowRule` | `rules/time-window.rule.ts` | `FORBIDDEN_EDIT_WINDOW_EXPIRED`, `FORBIDDEN_NOT_MESSAGE_SENDER`, `INVALID_CONTEXT` |
| HIGH | `MediaValidationRule` | `rules/media-validation.rule.ts` | `FORBIDDEN_MEDIA_FAILED` |

**Applies-to filters**: `TimeWindowRule` only fires for `MSG.EDIT_OWN`, `MSG.DELETE_OWN`, `MSG.DELETE_ANY` actions. `MediaValidationRule` only fires for `MSG.SEND_MEDIA`, `DOC.UPLOAD`, `DOC.SHARE_EXISTING` actions and only when `context.media` is present.

Error codes are defined in `libs/common/src/constants/permissions.constants.ts` (`ACLErrorCode` enum). Per-conversation-kind permission checks are handled by the **Strategy Pattern** (see below).

---

## Strategy Pattern

A `ConversationStrategyRegistry` maps each `ConversationKind` to a strategy class that implements kind-specific permission and validation logic:

| Strategy | Kind | Special Logic |
|----------|------|---------------|
| `DirectConversationStrategy` | `direct` | Friendship check, block check, rate-limit for strangers; all members have equal permissions |
| `GroupConversationStrategy` | `group` | Role-based permissions; OWNER/ADMIN/MODERATOR get elevated capabilities; MEMBER gets standard messaging |
| `CommunityConversationStrategy` | `community` | Only OWNER/ADMIN/MODERATOR can post (`MSG.SEND_TEXT`/`MSG.SEND_MEDIA`); MEMBER/GUEST can only `MSG.REACT` |

---

## Orchestrators

| File | Operation | Entry Point Pattern |
|------|-----------|---------------------|
| `message-send.orchestrator.ts` | Send message | `SEND_MESSAGE` |
| `message-edit.orchestrator.ts` | Edit message (10-min window) | `EDIT_MESSAGE` |
| `message-delete.orchestrator.ts` | Delete message (24h for own; ADMIN only for any) | `DELETE_MESSAGE` |
| `message-pin.orchestrator.ts` | Pin/unpin (max 3 per conversation) | `PIN_MESSAGE`, `UNPIN_MESSAGE` |
| `media-precheck.orchestrator.ts` | Phase 1 of two-phase upload (validate before upload) | `PRE_CHECK_MEDIA` |

### MessageSendOrchestrator Flow

1. Validate user account status (`UserValidatorService` → Users TCP)
2. Fetch conversation from `ConversationService` (TCP)
3. Fetch membership + role from Redis (`SISMEMBER`) or TCP fallback to Conversation Service
4. For `direct` kind: check friendship and block status via Friendship Service (TCP)
5. For non-friend `direct` conversation: check `HAS_REPLIED` via Message Store (TCP) for stranger rate-limiting
6. If `mediaId` present: validate via `MediaValidatorService` (Media Service TCP)
7. Build immutable `PermissionContext`
8. Execute ACL Rule Chain
9. Check idempotency: Redis `GET idempotency:message:{clientMessageId}` (24h window)
10. Atomic rate-limiting via Redis Lua script
11. Publish `MESSAGE_ACCEPTED` to Kafka
12. Store `clientMessageId` in Redis for deduplication
13. Return `{ messageId }` to caller

---

## AclContext (Permission Context)

```typescript
export interface AclContext {
  /** Actor performing the action */
  actor: {
    userId: string;
    isActive: boolean;       // false = banned; AccountStatusRule blocks all actions
    isMember: boolean;       // MembershipRule checks this
    role?: string;           // MemberRole ('owner'|'admin'|'moderator'|'member'|'guest')
  };

  /** Conversation context */
  conversation: {
    id: string;
    kind?: string;           // 'direct' | 'group' | 'community'
    settings?: Record<string, any>;
  };

  /** Message context — required for edit/delete operations */
  message?: {
    id: string;
    senderId: string;
    createdAtMs: number;     // epoch ms; used by TimeWindowRule
    conversationId: string;
  };

  /** Media context — present only when mediaId is in message metadata */
  media?: {
    id: string;
    status: MediaStatus;     // FAILED status is rejected; all others allowed
    mimeType: string;
    sizeBytes: number;
  };

  /** Current timestamp in epoch ms */
  nowMs: number;
}
```

`AclContext` is assembled by each orchestrator from cache/TCP lookups before the rule chain executes.

---

## TCP Patterns

| Pattern | Description |
|---------|-------------|
| `SEND_MESSAGE` | Validate and publish message |
| `EDIT_MESSAGE` | Validate edit (10-min window) and publish |
| `DELETE_MESSAGE` | Validate delete (24h own / ADMIN for any) and publish |
| `PIN_MESSAGE` | Validate pin (MSG.PIN permission, max 3 per conversation) and publish |
| `UNPIN_MESSAGE` | Validate unpin and publish |
| `PRE_CHECK_MEDIA` | Phase 1 media validation before client uploads to MinIO |
| `VALIDATE_MEMBERSHIP` | Check membership (used by other services) |
| `CHECK_BLOCK_STATUS` | Check bidirectional block status |
| `CHECK_RATE_LIMIT` | Check rate limit status for a user/conversation |
| `GET_CIRCUIT_BREAKER_HEALTH` | Circuit breaker + downstream health status |

---

## Kafka Events Published

| Topic | Trigger |
|-------|---------|
| `chat.event.message_accepted` | Message passed all validation; consumed by Message Store |

`MESSAGE_ACCEPTED` payload**:
```json
{
  "messageId": "uuid",
  "conversationId": "uuid",
  "conversationType": "direct | group | community",
  "senderId": "keycloak-id",
  "content": "...",
  "type": "text | image | file | audio | video",
  "timestamp": "2026-04-02T10:00:00.000Z",
  "metadata": { "replyToMessageId?": "...", "mediaId?": "..." }
}
```

`conversationType` and `timestamp` allow Message Store and downstream consumers to apply conversation-specific logic without an extra round-trip to Conversation Service.

Message Store consumes `MESSAGE_ACCEPTED`, increments conversation offset, persists the message, then publishes `MESSAGE_SAVED` for Realtime Gateway.

---

## Service Dependencies

| Service | Usage | Pattern |
|---------|-------|---------|
| Conversation Service | Fetch conversation, membership, member IDs | TCP |
| Friendship Service | Friend status, block status (direct conversations only) | TCP |
| Message Store | `HAS_REPLIED` check for stranger rate-limiting | TCP |
| Media Service | Validate media metadata, ownership, classification | TCP |
| Users Service | Validate account status | TCP |

All integrations use `IConversationService`, `IFriendshipService`, etc. interfaces from `@app/service-contracts` with TCP adapters — no direct `ClientProxy` in business logic.

---

## Redis Usage

| Key Pattern | Purpose | TTL |
|-------------|---------|-----|
| `chat:conversation:{id}:members` | Membership Set (`SISMEMBER`) | Event-driven (no TTL expiry; updated by Conversation Service consumers) |
| `idempotency:message:{clientMessageId}` | Deduplication for sent messages | 24 hours |
| `ratelimit:{userId}:{conversationId}` | Atomic rate limit counter (Lua script) | Configurable window |

---

## Database

Chat Core does **NOT** own any database tables. All validation is done using data fetched at runtime via TCP calls (conversation metadata, membership, media status, user account status). The `policy_rules` table **does not exist** — per-conversation-kind permission logic is embedded in the Strategy classes (`DirectConversationStrategy`, `GroupConversationStrategy`, `CommunityConversationStrategy`).

---

## Test Coverage

| Suite | Tests |
|-------|-------|
| ACL rules (`acl/__tests__/`) | 145 passing |
| Orchestrators (`orchestrators/__tests__/`) | 64 passing |
| Strategies (`strategies/__tests__/`) | 122 passing |

---

## Configuration

```bash
CHAT_CORE_SERVICE_HOST=localhost
CHAT_CORE_SERVICE_PORT=3004

POSTGRES_HOST=localhost
POSTGRES_PORT=5433
POSTGRES_USERNAME=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DATABASE=chat_db

KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=chat-core

REDIS_CHAT_HOST=localhost
REDIS_CHAT_PORT=6380
REDIS_CHAT_DB=0

CONVERSATION_SERVICE_HOST=localhost
CONVERSATION_SERVICE_PORT=3007
FRIENDSHIP_SERVICE_HOST=localhost
FRIENDSHIP_SERVICE_PORT=3008
MESSAGE_STORE_SERVICE_HOST=localhost
MESSAGE_STORE_SERVICE_PORT=3005
USERS_SERVICE_HOST=localhost
USERS_SERVICE_PORT=3001
```

---

## Important Behaviors

### Membership Validation Strategy

Chat Core validates membership using the Redis Set (`SISMEMBER`) maintained by Conversation Service's `MembershipCacheConsumer`. On cache miss or Redis unavailability, it falls back to a direct TCP call to `CONVERSATION_PATTERNS.IS_MEMBER`. This ensures membership is always checked against current state — there is no stale-TTL problem because Redis is updated synchronously on every MEMBER_ADDED/MEMBER_REMOVED event.

### Two-Phase Media Upload

`PRE_CHECK_MEDIA` (phase 1) validates media metadata on the Media Service before the client uploads the file to MinIO. This prevents unauthorized uploads and validates classification/ownership constraints upfront. After the client completes the upload, it calls `POST /media/upload/complete` on Media Service, which transitions status to `UPLOADED` → `PROCESSING` → `READY`.

### Idempotency

Each `SEND_MESSAGE` request must include a `clientMessageId`. Chat Core checks Redis for this ID (24h window). If found, the previous `messageId` is returned immediately without re-processing — this makes the operation safe to retry on network failures.

### Circuit Breaker

`CircuitBreakerService` (from `@app/common`, cockatiel-based) wraps calls to dependent services. On timeout or failed call, it returns `503 ServiceUnavailableException` rather than silently degrading — preventing ghost messages from being accepted.
