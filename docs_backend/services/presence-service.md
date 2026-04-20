# Presence Service

**Port**: 3003 (TCP Microservice)
**Technology**: NestJS + TCP Transport
**Cache**: Redis (no database — all state is ephemeral)

## Overview

The Presence Service is the authoritative source for real-time user online/offline status in the chat system. It provides lightweight, low-latency presence tracking using Redis as the primary data store, enabling features like online indicators, last-seen timestamps, activity tracking, and friend presence broadcasting. This service is designed for high-throughput, ephemeral state management where transient availability is acceptable and eventual consistency is sufficient.

This service does not manage friendships, user profiles, or persistent user data. It exclusively handles real-time presence state and activity indicators.

## Responsibilities

### What This Service IS Responsible For

- Tracking user online/offline status in real-time
- Managing scheduled offline transitions with configurable delay
- Canceling scheduled offline when user reconnects within delay window
- Updating user activity timestamps on interactions
- Retrieving single user presence status
- Bulk retrieving presence status for multiple users (e.g., friend lists)
- Checking if user is currently online (boolean check)
- Counting total online users system-wide
- Storing last-seen timestamps for offline users
- Managing presence TTL to automatically mark inactive users offline
- Providing fast, low-latency presence queries via Redis
- Supporting graceful disconnect scenarios with delayed offline

### What This Service IS NOT Responsible For

- Managing friendship relationships (handled by Friendship Service)
- Broadcasting presence changes to clients (handled by Realtime Gateway)
- Managing user profiles or authentication (handled by Users Service and Keycloak)
- Tracking detailed user activity or analytics
- Managing user sessions or connection state (handled by Realtime Gateway)
- Implementing complex presence states (away, busy, do-not-disturb)
- Persisting historical presence data
- Managing timezone-aware presence
- Implementing presence-based notifications

## External Communication

### HTTP Endpoints

None. This service is a TCP microservice and does not expose HTTP endpoints directly. All HTTP access is proxied through the Gateway service.

### TCP Message Patterns

**Pattern: `PRESENCE_PATTERNS.SET_ONLINE`**

- Purpose: Mark a user as online immediately
- Payload: userId (UUID)
- Response: Success boolean
- Side Effects: Sets Redis key with online status and timestamp, sets TTL for auto-expiration

**Pattern: `PRESENCE_PATTERNS.SET_OFFLINE`**

- Purpose: Mark a user as offline immediately
- Payload: userId (UUID)
- Response: Success boolean
- Side Effects: Updates Redis key with offline status and last-seen timestamp

**Pattern: `PRESENCE_PATTERNS.SCHEDULE_OFFLINE`**

- Purpose: Schedule user to be marked offline after a hardcoded grace period
- Payload: `{ userId: string }` — no delay parameter; grace period is fixed at **10 seconds** in `PresenceService`
- Response: `{ scheduled: true, gracePeriod: 10 }`
- Use Case: WebSocket disconnect with reconnection grace period
- Side Effects: Reduces Redis TTL to 10 s; sets in-process timer; if user doesn't reconnect, marks offline after 10 s

**Pattern: `PRESENCE_PATTERNS.CANCEL_OFFLINE`**

- Purpose: Cancel previously scheduled offline transition
- Payload: userId (UUID)
- Response: Success boolean
- Use Case: User reconnects before offline delay expires
- Side Effects: Cancels scheduled task, ensures user remains online

**Pattern: `PRESENCE_PATTERNS.UPDATE_ACTIVITY`**

- Purpose: Update user's last activity timestamp without changing online status
- Payload: userId (UUID)
- Response: Success boolean
- Use Case: Periodic activity pings from clients to prevent auto-offline

**Pattern: `PRESENCE_PATTERNS.GET_STATUS`**

- Purpose: Retrieve presence status for a single user
- Payload: userId (UUID)
- Response: `{ userId, online: boolean, lastSeen?: Date }` — `online: true` if key exists in Redis, `lastSeen` is the last recorded offline timestamp (undefined if user was never set offline)

**Pattern: `PRESENCE_PATTERNS.GET_BULK_STATUS`**

- Purpose: Retrieve presence status for multiple users in single call
- Payload: userIds (array of UUIDs)
- Response: Map of userId to status object
- Optimization: Uses Redis pipeline for efficient bulk retrieval

**Pattern: `PRESENCE_PATTERNS.IS_ONLINE`**

- Purpose: Quick boolean check if user is currently online
- Payload: userId (UUID)
- Response: Boolean (true if online, false if offline)
- Optimization: Fastest presence check, single Redis GET operation

**Pattern: `PRESENCE_PATTERNS.GET_ONLINE_COUNT`**

- Purpose: Retrieve total count of online users system-wide
- Payload: None
- Response: Integer count
- Use Case: System metrics, dashboard statistics

### Timeout and Retry Behavior

- TCP requests timeout after default NestJS ClientProxy timeout (typically 10 seconds)
- Redis operations have 1-second timeout to prevent blocking
- Failed Redis operations return error to client; no automatic retry
- Scheduled offline tasks are best-effort; failures are logged
- No guaranteed delivery for presence state changes

### Idempotency

- `SET_ONLINE` is idempotent; marking already-online user has no effect
- `SET_OFFLINE` is idempotent; marking already-offline user has no effect
- `SCHEDULE_OFFLINE` is idempotent; subsequent calls update scheduled time
- `CANCEL_OFFLINE` is idempotent; canceling non-existent schedule has no effect
- `UPDATE_ACTIVITY` is idempotent; updates timestamp regardless of previous value
- Read operations (GET_STATUS, IS_ONLINE, GET_BULK_STATUS, GET_ONLINE_COUNT) are inherently idempotent

## Asynchronous Communication

### Kafka Events Published

None. This service does not publish Kafka events. Presence changes are synchronous state updates without event notifications. Future implementation may publish `presence.changed` events for reactive features.

### Kafka Events Consumed

None. This service does not consume Kafka events. All operations are triggered by synchronous TCP requests from Realtime Gateway or other services.

### Event Processing Details

Not applicable. This service operates entirely on synchronous TCP communication patterns.

## Data Model

### Database Type

None. This service does not use a traditional database. All data is stored in Redis for fast, ephemeral access.

### Redis Data Structures

**Key Pattern: `presence:user:{userId}:status`**

- Type: String (`'1'`)
- TTL: 300 seconds (5 minutes, refreshed by heartbeat / `UPDATE_ACTIVITY`)
- Semantics: **key exists → user is online**; key deleted → user is offline
- Written by: `setOnline()` via `SETEX`, deleted by `setOffline()` via `DEL`

**Key Pattern: `presence:user:{userId}:last_activity`**

- Type: String (ISO 8601 timestamp)
- TTL: 86400 seconds (1 day)
- Written by: `setOffline()` to record when the user was last seen
- Read by: `getStatus()` / `getBulkStatus()` to populate the `lastSeen` field

> **Note**: Scheduled offline transitions are handled with an **in-process Node.js `setTimeout`**, not a Redis key. There is no `presence:scheduled:{userId}` key and no `presence:online:count` counter.

### Cache Usage

All presence data is cached in Redis. No persistent storage backend. This design prioritizes:

- Low latency (sub-millisecond reads)
- High throughput (100k+ operations per second)
- Horizontal scalability (Redis cluster support)
- Ephemeral state (acceptable to lose on restart)

### Data Retention

- Presence data is transient; no long-term retention
- Offline users retain last-seen timestamp until next login
- No historical presence data or analytics
- Redis restart clears all presence state (all users marked offline)

## Dependencies

### Internal Microservices

None. This service operates independently and does not call other microservices via TCP.

### Shared Libraries

- `@app/common` - Shared utilities, constants, logging, configuration
- `@app/cache` - Redis cache module for presence storage

### External Systems

**Redis:**

- Purpose: Primary and only data store for presence state
- Connection: Configured via REDIS_CHAT_* environment variables
- Required: Yes (service cannot function without Redis)
- Deployment: Single Redis instance or Redis cluster for high availability

## Important Behaviors

### Online Status Lifecycle

1. User connects to WebSocket (Realtime Gateway)
2. Realtime Gateway calls SET_ONLINE
3. Presence Service marks user online in Redis with TTL
4. User interacts with system (sends messages, etc.)
5. Periodic UPDATE_ACTIVITY calls refresh activity timestamp and TTL
6. User disconnects from WebSocket
7. Realtime Gateway calls SCHEDULE_OFFLINE (grace period is **10 seconds**, hardcoded)
8. If user reconnects within delay: CANCEL_OFFLINE prevents offline transition
9. If delay expires: Background task marks user offline with last-seen timestamp

### Scheduled Offline Logic

- Delayed offline prevents flapping for brief disconnects (network issues, app switching)
- Grace period is **10 seconds** (hardcoded in `PresenceService.GRACE_PERIOD`; not configurable via environment variable)
- Multiple SCHEDULE_OFFLINE calls update scheduled time (latest wins)
- CANCEL_OFFLINE prevents transition if called before delay expires
- Implementation uses Redis TTL-based expiration or in-memory scheduler

### Activity Tracking

- Last activity timestamp updated via UPDATE_ACTIVITY
- Separate from online/offline status changes
- Enables features like "active 5 minutes ago" even if user is online
- Activity updates extend TTL to prevent auto-offline

### Bulk Status Retrieval

- GET_BULK_STATUS optimized for friend list queries
- Uses Redis pipeline for efficient multi-key retrieval
- Returns map of userId to status for fast client-side rendering
- Typical use case: Show online indicators for all friends

### Auto-Offline on Inactivity

- Online users have TTL on presence:user:{userId} key
- TTL refreshed on SET_ONLINE and UPDATE_ACTIVITY
- TTL expiration automatically transitions user to offline
- Prevents orphaned online users from crashed clients

### Processing Order

1. For SET_ONLINE: `SETEX presence:user:{userId}:status 300 '1'` → refresh TTL
2. For SET_OFFLINE: `DEL presence:user:{userId}:status` + `SETEX presence:user:{userId}:last_activity` → set last-seen timestamp
3. For SCHEDULE_OFFLINE: reduce Redis TTL to 10 s via `EXPIRE`; start in-process `setTimeout(10s)` → call `SET_OFFLINE` if still disconnected
4. For GET_BULK_STATUS: Redis pipeline `EXISTS` × N + `GET last_activity` × N → assemble `{ userId, online, lastSeen? }[]`

### Consistency Model

- Eventual consistency: No guarantees on real-time accuracy
- Redis is single source of truth; no conflict resolution
- Acceptable staleness: Up to TTL duration (typically seconds)
- No strong consistency guarantees; transient state by design

### Error Handling

- Redis connection failure: Return error to client, log error
- Redis timeout: Return cached/default status (all offline)
- Scheduled task failure: Log error, user remains online until TTL expires
- Unhandled exceptions: Catch and log, return INTERNAL_SERVER_ERROR

### Scalability

- Horizontally scalable with multiple service instances
- Redis cluster support for sharding across keys
- No shared in-memory state across instances (stateless service)
- Background scheduled tasks run independently per instance
- Redis connection pooling handles concurrent requests

## Configuration

### Required Environment Variables

- `PRESENCE_SERVICE_PORT` - TCP service port (default: 3003)
- `REDIS_CHAT_HOST` - Redis host for presence storage (default: redis-chat)
- `REDIS_CHAT_PORT` - Redis port (default: 6379)
- `REDIS_CHAT_DB` - Redis database number (default: 0)
- `NODE_ENV` - Environment mode (development, production)

### Optional Configuration

- `REDIS_CONNECTION_TIMEOUT` - Redis operation timeout in milliseconds (default: 1000)

> **Note**: `PRESENCE_TTL` (300 s) and grace period (10 s) are **hardcoded constants** in `PresenceService`, not configurable via environment variables.

### Feature Flags

None currently implemented.

### Runtime Assumptions

- Redis is available and responsive with low latency
- Realtime Gateway calls SET_ONLINE on connection and SCHEDULE_OFFLINE on disconnect
- Clients implement periodic UPDATE_ACTIVITY to prevent auto-offline
- Acceptable for all users to appear offline if Redis restarts
- No persistent presence history required
- Presence accuracy within 30-60 seconds is acceptable

## Design Notes

### Architectural Decisions

**Why Redis Instead of Database:**

Redis provides sub-millisecond read latency and 100k+ ops/sec throughput, essential for presence which is queried frequently. PostgreSQL would add 10-50ms latency and cannot handle presence query volume.

**Why Ephemeral Storage:**

Presence is inherently transient; losing state on restart is acceptable since clients reconnect and re-establish status. Persistent storage would add complexity with no meaningful benefit.

**Why Scheduled Offline with Delay:**

Brief disconnects (network switching, app backgrounding) should not immediately show user offline. Delay provides better UX by maintaining online status through brief interruptions.

**Why No Kafka Events:**

Presence changes are high-frequency (multiple per second per user). Publishing every status change to Kafka would create excessive event volume. Synchronous queries provide better performance.

**Why No Complex Presence States:**

Simple online/offline binary model is sufficient for chat system. Complex states (away, busy, do-not-disturb) add UI/UX complexity without proportional value.

### Trade-offs

**Ephemeral vs Persistent:**

Ephemeral Redis storage provides extreme performance but loses all state on restart. Persistent storage would survive restarts but add latency and complexity. For presence, performance is more critical than durability.

**Scheduled Offline Delay vs Immediate:**

Delayed offline provides better UX but means user may appear online for 30+ seconds after disconnect. Immediate offline would be more accurate but create poor UX during network issues.

**No Kafka Events vs Event-Driven:**

Absence of presence events simplifies architecture and reduces Kafka load but requires services to poll for presence changes. Event-driven approach would enable reactive features but add significant complexity.

**Single Redis vs Redis Cluster:**

Single Redis instance is simpler and sufficient for medium scale (millions of users). Redis cluster provides better scalability and availability but adds operational complexity.

### Future Extensions

- Implement Redis Cluster support for horizontal scaling
- Add complex presence states (away, busy, do-not-disturb, custom status)
- Publish `presence.changed` Kafka events for reactive features
- Implement presence history tracking for analytics
- Add timezone-aware presence (show local time of user)
- Support custom status messages (what user is currently doing)
- Implement presence-based push notifications
- Add presence activity indicators (typing, recording, uploading)
- Support presence subscriptions (notify on specific user status change)
- Implement presence groups (track presence within specific context)
- Add presence aggregation (show online count per conversation)
- Support presence filtering (show only specific friends, hide from specific users)
- Implement presence-based routing (send messages only to online users)
- Add presence expiration warnings (notify user before auto-offline)
- Support presence persistence with checkpoint snapshots
- Implement presence synchronization across data centers
- Add presence metrics and monitoring dashboards
- Support custom presence TTL per user or client type
- Implement presence-based rate limiting or throttling
- Add presence A/B testing for different delay values
