# Membership Cache Architecture

## Problem
ChatCore cần validate membership nhanh cho mỗi message:
- **Trước**: ChatCore query Conversation Service via TCP (~10ms/message)
- **Trước**: Membership cache TTL 1 giờ → user bị kick vẫn gửi được message
- **Trước**: Role không được cache → mỗi role check cần 1 TCP call
- **Trước (DIRECT)**: Friendship status check qua TCP đến friendship-service mỗi message

## Solution: Multi-Layer Cache (L1 in-process + L0 Redis + TCP fallback)

### Architecture

```
Conversation Service (Source of Truth — PostgreSQL)
    │
    ├─ Write-through: sau DB commit → pipeline SADD + SET role vào Redis ngay
    │    (loại bỏ phụ thuộc Kafka consumer lag cho cache warm-up)
    │
    └─ Outbox event → Kafka → MembershipCacheConsumer (cache-updater group)
                                  (idempotent: SADD / SET là no-op nếu đã có)

Redis:
  {REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(id)}      (Set of userIds)
  {REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(id)}:{uid}:role  (String role)
    ↑
ChatCore MembershipValidatorService — 3 layers:
  L1: in-process Map cache (30s TTL, singleflight)
  L0: Redis pipeline SISMEMBER + GET role (1 round-trip)
  L3: TCP fallback to conversation-service (singleflight)
```

Friendship/block/friends cache (DIRECT message validation):

```
FriendshipBlockConsumer (Chat Core, CHAT_CORE_BLOCK_CACHE group)
  ← FRIENDSHIP.BLOCKED / FRIENDSHIP.UNBLOCKED
  → {chat:rel:{lo}:{hi}}:block:{blockerId}:{blockedId}  TTL 24h

FriendshipFriendsConsumer (Chat Core, CHAT_CORE_FRIEND_CACHE group)
  ← FRIENDSHIP.REQUEST_ACCEPTED / FRIENDSHIP.REMOVED
  → {chat:rel:{lo}:{hi}}:friends  (LWW +brokerTs / -brokerTs)  TTL 30d/60s

FRIENDSHIP_PROOF (Gateway, set synchronously on accept-friend)
  → {chat:rel:{lo}:{hi}}:proof = "1"  TTL 30s
    (30s race-condition bridge: covers Kafka consumer lag at accept-friend moment)

MessageSendOrchestrator
  → Single Redis MGET(block_A_B, block_B_A, friends, proof)
    All 4 keys share hash tag {chat:rel:{lo}:{hi}} → single Redis slot
```

---

## Flows

### 1. Member Added (Write-through + Kafka)

```typescript
// ConversationService.createConversation() / addMembers() — sau DB commit
const memberCacheKey = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversation.id);
const pipeline = redis.pipeline();
pipeline.sadd(memberCacheKey, ...memberIds);
for (const uid of memberIds) {
  const role = uid === createdBy ? MemberRole.OWNER : MemberRole.MEMBER;
  pipeline.set(`${memberCacheKey}:${uid}:role`, role, 'EX', 7 * 24 * 3600);
}
pipeline.expire(memberCacheKey, 7 * 24 * 3600);
await pipeline.exec().catch(err => logger.warn('Cache write-through non-critical', err));
// Sau đó Kafka event cũng đến → idempotent (SADD / SET overwrite với cùng giá trị)
```

### 2. Member Removed (Two-path invalidation)

**Path A — Immediate (in-process)**: sau DB transaction commit, trước Kafka event đến:
```typescript
const pipeline = redis.pipeline();
pipeline.srem(membersKey, userId);
pipeline.del(`${membersKey}:${userId}:role`);
await pipeline.exec().catch(() => {}); // soft-fail
```

**Path B — Event-driven (MembershipCacheConsumer)**: đến sau qua Kafka:
```typescript
// handleMemberRemoved() — idempotent
pipeline.srem(key, ...userIds);
for (const uid of userIds) pipeline.del(`${key}:${uid}:role`);
```

### 3. ChatCore Validation — 3 layers

```typescript
// MembershipValidatorService.validateMembership(userId, conversationId)

// Layer 1: in-process Map (30s TTL)
const memKey = `${userId}:${conversationId}`;
const cached = this.membershipCache.get(memKey);
if (cached && Date.now() < cached.validUntil) return { isMember: cached.isMember, ... };

// Layer 0: Redis pipeline (SISMEMBER + GET role — 1 round-trip)
const cacheKey = REDIS_KEYS.CHAT.CONVERSATION_MEMBERS(conversationId);
const roleKey = `${cacheKey}:${userId}:role`;
const [[, isMember], [, role]] = await redis.pipeline()
  .sismember(cacheKey, userId)
  .get(roleKey)
  .exec();

if (isMember === 1) {
  // Populate L1 cache
  this.membershipCache.set(memKey, { isMember: true, role, validUntil: Date.now() + 30_000 });
  return { isMember: true, role };
}

// Layer 3: TCP fallback (singleflight — N concurrent misses = 1 TCP call)
const pending = this.inflight.get(inflightKey);
if (pending) return pending;
const promise = this.fetchViaConversationService(userId, conversationId);
this.inflight.set(inflightKey, promise);
return promise;
```

### 4. Friendship Check (DIRECT) — Single Redis MGET

```typescript
// MessageSendOrchestrator.handleDirectConversation()
const [blockAB, blockBA, friends, proof] = await redis.mget(
  REDIS_KEYS.CHAT.FRIENDSHIP_BLOCK(senderId, receiverId),   // {chat:rel:{lo}:{hi}}:block:A:B
  REDIS_KEYS.CHAT.FRIENDSHIP_BLOCK(receiverId, senderId),   // {chat:rel:{lo}:{hi}}:block:B:A
  REDIS_KEYS.CHAT.FRIENDSHIP_FRIENDS(senderId, receiverId), // {chat:rel:{lo}:{hi}}:friends
  REDIS_KEYS.CHAT.FRIENDSHIP_PROOF(senderId, receiverId),   // {chat:rel:{lo}:{hi}}:proof
);
// All 4 keys share hash tag {chat:rel:{lo}:{hi}} → single Redis Cluster slot → safe MGET

if (blockAB || blockBA) throw new ForbiddenException('FORBIDDEN_BLOCKED_USER');

const areFriends = friends !== null && parseInt(friends) > 0;
const hasProof = proof !== null;
if (!areFriends && !hasProof) {
  // Strangers: apply rate limit (1 msg/hour) or TCP fallback if Redis MGET missed
}
```

### 5. FriendshipFriendsConsumer — LWW Cache

```typescript
// FriendshipFriendsConsumer — consumer group: nest-chat.chat-core.friend-cache
// FRIENDSHIP.REQUEST_ACCEPTED → Lua CAS SET với positive brokerTs
// FRIENDSHIP.REMOVED          → Lua CAS SET với negative brokerTs (tombstone, TTL 60s)

// LUA_CAS_SET (ACCEPTED):
//   cur = GET KEYS[1]
//   newTs = tonumber(ARGV[1])
//   if cur == false or abs(cur) < newTs → SET KEYS[1] ARGV[1] EX ARGV[2]
// → Immune to out-of-order Kafka delivery (broker timestamp, không phải app clock)
```

---

## Redis Keys Reference

| Key Pattern | Type | TTL | Set by | Read by |
|-------------|------|-----|--------|---------|
| `chat:conversation:{id}:members` | Set | 7 days | `ConversationService` (write-through) + `MembershipCacheConsumer` | `MembershipValidatorService` |
| `chat:conversation:{id}:members:{uid}:role` | String | 7 days | idem | `MembershipValidatorService` |
| `{chat:rel:{lo}:{hi}}:block:{A}:{B}` | String "1" | 24h | `FriendshipBlockConsumer` | `MessageSendOrchestrator` |
| `{chat:rel:{lo}:{hi}}:friends` | String (±Unix-ms) | 30d / 60s | `FriendshipFriendsConsumer` (Lua CAS) | `MessageSendOrchestrator` |
| `{chat:rel:{lo}:{hi}}:proof` | String "1" | 30s | Gateway (synchronous, on accept-friend) | `MessageSendOrchestrator` |
| `chat:conv:{id}:max_offset` | String (int) | permanent | `MessageAcceptedConsumer` (Redis INCR) | `MessageAcceptedConsumer` |
| `chat:conv:dirty_offsets` | Set | — | `MessageAcceptedConsumer` | `OffsetSyncJob` |
| `chat:kafka:outbox` | List | — | `MessageSendOrchestrator` (on Kafka fail) | `MessageSendOrchestrator` (outbox poller) |

---

## Consumer Groups

| Consumer | Group ID | Topics | Service |
|----------|----------|--------|---------|
| `MembershipCacheConsumer` | `nest-chat.conversation-service.cache-updater` | `MEMBER_ADDED`, `MEMBER_REMOVED` | Conversation Service |
| `FriendshipBlockConsumer` | `nest-chat.chat-core.block-cache` | `FRIENDSHIP.BLOCKED`, `FRIENDSHIP.UNBLOCKED` | Chat Core |
| `FriendshipFriendsConsumer` | `nest-chat.chat-core.friend-cache` | `FRIENDSHIP.REQUEST_ACCEPTED`, `FRIENDSHIP.REMOVED` | Chat Core |

---

## TTL Policy

| Key family | TTL | Rationale |
|------------|-----|-----------|
| Members Set | 7 days | Event-driven invalidation là primary; TTL là safety-net |
| Role String | 7 days | Đồng nhất với members set |
| Block key | 24h | Block/unblock infrequent; 24h prevents unbounded growth |
| Friends key (positive) | 30 days | Safety-net; eviction là tombstone event-driven |
| Friends tombstone (negative) | 60s | Covers worst-case Kafka redelivery lag |
| Proof key | 30s | Covers Kafka consumer lag sau accept-friend |

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Consumer crash (MEMBER_ADDED) | DLQ routing; TCP fallback trong Chat Core remains authoritative |
| Redis unavailable (read) | MGET → `catch → null` → TCP fallback; fail-open với TCP |
| Redis unavailable (write) | Log + swallow; TCP fallback đảm bảo correctness |
| Kafka lag > outbox interval | Write-through cache trong ConversationService đảm bảo timely warm-up |
| Friends key expired trước REMOVED event | Cache miss → TCP fallback → re-check friendship-service |
| Proof key expired nhưng friends key chưa ghi | 30s window đủ cho FriendshipFriendsConsumer ghi friends key |

---

## Security Notes

- **Fail-closed on membership**: cache miss → TCP. Redis outage không thể grant access.
- **Fail-closed on block**: same. Cache miss → TCP → block enforced.
- **Immediate invalidation on remove**: write-through pipeline bust ngay sau DB commit → window từ kicked→can-still-send giảm từ ≤30s xuống near-zero.
- **Two-direction block check**: MGET kiểm tra cả `A→B` lẫn `B→A` trong cùng 1 Redis call.
- **Hash Tag alignment**: tất cả 4 friendship keys chia sẻ `{chat:rel:{lo}:{hi}}` → cùng Redis Cluster slot → MGET là single-slot operation (no cross-slot error).

---

## Comparison

| Approach | Latency | Stale risk | Implementation complexity |
|----------|---------|-----------|--------------------------|
| Pure TCP call | ~10ms | None | Low |
| TTL cache (old, 1h) | <1ms | Yes (up to 1h) | Low |
| Event-driven Redis (current) | <1ms | Near-zero (write-through + dual invalidation) | Medium |
| + L1 in-process (current) | ~0ms | ≤30s per Pod | Medium-high |

> **Kết luận**: L1 in-process cache + L0 Redis + TCP fallback cho phép ChatCore xử lý burst traffic (KOL-level) mà không tạo TCP storm đến conversation-service.
