# Chat Core Service

## Overview

Chat Core là **validation orchestrator** — không lưu dữ liệu, không gọi TCP đến external services trừ khi cache miss. Nhận `SEND_MESSAGE` từ Gateway, validate toàn bộ nghiệp vụ, publish `MESSAGE_ACCEPTED` vào Kafka, rồi trả 201 ngay lập tức.

## Responsibilities

1. **Rate limiting** — Per-sender Redis counter.
2. **Content validation** — Format, length, type-specific rules (text / media / sticker).
3. **Conversation + membership validation** — L1 in-process cache → L0 Redis → TCP fallback (singleflight).
4. **Friendship / block check (DIRECT)** — Single Redis `MGET` trên 4 co-located keys; không bao giờ gọi TCP đến friendship-service trừ khi MGET hoàn toàn miss.
5. **Kafka publish (fire-and-forget + outbox)** — Publish `MESSAGE_ACCEPTED`; nếu Kafka fail → push vào Redis outbox list; background poller retry mỗi 500ms.
6. **FriendshipFriendsConsumer** — Cache friend status từ Kafka events vào Redis (LWW register).

## Key Components

### MessageSendOrchestrator

Orchestrator chính. Implements `OnModuleInit` / `OnModuleDestroy`.

**In-process caches (Map + TTL):**

| Cache | Key | TTL | Mục đích |
|-------|-----|-----|---------|
| `convCache` | `conversationId` | 15s | Conversation metadata |
| `membersCache` | `conversationId` | 30s | Members list (DIRECT receiver lookup) |
| `friendshipCache` | sorted `senderId:receiverId` | 30s | TCP fallback friendship status |

**Singleflight (Map<string, Promise>):**
- `convInflight`: N concurrent conv-fetch → 1 TCP call
- `membersInflight`: N concurrent members-fetch → 1 TCP call

**Kafka Outbox:**
- Redis list: `chat:kafka:outbox`
- `onModuleInit`: setInterval 500ms → `processKafkaOutbox()`
- `onModuleDestroy`: clearInterval tất cả intervals + clear caches

**Validation pipeline (theo thứ tự):**
```
Step 1: rateLimiter.checkLimitOrThrow(senderId)
Step 2: validateMessageContent(content, type, mediaId)
Step 3: getAndValidateConversation(conversationId)  ← L1 → L0 Redis → TCP
Step 4: getMembers(conversationId)                  ← L1 → TCP (singleflight)
Step 5: check sender is member
Step 6 [DIRECT only]: handleDirectConversation()
  → Redis MGET(block_A_B, block_B_A, friends, proof)
  → check blocked, check areFriends/hasProof, apply rate limit for strangers
Step 7: publishWithReliability(event) → Kafka or Redis outbox
Step 8: return { messageId, success: true }         ← 201 to Gateway
```

### MembershipValidatorService

3 layers:
1. **L1 in-process Map** (TTL 30s, cleanup 30s) — skip Redis entirely.
2. **L0 Redis pipeline** (SISMEMBER + GET role — 1 round-trip).
3. **TCP singleflight** — N concurrent misses → 1 call to conversation-service.

### UserValidatorService

2 layers:
1. **In-process Map** (60s valid / 5s invalid, cleanup 60s).
2. **TCP singleflight** — N concurrent misses → 1 call to users-service.
- `invalidateUser(userId)`: evict on deactivation event.

### MessageRateLimiterService

Redis INCR + EXPIRE. Per-sender bucket. Shared cho text + sticker.

### FriendshipFriendsConsumer

- Consumer group: `nest-chat.chat-core.friend-cache`
- Topics: `FRIENDSHIP.REQUEST_ACCEPTED`, `FRIENDSHIP.REMOVED`
- Writes/tombstones `{chat:rel:{lo}:{hi}}:friends` key via **Lua CAS** (EVALSHA).
- Clock source: Kafka broker log-append timestamp → immune to app Pod clock skew.
- `ACCEPTED` → positive Unix-ms, TTL 30 days.
- `REMOVED` → negative Unix-ms (tombstone), TTL 60s.

### ACL & Strategy

ACL chain và ConversationStrategy đã được **inlined** vào `MessageSendOrchestrator` để loại bỏ overhead. Không còn `AclRuleChainFactory` hay `ConversationStrategyRegistry` trên hot path.

## Luồng Send Message (tóm tắt)

```
Gateway TCP → MessageSendOrchestrator.execute(dto)
  │
  ├─ 1. Rate limit (Redis)
  ├─ 2. Content validation
  ├─ 3. Fetch conv+members parallel (L1 → Redis → TCP singleflight)
  ├─ 4. Membership check
  ├─ 5. [DIRECT] Redis MGET(4 keys) → block/friend check
  ├─ 6. publishWithReliability(event)
  │      → Kafka publish (try)
  │      → on fail: RPUSH chat:kafka:outbox payload
  └─ 7. Return { messageId } (201) immediately
```

Background:
```
setInterval(500ms) → processKafkaOutbox()
  → LPOP chat:kafka:outbox → retry Kafka publish → success → done
```

## Redis Keys Used

| Key | Operation | Purpose |
|-----|-----------|---------|
| `chat:conv:meta:{id}` | GET/SET | Conversation metadata L0 cache |
| `chat:conversation:{id}:members` | SISMEMBER | Membership check |
| `{chat:rel:{lo}:{hi}}:block:{A}:{B}` | MGET | Block status A→B |
| `{chat:rel:{lo}:{hi}}:block:{B}:{A}` | MGET | Block status B→A |
| `{chat:rel:{lo}:{hi}}:friends` | MGET | Friend status (LWW) |
| `{chat:rel:{lo}:{hi}}:proof` | MGET | Race-condition bridge |
| `chat:kafka:outbox` | RPUSH/LPOP | Kafka retry outbox |
| Rate limit keys | INCR/EXPIRE | Per-sender rate limiting |

## Kafka Events Published

| Topic | When | Consumer |
|-------|------|---------|
| `MESSAGE_ACCEPTED` | Validation passed | Message Store |

## Kafka Events Consumed

| Topic | Consumer | Action |
|-------|---------|--------|
| `FRIENDSHIP.BLOCKED` | `FriendshipBlockConsumer` | SET block key Redis TTL 24h |
| `FRIENDSHIP.UNBLOCKED` | `FriendshipBlockConsumer` | DEL block key |
| `FRIENDSHIP.REQUEST_ACCEPTED` | `FriendshipFriendsConsumer` | Lua CAS SET friends +brokerTs |
| `FRIENDSHIP.REMOVED` | `FriendshipFriendsConsumer` | Lua CAS SET friends -brokerTs (tombstone) |

## Error Codes

| Code | HTTP | Khi nào |
|------|------|---------|
| `FORBIDDEN` | 403 | Không phải member |
| `FORBIDDEN_BLOCKED_USER` | 403 | Bị block bởi receiver |
| `RATE_LIMIT_EXCEEDED` | 429 | Vượt rate limit (người lạ hoặc global) |
| `CONVERSATION_NOT_FOUND` | 404 | Conversation không tồn tại |
| `CONVERSATION_SERVICE_UNAVAILABLE` | 503 | conversation-service không phản hồi |
| `INVALID_MESSAGE` | 400 | Content không hợp lệ |

## Performance Characteristics

| Metric | Value |
|--------|-------|
| Latency (cache hit) | ~5–20ms |
| Latency (Redis hit) | ~10–30ms |
| Latency (TCP fallback) | ~30–80ms |
| TCP calls to conv-service (warm) | 0 per message |
| TCP calls to friendship-service (warm) | 0 per message |
| Kafka outbox retry interval | 500ms |
| Conv cache TTL | 15s |
| Members cache TTL | 30s |
| Friendship cache TTL | 30s |
