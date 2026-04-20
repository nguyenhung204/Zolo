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
| `community` | Unlimited | Broadcast channel; only OWNER/ADMIN/MODERATOR can post; MEMBER/GUEST can only react |

---

## Domain Model

### conversation entity

```
id                UUID (PK)
type              ENUM('direct', 'group', 'community')
name              VARCHAR (NULL for direct)
description       TEXT
avatarMediaId     VARCHAR(36) (NULL — UUID of the media record in Media Service)
memberCount       INT (denormalized)
maxOffset         BIGINT (monotonic message counter, 0-indexed)
createdBy         VARCHAR (owner userId, Keycloak ID)
metadata          JSONB  { settings?: { retentionDays?, allowGuestPost?, allowMemberUpload? } }
createdAt         TIMESTAMP
updatedAt         TIMESTAMP
```

> Note: Presigned avatar URLs are resolved at the Gateway layer on every list/detail request — they are never stored in the database.

### conversation_member entity

```
conversationId        UUID (PK, FK)
userId                VARCHAR (PK, Keycloak ID)
role                  VARCHAR(20) CHECK IN ('owner','admin','moderator','member','guest')
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

### Offset Management (Redis Atomic INCR + OffsetSyncJob)

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

---

## TCP Patterns

| Pattern | Description |
|---------|-------------|
| `CREATE_CONVERSATION` | Create conversation (all kinds) |
| `GET_CONVERSATION` | Get with membership check |
| `FIND_BY_ID` | Internal lookup, no auth check |
| `LIST_CONVERSATIONS` | Paginated list for user |
| `UPDATE_INFO` | Update name/description/avatarMediaId — returns `{ conversation, previousAvatarMediaId }` |
| `ADD_MEMBERS` | Add members (OWNER/ADMIN only) |
| `REMOVE_MEMBERS` | Remove members (OWNER/ADMIN only) |
| `IS_MEMBER` | Membership check (boolean) |
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

---

## Kafka Events Produced (via Outbox)

| Topic | Event | Consumed By |
|-------|-------|-------------|
| `chat.event.conversation_created` | CONVERSATION_CREATED | Realtime Gateway |
| `chat.event.conversation_updated` | CONVERSATION_UPDATED | Realtime Gateway |
| `chat.event.member_added` | MEMBER_ADDED | Realtime Gateway, Conversation Service (cache consumer) |
| `chat.event.member_removed` | MEMBER_REMOVED | Realtime Gateway, Conversation Service (cache consumer) |

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
    DatabasePostgresModule, // TypeORM: conversation, conversation_member, outbox
    KafkaModule,           // Kafka producer (outbox) + consumers
    CacheModule,           // Redis for membership sets
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
})
export class ConversationModule {}
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
```

---

## Business Rules

- `direct`: always exactly 2 members; type is immutable; created automatically on friendship acceptance
- `group`: manual member management; `OWNER`/`ADMIN` add/remove
- `community`: only `OWNER`/`ADMIN`/`MODERATOR` may post; all other members are `MEMBER` (react only) or `GUEST` (react only)
- `createdBy` always receives `OWNER` role on creation
- At least one `OWNER` must remain in any conversation (enforced before remove)
- Valid roles: `owner`, `admin`, `moderator`, `member`, `guest` (lowercase, matches DB constraint)
