# Conversation Service

**Port**: 3007 (TCP Microservice)
**Technology**: NestJS + TCP Transport
**Database**: PostgreSQL (chat_db)
**Cache**: Redis (membership sets, DB 0)
**Pattern**: Transactional Outbox

---

## Purpose

Manages conversation lifecycle and membership for all conversation kinds: DIRECT, DEPARTMENT, PROJECT, and ANNOUNCEMENT. Publishes membership change events to Kafka so that downstream services (Realtime Gateway, membership cache) can react in real time.

---

## Conversation Kinds

| Kind | Members | Use Case |
|------|---------|----------|
| `DIRECT` | Exactly 2 | One-on-one chat, created automatically on friendship acceptance |
| `DEPARTMENT` | Unlimited | Department-wide channel, membership auto-synced by HR events |
| `PROJECT` | Manual list | Project team channel, manually managed membership |
| `ANNOUNCEMENT` | Unlimited | Broadcast channel; only OWNER/ADMIN/MODERATOR can post |

---

## Domain Model

### conversation entity

```
id                UUID (PK)
type              ENUM('DIRECT', 'DEPARTMENT', 'PROJECT', 'ANNOUNCEMENT')
name              VARCHAR (NULL for DIRECT)
description       TEXT
memberCount       INT (denormalized)
maxOffset         BIGINT (monotonic message counter, 0-indexed)
createdBy         VARCHAR (owner userId)
orgId             VARCHAR (tenant isolation)
metadata          JSONB  { kind, departmentId?, projectId? }
createdAt         TIMESTAMP
updatedAt         TIMESTAMP
```

### conversation_member entity

```
id                    UUID (PK)
conversationId        UUID (FK)
userId                VARCHAR
role                  ENUM('OWNER','ADMIN','MODERATOR','MEMBER','GUEST','READONLY')
lastSeenOffset        BIGINT DEFAULT 0
lastDeliveredOffset   BIGINT DEFAULT 0
joinedAt              TIMESTAMP

UNIQUE(conversationId, userId)
INDEX(userId)
INDEX(conversationId, lastSeenOffset)
INDEX(conversationId, lastDeliveredOffset)
```

### outbox_events entity (shared, in chat_db)

Used by OutboxProcessor to publish events to Kafka atomically within the same transaction. Columns include `lockedBy` and `lockedAt` for multi-instance atomic claim.

---

## Key Workflows

### Create Conversation

1. Normalize memberIds (include createdBy, deduplicate)
2. Insert `conversation` record with correct `memberCount`
3. Bulk insert `conversation_member` records; `createdBy` gets `OWNER` role, others get `MEMBER`
4. For `DIRECT`: enforce idempotency via unique index on sorted pair — catch `23505` conflict and return existing conversation
5. Write `CONVERSATION_CREATED` outbox event in same transaction
6. Commit

### Add / Remove Members

1. Verify caller has `OWNER` or `ADMIN` role
2. Bulk insert members (`ON CONFLICT DO NOTHING` for idempotency)
3. Update `memberCount` from actual DB count
4. Write `MEMBER_ADDED` / `MEMBER_REMOVED` outbox event in same transaction
5. Commit

`MembershipCacheConsumer` (Kafka) handles Redis Set invalidation on receipt of these events.

### Offset Management

`INCREMENT_MAX_OFFSET` atomically increments `conversation.maxOffset` and returns the new value. Called by Message Store before persisting a message to assign a unique, ordered offset.

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
| `UPDATE_INFO` | Update name/description |
| `ADD_MEMBERS` | Add members (OWNER/ADMIN only) |
| `REMOVE_MEMBERS` | Remove members (OWNER/ADMIN only) |
| `IS_MEMBER` | Membership check (boolean) |
| `GET_MEMBER_IDS` | All member IDs |
| `GET_MEMBERS_WITH_ROLES` | Members with role info |
| `SET_MEMBER_ROLE` | Change member role |
| `INCREMENT_MAX_OFFSET` | Atomic offset increment |
| `UPDATE_SEEN_CURSOR` | Update lastSeenOffset |
| `UPDATE_DELIVERED_CURSOR` | Update lastDeliveredOffset |
| `GET_MEMBER_CURSORS` | Fetch both cursors for a member |
| `GET_UNREAD_COUNT` | Compute unread for a member |
| `GET_OUTBOX_HEALTH` | Pending outbox event count |

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
| `friendship.request.accepted` | `FriendshipEventConsumer` | Auto-create DIRECT conversation for the two users |
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
    UsersTcpClient,        // TCP client for Users Service
  ],
  providers: [
    ConversationService,
    ConversationRepository,
    ConversationMemberRepository,
    OutboxRepository,
    ConversationOutboxProcessor,
    FriendshipEventConsumer,
    MembershipCacheConsumer,
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

- `DIRECT`: always exactly 2 members; type is immutable; created automatically on friendship acceptance
- `DEPARTMENT`: membership is controlled externally via HR events (add/remove triggers Kafka events); direct manual add is allowed for `GUEST` role only
- `PROJECT`: manual member management; `OWNER`/`ADMIN` add/remove
- `ANNOUNCEMENT`: only `OWNER`/`ADMIN`/`MODERATOR` may post; all other members are `MEMBER` (read) or `READONLY`
- `createdBy` always receives `OWNER` role on creation
- At least one `OWNER` must remain in any conversation (enforced before remove)
- All queries filter by `orgId` (tenant isolation boundary)
