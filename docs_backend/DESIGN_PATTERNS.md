# Design Patterns & Service Decoupling

This document explains the design patterns used to reduce tight coupling in this system, covering both inter-service and intra-service concerns. For each pattern the structure is:

1. **Problem** — what the pain point is without the pattern
2. **Pattern** — what was applied and where it lives
3. **What it solves** — concrete benefits
4. **How to extend** — what to do when adding new features

---

## Table of Contents

1. [Service Facade (Gateway ↔ Microservices)](#1-service-facade-gateway--microservices)
2. [Service Contracts / DIP (Chat Core ↔ Dependencies)](#2-service-contracts--dependency-inversion-chat-core--dependencies)
3. [Transactional Outbox (Service ↔ Kafka)](#3-transactional-outbox-service--kafka)
4. [Event-Driven Membership Cache (Chat Core ↔ Conversation Service)](#4-event-driven-membership-cache-chat-core--conversation-service)
5. [Chain of Responsibility (ACL Rules in Chat Core)](#5-chain-of-responsibility-acl-rules-in-chat-core)
6. [Strategy (Per-Kind Channel Logic in Chat Core)](#6-strategy-per-kind-channel-logic-in-chat-core)
7. [Orchestrator (Operation Flows in Chat Core)](#7-orchestrator-operation-flows-in-chat-core)
8. [Pattern Interaction Map](#8-pattern-interaction-map)
9. [Singleflight (Concurrent Deduplication)](#9-singleflight-concurrent-deduplication)
10. [Kafka Outbox (Redis List Retry)](#10-kafka-outbox-redis-list-retry)
11. [LWW Register (FriendshipFriendsConsumer)](#11-lww-register-friendshipfriendsconsumer)
12. [Factory (AclRuleChainFactory)](#12-factory-aclrulechainfactory)
13. [Adapter (Service Contracts TCP Adapters)](#13-adapter-service-contracts-tcp-adapters)
14. [Write-Behind Caching (Reactions & Message Offsets)](#14-write-behind-caching-reactions--message-offsets)
15. [Observer / Redis Pub-Sub (Reactions & Session Revocation)](#15-observer--redis-pub-sub-reactions--session-revocation)
16. [Write-Through Cache (ConversationService)](#16-write-through-cache-conversationservice)

---

## 1. Service Facade (Gateway ↔ Microservices)

### Problem

Without a facade layer, every HTTP controller in the Gateway would directly hold a `ClientProxy`, manually set timeouts, handle `ECONNREFUSED`/`TimeoutError`, and repeat serialization logic. The Circuit Breaker would be wired in 8 different places with inconsistent policies. Adding a new message pattern means touching multiple controllers.

### Pattern Applied

**SDK/Facade Pattern** — `BaseGatewayService` is an abstract class that wraps a `ClientProxy` inside a `ProxyHelper`. Every service module in the Gateway exposes exactly one facade class that extends it.

```
apps/gateway/src/modules/base/base-gateway.service.ts                  ← abstract base
apps/gateway/src/modules/chat/chat-gateway.service.ts                  ← ChatGatewayService (Chat Core, hard-fail)
apps/gateway/src/modules/chat/conversation-management.gateway.ts       ← ConversationManagementGatewayService (hard-fail)
apps/gateway/src/modules/chat/message-operations.gateway.ts            ← MessageOperationsGatewayService (hard-fail)
apps/gateway/src/modules/conversation/conversation-gateway.service.ts  ← ConversationGatewayService
apps/gateway/src/modules/presence/presence.gateway.ts                  ← PresenceGatewayService (soft-fail, returns offline)
apps/gateway/src/modules/friendship/friendship.gateway.ts              ← FriendshipGatewayService (soft-fail, returns empty list)
apps/gateway/src/modules/media/media.gateway.ts                        ← MediaGatewayService
apps/gateway/src/modules/users/users.gateway.ts                        ← UsersGatewayService
apps/gateway/src/modules/call/call.gateway.ts                          ← CallGatewayService
apps/gateway/src/modules/notification/notification.gateway.ts          ← NotificationGatewayService
apps/gateway/src/modules/sticker/sticker.gateway.service.ts            ← StickerGatewayService
```

The base class:
- Caches `ProxyHelper` instances per `ClientProxy` key using a `WeakMap`
- Optionally wraps the proxy in a Circuit Breaker via `CircuitBreakerService.createProtectedProxy()`
- Controllers receive the facade via DI; they never import `ClientProxy` directly

**Hard-fail vs Soft-fail policy** (configured at construction time):

| Service | Policy | Reason |
|---------|--------|--------|
| Chat Core | Hard-fail (no fallback) | Message validation must be authoritative |
| Message Store | Hard-fail (no fallback) | Data loss is unacceptable |
| Presence | Soft-fail (returns `offline`) | Non-critical; online status can degrade gracefully |
| Friendship | Soft-fail (returns empty list) | Feed can be shown without friendship data |

### What it Solves

- **Single change point**: adding a timeout policy, changing a TCP port, or modifying error handling touches one file per service, not every controller that uses that service
- **Consistent Circuit Breaker**: break/half-open/close logic is uniform across all downstream services
- **Testability**: controllers are tested by injecting a mock facade — no need to start a TCP server

### How to Extend

**Adding a new microservice to the Gateway:**

1. Create `apps/gateway/src/modules/<service>/` directory
2. Create `<service>.gateway.ts` extending `BaseGatewayService`:

```typescript
@Injectable()
export class NotificationGatewayService extends BaseGatewayService {
  constructor(
    @Inject(SERVICES.NOTIFICATION) client: ClientProxy,
    cbService: CircuitBreakerService,
  ) {
    // 3rd arg = service name for CB metrics, 4th = fallback (optional)
    super(client, cbService, 'notification-service');
  }

  sendPush(userId: string, payload: PushDto) {
    return firstValueFrom(
      this.proxy.send(NOTIFICATION_PATTERNS.SEND_PUSH, { userId, payload })
        .pipe(timeout(3000)),
    );
  }
}
```

3. Import and provide in the feature module; inject `NotificationGatewayService` in controllers — never `ClientProxy` directly.

**Adding a new message pattern to an existing facade:** add one method to the facade class. Controllers stay unchanged.

---

## 2. Service Contracts / Dependency Inversion (Chat Core ↔ Dependencies)

### Problem

Chat Core requires conversation metadata, user account status, friendship data, media metadata, and message versions to validate every operation. Without an abstraction layer, Chat Core would directly import `ConversationServiceAdapter`, `UserServiceAdapter`, etc. — concrete TCP implementations. This means:

- Unit tests require real TCP connections
- Changing how a service is called (TCP → HTTP, or adding a cache) requires editing Chat Core
- Circular dependency risk between the orchestration layer and transport details

### Pattern Applied

**Dependency Inversion Principle via Interface Contracts** — `libs/service-contracts` defines thin interfaces; Chat Core depends only on those interfaces. Adapters (concrete TCP implementations) live outside Chat Core and are injected by NestJS DI.

```
libs/service-contracts/src/
  conversation/
    IConversationService.interface.ts   ← interface contract
    conversation.dto.ts                 ← shared DTOs
  users/
    IUserService.interface.ts
  friendship/
    IFriendshipService.interface.ts
  media/
    IMediaService.interface.ts
  message/
    IMessageService.interface.ts
  adapters/
    conversation-service.adapter.ts     ← TCP implementation of IConversationService
    user-service.adapter.ts
    friendship-service.adapter.ts
    media-service.adapter.ts
    message-service.adapter.ts
  registry/
    service-registry.ts                 ← runtime lookup by SERVICE_NAMES constant
    service-provider.factory.ts         ← wires adapters into NestJS providers
```

Example interface contract:

```typescript
export interface IConversationService {
  getConversation(conversationId: string): Promise<ConversationDto | null>;
  getMembership(userId: string, conversationId: string): Promise<MembershipResult>;
  isMember(userId: string, conversationId: string): Promise<boolean>;
  addMember(conversationId: string, userId: string, role: string, addedBy: string): Promise<MembershipDto>;
  removeMember(conversationId: string, userId: string, removedBy: string): Promise<boolean>;
  // ...
}
```

The adapter implements this interface over TCP with an optional Circuit Breaker:

```typescript
@Injectable()
export class ConversationServiceAdapter implements IConversationService {
  constructor(
    @Inject(SERVICES.CONVERSATION) private readonly client: ClientProxy,
    @Optional() private readonly circuitBreaker?: CircuitBreakerService,
  ) {}

  // Generic helper: uses CB when available, plain timeout otherwise
  private async call<T = any>(pattern: object, payload: any): Promise<T> {
    try {
      if (this.circuitBreaker) {
        return await this.circuitBreaker.execute(() =>
          firstValueFrom(this.client.send(pattern, payload).pipe(timeout(5000))),
        );
      }
      return await firstValueFrom(this.client.send(pattern, payload).pipe(timeout(5000)));
    } catch (error: any) {
      if (error?.name === 'BrokenCircuitError' || error?.name === 'TaskCancelledError') {
        throw new ServiceUnavailableException('conversation-service circuit open');
      }
      if (isServiceUnavailable(error)) throw new ServiceUnavailableException('conversation-service unavailable');
      throw error;
    }
  }

  async getMembership(userId: string, conversationId: string): Promise<MembershipResult> {
    return this.call(CONVERSATION_PATTERNS.GET_MEMBERSHIP, { userId, conversationId });
  }
}
```

The `@Optional()` decorator makes the Circuit Breaker backward-compatible: services that do not register `CircuitBreakerService` as a provider fall back silently to plain RxJS `timeout(5000)`.

Chat Core orchestrators import from `@app/service-contracts`, never from adapter files:

```typescript
import { ServiceRegistry, IConversationService, SERVICE_NAMES } from '@app/service-contracts';

@Injectable()
export class MessageSendOrchestrator {
  private readonly conversationService: IConversationService;

  constructor(private readonly registry: ServiceRegistry) {
    this.conversationService = registry.get<IConversationService>(SERVICE_NAMES.CONVERSATION);
  }
}
```

### What it Solves

- **Testability**: swap the real adapter with a mock implementing the same interface — no TCP, no Kafka
- **Transport independence**: change a service from TCP to HTTP by writing a new adapter class; Chat Core is unchanged
- **Explicit contracts**: interface is the source of truth for what Chat Core requires from each service; versioning is clear
- **Compile-time safety**: TypeScript ensures adapters implement every required method

### How to Extend

**Adding a new method to an existing service:**

1. Add the method signature to the interface in `libs/service-contracts/src/<service>/IXxxService.interface.ts`
2. Implement it in the corresponding adapter in `libs/service-contracts/src/adapters/`
3. Use it in orchestrators via `this.registry.get<IXxxService>(SERVICE_NAMES.XXX).newMethod()`
4. For tests, add the mock implementation; TypeScript will flag the missing method

**Adding a brand-new service dependency to Chat Core:**

1. Create `libs/service-contracts/src/<new-service>/INewService.interface.ts`
2. Create `libs/service-contracts/src/adapters/new-service.adapter.ts`
3. Register in `service-provider.factory.ts` and add to `SERVICE_NAMES` constant
4. Export from `libs/service-contracts/src/index.ts`

---

## 3. Transactional Outbox (Service ↔ Kafka)

### Problem

Any service that publishes a Kafka event after a DB write faces the **dual-write problem**: the DB write can succeed while the Kafka publish fails (network blip, broker restart), leaving the system in an inconsistent state where other services never receive the event. Retrying naively risks duplicate events on a partial failure.

### Pattern Applied

**Transactional Outbox** — the Kafka event payload is written into an `outbox` table **in the same database transaction** as the domain data. A background `OutboxProcessor` polls the outbox table every **5 seconds** (configurable via `intervalMs`, default 5000ms), publishes pending rows to Kafka, then marks them as published.

```
libs/database-postgres/src/outbox/
  outbox.entity.ts          ← outbox DB row: topic, payload, status, idempotencyKey, nextRetryAt
  outbox.repository.ts      ← create() / createMany() with idempotency; markAsFailed() with backoff
  outbox.processor.ts       ← @Cron polls + publishes via KafkaProducerService
```

Sequence for creating a conversation (Conversation Service):

```
1. BEGIN TRANSACTION
2. INSERT INTO conversations (...)
3. INSERT INTO conversation_members (...)
4. INSERT INTO outbox (topic='CONVERSATION_CREATED', payload={...}, status='PENDING',
                       idempotency_key='conv-<id>-created')
5. COMMIT
6. [30s later] OutboxProcessor SELECT WHERE status='PENDING'
                               AND (next_retry_at IS NULL OR next_retry_at <= NOW())
7. kafkaProducer.publish('CONVERSATION_CREATED', payload)
8. UPDATE outbox SET status='PUBLISHED'
```

If step 7 fails: `markAsFailed()` increments `retry_count` and sets `next_retry_at = NOW() + min(30s × 2^retryCount, 1h)`. The row is retried on the next poll cycle only after that backoff window elapses.

Duplicate writes with the same `idempotencyKey` catch PostgreSQL error code `23505` (unique_violation) and silently return the existing row — making `create()` fully idempotent.

### What it Solves

- **No lost events**: DB and Kafka either both succeed (eventually) or both fail
- **Survives broker restarts**: pending rows wait in the DB until Kafka is healthy
- **No duplicate rows**: `idempotencyKey` unique constraint prevents double-write under concurrent retries
- **No retry storms**: exponential backoff (30 s base, 1 h cap) avoids hammering a degraded broker
- **Audit trail**: outbox table serves as an event log for operational debugging

### How to Extend

**Adding a new event type from an existing service:**

```typescript
// Inside a service method, using the injected EntityManager (transaction manager):
await this.outboxRepository.create(entityManager, {
  topic: 'MEMBER_ROLE_CHANGED',
  payload: JSON.stringify({ conversationId, userId, oldRole, newRole }),
  idempotencyKey: `role-change-${conversationId}-${userId}-${Date.now()}`,
});
// This runs inside the same BEGIN/COMMIT block as the DB update.
```

**Adding outbox to a new service:**

1. Import `@app/database-postgres` and add `OutboxModule` to the service's `AppModule`
2. Inject `OutboxRepository` into the service
3. Inject `EntityManager` into the service constructor (TypeORM's transaction manager)
4. Wrap domain save + outbox create in `entityManager.transaction(async (manager) => { ... })`
5. The `OutboxProcessor` starts automatically when the module is imported

---

## 4. Event-Driven Membership Cache (Chat Core ↔ Conversation Service)

### Problem

On every message, Chat Core must verify that the sender is a member of the target conversation. Without caching, this requires a TCP call to Conversation Service per message — adding 5–20 ms of synchronous latency to the hot path and making Chat Core tightly coupled to Conversation Service availability.

### Pattern Applied

**Event-Driven Cache Invalidation (cache-first, implemented)** — Conversation Service publishes `MEMBER_ADDED` / `MEMBER_REMOVED` Kafka events whenever membership changes. `MembershipCacheConsumer` keeps Redis up to date; Chat Core reads Redis first (O(1)) and falls back to TCP only on a cache miss.

```
Redis keys:
  chat:conversation:{id}:members          → Set of userId strings, TTL 7 days
  chat:conversation:{id}:members:{uid}:role → String (role), TTL 7 days

Chat Core membership check (MembershipValidatorService):
  1. redis.sismember(key, userId)        → O(1), < 1 ms
  2. redis.get(roleKey)                  → O(1), skips TCP on hit
  3. TCP fallback if Redis miss/down

Friendship block check (MessageSendOrchestrator DIRECT path):
  redis.mget(block:A:B, block:B:A, friends, proof)  → single-slot O(1) MGET
  TCP fallback only when relationship keys are unavailable
```

Event flows:

```
[Member Added]
ConversationService DB write + outbox event (same tx)
  → MembershipCacheConsumer
    → redis.sadd(members-key, userId)
    → pipeline: SET role-key EX 604800
    → redis.expire(members-key, 604800)

[Member Removed — dual path]
Path A (immediate, same process):
  → conversation.service.ts post-transaction:
    redis.pipeline() → SREM + DEL role-key

Path B (event-driven):
  → MembershipCacheConsumer.handleMemberRemoved()
    → pipeline: SREM + DEL role-keys

[Block / Unblock]
Friendship Service publishes FRIENDSHIP.BLOCKED / FRIENDSHIP.UNBLOCKED
  → FriendshipBlockConsumer (Chat Core, group: chat-core.block-cache)
    → BLOCKED:   SET {chat:rel:{lo}:{hi}}:block:A:B 1 EX 86400
    → UNBLOCKED: DEL {chat:rel:{lo}:{hi}}:block:A:B

[Friendship Accepted / Removed]
Friendship Service publishes FRIENDSHIP.REQUEST_ACCEPTED / FRIENDSHIP.REMOVED
  → FriendshipFriendsConsumer (Chat Core, group: nest-chat.chat-core.friend-cache)
    → Lua CAS SET {chat:rel:{lo}:{hi}}:friends = +brokerTs (accept, TTL 30d)
    → Lua CAS SET {chat:rel:{lo}:{hi}}:friends = -brokerTs (remove tombstone, TTL 60s)
```

### What it Solves

- **Hot-path latency**: membership + role check drops from ~10 ms (TCP) to < 1 ms (Redis)
- **No stale state after kick**: `removeMembers()` busts Redis immediately (Path A), before the Kafka event arrives
- **Role available without TCP**: role String keys eliminate the TCP round-trip needed previously to get the member's role
- **Relationship check without TCP**: block/friends/proof Redis keys allow `MessageSendOrchestrator` to skip Friendship Service TCP on warm path
- **TTL consistency**: both members Set and role String use 7 days (previously role TTL was 1 h, causing stale writes to overwrite the event cache)
- **Graceful degradation**: Redis unavailability falls through safely to TCP

### How to Extend

**Caching member roles is already implemented** — `MemberAddedEventSchema` now carries `roles: Record<string, string>` and `MembershipCacheConsumer` pipelines `SET` calls for each role.

**Adding a new block-type relationship to the cache:** follow the `FriendshipBlockConsumer` pattern — create a consumer in the target service, subscribe to the relevant Kafka topic, and write/delete the appropriate Redis key.

**Adding a new service that needs membership data:** subscribe to the existing `MEMBER_ADDED`/`MEMBER_REMOVED` events; no changes to Conversation Service needed.

---

## 5. Chain of Responsibility (ACL Rules in Chat Core)

### Problem

Message authorization in Chat Core involves multiple independent checks: tenant isolation, account status, membership, time windows, media classification, and role-based policy. Without a pattern, this becomes a single `validateMessage()` method with deeply nested conditionals.

> **Note (v2)**: `AclRuleChainFactory` and `ConversationStrategyRegistry` have been **removed from the `MessageSendOrchestrator` hot path** in v2. The orchestrator now inlines validation steps for maximum performance (L1 cache → L0 Redis → TCP singleflight). ACL rules remain available for non-hot-path operations (edit, delete, pin).

### Pattern Applied

**Chain of Responsibility** — each business rule is an independent class implementing `IAclRule`. Rules are chained in priority order; each rule either rejects immediately or passes to the next.

```
apps/chat-core/src/acl/
  IAclRule.interface.ts             ← interface: handle(ctx, next) → AclResult
  acl-rule-chain.ts                 ← executes rules in sequence
  acl-rule-chain.factory.ts         ← builds the standard chain (wires DI)
  permission-context.interface.ts   ← AclContext: immutable snapshot of the request
  rules/
    account-status.rule.ts          ← CRITICAL: SUSPENDED/OFFBOARDED → FORBIDDEN_ACCOUNT_STATUS
    membership.rule.ts              ← HIGH:     not a member → FORBIDDEN_NOT_MEMBER
    time-window.rule.ts             ← HIGH:     edit > 10 min → FORBIDDEN_TIME_WINDOW
    media-validation.rule.ts        ← HIGH:     RESTRICTED file in wrong channel → FORBIDDEN_MEDIA_CLASSIFICATION
```

Rule priority / ordering:

```
AccountStatus → Membership → TimeWindow → MediaValidation
```

CRITICAL rules run first; if any reject, the chain stops immediately. The `AclContext` is built once (immutable) before the chain executes — no DB calls inside rules.

### What it Solves

- **Single responsibility**: each file owns exactly one business rule; changes to the tenant check don't touch the rate-limit check
- **Ordered short-circuit**: cheap/critical checks (status) run before more targeted ones (membership, time window)
- **Testability**: each rule is testable in isolation with a minimal `AclContext` mock
- **Observability**: rejections carry the exact failing rule's error code (`FORBIDDEN_TENANT_MISMATCH`, etc.)

### How to Extend

**Adding a new rule** (e.g., a global hourly rate limit):

1. Create `apps/chat-core/src/acl/rules/hourly-rate-limit.rule.ts`:

```typescript
@Injectable()
export class HourlyRateLimitRule implements IAclRule {
  readonly priority = 'MEDIUM';

  constructor(private readonly rateLimiter: RateLimiterService) {}

  async handle(ctx: AclContext, next: () => Promise<AclResult>): Promise<AclResult> {
    const exceeded = await this.rateLimiter.isHourlyLimitExceeded(ctx.actor.userId);
    if (exceeded) return { ok: false, code: 'RATE_LIMIT_EXCEEDED' };
    return next();
  }
}
```

2. Register the new rule in `acl-rule-chain.factory.ts` — insert it at the right position in the chain array
3. Add `RATE_LIMIT_EXCEEDED` to the error code enum in `@app/common`
4. No other files change

**Removing a rule:** remove it from the factory registration. No rule file needs to know about its neighbors.

---

## 6. Strategy (Per-Kind Channel Logic in Chat Core)

### Problem

Each `ConversationKind` (`direct`, `group`, `community`) has its own permission matrix, membership rules, and post constraints. Without the Strategy pattern, this becomes one large class with a `switch(kind)` block duplicated across every operation. Adding a new channel kind means editing every switch block.

### Pattern Applied

**Strategy Pattern** — each `ConversationKind` maps to a dedicated strategy class. In v2, strategy lookup was removed from the `MessageSendOrchestrator` hot path for performance, but strategy classes are still useful for non-hot-path operations and permission modeling.

```
apps/chat-core/src/strategies/conversation/
  direct-conversation.strategy.ts         ← direct: symmetric perms for all members
  group-conversation.strategy.ts          ← group: role-based perms (OWNER > ADMIN > MEMBER)
  community-conversation.strategy.ts      ← community: only OWNER/ADMIN post; MEMBER react-only
  conversation-strategy.registry.ts       ← Map<ConversationKind, IConversationStrategy>
```

Usage in an orchestrator:

```typescript
const strategy = this.strategyRegistry.resolveOrThrow(conversation.kind);
const result = await strategy.validateMessage(context);
if (!result.isValid) throw new ForbiddenException(result.errorCode);
```

Each strategy encapsulates:
- Which `Permission` codes are available per `MemberRole`
- Kind-specific pre-checks (e.g., `community` blocks non-admin `MSG.SEND_TEXT`)
- Join policies (e.g., `direct` disallows join; `community` auto-assigns MEMBER role)

Permission sets are hardcoded per-strategy in `getPermissionsForRole()` — there is no database-backed `policy_rules` table.

### What it Solves

- **Isolated per-kind logic**: changing `community` permissions doesn't risk breaking `group` logic
- **Extensibility**: adding a new kind = one new strategy class + one registry entry

### How to Extend

**Adding a new `ConversationKind`:**

1. Add the literal to the `ConversationType` enum in `libs/common/src/enums/conversation.enum.ts`
2. Create `apps/chat-core/src/strategies/conversation/<new-kind>-conversation.strategy.ts` implementing `IConversationStrategy` and defining `getPermissionsForRole()` for each `MemberRole`
3. Register it in `conversation-strategy.registry.ts`:

```typescript
this.strategies.set('broadcast', this.broadcastStrategy);
```

4. No existing strategy files change.

**Changing permissions for an existing kind:** edit `getPermissionsForRole()` in the relevant strategy file. If the permission code is new, add it to the `Permission` enum in `libs/common/src/constants/permissions.constants.ts` first.

---

## 7. Orchestrator (Operation Flows in Chat Core)

### Problem

Business operations like "send message" require multiple steps: validate user, validate conversation, check friendship, rate-limit, validate media, then publish a Kafka event. Without the Orchestrator pattern, these steps collapse into a single service method mixing validation logic, service calls, and event publication — hard to read, hard to test, and hard to modify.

### Pattern Applied

**Orchestrator Pattern** — each operation in Chat Core is a dedicated orchestrator class with a single public method. The orchestrator coordinates specialized services/validators but contains no business logic of its own.

```
apps/chat-core/src/orchestrators/
  message-send.orchestrator.ts            ← validates + emits MESSAGE_ACCEPTED
  message-edit.orchestrator.ts            ← enforces 10-min window + ACL chain
  message-delete.orchestrator.ts          ← enforces 24h window + role check (DELETE_ANY)
  message-pin.orchestrator.ts             ← permission check + broadcasts pin event
  message-revoke.orchestrator.ts          ← Tombstone pattern: sets is_revoked, 1-hour window
  message-forward.orchestrator.ts         ← validates source + all target memberships; emits MESSAGE_ACCEPTED per target
  message-delete-for-user.orchestrator.ts ← per-user soft hide (inserts into message_user_deletions)
  media-precheck.orchestrator.ts          ← pre-upload DLP + media classification check
```

`MessageSendOrchestrator` coordination sequence (v2 hot path):

```
1. MessageRateLimiterService.check(...)                           → per-user throttle
2. getAndValidateConversation(...)                                → L1 in-process cache → L0 Redis → TCP fallback
3. getMembers(...)                                                → L1 in-process cache → TCP fallback (singleflight)
4. Membership check                                               → sender must be member
5. [direct kind only] redis.mget(block:A:B, block:B:A, friends, proof)
                  → fallback TCP to FriendshipService only on relationship cache miss
6. validateMessageContent(...) / MediaValidatorService.validate(...) as needed
7. publishWithReliability('MESSAGE_ACCEPTED')                     → Kafka, or Redis outbox fallback
```

The orchestrator imports all dependencies via `@app/service-contracts` interfaces — it never imports transport-specific classes.

### What it Solves

- **Readable flow**: the orchestrator is a recipe, not a logic block; each step has a name
- **Single responsibility**: validators contain logic, orchestrator contains only sequencing
- **Testability**: mock any validator individually and test the orchestrator's flow control
- **Independent change**: updating the rate-limiter logic doesn't require reading the media validation code

### How to Extend

**Adding a new operation** (e.g., "forward message"):

1. Create `apps/chat-core/src/orchestrators/message-forward.orchestrator.ts`
2. Inject the needed validators/services via DI
3. Implement the single public method `forward(dto, user)` as a sequence of calls
4. Add a `@MessagePattern` handler in the Chat Core controller that delegates to this orchestrator
5. Expose the corresponding TCP pattern from the Gateway facade

**Adding a new step to an existing operation** (e.g., legal hold check before delete):

1. Create `LegalHoldValidatorService` with a single `check(messageId)` method
2. Inject it into `MessageDeleteOrchestrator`
3. Add one line to the sequence: `await this.legalHoldValidator.check(dto.messageId)`
4. Other orchestrators are unchanged

---

## 8. Pattern Interaction Map

The patterns are layered — outer patterns delegate to inner ones:

```
HTTP Request (Client)
  
  
[ Gateway HTTP Controller ]
    depends on facade only
  
[ Service Facade (BaseGatewayService) ]        ← Pattern 1
    TCP + Circuit Breaker
  
[ Chat Core TCP Controller ]
  
  
[ Orchestrator ]                               ← Pattern 7
    coordinates validators
   [ MembershipValidatorService ]
             Redis O(1) lookup              ← Pattern 4 (hot path)
            TCP fallback via
                 ConversationServiceAdapter  ← Pattern 2 (DIP)
  
   [ AclRuleChain ]                       ← Pattern 5
             runs rules in order

                [ ConversationStrategy ]     ← Pattern 6
  
   KafkaProducerService.publish()
            
            
       [ Conversation Service ]
              DB write + outbox write (same tx)
            
       [ OutboxProcessor → Kafka ]            ← Pattern 3
            
            
       [ MembershipCacheConsumer ]            ← Pattern 4 (cache update)
            
             redis.sadd / srem
```

### Decision Guide: Which Pattern When

| Situation | Apply |
|-----------|-------|
| New external microservice added to Gateway | Service Facade (extend `BaseGatewayService`) |
| Chat Core needs data from a new service | Service Contracts (add interface + adapter to `@app/service-contracts`) |
| New TCP transport for a service dependency | Adapter (add adapter to `libs/service-contracts/src/adapters/`) |
| New service emits Kafka events | Transactional Outbox (import `OutboxModule`) |
| Hot-path data read hammering another service | Event-Driven Cache (Redis Set + Kafka consumer) |
| New business rule in Chat Core validation | Chain of Responsibility (add rule class, register in factory) |
| New operation type needs its own ACL chain | Factory (`AclRuleChainFactory.createFor*()`) |
| New `ConversationKind` or permission change | Strategy (add strategy class, update `getPermissionsForRole()`) |
| New multi-step operation in Chat Core | Orchestrator (add orchestrator class, add controller handler) |
| N concurrent TCP calls for same resource | Singleflight (inflight Map<string, Promise>) |
| Kafka failure must not lose messages | Kafka Outbox + Redis List + background poller |
| Friend/block status lookup per message | LWW Register (FriendshipFriendsConsumer + Lua CAS) |
| Write DB counter but reduce PG row-lock | Write-Behind Caching (Redis INCR → OffsetSyncJob) |
| High-frequency mutable data, defer DB writes | Write-Behind Caching (Redis Hash → ReactionSyncJob) |
| Push event to WebSocket rooms without polling | Observer / Redis Pub-Sub (psubscribe + emit) |
| Cache must be warm immediately after DB commit | Write-Through Cache (pipeline after transaction) |
| CQRS | **Not used** — no CQRS infrastructure in this codebase |

---

## 9. Singleflight (Concurrent Deduplication)

### Problem

Under burst traffic, N concurrent requests for the same resource (e.g., conversation metadata) each trigger a separate TCP call, causing a "TCP storm" to the downstream service.

### Pattern Applied

An **inflight Map** deduplicates in-flight Promises:

```typescript
private readonly convInflight = new Map<string, Promise<ConversationDto>>();

async getConversation(id: string): Promise<ConversationDto> {
  const cached = this.convCache.get(id);
  if (cached) return cached;

  let promise = this.convInflight.get(id);
  if (!promise) {
    promise = this.fetchConversationTcp(id).finally(() => this.convInflight.delete(id));
    this.convInflight.set(id, promise);
  }
  return promise; // All concurrent callers await the same Promise
}
```

**Used in**: `MessageSendOrchestrator` (`convInflight`, `membersInflight`), `MembershipValidatorService`, `UserValidatorService`.

---

## 10. Kafka Outbox (Redis List Retry)

### Problem

If the Kafka broker is temporarily unavailable during `MessageSendOrchestrator.execute()`, the message would be lost because ChatCore returns 201 to the client before persistence.

### Pattern Applied

On Kafka publish failure, push payload to Redis list; background poller retries:

```typescript
async publishWithReliability(event: MessageAcceptedEvent): Promise<void> {
  try {
    await this.kafka.emit(TOPICS.MESSAGE_ACCEPTED, event);
  } catch {
    await this.redis.rpush(REDIS_KEYS.CHAT.KAFKA_OUTBOX, JSON.stringify(event));
  }
}

// Background (500ms interval):
async processKafkaOutbox(): Promise<void> {
  const raw = await this.redis.lpop(REDIS_KEYS.CHAT.KAFKA_OUTBOX);
  if (!raw) return;
  await this.kafka.emit(TOPICS.MESSAGE_ACCEPTED, JSON.parse(raw));
}
```

**Key**: `chat:kafka:outbox` (Redis List). **Retry interval**: 500ms. **Lifecycle**: `onModuleInit` starts interval, `onModuleDestroy` clears it.

---

## 11. LWW Register (FriendshipFriendsConsumer)

### Problem

Kafka delivers events **at-least-once** and potentially **out-of-order**. A `FRIENDSHIP.REMOVED` event arriving before `FRIENDSHIP.REQUEST_ACCEPTED` would incorrectly show users as friends.

### Pattern Applied

**Last-Write-Wins Register** using broker log-append timestamp as the clock (immune to Pod clock skew):

```lua
-- Lua CAS script (EVALSHA):
local cur = redis.call('GET', KEYS[1])
local newTs = math.abs(tonumber(ARGV[1]))
if cur == false or math.abs(tonumber(cur)) < newTs then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  return 1
end
return 0
```

- `ACCEPTED` event → store `+brokerTs` (TTL 30d).
- `REMOVED` event → store `-brokerTs` as tombstone (TTL 60s).
- Read: `value > 0` means friends, `value < 0` means tombstone (not friends), `nil` = unknown (TCP fallback).

**Used in**: `FriendshipFriendsConsumer` (`apps/chat-core/src/consumers/friendship-friends.consumer.ts`).

---

## 12. Factory (AclRuleChainFactory)

### Problem

Each Chat Core operation (edit, delete, pin, revoke, media-precheck) requires a different subset of ACL rules. Without a factory, each orchestrator would hard-code its own `new AclRuleChain([...])` call, duplicating rule instantiation and making it easy for two operations to accidentally share mutable state.

### Pattern Applied

**Factory Pattern** — `AclRuleChainFactory` instantiates all rule and chain objects once at NestJS boot time. Orchestrators receive pre-built singleton chains via DI; no orchestrator ever calls `new AclRuleChain()`.

```
apps/chat-core/src/acl/
  acl-rule-chain.factory.ts   ← @Injectable() factory; builds 5 pre-warmed chains
  acl-rule-chain.ts           ← AclRuleChain: executes rules in priority order
  rules/
    account-status.rule.ts    ← AccountStatusRule (CRITICAL priority)
    membership.rule.ts        ← MembershipRule (HIGH priority)
    time-window.rule.ts       ← TimeWindowRule (HIGH priority)
    media-validation.rule.ts  ← MediaValidationRule (HIGH priority)
```

Factory source (`acl-rule-chain.factory.ts`):

```typescript
@Injectable()
export class AclRuleChainFactory {
  // Singleton rule instances
  private readonly accountStatusRule  = new AccountStatusRule();
  private readonly membershipRule     = new MembershipRule();
  private readonly timeWindowRule     = new TimeWindowRule();
  private readonly mediaValidationRule = new MediaValidationRule();

  // Singleton chain instances — one per operation type
  private readonly _messageEditChain   = new AclRuleChain([this.accountStatusRule, this.membershipRule, this.timeWindowRule]);
  private readonly _messageDeleteChain = new AclRuleChain([this.accountStatusRule, this.membershipRule, this.timeWindowRule]);
  private readonly _mediaChain         = new AclRuleChain([this.accountStatusRule, this.membershipRule, this.mediaValidationRule]);
  private readonly _membershipChain    = new AclRuleChain([this.accountStatusRule, this.membershipRule]);
  private readonly _messageRevokeChain = new AclRuleChain([this.accountStatusRule, this.membershipRule, this.timeWindowRule]);

  createForMessageEdit():          AclRuleChain { return this._messageEditChain; }
  createForMessageDelete():        AclRuleChain { return this._messageDeleteChain; }
  createForMediaOperations():      AclRuleChain { return this._mediaChain; }
  createForMembershipOperations(): AclRuleChain { return this._membershipChain; }
  createForMessageRevoke():        AclRuleChain { return this._messageRevokeChain; }
}
```

Orchestrator usage:

```typescript
@Injectable()
export class MessageRevokeOrchestrator {
  private readonly aclChain: AclRuleChain;

  constructor(private readonly aclFactory: AclRuleChainFactory, ...) {
    this.aclChain = this.aclFactory.createForMessageRevoke();
  }
}
```

### What it Solves

- **No duplicate instantiation**: rule objects are created once regardless of how many orchestrators use them
- **Isolated chain configs**: `_messageEditChain` and `_mediaChain` hold different rule sets — sharing the same `accountStatusRule` instance is safe because rules are stateless
- **Single registration point**: adding a rule to all `edit`-like operations means touching only `createForMessageEdit()` in one file

### How to Extend

**Adding a new operation that needs ACL:**

1. Add `createForNewOperation(): AclRuleChain { return new AclRuleChain([...]); }` in `acl-rule-chain.factory.ts`
2. Call `this.aclFactory.createForNewOperation()` in the new orchestrator constructor

**Adding a new rule globally:** create the rule class in `rules/`, instantiate it as a private field in `AclRuleChainFactory`, then add it to the relevant chain constructor calls.

---

## 13. Adapter (Service Contracts TCP Adapters)

### Problem

Chat Core needs to call six downstream services (Users, Conversation, Friendship, Media, MessageStore, CallService). Without adapters, Chat Core orchestrators would directly import `ClientProxy`, hard-code TCP patterns, and manage timeout/CB logic in-line. Swapping the transport (TCP → gRPC) or adding a Circuit Breaker would require editing every orchestrator.

### Pattern Applied

**Adapter Pattern** — six concrete adapter classes implement the corresponding `IXxxService` interface from `@app/service-contracts`. All TCP transport, timeout, and Circuit Breaker logic is encapsulated inside the adapter. Chat Core only sees the interface.

```
libs/service-contracts/src/adapters/
  conversation-service.adapter.ts  ← ConversationServiceAdapter implements IConversationService
  user-service.adapter.ts          ← UserServiceAdapter implements IUserService
  friendship-service.adapter.ts    ← FriendshipServiceAdapter implements IFriendshipService
  media-service.adapter.ts         ← MediaServiceAdapter implements IMediaService
  message-service.adapter.ts       ← MessageServiceAdapter implements IMessageService
  call-service.adapter.ts          ← CallServiceAdapter implements ICallService
```

Each adapter follows the same internal structure:

```typescript
@Injectable()
export class ConversationServiceAdapter implements IConversationService {
  constructor(
    @Inject(SERVICES.CONVERSATION) private readonly client: ClientProxy,
    @Optional() private readonly circuitBreaker?: CircuitBreakerService,
  ) {}

  private async call<T>(pattern: object, payload: any): Promise<T> {
    if (this.circuitBreaker) {
      return this.circuitBreaker.execute(
        { serviceName: 'conversation-service', timeout: 3000, retries: 0, halfOpenAfter: 5000 },
        () => firstValueFrom(this.client.send(pattern, payload)),
      );
    }
    return firstValueFrom(this.client.send(pattern, payload).pipe(timeout(3000)));
  }

  async getConversation(id: string): Promise<ConversationDto | null> {
    return this.call(CONVERSATION_PATTERNS.GET_CONVERSATION, { conversationId: id });
  }
}
```

`@Optional()` makes `CircuitBreakerService` backward-compatible — services that do not register it fall back to a plain RxJS `timeout(3000)`. Adapters are registered in `ChatCoreModule.onModuleInit()` via `ServiceRegistry`:

```typescript
onModuleInit(): void {
  this.registry.register(SERVICE_NAMES.CONVERSATION, this.conversationService);
  this.registry.register(SERVICE_NAMES.FRIENDSHIP,   this.friendshipService);
  // ...
}
```

### What it Solves

- **Transport isolation**: changing a service from TCP to gRPC means rewriting one adapter file; all orchestrators are untouched
- **Uniform CB policy**: timeout / retries / `halfOpenAfter` are configured once per service, not scattered across orchestrators
- **Testability**: inject a mock implementing the interface; no TCP server needed

### How to Extend

To add a new downstream service to Chat Core:
1. Define `INewService.interface.ts` in `libs/service-contracts/src/<new-service>/`
2. Create `new-service.adapter.ts` in `libs/service-contracts/src/adapters/`
3. Export from `libs/service-contracts/src/index.ts`
4. Register in `ChatCoreModule.onModuleInit()`

---

## 14. Write-Behind Caching (Reactions & Message Offsets)

### Problem

Two write-intensive paths — reaction toggles and message offset increments — hit PostgreSQL directly in the hot path, causing row-level lock contention under concurrent traffic. Reactions are toggled many times per second; every new message increments a `max_offset` counter that multiple pods would race to update.

### Pattern Applied

**Write-Behind Caching** — writes land in Redis (O(1), no row-lock). Background cron jobs flush Redis state to PostgreSQL every 5 seconds under a leader lock, so only one pod writes per tick.

#### Instance A: Reaction Sync (`ReactionSyncJob`)

```
apps/message-store/src/jobs/reaction-sync.job.ts
```

Write path (synchronous TCP call `REACT_MESSAGE` → `MessageStoreService.reactToMessage()`):

```typescript
// 1. Update Redis Hash (O(1))
await this.redis.hset(REDIS_KEYS.CHAT.REACTION_HASH(messageId), `${emoji}:${reactorId}`, '1');
// 2. Mark messageId dirty
await this.redis.sadd(REDIS_KEYS.CHAT.REACTION_DIRTY_SET, messageId);
// 3. Publish aggregated reactions to Redis Pub/Sub → RealtimeGateway → WS
await this.redis.publish(REDIS_KEYS.CHAT.REACTION_PUBSUB_CHANNEL(conversationId), JSON.stringify(payload));
```

Flush path (`@Cron('*/5 * * * * *')` under `tryLeaderLock`):

```typescript
// 1. SMEMBERS msg:reaction:dirty
// 2. HGETALL msg:reaction:{messageId}   → { 'emoji:userId': '1', ... }
// 3. Aggregate → { emoji: userId[] }
// 4. UPDATE messages SET metadata = jsonb_set(…, '{reactions}', $1) WHERE id = $2
// 5. SREM msg:reaction:dirty {processedIds}
```

**Redis keys**: `msg:reaction:{messageId}` (Hash), `msg:reaction:dirty` (Set).

#### Instance B: Message Offset Sync (`OffsetSyncJob`)

```
apps/conversation-service/src/jobs/offset-sync.job.ts
```

Write path (`MessageAcceptedConsumer` in message-store, after inserting a new message):

```typescript
// Redis INCR — no PG row-lock
await this.redis.incr(REDIS_KEYS.CHAT.CONVERSATION_MAX_OFFSET(conversationId));
await this.redis.sadd(REDIS_KEYS.CHAT.CONVERSATION_OFFSET_DIRTY_SET, conversationId);
```

Flush path (`@Cron('*/5 * * * * *')`):

```typescript
// 1. SMEMBERS chat:conv:dirty_offsets
// 2. Pipeline GET chat:conv:offset:{id} for all dirty IDs
// 3. UPDATE conversations SET max_offset = $2 WHERE id = $1 AND max_offset < $2  ← never goes backwards
// 4. SREM chat:conv:dirty_offsets {synced IDs}
```

**Redis key**: `chat:conv:offset:{conversationId}` (String counter). The `AND max_offset < $2` guard prevents a stale slow flush from overwriting a newer value.

### What it Solves

- **No hot-row contention**: reaction hash fields and INCR counters are Redis operations with no DB locks
- **Horizontal-scale safe**: `CacheService.tryLeaderLock()` (SET NX PX + Lua release) ensures exactly one pod flushes per tick
- **Failure recovery**: if a flush fails, the dirty set retains the ID; next cron tick retries — no data lost
- **Client responsiveness**: `REACT_MESSAGE` TCP call returns the updated reaction map immediately (from Redis), without waiting for DB write

### How to Extend

Follow the `ReactionSyncJob` template:
1. Write fast path → Redis data structure + add to dirty Set
2. Create a `@Cron`-based flush job; acquire `tryLeaderLock` at the start
3. Read all dirty IDs → batch-update PG → remove from dirty Set

---

## 15. Observer / Redis Pub-Sub (Reactions & Session Revocation)

### Problem

When a user reacts to a message, all WebSocket clients in the conversation room must see the update in real time. The `MessageStore` service (where the reaction is processed) cannot directly reach the `RealtimeGateway` service (where WebSocket connections live) — they are separate processes with no shared memory.

Similarly, when a user logs in from a new device, the previous session's WebSocket connection must be forcibly terminated without a direct service-to-service call.

### Pattern Applied

**Observer Pattern via Redis Pub/Sub** — the publisher (message-store, gateway) publishes to a channel; the subscriber (realtime-gateway) holds a dedicated ioredis connection in `SUBSCRIBE` mode that dispatches events to all connected WebSocket rooms.

#### Instance A: Reaction Broadcast (`ReactionPubSubService`)

```
apps/realtime-gateway/src/chat/services/reaction-pubsub.service.ts
```

```
Publisher: MessageStoreService.reactToMessage()
  → redis.publish('reactions:conv:{conversationId}', JSON.stringify(payload))

Subscriber: ReactionPubSubService (onModuleInit)
  → subscriber.psubscribe('reactions:conv:*')
  → on 'pmessage': extract conversationId from channel name
  → server.to('conversation:{conversationId}').emit('message:reaction_updated', payload)
```

#### Instance B: Session Revocation (`SessionRevocationService`)

```
apps/realtime-gateway/src/chat/services/session-revocation.service.ts
```

```
Publisher: Gateway (on login from new device / logout)
  → redis.publish('auth:session:revoked', JSON.stringify({ userId, platform, keycloakSid }))

Subscriber: SessionRevocationService (onModuleInit)
  → subscriber.subscribe('auth:session:revoked')
  → on 'message': find all sockets matching userId + platform + keycloakSid
  → emit 'session_revoked' to each socket → ConnectionManager.unregisterConnection() → socket.disconnect()
```

Both services use a **dedicated ioredis connection** for the subscriber (the ioredis `SUBSCRIBE`/`PSUBSCRIBE` mode is exclusive — a subscribed connection cannot issue regular Redis commands). The WebSocket `Server` reference is injected into each service by `ChatGateway` after `afterInit()`:

```typescript
afterInit(server: Server): void {
  this.reactionPubSubService.server = server;
  this.sessionRevocationService.server = server;
}
```

### What it Solves

- **Process decoupling**: `message-store` pushes reactions without knowing anything about WebSocket topology
- **Fan-out at socket layer**: one `PUBLISH` reaches N WebSocket pods because each pod subscribes independently — no shared Socket.IO adapter needed for this path
- **Low-latency push**: Redis Pub/Sub delivery is typically < 1 ms across pods on the same network

### How to Extend

**Adding a new real-time push event:**
1. In the producing service, call `redis.publish('<channel>', JSON.stringify(payload))`
2. In `realtime-gateway`, create a new service implementing `OnModuleInit` / `OnModuleDestroy`, subscribe to the channel, and emit the appropriate WebSocket event to the correct room
3. Register the service in `RealtimeGatewayModule` and inject the `server` reference from `ChatGateway.afterInit()`

---

## 16. Write-Through Cache (ConversationService)

### Problem

After Kafka publishes `MEMBER_ADDED`, there is a lag before `MembershipCacheConsumer` processes the event and warms the Redis membership cache. During this lag, membership validation in Chat Core falls back to TCP for every request — defeating the hot-path optimisation.

### Pattern Applied

**Write-Through Cache** — `ConversationService` immediately pipeline-writes to Redis after each DB transaction commit (non-blocking, soft-fail). This ensures the cache is warm before the first subsequent message check, regardless of Kafka consumer lag.

```
apps/conversation-service/src/conversation.service.ts
```

```typescript
// After DB commit in createConversation() / addMembers():
const pipeline = this.redis.pipeline();
pipeline.sadd(memberCacheKey, ...normalizedMemberIds);
for (const uid of normalizedMemberIds) {
  pipeline.set(`${memberCacheKey}:${uid}:role`, role, 'EX', 7 * 24 * 3600);
}
pipeline.expire(memberCacheKey, 7 * 24 * 3600);
await pipeline.exec().catch(err =>
  this.logger.warn(`Cache write-through for createConversation (non-critical): ${err.message}`)
);
```

The Kafka `MembershipCacheConsumer` in Chat Core is fully idempotent (`SADD` / `SET` with the same values = no-op), so there is no conflict between the two write paths. Write-through provides the guarantee; event-driven cache provides the fallback for Conversation Service restarts.

### What it Solves

- **Zero cold-start lag**: cache is warm immediately after DB commit; no TCP fallback on the first message
- **Dual-write safety**: write-through is soft-fail (`catch` + warn) — a Redis blip does not roll back the DB transaction
- **Idempotent consumer**: event-driven path (Section 4) can re-run without overwriting valid cache entries

---

## Related Documents

- [SERVICE_COMMUNICATION.md](integration/SERVICE_COMMUNICATION.md) — TCP message patterns and transport layer
- [MEMBERSHIP_CACHE_ARCHITECTURE.md](integration/MEMBERSHIP_CACHE_ARCHITECTURE.md) — Redis Set cache deep dive
- [DATA_FLOW_PATTERNS.md](integration/DATA_FLOW_PATTERNS.md) — end-to-end event flows
- [database-postgres.md](libraries/database-postgres.md) — OutboxRepository and transaction patterns
- [chat-core.md](services/chat-core.md) — Chat Core service internals
