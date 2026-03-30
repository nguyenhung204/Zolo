# Membership Cache Architecture

## Problem
ChatCore needs to validate membership quickly for every message:
-  **Before**: ChatCore queries Conversation Service via TCP (high latency)
-  **Before**: ChatCore caches membership with TTL (stale cache issue)
-  **Problem**: User kicked from group can still send messages during cache TTL

## Solution: Event-Driven Redis Cache

### Architecture
```
Conversation Service (Source of Truth)
    ↓ (add/remove member in DB)
    ↓ (publish MEMBER_ADDED/MEMBER_REMOVED event)
    ↓
Kafka (Event Bus)
    ↓
Conversation Service Consumer
    ↓ (update Redis Set immediately)
    ↓
Redis: chat:conversation:{id}:members (Set)
    ↑ (SISMEMBER check - O(1))
    ↑
ChatCore (Validation)
```

### Flow

#### 1. Member Added
```typescript
// Conversation Service
await conversationMemberRepo.save({conversationId, userId});
await outbox.save({
  eventType: 'member.added',
  payload: { conversationId, userIds: [userId] }
});

// → Outbox Processor publishes to Kafka
// → MembershipCacheConsumer receives event
await redis.sadd(`chat:conversation:${conversationId}:members`, userId);
```

#### 2. Member Removed
```typescript
// Conversation Service
await conversationMemberRepo.delete({conversationId, userId});
await outbox.save({
  eventType: 'member.removed',
  payload: { conversationId, userIds: [userId] }
});

// → Outbox Processor publishes to Kafka
// → MembershipCacheConsumer receives event
await redis.srem(`chat:conversation:${conversationId}:members`, userId);
```

#### 3. ChatCore Validation
```typescript
// Option A: Check Redis (fast path)
const isMember = await redis.sismember(
  `chat:conversation:${conversationId}:members`,
  userId
);

// Option B: Fallback to Conversation Service (if Redis unavailable)
const result = await conversationClient.send(IS_MEMBER, {...});
```

## Benefits

### 1. Real-Time Updates
- No TTL issues
- Immediate cache invalidation
- Kicked user cannot send messages after kick

### 2. Performance
- Redis SISMEMBER: O(1) operation
- No TCP call to Conversation Service
- Reduced load on Conversation Service

### 3. Reliability
- Circuit breaker can fallback to Conversation Service
- Best-effort cache update (doesn't break flow if Redis down)
- Automatic cache expiry (300 seconds / 5 minutes) for cleanup

### 4. Separation of Concerns
- Conversation Service owns membership data
- Conversation Service updates cache
- ChatCore only validates (read-only)

## Implementation

### Conversation Service
**File**: `apps/conversation-service/src/consumers/membership-cache.consumer.ts`

**Responsibilities**:
- Listen to `MEMBER_ADDED` / `MEMBER_REMOVED` events
- Update Redis Sets: `SADD` / `SREM`
- Handle empty conversations (delete cache key)
- Set TTL for cleanup (300 seconds / 5 minutes)

**Consumer Group**: `CONVERSATION_CACHE_UPDATER`

### ChatCore Service
**Current**: Validates membership via TCP call to Conversation Service

**Future Enhancement** (Optional):
```typescript
// Try Redis first (fast path)
const isMember = await redis.sismember(key, userId);
if (!isMember) {
  // Fallback to Conversation Service (authoritative)
  const result = await conversationClient.send(IS_MEMBER, {...});
  
  // Update Redis if member (warm cache)
  if (result.isMember) {
    await redis.sadd(key, userId);
  }
}
```

## Redis Keys

### Structure
```
Key: chat:conversation:{conversationId}:members
Type: Set
Members: [userId1, userId2, userId3, ...]
TTL: 300 seconds (5 minutes)
```

### Operations
- **Add member**: `SADD chat:conversation:123:members user456`
- **Remove member**: `SREM chat:conversation:123:members user456`
- **Check member**: `SISMEMBER chat:conversation:123:members user456`
- **Count members**: `SCARD chat:conversation:123:members`
- **List members**: `SMEMBERS chat:conversation:123:members`

## Error Handling

### Consumer Failures
- Best-effort update (don't throw exceptions)
- Log errors but continue processing
- ChatCore fallback ensures correctness

### Redis Unavailable
- Consumer logs error and continues
- ChatCore uses circuit breaker fallback
- System remains functional (degraded performance)

### Event Order
- Kafka ensures event ordering per partition
- Idempotent operations: `SADD` / `SREM` can be retried

## Monitoring

### Metrics to Track
1. **Cache Hit Rate**: Redis checks vs TCP fallbacks
2. **Consumer Lag**: Kafka consumer lag for cache updates
3. **Update Latency**: Time from event publish to cache update
4. **Fallback Rate**: How often ChatCore falls back to TCP

### Alerts
- Consumer lag > 1000 messages
- Redis unavailable
- High fallback rate (>10%)

## Migration Path

### Phase 1: Dual Write (Current)
- Conversation Service updates Redis via consumer
- ChatCore validates via TCP call (authoritative)
- Monitor cache consistency

### Phase 2: Cache-First (Future)
- ChatCore checks Redis first
- Fallback to TCP on cache miss
- Warm cache on TCP hit

### Phase 3: Cache-Only (Optional)
- ChatCore only checks Redis
- Circuit breaker fails closed if Redis down
- 99.9% cache hit rate expected

## Comparison

| Approach | Pros | Cons |
|----------|------|------|
| **TCP Call** | Always authoritative | High latency, TCP overhead |
| **Cache with TTL** | Fast | Stale data, kicked user can send |
| **Event-Driven Cache** | Fast + Real-time | Requires Kafka + Redis |

**Winner**: Event-Driven Cache (current implementation) 

## Security Note

**Fail-Closed Strategy**:
- Cache update is best-effort (fail-open)
- Validation is fail-closed (circuit breaker throws 503)
- If both Redis and Conversation Service down → messages rejected (correct behavior)

This ensures security: **Cannot bypass membership validation** even during service failures.
