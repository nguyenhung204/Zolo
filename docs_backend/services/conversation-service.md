# Conversation Service

**Port**: 3007 (TCP Microservice)
**Technology**: NestJS + TCP Transport
**Database**: PostgreSQL (chat_db)
**Cache**: Redis (membership sets, DB 0)
**Pattern**: Transactional Outbox

---

## Purpose

Manages conversation lifecycle and membership for all conversation kinds: DIRECT, GROUP, and COMMUNITY. Publishes membership change events to Kafka so that downstream services (Realtime Gateway, membership cache) can react in real time.

---

## Conversation Kinds

| Kind | Members | Use Case |
|------|---------|----------|
| `direct` | Exactly 2 | One-on-one chat, created automatically on friendship acceptance |
| `group` | Unlimited | Group chat with manual membership; OWNER/ADMIN manage members |
| `community` | Unlimited | Broadcast channel; only OWNER/ADMIN can post; MEMBER can only react |

---

## Domain Model

### conversation entity

```
id                    UUID (PK)
type                  ENUM('direct', 'group', 'community')
name                  VARCHAR (NULL for direct)
description           TEXT
avatarMediaId         VARCHAR(36) (NULL — UUID of the media record in Media Service)
memberCount           INT (denormalized)
maxOffset             BIGINT (monotonic message counter, 0-indexed)
createdBy             VARCHAR (owner userId, Keycloak ID)
metadata              JSONB  { settings?: { retentionDays?, allowGuestPost?, allowMemberUpload? } }
isPublic              BOOLEAN DEFAULT false  — public discovery flag
joinApprovalRequired  BOOLEAN DEFAULT false  — require OWNER/ADMIN approval for invite-link joins
allowMemberMessage    BOOLEAN DEFAULT true   — when false, only OWNER/ADMIN may post
linkVersion           INT DEFAULT 1          — monotonic counter; increment to revoke all invite links
createdAt             TIMESTAMP
updatedAt             TIMESTAMP
```

> Note: Presigned avatar URLs are resolved at the Gateway layer on every list/detail request — they are never stored in the database.

### conversation_member entity

```
conversationId        UUID (PK, FK)
userId                VARCHAR (PK, Keycloak ID)
role                  VARCHAR(20) CHECK IN ('owner','admin','member')
joinedAt              TIMESTAMP
lastSeenOffset        BIGINT DEFAULT 0
lastDeliveredOffset   BIGINT DEFAULT 0
deleted_until         BIGINT DEFAULT 0    -- bulk-delete cursor: messages with offset <= deleted_until hidden for this member (O(1) clear-history)

PRIMARY KEY (conversationId, userId)  -- composite; no separate UUID id column
UNIQUE implicitly from composite PK
INDEX(userId)
INDEX(conversationId, role)
```

### outbox_events entity (shared, in chat_db)

Used by OutboxProcessor to publish events to Kafka atomically within the same transaction. Columns include `lockedBy` and `lockedAt` for multi-instance atomic claim.

### group_join_requests entity

```
id              UUID (PK)
userId          UUID (Keycloak ID of requester)
conversationId  UUID (FK → conversations.id ON DELETE CASCADE)
status          ENUM('pending','approved','rejected') DEFAULT 'pending'
requestMessage  TEXT (nullable — optional message from requester)
reviewedBy      UUID (nullable — OWNER/ADMIN who reviewed)
createdAt       TIMESTAMP
updatedAt       TIMESTAMP

UNIQUE INDEX: (conversationId, userId)
INDEX: (conversationId, status)
INDEX: (userId, status)
```

### polls entity

```
id             UUID (PK)
conversationId UUID (FK → conversations.id ON DELETE CASCADE)
creatorId      UUID
question       TEXT
options        JSONB  [ { id, text, voterIds[] } ]  — pessimistic-lock write path
multipleChoice BOOLEAN DEFAULT false
deadline       TIMESTAMPTZ (nullable)
isClosed       BOOLEAN DEFAULT false
createdAt      TIMESTAMP
updatedAt      TIMESTAMP
```

> All writes to `options` MUST go through `PollService.votePoll()` which holds a `SELECT … FOR UPDATE` row lock.

### appointments entity

```
id             UUID (PK)
conversationId UUID (FK → conversations.id ON DELETE CASCADE)
creatorId      UUID
title          VARCHAR(255)
description    TEXT (nullable)
scheduledAt    TIMESTAMPTZ
location       TEXT (nullable)
createdAt      TIMESTAMP
updatedAt      TIMESTAMP
deletedAt      TIMESTAMPTZ (nullable — soft-delete)
```

> When created/updated, `AppointmentService` schedules a BullMQ delayed job 15 minutes before `scheduledAt`. Deletion removes the job.

---

## Key Workflows

### Create Conversation

1. Normalize memberIds (include createdBy, deduplicate).
2. Insert `conversation` record with correct `memberCount`.
3. Bulk insert `conversation_member` records; `createdBy` gets `owner` role, others get `member`.
4. For `direct`: enforce idempotency via unique index on sorted pair — catch `23505` conflict and return existing conversation.
5. Write `CONVERSATION_CREATED` outbox event in same transaction.
6. Commit transaction.
7. **Write-through Redis** (after commit, non-blocking): pipeline `SADD members` + `SET role EX 7d` + `EXPIRE 7d` for all members. Eliminates dependency on Kafka MEMBER_ADDED consumer lag for cache warm-up.

### Get Conversation (with participants)

1. Load conversation record
2. Load all members in a single query (`findByConversationIds`)
3. Verify caller is a member (no separate `isMember` round-trip)
4. Return `{ ...conversation, participants: [{ userId, role }, ...] }`

User profile enrichment (username, displayName, avatarUrl) is **not** performed here. The Gateway layer resolves profiles via `UsersGatewayService.getUsersByIds`.

### List Conversations

1. Paginate conversations where the user is a member
2. Load member records only for `direct` conversations (GROUP/COMMUNITY do not expose participant lists at list level)
3. For each `direct` conversation, extract `otherUserId` (the other member)
4. Return raw list: `{ ...conv, otherUserId? }` — no user-profile enrichment

User profile enrichment and avatar URL resolution are handled at the Gateway layer.

### Update Conversation Info

1. Verify caller has `OWNER` or `ADMIN` role
2. Read the current `avatarMediaId` from DB (before update)
3. Apply the field updates (`name`, `description`, `avatarMediaId`)
4. Return `{ conversation, previousAvatarMediaId }` so the caller (Gateway) can delete the old avatar file
5. Write `CONVERSATION_UPDATED` outbox event in same transaction

The Gateway (`ConversationManagementGatewayService`) uses `previousAvatarMediaId` to:
- Immediately bust the Redis avatar URL cache key
- Trigger a soft-fail `deleteAvatarSystem` call to Media Service

### Add / Remove Members

1. Verify caller has `OWNER` or `ADMIN` role.
2. Bulk insert members (`ON CONFLICT DO NOTHING` for idempotency).
3. Update `memberCount` from actual DB count.
4. Write `MEMBER_ADDED` / `MEMBER_REMOVED` outbox event in same transaction.
5. Commit.
6. **Write-through Redis** (after commit, non-blocking): for `addMembers()`, pipeline `SADD + SET role EX 7d + EXPIRE 7d`. Same pattern as createConversation for immediate cache warm-up.

`MembershipCacheConsumer` (Kafka) also handles Redis Set invalidation on receipt of these events (idempotent).

### Leave Conversation (self-remove)

1. Verify caller is a member.
2. Reject if caller is `OWNER` (must disband or transfer ownership first).
3. Delete `conversation_member` row.
4. Update `memberCount` from actual DB count.
5. Write `MEMBER_REMOVED` outbox event (same transaction).
6. Cache bust: `SREM members-set userId` + `DEL role-key`.

### Self-Join via Invite Token

1. `InviteTokenService.validateInviteToken()` verifies JWT signature and `linkVersion` against DB — immediate rejection on version mismatch (revoked link).
2. If `joinApprovalRequired = true` → create a `GroupJoinRequest` (status=pending) and return `{ requiresApproval: true, requestId }`.
3. Otherwise → call `ConversationService.selfJoin()`: insert member with `ON CONFLICT DO NOTHING`, update `memberCount`, write `MEMBER_ADDED` outbox event, write-through Redis cache.

### Group Settings Update

1. `GroupMemberService.updateGroupSettings()` verifies caller has `OWNER` or `ADMIN` role.
2. Apply allowed fields: `allowMemberMessage`, `isPublic`, `joinApprovalRequired`.
3. Write `GROUP.SETTINGS_UPDATED` outbox event (Kafka fan-out → Realtime Gateway).

### Disband Group

1. Verify caller is `OWNER`.
2. Within transaction: delete all `conversation_member` rows, then delete `conversation` record.
3. Write `GROUP.DISBANDED` outbox event — all members notified via WebSocket `group:disbanded`.

### Kick Member

1. Verify caller has `OWNER` or `ADMIN` role.
2. `OWNER` may kick anyone except themselves. `ADMIN` may kick `MEMBER`s only (cannot kick another `ADMIN` or the `OWNER`).
3. Delete `conversation_member` row, update `memberCount`, write `GROUP.MEMBER_KICKED` outbox event.
4. Cache bust for kicked user's membership keys.

### allowMemberMessage Enforcement (Chat Core)

After loading conversation + members, `MessageSendOrchestrator` checks:
- If `conversation.allowMemberMessage === false` AND sender role is not `owner`/`admin` → throw `FORBIDDEN_MEMBER_MESSAGE_RESTRICTED`.
- This is a fast in-process check; no extra TCP round-trip.

---

**Trước**: `INCREMENT_MAX_OFFSET` pattern — TCP call từ message-store → UPDATE conversations SET max_offset + 1 → row lock mỗi message.

**Hiện tại**: Redis Atomic Offset pattern:
1. `MessageAcceptedConsumer` dùng Lua script `INCR_IF_EXISTS` để assign offset từ Redis counter `chat:conv:{id}:max_offset` (O(1), zero DB traffic on warm path).
2. Sau mỗi INCR: `SADD chat:conv:dirty_offsets {conversationId}`.
3. **OffsetSyncJob** (`@Cron('*/5 * * * * *')`): `SMEMBERS dirty_offsets` → batch `UPDATE conversations SET max_offset = :val WHERE max_offset < :val` → `SREM dirty_offsets`.

`INCREMENT_MAX_OFFSET` TCP pattern chỉ dùng cho **cold path** (Redis counter absent sau restart).

`IConversationRepository.syncMaxOffset(conversationId, offset)`: method mới cho OffsetSyncJob.

### Cursor Tracking (Unread / Delivery Status)

Both cursors use monotonic `UPDATE … SET X = GREATEST(X, :value)`:

```sql
UPDATE conversation_member
SET last_seen_offset = GREATEST(last_seen_offset, :offset)
WHERE conversation_id = :id AND user_id = :userId;
```

Unread count = `conversation.maxOffset - member.lastSeenOffset` (O(1), no per-message query).

> **Important**: `updateSeenCursor` and `updateDeliveredCursor` update the DB directly — they do **not** write to the outbox. Cursor updates are internal state changes with no downstream subscribers; publishing them as Kafka events previously caused spurious `conversation:updated` socket broadcasts (5–6 duplicate events per update).

---

## TCP Patterns

### ConversationController patterns

| Pattern | Description |
|---------|-------------|
| `CREATE_CONVERSATION` | Create conversation (all kinds) |
| `GET_CONVERSATION` | Get with membership check |
| `FIND_BY_ID` | Internal lookup, no auth check |
| `LIST_CONVERSATIONS` | Paginated list for user |
| `UPDATE_INFO` | Update name/description/avatarMediaId — returns `{ conversation, previousAvatarMediaId }` |
| `ADD_MEMBERS` | Add members (OWNER/ADMIN only) |
| `REMOVE_MEMBERS` | Remove members (OWNER/ADMIN only) |
| `IS_MEMBER` | Membership check — returns `{ isMember: boolean }` |
| `HAVE_SHARED_CONVERSATION` | Check if two users share any conversation — returns `{ hasShared: boolean }` (used by Media Service for avatar authorization) |
| `GET_MEMBER_IDS` | All member IDs |
| `GET_MEMBERS_WITH_ROLES` | Members with role info |
| `SET_MEMBER_ROLE` | Change member role |
| `INCREMENT_MAX_OFFSET` | Atomic offset increment (cold-path seeding for Redis counter) |
| `UPDATE_LAST_SEEN_OFFSET` | Deprecated alias of `UPDATE_SEEN_CURSOR` (kept for backward compatibility) |
| `UPDATE_SEEN_CURSOR` | Update lastSeenOffset |
| `UPDATE_DELIVERED_CURSOR` | Update lastDeliveredOffset |
| `GET_MEMBER_CURSORS` | Fetch seen/delivered cursors for all members in a conversation |
| `GET_UNREAD_COUNT` | Compute unread for a member |
| `GET_OUTBOX_HEALTH` | Pending outbox event count |
| `GET_USER_CONVERSATION_IDS` | All conversation IDs for a user (used by Realtime GW for fan-out routing) |

### GroupController patterns (cmd prefix: `group_`)

| Pattern | Description |
|---------|-------------|
| `group_disband` | Permanently disband group (OWNER only) |
| `group_update_settings` | Update `allowMemberMessage`, `isPublic`, `joinApprovalRequired` (OWNER/ADMIN) |
| `group_leave_conversation` | Self-remove from group (any member except OWNER) |
| `group_kick_member` | Remove another member (OWNER/ADMIN) |
| `group_generate_invite_link` | Create a signed JWT invite link (OWNER/ADMIN) — 7-day TTL |
| `group_reset_invite_link` | Increment `linkVersion` to revoke all outstanding links (OWNER/ADMIN) |
| `group_join_via_token` | Validate invite token; direct join or create pending join request |
| `group_request_join` | Submit a join request for an approval-required group |
| `group_get_join_requests` | List pending join requests (OWNER/ADMIN) |
| `group_review_join_request` | Approve or reject a pending join request (OWNER/ADMIN) |

---

## Kafka Events Produced (via Outbox)

| Topic | Event | Consumed By |
|-------|-------|-------------|
| `chat.event.conversation_created` | CONVERSATION_CREATED | Realtime Gateway |
| `chat.event.conversation_updated` | CONVERSATION_UPDATED | Realtime Gateway |
| `chat.event.member_added` | MEMBER_ADDED | Realtime Gateway, Conversation Service (cache consumer) |
| `chat.event.member_removed` | MEMBER_REMOVED | Realtime Gateway, Conversation Service (cache consumer), Message Store (system messages) |
| `group.event.settings_updated` | GROUP settings change | Realtime Gateway → `group:settings_updated` WS event |
| `group.event.member_role_changed` | Role change | Realtime Gateway → `group:member_role_changed` WS event |
| `group.event.member_kicked` | Kick | Realtime Gateway → `group:member_kicked` WS event; Message Store → system message |
| `group.event.disbanded` | Group disbanded | Realtime Gateway → `group:disbanded` WS event to all members |
| `group.event.invite_link_reset` | Link revocation | Realtime Gateway → `group:settings_updated` WS event |
| `group.event.join_requested` | New join request | Realtime Gateway → `group:join_requested` WS event to all members |
| `group.event.join_approved` | Request approved | Realtime Gateway → `group:join_approved` WS event to requester |
| `group.event.join_rejected` | Request rejected | Realtime Gateway → `group:join_rejected` WS event to requester |

> All `group.event.*` topics use `conversationId` as the Kafka message key for strict FIFO ordering per group.

---

## Kafka Events Consumed

| Topic | Consumer | Action |
|-------|----------|--------|
| `friendship.request.accepted` | `FriendshipEventConsumer` | Auto-create `direct` conversation for the two users |
| `chat.event.member_added` | `MembershipCacheConsumer` | `SADD chat:conversation:{id}:members {userId}` |
| `chat.event.member_removed` | `MembershipCacheConsumer` | `SREM chat:conversation:{id}:members {userId}` |

The membership Redis Set (key: `chat:conversation:{conversationId}:members`) is the real-time cache used by Chat Core for O(1) membership validation via `SISMEMBER`.

---

## Outbox Pattern

`ConversationOutboxProcessor` extends the `OutboxProcessor` base class from `@app/database-postgres`. It:
- Polls `outbox_events` table at `OUTBOX_INTERVAL_MS` interval (default: 30 000 ms)
- Atomically claims a batch via `claimPendingEvents()` (SQL UPDATE with `lockedBy`/`lockedAt`) — safe for multi-instance deployments
- Publishes to Kafka, then marks events as `COMPLETED` or `FAILED`
- `/health/outbox` endpoint exposes pending event count for monitoring

---

## Module Structure

```typescript
@Module({
  imports: [
    SharedConfigModule,
    TcpTransport,          // TCP microservice transport
    DatabasePostgresModule, // TypeORM: conversation, conversation_member, outbox, poll, appointment, group_join_requests
    KafkaModule,           // Kafka producer (outbox) + consumers
    CacheModule,           // Redis for membership sets
    GroupModule,           // Group management sub-module (services, controller, guards, producers)
    // Note: Users Service TCP client removed — user-profile enrichment is done
    // at the Gateway layer (ConversationGatewayService) to keep this service
    // free of a Users dependency.
  ],
  providers: [
    ConversationService,
    ConversationRepository,
    ConversationMemberRepository,
    OutboxRepository,
    ConversationOutboxProcessor,
    FriendshipEventConsumer,
    MembershipCacheConsumer,
    OffsetSyncJob,           // @Cron(*/5 * * * * *) — write-behind Redis→PG
  ],
  controllers: [
    ConversationController,
    GroupController,         // GROUP_PATTERNS handlers (group management)
    HealthController,
  ],
})
export class ConversationModule {}
```

### GroupModule (sub-module)

```typescript
@Module({
  providers: [
    GroupMemberService,        // disband, kick, update settings
    InviteTokenService,        // JWT invite link generation and validation
    GroupJoinRequestService,   // join request lifecycle
    PollService,               // poll CRUD with pessimistic-lock vote
    AppointmentService,        // appointment CRUD + BullMQ reminder scheduling
    AppointmentWorker,         // BullMQ worker: fires group.event.appointment_reminder
    GroupEventProducer,        // Kafka producer for group.event.* topics
    GroupRoleGuard,            // Guard: verifies caller role from Redis membership cache
  ],
})
export class GroupModule {}
```

---

## Configuration

```bash
CONVERSATION_SERVICE_HOST=localhost
CONVERSATION_SERVICE_PORT=3007

POSTGRES_HOST=localhost
POSTGRES_PORT=5433        # chat-db container (host port)
POSTGRES_USERNAME=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DATABASE=chat_db

KAFKA_BROKERS=localhost:9092
OUTBOX_INTERVAL_MS=30000

REDIS_CHAT_HOST=localhost
REDIS_CHAT_PORT=6380      # redis-chat container (host port)
REDIS_CHAT_DB=0

# Group management
INVITE_JWT_SECRET=change-me-in-production   # signs invite-link JWTs
APP_BASE_URL=https://zolo-smoky.vercel.app  # base URL prepended to invite links
```

---

## Business Rules

- `direct`: always exactly 2 members; type is immutable; created automatically on friendship acceptance
- `group`: manual member management; `OWNER`/`ADMIN` add/remove; supports invite links, join requests, polls, appointments
- `community`: only `OWNER`/`ADMIN` may post; all other members are `MEMBER` (react only)
- `createdBy` always receives `OWNER` role on creation
- At least one `OWNER` must remain in any conversation (enforced before remove)
- Valid roles: `owner`, `admin`, `member` (lowercase, matches DB constraint)
- `OWNER` cannot leave a group — must disband or transfer ownership first
- `allowMemberMessage = false` → only `OWNER`/`ADMIN` may send messages (enforced in Chat Core, not here)
- `linkVersion` increments on `resetInviteLink()` — all previously issued JWTs immediately invalid
- Invite JWT payload contains `{ conversationId, linkVersion, iat, exp }` — 7-day TTL

