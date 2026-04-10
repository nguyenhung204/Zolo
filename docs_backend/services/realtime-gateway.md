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
- Handling typing indicators for DIRECT and GROUP conversations (not COMMUNITY)
- Integrating with Presence Service for automatic online/offline status management
- Providing real-time mark-as-read functionality via Message Store Service
- Validating conversation membership before allowing typing broadcasts or message receipt
- Emitting connection acknowledgment and error events to clients

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
   - Events emitted: `message:saved` (to sender), `message:notify` (to other members), `message:new` (to conversation room)

2. **`chat.event.message_updated`** / **`chat.event.message_edited`** / **`chat.event.message_pinned`** / **`chat.event.message_unpinned`** (MessageUpdatedConsumer)
   - Purpose: Broadcast message mutation events
   - Events emitted: `message:edited`, `message:pinned`, `message:unpinned`

3. **`chat.event.member_added`** / **`chat.event.member_removed`** (MemberChangesConsumer)
   - Purpose: Notify when members added to or removed from a conversation
   - Events emitted: `member:added`, `member:removed`

5. **`chat.event.conversation_updated`** (ConversationUpdatedConsumer)
   - Purpose: Broadcast conversation info changes (name, description, avatar) to all members
   - Strategy: **refetch** — raw `{ conversationId, changes, updatedBy, timestamp }` payload forwarded as-is; client calls `GET /conversations/:id` for fresh details
   - Caching: Member list cached in Redis, TTL 10 min (same pattern as MessageSavedConsumer)
   - Events emitted: `conversation:updated`

6. **`chat.event.community_notify`** (CommunityNotifyConsumer)
   - Purpose: Lightweight notification for large-channel messages
   - Events emitted: `community:notify`

### WebSocket Events

**Incoming Events from Clients:**

- `message:send` - Client sends a message to a conversation
- `typing:start` - Client starts typing (DIRECT/GROUP only)
- `typing:stop` - Client stops typing (DIRECT/GROUP only)
- `message:read` - Client marks messages as read
- `authenticate` - Client authenticates with JWT token

**Outgoing Events to Clients:**

- `message:new` - New message notification (full payload to conversation room)
- `message:notify` - Lightweight notification (to personal user rooms)
- `community:notify` - Lightweight large-channel new message indicator
- `typing:start` - User started typing
- `typing:stop` - User stopped typing
- `member:added` - New member added to conversation
- `member:removed` - Member removed from conversation
- `conversation:updated` - Conversation info changed (name/description/avatar); payload: `{ conversationId, changes, updatedBy?, timestamp? }`; client should refetch `GET /conversations/:id` to get updated `avatarUrl`
- `user:profile-updated` - User profile changed (name or avatar); payload: `{ userId, changedFields, snapshot: { displayName, avatarMediaId }, timestamp }`; client should invalidate cached avatar URL and refetch presigned URL via `GET /media/avatar/:mediaId` when `changedFields` includes `avatarMediaId`
- `message:saved` - Sent to message sender only (confirmation)
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
- Payload: messageId, conversationId, senderId, offset, timestamp
- Processing: 80ms batch window; broadcast to personal rooms (lightweight) and conversation room (full payload); members list fetched from Redis cache (TTL: 10 min)

**Topic: `chat.event.message_updated`** / **`chat.event.message_edited`** / **`chat.event.message_pinned`** / **`chat.event.message_unpinned`**

- Consumer Group: `realtime-gateway`
- Purpose: Broadcast message mutation events to conversation members
- Processing: Direct broadcast to `conversation:{id}` room

**Topic: `chat.event.member_added`**

- Event Type: MEMBER_ADDED
- Consumer Group: `realtime-gateway`
- Purpose: Notify existing members when new members join a conversation
- Payload: conversationId, addedUserIds, addedBy, timestamp
- Processing: Broadcast to existing members and send welcome notification to new members

**Topic: `chat.event.member_removed`**

- Event Type: MEMBER_REMOVED
- Consumer Group: `realtime-gateway`
- Purpose: Notify members when users are removed from a conversation
- Payload: conversationId, removedUserIds, removedBy, timestamp
- Processing: Broadcast removal notification to remaining members and removal confirmation to removed users

**Topic: `chat.event.conversation_updated`**

- Event Type: CONVERSATION_UPDATED
- Consumer Group: `realtime-gateway`
- Purpose: Notify conversation members when metadata changes (name, description, avatar)
- Payload: `{ conversationId, changes, updatedBy, timestamp }`
- Processing: Fetch member list (Redis cache, TTL 10 min), broadcast `conversation:updated` to all members
- Client contract: On receiving `conversation:updated`, clients must call `GET /conversations/:id` to get a fresh presigned `avatarUrl`. Presigned URLs are not included in the WebSocket payload.

**Topic: `chat.event.community_notify`**

- Consumer Group: `realtime-gateway`
- Purpose: Lightweight notification for large-channel message events
- Processing: Broadcast `community:notify` to subscribed clients

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

### Redis Cache Usage

**Connection Management:**

- Key Pattern: `ws:connection:{userId}` - Stores Socket ID for user to enable targeted message delivery
- TTL: Session-based, removed on disconnection
- Purpose: Map user IDs to active WebSocket socket IDs for targeted broadcasts

**Presence Integration:**

- Presence data is managed by Presence Service; this service only triggers presence updates
- No local caching of presence state

### In-Memory State

- Active Socket.IO connections managed by Socket.IO adapter
- Connection metadata temporarily stored during request lifecycle
- No persistent in-memory state across restarts

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
- On disconnection, offline status is scheduled with configurable delay (default 30 seconds)
- Reconnection within delay window cancels scheduled offline status
- Connection state is stored in Redis to enable multi-instance deployments

### Message Broadcasting

- MESSAGE_SAVED events are broadcast to all conversation members as lightweight notifications
- Only metadata is sent (messageId, conversationId, senderId, offset, timestamp); clients must fetch full message via HTTP
- Broadcasting is performed for all conversation types: DIRECT, GROUP, COMMUNITY
- Broadcast targets are determined by querying Conversation Service for member IDs
- Offline members do not receive broadcasts; they sync on reconnection

### Typing Indicators

- Typing indicators are ONLY supported for DIRECT and GROUP conversations
- COMMUNITY conversations do not support typing indicators (validation enforced)
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

**Why No COMMUNITY Typing Indicators:**

COMMUNITY conversations are broadcast-only channels where only OWNER/ADMIN/MODERATOR can post. Typing indicators would be meaningless for members who cannot post.

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
