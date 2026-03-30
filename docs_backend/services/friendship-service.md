# Friendship Service

**Port**: 3008 (TCP Microservice)  
**Technology**: NestJS + TCP Transport  
**Database**: PostgreSQL (users_db schema)  
**Cache**: Redis (friend lists with 5-minute TTL)

---

##  Purpose

Manages social relationships: friend requests, friendships, and block status with bidirectional consistency.

---

##  Architecture Pattern: **Transactional Outbox**

All state-changing operations use **DataSource transactions** to ensure atomicity between:
1. Database writes (Friendship, FriendRequest, Block tables)
2. Outbox event writes (for Kafka publishing)
3. Cache invalidation

This prevents inconsistencies like:
-  Database committed but Kafka event lost
-  Cache shows stale data after DB update
-  Race conditions in bidirectional updates

---

##  Database Schema

### Tables

**friendship** (Bidirectional records)
```sql
userId         VARCHAR (PK, part 1)
targetUserId   VARCHAR (PK, part 2)
status         ENUM('FRIEND', 'PENDING_IN', 'PENDING_OUT', 'BLOCKED')
createdAt      TIMESTAMP
```

**friend_request** (Source of truth for pending requests)
```sql
id             UUID (PK)
fromUserId     VARCHAR (indexed)
toUserId       VARCHAR (indexed)
status         ENUM('PENDING', 'ACCEPTED', 'REJECTED')
createdAt      TIMESTAMP
UNIQUE(fromUserId, toUserId)
```

**block** (Source of truth for blocks)
```sql
id             SERIAL (PK)
userId         VARCHAR (blocker)
blockedUserId  VARCHAR (blocked user)
createdAt      TIMESTAMP
UNIQUE(userId, blockedUserId)
```

---

##  Key Workflows

### 1. Send Friend Request

**Input**: `userId` sends request to `targetUserId`

**Transaction Steps**:
1. Validate: Check if already friends or blocked
2. Create `FriendRequest` record with `status=PENDING`
3. Insert bidirectional `Friendship` records:
   - `(userId → targetUserId, status=PENDING_OUT)`
   - `(targetUserId → userId, status=PENDING_IN)`
4. Write to `outbox` table: `eventType='friend.request_sent'`
5. Invalidate cache for both users
6. **Commit transaction** → All-or-nothing

**Outbox Event** → Kafka:
- Topic: `friendship.request_sent`
- Payload: `{ eventId, fromUser: userId, toUser: targetUserId, timestamp }`
- Kafka Key: `friendship:${pairKey}` (deterministic: sorted user IDs)

---

### 2. Accept Friend Request

**Input**: `userId` accepts request from `fromUserId`

**Transaction Steps**:
1. Validate: Check if incoming request exists (`PENDING_IN`)
2. Update both `Friendship` records to `status=FRIEND`
3. Update `FriendRequest` to `status=ACCEPTED`
4. Write to `outbox`: `eventType='friend.request_accepted'`
5. Invalidate cache for both users
6. **Commit transaction**

**Outbox Event** → Kafka:
- Topic: `friendship.request_accepted`
- Payload: `{ eventId, userA, userB, timestamp }`
- Kafka Key: `friendship:${pairKey}`

**Downstream Effect**:
- Conversation Service creates DIRECT conversation automatically

---

### 3. Block User

**Input**: `userId` blocks `targetUserId`

**Transaction Steps**:
1. Delete any existing `Friendship` and `FriendRequest` records (both directions)
2. Insert into `Block` table: `(userId, blockedUserId)`
3. Insert `Friendship` record: `(userId → targetUserId, status=BLOCKED)` (for compatibility)
4. Write to `outbox`: `eventType='user.blocked'`
5. Invalidate cache for both users
6. **Commit transaction**

**Outbox Event** → Kafka:
- Topic: `friendship.blocked`
- Payload: `{ eventId, blocker: userId, blocked: targetUserId, timestamp }`

**Downstream Effect**:
- Conversation Service archives DIRECT conversation
- Presence Service stops sharing online status

---

### 4. Get Friend Status

**Input**: `userId`, `targetUserId`

**Logic**:
1. **Check `Block` table first** (source of truth):
   - If blocked by either user → Return `status=BLOCKED`
2. Check `Friendship` table:
   - Return actual status or `NONE` if no record

**Response**:
```json
{
  "userId": "user1",
  "targetUserId": "user2",
  "status": "FRIEND" | "PENDING_IN" | "PENDING_OUT" | "BLOCKED" | "NONE"
}
```

---

### 5. Get Block Status

**Input**: `userId`, `targetUserId`

**Logic** (used by Chat Core for bidirectional check):
1. Query `Block` table twice:
   - `isBlockedByMe = exists(userId, targetUserId)`
   - `isBlockedByOther = exists(targetUserId, userId)`

**Response**:
```json
{
  "userId": "user1",
  "targetUserId": "user2",
  "blocked": {
    "byMe": false,
    "byOther": true
  }
}
```

---

##  Bidirectional Consistency

All friendship operations create **two records** to enable efficient queries from either perspective:

```typescript
// User A → User B (outgoing)
{ userId: 'A', targetUserId: 'B', status: 'PENDING_OUT' }

// User B → User A (incoming)
{ userId: 'B', targetUserId: 'A', status: 'PENDING_IN' }
```

**Why?**
-  O(1) query: `SELECT * FROM friendship WHERE userId=? AND targetUserId=?`
-  No need for `OR` clauses or bidirectional checks in SQL
-  Each user has their own perspective

---

##  TCP Patterns (Consumed)

| Pattern | Description | Response |
|---------|-------------|----------|
| `SEND_FRIEND_REQUEST` | Send friend request | `{ success: true, message }` |
| `ACCEPT_FRIEND_REQUEST` | Accept incoming request | `{ success: true, message }` |
| `REJECT_FRIEND_REQUEST` | Reject incoming or cancel outgoing | `{ success: true, message }` |
| `UNFRIEND` | Remove friendship | `{ success: true, message }` |
| `BLOCK_USER` | Block user (overrides all statuses) | `{ success: true, message }` |
| `UNBLOCK_USER` | Remove block | `{ success: true, message }` |
| `GET_FRIENDS` | Get friend list (with cache) | `{ friends: string[], fromCache: boolean }` |
| `GET_PENDING_REQUESTS` | Get incoming/outgoing requests | `{ incoming: string[], outgoing: string[] }` |
| `GET_FRIEND_STATUS` | Check status between two users | `{ userId, targetUserId, status }` |
| `GET_BLOCK_STATUS` | Check bidirectional block status | `{ userId, targetUserId, blocked: { byMe, byOther } }` |
| `IS_FRIEND` | Boolean check (used by ChatCore) | `boolean` (false if either blocks) |

---

##  Kafka Topics (Produced via Outbox)

| Topic | Event Type | Purpose | Consumed By |
|-------|------------|---------|-------------|
| `friendship.request_sent` | `friend.request_sent` | Notify friend request | Realtime Gateway (notification) |
| `friendship.request_accepted` | `friend.request_accepted` | Auto-create DIRECT conversation | Conversation Service |
| `friendship.removed` | `friend.removed` | Friendship ended | Realtime Gateway (notification) |
| `friendship.blocked` | `user.blocked` | Archive conversation, hide status | Conversation, Presence |
| `friendship.unblocked` | `user.unblocked` | Restore access | Presence |
| `friendship.request_rejected` | `friend.request_rejected` | Notify rejection | Realtime Gateway (notification) |

---

##  Outbox Pattern Implementation

### Outbox Processor Service

**Cron Job**: Runs every **5 seconds**

**Steps**:
1. Fetch unpublished outbox events (limit: 100)
2. Publish to Kafka with retry logic
3. Mark events as `published=true`
4. Delete old published events (> 7 days)

**Benefits**:
-  Guarantees "at-least-once" delivery (event survives even if Kafka is down)
-  No distributed transaction complexity (2PC not needed)
-  Survives service crashes (events are durable in PostgreSQL)

**Event Structure**:
```typescript
{
  aggregateType: 'friendship',
  aggregateId: 'friendship:user1-user2', // Deterministic pair key
  eventType: 'friend.request_accepted',
  kafkaTopic: 'friendship.request_accepted',
  kafkaKey: 'friendship:user1-user2',
  payload: { eventId, userA, userB, timestamp },
  published: false,
  createdAt: new Date()
}
```

---

##  Cache Strategy

**Key Format**: `friends:{userId}`

**TTL**: 300 seconds (5 minutes)

**Invalidation Points**:
- After `sendFriendRequest` (both users)
- After `acceptFriendRequest` (both users)
- After `unfriend` (both users)
- After `blockUser` (both users)
- After `unblockUser` (both users)

**Cache Hit**: `getFriends` returns cached friend IDs without DB query

---

##  Configuration (Environment Variables)

```bash
# TCP Server
FRIENDSHIP_SERVICE_HOST=localhost
FRIENDSHIP_SERVICE_PORT=3003

# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USERNAME=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DATABASE=users_db

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Kafka
KAFKA_CLIENT_ID=nest-api-system
KAFKA_BROKERS=localhost:9092
```

---

##  Business Rules

### Friend Requests
-  Cannot send request to yourself
-  Cannot send request if already friends
-  Cannot send request if blocked (either direction)
-  Can cancel outgoing request via `REJECT_FRIEND_REQUEST`

### Blocking
-  Block overrides all other statuses (auto-deletes friendship/requests)
-  Cannot send messages/requests while blocked
-  Bidirectional: Both users cannot interact

### Consistency
-  All state changes are atomic (transaction + outbox)
-  Cache invalidated after every mutation
-  Block table is source of truth (checked first in status queries)

---

##  Module Structure

```typescript
@Module({
  imports: [
    SharedConfigModule,
    TcpTransport,
    DatabasePostgresModule, // Friendship, FriendRequest, Block, Outbox
    CacheModule, // Redis
    KafkaModule, // For OutboxProcessor
  ],
  providers: [
    FriendshipService,
    FriendshipRepository,
    OutboxRepository,
    OutboxProcessorService, // Cron job every 5s
  ],
})
export class FriendshipServiceModule {}
```

---

##  Code References

- Service: [FriendshipService](../../apps/friendship-service/src/friendship.service.ts)
- Repository: [FriendshipRepository](../../apps/friendship-service/src/infrastructure/friendship.repository.ts)
- Outbox Processor: [OutboxProcessorService](../../apps/friendship-service/src/infrastructure/outbox-processor.service.ts)
- Controller: [FriendshipController](../../apps/friendship-service/src/friendship.controller.ts)
- Entities: [Friendship](../../apps/friendship-service/src/domain/entities/friendship.entity.ts), [FriendRequest](../../apps/friendship-service/src/domain/entities/friend-request.entity.ts), [Block](../../apps/friendship-service/src/domain/entities/block.entity.ts)

### Key Implementation Details

**Transaction + Outbox Pattern**:
```typescript
await this.dataSource.transaction(async (manager) => {
  // 1. Business logic with manager.getRepository()
  const friendshipRepo = manager.getRepository(Friendship);
  await friendshipRepo.save([...]);

  // 2. Write to outbox within same transaction
  await this.outboxRepository.create({
    aggregateType: 'friendship',
    aggregateId: `friendship:${this.getPairKey(userA, userB)}`,
    eventType: 'friend.request_accepted',
    kafkaTopic: KAFKA_TOPICS.FRIENDSHIP.REQUEST_ACCEPTED,
    payload: { ... },
  }, manager);
  
  // 3. All commits together or rolls back
});

// 4. Cache invalidation after successful transaction
await this.invalidateFriendCache(userA);
await this.invalidateFriendCache(userB);
```

**Deterministic Pair Key** (for Kafka partitioning):
```typescript
private getPairKey(userA: string, userB: string): string {
  return [userA, userB].sort().join('-'); // Always 'alice-bob', never 'bob-alice'
}
```

**Block Status Check** (source of truth):
```typescript
async isFriend(userId: string, targetUserId: string): Promise<boolean> {
  // Check Block table first
  const isBlockedByUser = await this.friendshipRepository.isBlocked(userId, targetUserId);
  const isBlockedByTarget = await this.friendshipRepository.isBlocked(targetUserId, userId);
  
  if (isBlockedByUser || isBlockedByTarget) {
    return false; // Block overrides Friendship table
  }
  
  // Then check Friendship table
  const friendship = await this.friendshipRepository.findFriendship(userId, targetUserId);
  return friendship?.status === FriendshipStatus.FRIEND;
}
```
