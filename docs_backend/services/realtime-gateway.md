# Realtime Gateway Service

## Overview

The Realtime Gateway Service is the WebSocket entry point for all real-time client communications in the chat system. It acts as a bidirectional bridge between WebSocket clients and backend microservices, handling live message delivery, typing indicators, presence updates, and member change notifications. Built on Socket.IO with NestJS WebSocket Gateway, it provides an authenticated, stateful connection layer while remaining stateless at the application level by leveraging Redis for connection state management.

This service does not perform business validation or data persistence. Instead, it forwards client commands to appropriate microservices via TCP and broadcasts Kafka events to connected clients as WebSocket messages.

## Responsibilities

### What This Service IS Responsible For

- Accepting and authenticating WebSocket connections using Keycloak JWT tokens
- Managing active WebSocket connections and storing connection mappings in Redis
- Forwarding client messages to Chat Core Service for validation via TCP
- Consuming Kafka events and broadcasting them to relevant connected clients
- Broadcasting MESSAGE_SAVED notifications to conversation members for all conversation types
- Broadcasting MEMBER_ADDED and MEMBER_REMOVED events for membership changes
- Handling typing indicators for DIRECT and GROUP conversations (not ANNOUNCEMENT)
- Integrating with Presence Service for automatic online/offline status management
- Providing real-time mark-as-read functionality via Message Store Service
- Validating conversation membership before allowing typing broadcasts or message receipt
- Emitting connection acknowledgment and error events to clients
- **Subscribing to Redis Pub/Sub `realtime:call_events` channel for sub-50 ms call signaling fan-out**

### What This Service IS NOT Responsible For

- Validating message content or business rules
- Persisting messages to database
- Managing conversation membership data
- Managing friendship relationships
- Managing user profiles or authentication
- Processing offline messages or message history
- Implementing backpressure or rate limiting for message sending
- Generating message IDs or assigning message offsets
- Determining conversation types or enforcing conversation-specific rules
- Storing or caching message content

## Kafka Events Consumed (from code)

**Consumer Group**: `realtime-gateway`

1. **`chat.event.message_saved`** (MessageSavedConsumer)
   - Purpose: Broadcast message notifications to members
   - Strategy: 2-tier — personal room `user:{userId}` for lightweight notification, conversation room `conversation:{id}` for full payload
   - Batching: 80ms window to reduce spam
   - Caching: Members list cached in Redis (TTL: 10 min)
   - **Sender exclusion**: sender is ALWAYS excluded from `message:notify` (both regular and forwarded messages)
   - `message:saved` is emitted only to the sender's own sockets via `notifySelf()` so the shared `user:{id}` room does not leak delivery confirmations to friends
   - `message:notify` now carries preview metadata (`senderName`, `content`, `type`, optional `conversationName`) for unread badges and list previews
   - Events emitted: `message:saved` (sender-only sockets), `message:notify` (to members except sender), `message:new` (to conversation room)

2. **`chat.event.message_updated`** (MessageUpdatedConsumer)
   - Purpose: Broadcast message mutation events to all conversation participants
   - Events emitted depend on `patch` content:
     - `patch.isRevoked = true` → emits `message:revoked` to conversation room
     - `patch.isDeleted = true` → emits `message:deleted` to conversation room
     - `patch.content` set → emits `message:edited` to conversation room
     - otherwise → emits `message:updated` (e.g. attachment status change)
   - Payload: `{ messageId, conversationId, ...patch }`

3. **`chat.event.message_deleted_for_user`** (MessageDeletedForUserConsumer)
   - Purpose: Notify a specific user that a message was hidden for them only
   - Events emitted: `message:deleted_for_me` → sent to **personal room** `user:{userId}` only (not conversation broadcast)
   - Payload: `{ messageId, conversationId, deletedAt }`

4. **`chat.event.member_added`** / **`chat.event.member_removed`** (MemberChangesConsumer)
   - Purpose: Notify when members added to or removed from a conversation
   - Events emitted: `conversation:member-added`, `conversation:member-removed`

5. **`chat.event.conversation_created`** (ConversationCreatedConsumer)
   - Purpose: Broadcast `conversation:new` to all initial members immediately after a conversation is created
   - Key use case: friend request accepted → DIRECT conversation auto-created → both users' clients update in real-time without reload
   - Payload emitted: `{ conversationId, type, createdBy, timestamp }`
   - Events emitted: `conversation:new`

6. **`chat.event.conversation_updated`** (ConversationUpdatedConsumer)
   - Purpose: Broadcast conversation info changes (name, description, avatar) to all members
   - **Event filtering**: only `eventType = 'conversation.info_updated'` triggers a broadcast; internal events like cursor updates on the same topic are silently skipped
   - **Clean changes**: `undefined` values are stripped from `changes` before broadcasting so clients always receive a clean diff object
   - Strategy: **refetch** — raw `{ conversationId, changes, updatedBy, timestamp }` payload forwarded as-is; client calls `GET /conversations/:id` for fresh details
   - Caching: Member list cached in Redis, TTL 10 min (same pattern as MessageSavedConsumer)
   - Events emitted: `conversation:updated`

7. **`user.profile.updated`** (UserProfileUpdatedConsumer)
   - Purpose: Fan-out profile changes (name, avatar) to all clients sharing a conversation with the updated user
   - Logic: skip if `changedFields` is empty; emit to user's own devices; fan-out to conversation rooms in chunks of 50
   - Events emitted: `user:profile-updated`

8. **`user.deactivated`** / **`user.deleted`** (UserAccountStatusConsumer)
   - Purpose: Force-disconnect WS when account is deactivated or deleted
   - Events emitted: `account:status-changed`

9. **`chat.dlq`** (DlqMessageFailedConsumer)
   - Purpose: Notify sender when their message fails DLQ after all retries
   - Events emitted: `message:failed`

> **Note:** `call.event.ringing`, `call.event.accepted`, `call.event.declined`, and `call.event.ended` are no longer consumed from Kafka by this service. `CallEventConsumer` has been removed. Call signaling is now delivered via the **Redis Pub/Sub fast-track** described below.

### Redis Pub/Sub — Call Signaling Fast-Track

**`CallSignalingSubscriber`** (`apps/realtime-gateway/src/call/call-signaling.subscriber.ts`)

- Channel: `realtime:call_events` (constant `REDIS_KEYS.CHANNELS.CALL_SIGNALING`)
- Published by: `call-service` (`CallSignalingPublisher`) immediately after each DB transaction commits
- Latency: < 50 ms (vs 1–3 s via Kafka polling outbox)
- Uses a **dedicated ioredis subscriber connection** (exclusive to PUB/SUB; not shared with the cache client)
- Server reference injected by `CallGateway.afterInit()` to avoid circular dependency

| `eventType` in message | WS event emitted | Target room                    |
| ---------------------- | ---------------- | ------------------------------ |
| `call.event.ringing`   | `call:ringing`   | `user:{calleeId}` (per callee) |
| `call.event.accepted`  | `call:accepted`  | `call:{callId}`                |
| `call.event.declined`  | `call:declined`  | `call:{callId}`                |
| `call.event.ended`     | `call:ended`     | `call:{callId}`                |

Message envelope:

```json
{
  "eventType": "call.event.ringing",
  "callId": "<uuid>",
  "conversationId": "<uuid>",
  "payload": { ... }
}
```

### WebSocket Events

**Incoming Events from Clients:**

- `typing:start` - Client starts typing (DIRECT/GROUP only)
- `typing:stop` - Client stops typing (DIRECT/GROUP only)
- `message:read` - Client marks messages as read
- `authenticate` - Client authenticates with JWT token

**Outgoing Events to Clients:**

- `message:new` - New message (full payload to conversation room); includes `attachments[]` for media messages and `forwardedFrom` for forwarded messages
- `message:notify` - Lightweight notification with preview metadata (to personal user rooms)
- `message:saved` - Sent to the sender's own sockets only (confirmation with `messageId`, `offset`)
- `message:media_ready` - Media processing completed (image/video/file only; audio is not server-processed); FE should update media display (optimized image, poster); payload: `{ messageId, conversationId, attachment: { mediaId, kind, status, meta?, thumbReady?, variantsReady?, error? } }`
- `message:revoked` - Message tombstoned (all participants); payload: `{ messageId, conversationId, revokedAt, tombstoneTextKey }`
- `message:deleted` - Message soft-deleted for all; payload: `{ messageId, conversationId, deletedAt }`
- `message:edited` - Message content updated; payload: `{ messageId, conversationId, content, isEdited, editedAt }`
- `message:deleted_for_me` - Message hidden for this user only (**private** — emitted to `user:{userId}` room); payload: `{ messageId, conversationId, deletedAt }`
- `message:reaction_updated` - Reaction changed on message; payload: `{ messageId, conversationId, reactions, action, reactorId, emoji }`
- `message:updated` - Generic fallback for other mutations
- `announcement:notify` - Lightweight large-channel new message indicator
- `typing:start` - User started typing
- `typing:stop` - User stopped typing
- `friendship:request_sent` / `friendship:request_received` / `friendship:request_accepted` / `friendship:request_rejected` - Friend-request lifecycle events emitted to the involved users' own sockets; accepted requests are followed by `conversation:new` when the DIRECT conversation is ready
- `conversation:member-added` - Member added, invite-link join, or join-request approval; emitted to all current members' own sockets with `source: 'member_add' | 'invite_link' | 'join_approved'`
- `conversation:member-removed` - Member left/removed; emitted to remaining and removed users' own sockets with `source: 'member_left' | 'member_removed'`; removed users are forced out of the conversation room
- `conversation:new` - New conversation created (e.g. friend request accepted triggers DIRECT conversation); payload: `{ conversationId, type, createdBy, timestamp }`; client should fetch `GET /conversations/:id` to populate the conversation list entry
- `account:status-changed` - Force-disconnect signal: emitted to `user:{userId}` room when account is deactivated or deleted; payload: `{ reason: 'deactivated' | 'deleted' }`; sockets are force-closed immediately after
- `conversation:updated` - Conversation info changed (name/description/avatar); payload: `{ conversationId, changes, updatedBy?, timestamp? }`; client should refetch `GET /conversations/:id` to get updated `avatarUrl`
- `group:join_requested` - New join request with `userName` and `source: 'invite_link' | 'request'` for admin review queues
- `group:join_approved` / `group:join_rejected` - Review result with `reviewedByName`; requester and current members can update pending queues without reload
- `group:member_kicked` - Kicked user and remaining members receive `{ conversationId, userId, userName, kickedBy, kickedByName, timestamp }`; kicked user is forced out of the room
- `group:disbanded` - All members from the pre-disband snapshot receive `{ conversationId, disbandedBy, disbandedByName, timestamp }` and are forced out of the room
- `conversation:removed` - Generic forced-room-removal safety event emitted to affected sockets after kick/remove/disband; payload includes `{ conversationId, reason, message }`
- `group:member_role_changed` - Role badge/admin-control update with actor and target display names
- `group:poll_created` - New poll posted in a group; emitted to every member's `user:{userId}` room. Payload: `{ conversationId, poll: { id, conversationId, creatorId, question, options[], multipleChoice, deadline, isClosed: false }, createdBy, createdByName, timestamp }`. FE should prepend `payload.poll` to the polls list — no refetch needed.
- `group:poll_voted` - A member cast or updated their vote. Payload: `{ conversationId, pollId, voterId, voterName, optionIds, options: [{ id, text, voterIds[] }], timestamp }`. Carries the **full updated options snapshot**, so FE can replace `poll.options` directly. Skip if `voterId === currentUser.id` and the optimistic update is already applied.
- `group:poll_closed` - Poll closed (no more votes). Payload: `{ conversationId, pollId, closedBy, closedByName, options[], timestamp }`. FE should set `isClosed = true` and replace `options`.
- `user:profile-updated` - User profile changed (name or avatar); payload: `{ userId, changedFields, snapshot: { displayName, avatarMediaId }, timestamp }`; client should invalidate cached avatar URL and refetch presigned URL via `GET /media/avatar/:mediaId` when `changedFields` includes `avatarMediaId`
- `call:ringing` - Incoming call alert for callee(s); emitted to `user:{calleeId}` room; payload: `{ callId, conversationId, callerId, startedAt }`
- `call:accepted` - Callee joined the call; emitted to `call:{callId}` room; payload: `{ callId, conversationId, calleeId, acceptedAt }`
- `call:declined` - Call was declined/missed; emitted to `call:{callId}` room; payload: `{ callId, conversationId, declinedBy, finalStatus, declinedAt }`
- `call:ended` - Call ended; emitted to `call:{callId}` room; payload: `{ callId, conversationId, endedBy, endReason, durationMs, endedAt }`
- `error` - Error notification
- `authenticated` - Authentication success confirmation

### TCP Message Patterns

**To Chat Core Service:**

- Pattern: `CHAT_CORE_PATTERNS.SEND_MESSAGE`
- Purpose: Validate and process incoming messages
- Payload: Message data including conversationId, senderId, content, messageType

**To Presence Service:**

- Pattern: `PRESENCE_PATTERNS.SET_ONLINE` - Mark user online on connection
- Pattern: `PRESENCE_PATTERNS.SCHEDULE_OFFLINE` - Schedule offline status on disconnection
- Pattern: `PRESENCE_PATTERNS.CANCEL_OFFLINE` - Cancel scheduled offline on reconnection

**To Friendship Service:**

- Pattern: `FRIENDSHIP_PATTERNS.GET_FRIENDS` - Retrieve user's friends list for presence broadcasting

**To Conversation Service:**

- Pattern: `CONVERSATION_PATTERNS.IS_MEMBER` - Verify user is conversation member before allowing actions
- Pattern: `CONVERSATION_PATTERNS.GET_MEMBER_IDS` - Get all member IDs for targeted broadcasting

**To Message Store Service:**

- Pattern: `MESSAGE_STORE_PATTERNS.MARK_AS_READ` - Update last seen offset when client marks as read

### Timeout and Retry Behavior

- TCP requests to microservices timeout after default NestJS ClientProxy timeout (typically 10 seconds)
- Failed TCP calls result in error events emitted to client; no automatic retry
- WebSocket connection failures trigger automatic client-side reconnection via Socket.IO
- Kafka consumer uses at-least-once delivery with automatic retries and backoff

### Idempotency

- Message sending is not idempotent at this layer; relies on Chat Core Service deduplication
- Mark-as-read operations are idempotent via Message Store Service
- Kafka event processing is idempotent through event deduplication by messageId and conversationId

## Asynchronous Communication

### Kafka Events Published

None. This service does not publish Kafka events; it only consumes them.

### Kafka Events Consumed

**Topic: `chat.event.message_saved`**

- Event Type: MESSAGE_SAVED
- Consumer Group: `realtime-gateway`
- Purpose: Notify conversation members that a new message has been persisted
- Payload: messageId, conversationId, conversationType, senderId, senderName, conversationName?, latestOffset, content?, type, attachments[], forwardedFrom, timestamp
- Processing: 80ms batch window; broadcast to personal rooms (lightweight `message:notify` with preview metadata) and conversation room (full `message:new` with attachments); members list fetched from Redis cache (TTL: 10 min)

**Topic: `chat.event.message_updated`**

- Consumer Group: `realtime-gateway`
- Purpose: Broadcast message mutation events to all conversation participants
- Processing: Direct broadcast to `conversation:{id}` room; event name derived from `patch` content:
  - `patch.isRevoked` → emits `message:revoked`
  - `patch.isDeleted` → emits `message:deleted`
  - `patch.content` → emits `message:edited`
  - `patch.attachment` → emits `message:media_ready` (media processing complete)
  - fallback → emits `message:updated`

**Topic: `chat.event.message_deleted_for_user`**

- Consumer Group: `realtime-gateway`
- Purpose: Notify the specific user that a message was hidden for them only
- Processing: Emit `message:deleted_for_me` to personal room `user:{userId}` — **not broadcast to conversation**
- Payload emitted: `{ messageId, conversationId, deletedAt }`

**Topic: `chat.event.member_added`**

- Event Type: MEMBER_ADDED
- Consumer Group: `realtime-gateway`
- Purpose: Notify existing members when new members join a conversation
- Payload: conversationId, userIds, addedBy, conversationType, newMemberCount, timestamp
- Processing: Invalidate member cache, refetch current members, emit `conversation:member-added` to all current members' own sockets. `source` is `invite_link` when `addedBy` is one of the added users, otherwise `member_add`.

**Topic: `chat.event.member_removed`**

- Event Type: MEMBER_REMOVED
- Consumer Group: `realtime-gateway`
- Purpose: Notify members when users are removed from a conversation
- Payload: conversationId, userIds, removedBy, conversationType, newMemberCount, timestamp
- Processing: Invalidate member cache, emit `conversation:member-removed` to remaining and removed users' own sockets, then force removed users to leave `conversation:{id}`.

**Topic: `friendship.request.sent` / `friendship.request.accepted` / `friendship.request.rejected`**

- Consumer Group: `realtime-gateway`
- Purpose: Keep friend request trays, profile CTAs, and friend lists in sync across devices
- Processing: emit `friendship:request_sent` to sender, `friendship:request_received` to receiver, and accepted/rejected events to both users' own sockets. On accepted, Conversation Service separately creates the DIRECT conversation and emits `conversation:new`.

**Topic: `group.event.join_requested` / `group.event.join_approved` / `group.event.join_rejected`**

- Consumer Group: `realtime-gateway.group-events`
- Purpose: Realtime group approval queue and requester feedback
- Processing: join requests fan out to current members for client-side admin filtering with `source` preserved (`invite_link` when submitted from an invite token); approval emits both `group:join_approved` and `conversation:member-added`; rejection emits `group:join_rejected` to requester and current members.

**Topic: `group.event.member_kicked` / `group.event.disbanded`**

- Consumer Group: `realtime-gateway.group-events`
- Purpose: Remove kicked/disbanded groups from UI without reload
- Processing: kicked users and disbanded members receive direct socket events and are forced to leave `conversation:{id}`. The force-leave path also emits `conversation:removed` with `reason: 'group-member-kicked' | 'group-disbanded'`. Disband uses a member snapshot captured before deletion, so broadcasts still work when the members table is already empty.

**Topic: `chat.event.conversation_updated`**

- Event Type: CONVERSATION_UPDATED
- Consumer Group: `realtime-gateway`
- Purpose: Notify conversation members when metadata changes (name, description, avatar)
- Payload: `{ conversationId, changes, updatedBy, timestamp }`
- Processing: Fetch member list (Redis cache, TTL 10 min), broadcast `conversation:updated` to all members
- Client contract: On receiving `conversation:updated`, clients must call `GET /conversations/:id` to get a fresh presigned `avatarUrl`. Presigned URLs are not included in the WebSocket payload.

**Topic: `chat.event.announcement_notify`**

- Consumer Group: `realtime-gateway`
- Purpose: Lightweight notification for large-channel message events
- Processing: Broadcast `announcement:notify` to subscribed clients

**Topic: `user.profile.updated`** (KAFKA_TOPICS.USER.PROFILE_UPDATED)

- Consumer Group: `nest-chat.realtime-gateway`
- Purpose: Fan-out profile changes (name, avatar) to all clients sharing a conversation with the updated user
- Handler: `UserProfileUpdatedConsumer` (`apps/realtime-gateway/src/consumers/user-profile-updated.consumer.ts`)
- Logic:
  1. **Skip** if `changedFields` is empty (cache-eviction-only signal — avatar not yet `READY`)
  2. Emit `user:profile-updated` to `user:{userId}` room (user's own devices)
  3. TCP call `GET_USER_CONVERSATION_IDS` → conversation IDs list
  4. Fan-out to each `conversation:{id}` room in chunks of 50 via `setImmediate` (Thundering Herd mitigation)
- Event emitted: `user:profile-updated`
- Payload emitted:
  ```json
  {
    "userId": "string",
    "changedFields": ["avatarMediaId"],
    "snapshot": { "displayName": "Nguyen Van A", "avatarMediaId": "uuid" },
    "timestamp": 1712345678000
  }
  ```

**New TCP pattern used by this consumer:**

- Pattern: `CONVERSATION_PATTERNS.GET_USER_CONVERSATION_IDS` (`get_user_conversation_ids`)
- Direction: Realtime GW → Conversation Service
- Purpose: Retrieve all conversation IDs a user belongs to (for fan-out routing)

### Event Processing Details

- All Kafka consumers run within the same service instance process
- Events are processed sequentially within each partition to maintain ordering per conversation
- Failed event processing is logged; events are not retried automatically to prevent blocking
- Broadcast failures to disconnected clients are silently ignored (clients will sync on reconnection)

## Data Model

### Database Type

None. This service does not persist data to a database.

### Redis Cache and Pub/Sub Usage

**Connection Management:**

- Key Pattern: `ws:connection:{userId}` - Stores Socket ID for user to enable targeted message delivery
- TTL: Session-based, removed on disconnection
- Purpose: Map user IDs to active WebSocket socket IDs for targeted broadcasts

**Presence Integration:**

- Presence data is managed by Presence Service; this service only triggers presence updates
- No local caching of presence state

**Call Signaling Pub/Sub:**

- Channel: `realtime:call_events` (subscribed via `CallSignalingSubscriber`)
- Dedicated ioredis subscriber connection per pod (not shared with cache client)
- Provides < 50 ms call event fan-out, replacing the previous Kafka-based `CallEventConsumer`

### In-Memory State — ConnectionManager

`ConnectionManager` tracks active local socket connections per user:

```
Map<userId, Set<socketId>>
```

- `register(userId, socketId)`: adds socketId to the user's Set.
- `unregister(userId, socketId)`: removes socketId; deletes the Set if empty.
- `getSockets(userId)`: returns `Set<socketId>` for a user (undefined if offline locally).
- `isConnectedLocally(userId)`: returns true if any socket exists for that userId on this Pod.

Used by `ChatGateway` on `connect`/`disconnect` events and by WS revocation subscriber (Redis pub/sub) to find which local sockets to forcibly disconnect when a session is kicked.

### SoftLimitService

Enforces per-platform connection limits on authenticate. MAX_WEB = 1, MAX_MOBILE = 1. When a user authenticates a new socket and the platform already has an active socket from the **same Keycloak session** (same `keycloakSid`), the oldest same-session socket is force-kicked via `session:revoked` event. Sockets from a different login session are left for `SessionRevocationService`.

**No persistent in-memory state survives across restarts.** `ConnectionManager` is rebuilt from live Socket.IO adapter on startup.

## Dependencies

### Internal Microservices

**Chat Core Service (TCP):**

- Purpose: Message validation and business rule enforcement
- Used For: Processing sendMessage commands from clients
- Required: Yes

**Conversation Service (TCP):**

- Purpose: Conversation membership validation and metadata retrieval
- Used For: Verifying user membership before broadcasting typing indicators or messages
- Required: Yes

**Presence Service (TCP):**

- Purpose: User online/offline status management
- Used For: Automatic presence updates on connection/disconnection
- Required: Yes

**Friendship Service (TCP):**

- Purpose: Friend list retrieval
- Used For: Broadcasting presence changes to friends
- Required: No (service operates without it, but presence features degraded)

**Message Store Service (TCP):**

- Purpose: Message persistence and read status tracking
- Used For: Mark-as-read functionality
- Required: No (service operates without it, but read receipts unavailable)

### Shared Libraries

- `@app/common` - Shared utilities, constants, guards, decorators, logging
- `@app/cache` - Redis cache module for connection management
- `@app/kafka` - Kafka consumer and event handling infrastructure

### External Systems

**Keycloak:**

- Purpose: JWT token validation for WebSocket authentication
- Connection: JWKS endpoint for public key retrieval (RS256 signature verification)
- Required: Yes

**Kafka:**

- Purpose: Event consumption for real-time notifications
- Connection: Kafka brokers configured via KAFKA_BROKERS environment variable
- Required: Yes (service cannot function without event stream)

**Redis:**

- Purpose: Connection state storage
- Connection: Single Redis instance configured via REDIS_CHAT_HOST and REDIS_CHAT_PORT
- Required: Yes (service cannot track connections without Redis)

## Important Behaviors

### Connection Management

- Clients authenticate via JWT token in connection handshake (query or auth object)
- WsKeycloakGuard validates JWT signature using Keycloak JWKS
- On successful connection, user is marked online in Presence Service
- On disconnection, offline status is scheduled with a hardcoded **10-second** grace period (not configurable)
- Reconnection within delay window cancels scheduled offline status
- Connection state is stored in Redis to enable multi-instance deployments

### Message Broadcasting

- **Two-tier broadcast** per `MESSAGE_SAVED` event:
  - **Tier 2** (`conversation:{id}` room): `message:new` with **full payload** (content, type, attachments, forwardedFrom, metadata) — received by users who have actively joined the conversation room.
  - **Tier 1** (personal `user:{userId}` rooms): `message:notify` with lightweight payload `{ conversationId, latestOffset }` — received by all members regardless of which conversation they are viewing; batched over an 80 ms window to reduce WS spam.
  - `message:saved` (personal `user:{senderId}` room): delivery confirmation to sender immediately (not batched).
- Broadcasting is performed for all conversation types: DIRECT, GROUP, ANNOUNCEMENT.
- Member IDs for the Tier 1 `message:notify` broadcast are fetched from a Redis JSON cache (key: `conversation:{id}:members`, TTL 600 s); on miss, fetched from Conversation Service via TCP.
- Offline members do not receive broadcasts; they sync on reconnection.

### Typing Indicators

- Typing indicators are ONLY supported for DIRECT and GROUP conversations
- ANNOUNCEMENT conversations do not support typing indicators (validation enforced)
- Typing events are validated for membership before broadcasting
- Typing start/stop events are broadcast to all other conversation members except sender
- No persistence or replay of typing indicators

### Conversation Membership Validation

- All actions (typing, message sending) validate membership via Conversation Service
- Non-members receive error events and their actions are rejected
- Membership cache may be introduced in future for performance optimization

### Processing Order

1. Client connects and authenticates via JWT
2. Connection state stored in Redis and presence updated
3. Client sends message via sendMessage event
4. Gateway forwards to Chat Core Service for validation
5. Chat Core publishes MESSAGE_ACCEPTED to Kafka
6. Message Store consumes MESSAGE_ACCEPTED, persists, publishes MESSAGE_SAVED
7. Gateway consumes MESSAGE_SAVED and broadcasts to conversation members
8. Clients receive notification and can fetch full message via HTTP Gateway

### Consistency Model

- Eventually consistent: Broadcasts occur after Kafka event processing
- No ordering guarantees across different conversations
- Ordering guaranteed within a single conversation partition
- Clients must handle duplicate notifications (Kafka at-least-once delivery)

### Error Handling

- TCP call failures emit error events to client with error code and message
- Kafka consumer errors are logged; failed events are not retried (manual intervention required)
- WebSocket errors during broadcast are silently ignored (client will resync)
- Unhandled exceptions in event handlers are caught and logged to prevent service crash

### Scalability

- Service is horizontally scalable with multiple instances
- Socket.IO requires sticky sessions or Redis adapter for multi-instance support (currently using in-memory adapter)
- Kafka consumer groups distribute event processing across instances
- Redis connection state enables cross-instance user lookups
- No shared in-memory state across instances

## Deployment Note

This service has a Dockerfile (`apps/realtime-gateway/Dockerfile`) but is not included in `docker-compose.yml`. It must be started separately during local development with `pnpm start:realtime-gateway:dev`.

## Configuration

### Required Environment Variables

- `REALTIME_GATEWAY_PORT` - WebSocket server port (default: 3002)
- `CORS_ORIGIN` - Allowed CORS origins for WebSocket connections (comma-separated or wildcard)
- `KEYCLOAK_URL` - Keycloak server URL for JWKS fetching
- `KEYCLOAK_REALM` - Keycloak realm name (default: nest-realm)
- `KAFKA_CLIENT_ID` - Kafka client identifier (default: nest-realtime-gateway)
- `KAFKA_BROKERS` - Comma-separated list of Kafka broker addresses
- `REDIS_CHAT_HOST` - Redis host for connection state (default: redis-chat)
- `REDIS_CHAT_PORT` - Redis port (default: 6379)
- `REDIS_CHAT_DB` - Redis database number (default: 0)
- `CHAT_CORE_SERVICE_HOST` - Chat Core Service hostname (default: chat-core)
- `CHAT_CORE_SERVICE_PORT` - Chat Core Service TCP port (default: 3004)
- `PRESENCE_SERVICE_HOST` - Presence Service hostname (default: presence-service)
- `PRESENCE_SERVICE_PORT` - Presence Service TCP port (default: 3003)
- `CONVERSATION_SERVICE_HOST` - Conversation Service hostname (default: conversation-service)
- `CONVERSATION_SERVICE_PORT` - Conversation Service TCP port (default: 3007)
- `FRIENDSHIP_SERVICE_HOST` - Friendship Service hostname (default: friendship-service)
- `FRIENDSHIP_SERVICE_PORT` - Friendship Service TCP port (default: 3008)
- `MESSAGE_STORE_SERVICE_HOST` - Message Store Service hostname (default: message-store)
- `MESSAGE_STORE_SERVICE_PORT` - Message Store Service TCP port (default: 3005)

### Optional Configuration

- `NODE_ENV` - Environment mode (development, production)
- `PRESENCE_OFFLINE_DELAY_SECONDS` - Delay before marking user offline on disconnect (default: 30)

### Feature Flags

None currently implemented.

### Runtime Assumptions

- Keycloak is accessible and operational for JWT validation
- Kafka cluster is available with required topics pre-created
- Redis is available for connection state storage
- All dependent TCP microservices are reachable
- Clients use Socket.IO client library compatible with server version
- Clients handle reconnection logic and event deduplication
- Network latency between Gateway and microservices is low (same datacenter recommended)

## Design Notes

### Architectural Decisions

**Why Socket.IO Instead of Native WebSocket:**

Socket.IO provides automatic reconnection, fallback to long-polling, room management, and broadcast helpers. This reduces client complexity and improves reliability in unreliable network conditions.

**Why No Message Content in Broadcasts:**

MESSAGE_SAVED notifications are lightweight and contain no message content to reduce payload size and improve scalability. Clients fetch full messages via HTTP Gateway on demand, enabling better caching, compression, and rate limiting.

**Why Redis for Connection State:**

Redis provides fast, centralized connection state storage, enabling multi-instance deployments without sticky sessions. Future migration to Redis Socket.IO adapter will enable cross-instance broadcasting.

**Why No ANNOUNCEMENT Typing Indicators:**

ANNOUNCEMENT conversations are broadcast-only channels where only OWNER/ADMIN can post. Typing indicators would be meaningless for members who cannot post.

**Why Separate Consumers for Different Events:**

Each Kafka consumer is isolated in its own class for separation of concerns, testability, and independent scaling. Consumers share the same consumer group to distribute load.

### Trade-offs

**Eventual Consistency vs Real-time Guarantees:**

The system prioritizes availability and partition tolerance over strict consistency. Clients may receive notifications out of order or miss notifications entirely, requiring resync logic on reconnection.

**Lightweight Notifications vs Feature Richness:**

Notifications do not include message content, requiring an additional HTTP fetch. This trades real-time richness for scalability and reduces WebSocket payload size.

**No Backpressure on Message Sending:**

Clients can send messages as fast as they want; backpressure is only applied at Chat Core Service via validation. This can lead to validation overload under heavy load but keeps Gateway simple.

**In-Memory Socket.IO Adapter:**

Current implementation uses in-memory adapter, limiting to single instance for correct broadcasting. Migration to Redis adapter required for multi-instance production deployment.

### Future Extensions

- Implement Redis Socket.IO adapter for multi-instance support
- Add connection metrics and monitoring (active connections, messages per second)
- Implement client-side message caching to reduce HTTP fetches
- Add WebSocket compression for large payloads
- Implement rate limiting at Gateway level before forwarding to Chat Core
- Add support for direct user-to-user notifications outside conversation context
- Implement presence broadcasting to friends on status change
- Add typing indicator caching to reduce Conversation Service calls
- Support for custom WebSocket namespaces per conversation type
