# Chat Core Service

**Port**: 3004 (TCP Microservice)
**Technology**: NestJS + TCP Transport
**Database**: PostgreSQL (chat_db, read-only: `policy_rules` table)
**Cache**: Redis (membership sets, policy cache, idempotency, rate limiting)

---

## Purpose

Chat Core is the business validation engine for all message operations. It enforces all access control rules and business constraints before any message is accepted or operation is executed. It does not persist messages; it publishes `MESSAGE_ACCEPTED` to Kafka after validation passes.

---

## Architecture: Phase 5 — DB-Backed ACL Chain

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
      → ACL Rule Chain (execute 6 rules, fail-fast)
        → If OK: publish to Kafka
        → If Error: throw RpcException with specific error code
```

---

## ACL Rule Chain

Six rules execute in priority order (highest first). Execution stops at the first failure:

| Priority | Rule | Error Code |
|----------|------|------------|
| CRITICAL | `TenantIsolationRule` | `FORBIDDEN_TENANT_MISMATCH` |
| CRITICAL | `AccountStatusRule` | `FORBIDDEN_ACCOUNT_STATUS` |
| HIGH | `MembershipRule` | `FORBIDDEN_NOT_MEMBER` |
| HIGH | `TimeWindowRule` | `FORBIDDEN_TIME_WINDOW`, `MESSAGE_EDIT_WINDOW_EXPIRED` |
| HIGH | `MediaValidationRule` | `FORBIDDEN_MEDIA_NOT_READY`, `FORBIDDEN_MEDIA_CLASSIFICATION`, `FORBIDDEN_MEDIA_OWNERSHIP` |
| MEDIUM | `PolicyMatrixRule` | `FORBIDDEN_ROLE_REQUIRED` |

### PolicyMatrixRule — DB-Backed

The `policy_rules` table in `chat_db` stores 202 rules across 4 conversation kinds × 6 roles. Each row maps `(conversationKind, memberRole, permission)` to an allowed flag.

- **Cold path**: Query `policy_rules` via `PolicyRepository`, cache result in Redis
- **Warm path** (subsequent lookups): Redis cache hit, response < 1 ms
- **Indexed query**: 0.086 ms average per PostgreSQL benchmark

---

## Strategy Pattern

A `ConversationStrategyRegistry` maps each `ConversationKind` to a strategy class that implements kind-specific validation logic:

| Strategy | Kind | Special Logic |
|----------|------|---------------|
| `DirectConversationStrategy` | `DIRECT` | Friendship check, block check, rate-limit for strangers |
| `DepartmentConversationStrategy` | `DEPARTMENT` | Department membership sync validation |
| `ProjectConversationStrategy` | `PROJECT` | Project membership rules |
| `AnnouncementConversationStrategy` | `ANNOUNCEMENT` | MEMBER/GUEST/READONLY cannot post (MSG.SEND_TEXT requires MODERATOR+) |

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
4. For `DIRECT`: check friendship and block status via Friendship Service (TCP)
5. For non-friend `DIRECT`: check `HAS_REPLIED` via Message Store (TCP) for stranger rate-limiting
6. If `mediaId` present: validate via `MediaValidatorService` (Media Service TCP)
7. Build immutable `PermissionContext`
8. Execute ACL Rule Chain
9. Check idempotency: Redis `GET idempotency:message:{clientMessageId}` (24h window)
10. Atomic rate-limiting via Redis Lua script
11. Publish `MESSAGE_ACCEPTED` to Kafka
12. Store `clientMessageId` in Redis for deduplication
13. Return `{ messageId }` to caller

---

## PermissionContext

```typescript
interface PermissionContext {
  orgId: string;
  conversation: {
    id: string;
    kind: 'DIRECT' | 'DEPARTMENT' | 'PROJECT' | 'ANNOUNCEMENT';
    orgId: string;
    settings?: { restrictedAllowed?: boolean };
    departmentId?: string;
    projectId?: string;
  };
  actor: {
    userId: string;
    orgId: string;
    accountStatus: 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDED';
    role: MemberRole;
    isMember: boolean;
  };
  message?: {
    id: string;
    senderId: string;
    createdAtMs: number;
  };
  media?: {
    id: string;
    ownerId: string;
    orgId: string;
    status: MediaStatus;
    classification: 'PUBLIC_INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';
    sizeBytes: number;
    mimeType: string;
  };
  nowMs: number;
}
```

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

Message Store consumes `MESSAGE_ACCEPTED`, increments conversation offset, persists the message, then publishes `MESSAGE_SAVED` for Realtime Gateway.

---

## Service Dependencies

| Service | Usage | Pattern |
|---------|-------|---------|
| Conversation Service | Fetch conversation, membership, member IDs | TCP |
| Friendship Service | Friend status, block status (DIRECT only) | TCP |
| Message Store | `HAS_REPLIED` check for stranger rate-limiting | TCP |
| Media Service | Validate media metadata, ownership, classification | TCP |
| Users Service | Validate account status | TCP |

All integrations use `IConversationService`, `IFriendshipService`, etc. interfaces from `@app/service-contracts` with TCP adapters — no direct `ClientProxy` in business logic.

---

## Redis Usage

| Key Pattern | Purpose | TTL |
|-------------|---------|-----|
| `chat:conversation:{id}:members` | Membership Set (`SISMEMBER`) | Event-driven (no TTL expiry) |
| `policy:cache:{kind}:{role}` | Cached permission set from `policy_rules` | Warm: cache on demand |
| `idempotency:message:{clientMessageId}` | Deduplication for sent messages | 24 hours |
| `ratelimit:{userId}:{conversationId}` | Atomic rate limit counter (Lua) | Configurable window |

---

## Database

Chat Core reads from the `policy_rules` table in `chat_db` (shared PostgreSQL container `chat-db`, host port 5433). It does not write to any database. Message persistence is delegated to Message Store.

`policy_rules` schema:

```sql
id               UUID PK
conversation_kind ENUM('DIRECT','DEPARTMENT','PROJECT','ANNOUNCEMENT')
member_role       ENUM('OWNER','ADMIN','MODERATOR','MEMBER','GUEST','READONLY')
permission        VARCHAR    -- e.g. 'MSG.SEND_TEXT', 'CH.UPDATE_INFO'
allowed           BOOLEAN
description       VARCHAR
```

202 rows total. Indexed on `(conversation_kind, member_role)` for O(1) bulk fetch.

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
