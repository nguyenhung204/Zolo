# Membership Cache Architecture

## Problem
ChatCore needs to validate membership quickly for every message:
- **Before**: ChatCore queried Conversation Service via TCP (high latency, ~10 ms per message)
- **Before**: ChatCore cached membership with a 1-hour TTL (stale cache issue)
- **Problem**: User kicked from group could still send messages until TTL expiry
- **Problem**: Role was not cached — every role-based check required a TCP call

## Solution: Event-Driven Redis Cache (Cache-First)

### Architecture

```
Conversation Service (Source of Truth)
    ↓ DB write + outbox event (same transaction)
    ↓
Kafka → MembershipCacheConsumer (CONVERSATION_CACHE_UPDATER group)
    ↓
Redis:
  chat:conversation:{id}:members            (Set of userIds)
  chat:conversation:{id}:members:{uid}:role (String with member role)
    ↑
ChatCore MembershipValidatorService
  1. redis.sismember(key, userId)     → O(1) membership
  2. redis.get(roleKey)               → O(1) role (skips TCP if hit)
  3. TCP fallback if Redis unavailable
```

Additionally, to avoid a TCP call on every DIRECT-conversation block check:

```
Friendship Service
    ↓ publishes FRIENDSHIP.BLOCKED / FRIENDSHIP.UNBLOCKED events
    ↓
Kafka → FriendshipBlockConsumer (CHAT_CORE_BLOCK_CACHE group, in Chat Core)
    ↓
Redis: chat:friendship:block:{blockerId}:{blockedId}  (String "1", TTL 24h)
    ↑
MessageSendOrchestrator (fast-path before TCP to Friendship Service)
```

---

## Flows

### 1. Member Added

```typescript
// Conversation Service — conversation.service.ts
// DB write and outbox save in the same transaction:
await entityManager.save(ConversationMember, { conversationId, userId, role });
await outboxRepository.create(entityManager, {
  topic: KAFKA_TOPICS.MEMBER_ADDED,
  payload: JSON.stringify({ conversationId, userIds: [userId], roles: { [userId]: role } }),
});

// → OutboxProcessor publishes after commit
// → MembershipCacheConsumer.handleMemberAdded():
const key = `chat:conversation:${conversationId}:members`;
await redis.sadd(key, userId);
await redis.set(`${key}:${userId}:role`, role, 'EX', 604800); // 7 days
await redis.expire(key, 604800);

// Immediate bust also happens in-process (before Kafka round-trip):
// conversation.service.ts removes SREM / DEL role key directly after the DB commit
```

### 2. Member Removed

Two invalidation paths run in parallel (defense-in-depth):

**Path A — Immediate (in-process, conversation.service.ts)**:
```typescript
// Runs right after the DB transaction commits, before Kafka event arrives
const pipeline = redis.pipeline();
pipeline.srem(membersKey, userId);
pipeline.del(`${membersKey}:${userId}:role`);
await pipeline.exec().catch(() => {}); // soft-fail
```

**Path B — Event-driven (MembershipCacheConsumer)**:
```typescript
// handleMemberRemoved() after MEMBER_REMOVED Kafka event
const pipeline = redis.pipeline();
pipeline.srem(key, ...userIds);
for (const uid of userIds) pipeline.del(`${key}:${uid}:role`);
await pipeline.exec();
```

Both paths are idempotent: `SREM` and `DEL` on a non-existent key are no-ops.

### 3. ChatCore Validation (implemented, cache-first)

```typescript
// MembershipValidatorService
const membersKey = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversationId);
const isMember = await redis.sismember(membersKey, userId);  // O(1)

// Role lookup (avoids TCP on cache hit)
const roleKey = `${membersKey}:${userId}:role`;
const cachedRole = await redis.get(roleKey);
if (cachedRole) return { isMember: true, role: cachedRole };

// TCP fallback only when Redis misses
const membership = await conversationServiceAdapter.getMembership(userId, conversationId);
```

### 4. Friendship Block Check (fast-path in MessageSendOrchestrator)

```typescript
// Before TCP call to Friendship Service:
const [isBlocked, isBlockedBy] = await redis
  .mget(
    REDIS_KEYS.CHAT.FRIENDSHIP_BLOCK(senderId, receiverId),
    REDIS_KEYS.CHAT.FRIENDSHIP_BLOCK(receiverId, senderId),
  )
  .catch(() => [null, null]); // Redis failure → fall through to TCP

if (isBlocked || isBlockedBy) {
  throw new ForbiddenException('FORBIDDEN_BLOCKED_USER');
}
// TCP call only on cache miss:
const status = await friendshipService.getFriendshipStatus(senderId, receiverId);
```

---

## Redis Keys Reference

| Key Pattern | Type | TTL | Set by | Read by |
|-------------|------|-----|--------|---------|
| `chat:conversation:{id}:members` | Set | 7 days | `MembershipCacheConsumer` + `conversation.service.ts` | `MembershipValidatorService` |
| `chat:conversation:{id}:members:{uid}:role` | String | 7 days | `MembershipCacheConsumer` + `membership-validator.service.ts` | `MembershipValidatorService` |
| `chat:friendship:block:{blockerId}:{blockedId}` | String | 24 hours | `FriendshipBlockConsumer` (Chat Core) | `MessageSendOrchestrator` |

### Operations
- **Check membership**: `SISMEMBER chat:conversation:123:members user456` → O(1)
- **Get role**: `GET chat:conversation:123:members:user456:role` → O(1)
- **Check block**: `MGET chat:friendship:block:A:B chat:friendship:block:B:A` → O(1)
- **Remove member**: `SREM` + `DEL role key` in pipeline → O(1)

---

## Consumer Groups

| Consumer | Group ID | Topics | Service |
|----------|----------|--------|---------|
| `MembershipCacheConsumer` | `nest-chat.conversation-service.cache-updater` | `MEMBER_ADDED`, `MEMBER_REMOVED` | Conversation Service |
| `FriendshipBlockConsumer` | `nest-chat.chat-core.block-cache` | `FRIENDSHIP.BLOCKED`, `FRIENDSHIP.UNBLOCKED` | Chat Core |

---

## TTL Policy

| Key family | TTL | Rationale |
|------------|-----|-----------|
| Members Set | 7 days | Long enough to survive weekend Kafka lag; event-driven invalidation is primary |
| Role String | 7 days | Same as members set for consistency (also written by TCP fallback path) |
| Role key written by TCP fallback | 7 days | Previously 1 hour — fixed to prevent TTL mismatch overwriting event cache |
| Block key | 24 hours | Block/unblock cycles are infrequent; 24h cap prevents unbounded growth |

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Consumer crash on `MEMBER_ADDED` | DLQ routing; TCP fallback in Chat Core remains authoritative |
| Redis unavailable (read) | `catch(() => [null, null])` → fall through to TCP; system degrades gracefully |
| Redis unavailable (write in consumer) | Log + swallow error; TCP fallback handles correctness |
| Kafka lag > outbox interval | Immediate in-process bust guarantees timely invalidation for `removeMembers()` |
| Block key expired before UNBLOCKED arrives | Safe: expired key = cache miss → TCP fallback re-checks Friendship Service |

---

## Security Notes

- **Fail-closed on membership**: cache miss falls back to authoritative TCP. A Redis outage cannot grant access.
- **Fail-closed on block**: same pattern. Cache miss → TCP → block enforced.
- **Immediate invalidation on remove**: the in-process `redis.pipeline()` bust in `conversation.service.ts` prevents the window where a kicked user sends messages before the Kafka event propagates (reduces stale window from ≤30 s to near-zero).
- **Two-direction block check**: `MGET` checks both `A→B` and `B→A` simultaneously, ensuring `isBlockedBy` is also cached.

---

## Comparison

| Approach | Latency | Stale risk | Implementation complexity |
|----------|---------|-----------|--------------------------|
| Pure TCP call | ~10 ms | None | Low |
| TTL cache (old) | < 1 ms | Yes (up to TTL) | Low |
| Event-driven cache (current) | < 1 ms | Near-zero (dual invalidation) | Medium |
- If both Redis and Conversation Service down → messages rejected (correct behavior)

This ensures security: **Cannot bypass membership validation** even during service failures.
