# Message Store Service

## Overview

The Message Store Service is the persistent storage layer and read interface for all chat messages in the system. It consumes MESSAGE_ACCEPTED events from Chat Core Service, assigns conversation-level offsets, persists messages to PostgreSQL, and publishes MESSAGE_SAVED notifications for real-time delivery. This service is the single source of truth for message history and provides efficient read access to conversation messages with pagination, read receipt tracking, and unread count calculations.

This service does not perform message validation or business rule enforcement. It exclusively handles message persistence and retrieval after messages have been validated by Chat Core Service.

## Responsibilities

### What This Service IS Responsible For

- Consuming MESSAGE_ACCEPTED events from Kafka
- Assigning sequential message offsets within conversations via Conversation Service
- Persisting messages to PostgreSQL with full content and metadata
- Publishing MESSAGE_SAVED events for real-time notification broadcasting
- Providing paginated message retrieval by conversation ID
- Calculating unread message counts for users in conversations (via Conversation Service cursors)
- Checking if user has replied in a conversation (for smart notifications and rate limiting)
- Status tracking via cursor-based approach (no per-message receipts — callers use CONVERSATION_PATTERNS directly for cursor updates and unread count)

- Handling idempotency for duplicate MESSAGE_ACCEPTED events
- Supporting all conversation types (DIRECT, GROUP, COMMUNITY) with unified message model

### What This Service IS Also Responsible For

- Persisting edited messages and recording edit history (`message_edit_history` table)
- Persisting soft-deleted messages (`is_deleted` flag, `deleted_at`, `deleted_by`)
- Persisting pinned messages per conversation (`pinned_messages` table, max 3)
- Consuming MESSAGE_EDITED, MESSAGE_DELETED, MESSAGE_PINNED, MESSAGE_UNPINNED events from Kafka
- Updating attachment status when Media Worker reports MEDIA_READY or MEDIA_FAILED
- Dead-letter queue (DLQ) consumer for failed event recovery
- Scheduled cleanup job for orphaned messages in deleted conversations

### What This Service IS NOT Responsible For

- Validating message content or sender permissions (handled by Chat Core Service)
- Enforcing edit/delete time windows (handled by Chat Core Service)
- Managing conversation state or membership (handled by Conversation Service)
- Managing friendship relationships (handled by Friendship Service)
- Broadcasting messages to clients (handled by Realtime Gateway)
- Handling message reactions or thread replies (future feature)
- Implementing message search or full-text indexing
- Managing file storage (handled by Media Service / MinIO)
- Rate limiting or abuse detection

## Service Dependencies (from code)

**Injected Services:**
- `MESSAGE_REPOSITORY` - Message persistence (TypeORM repository)
- `SERVICES.CONVERSATION` - Membership validation, cursor management (get_conversation pattern)

**Kafka Integration:**
- **Consumes**: `chat.event.message_accepted` (from Chat Core)
- **Consumes**: `chat.event.message_edited` / `chat.event.message_deleted` / `chat.event.message_pinned` / `chat.event.message_unpinned` (from Chat Core via `MessageOperationConsumer`)
- **Consumes**: `media.ready` / `media.failed` (from Media Worker via `AttachmentSyncConsumer`)
- **Consumes**: DLQ topics (via `DlqConsumer`)
- **Publishes**: `chat.event.message_saved` (to Realtime Gateway)
- **Publishes**: `chat.event.message_updated` (for edits/deletes/pins broadcast)

## External Communication

### HTTP Endpoints

None. This service is a TCP microservice and does not expose HTTP endpoints directly. All HTTP access is proxied through the Gateway service.

### TCP Message Patterns

**Pattern: `MESSAGE_STORE_PATTERNS.GET_MESSAGES`**

- Purpose: Retrieve paginated messages from a conversation
- Payload: conversationId (UUID), limit (default 50, max 100), offset (optional, for cursor-based pagination)
- Response: Paginated message list with message entities (id, senderId, content, offset, timestamp, etc.)
- Behavior: Returns messages in descending offset order (newest first)

**Note on cursor updates and unread count**: `UPDATE_SEEN_CURSOR`, `UPDATE_DELIVERED_CURSOR`, and `GET_UNREAD_COUNT` are **not** handled by Message Store. These belong to `CONVERSATION_PATTERNS` and callers (e.g., Gateway) should send those requests directly to the Conversation Service.

**Pattern: `MESSAGE_STORE_PATTERNS.HAS_REPLIED`**

- Purpose: Check if user has sent any messages in a conversation
- Payload: conversationId (UUID), userId (UUID)
- Response: Boolean (true if user has sent at least one message)
- Use Case: Smart notifications and stranger rate-limiting in Chat Core

**Pattern: `MESSAGE_STORE_PATTERNS.GET_PINNED_MESSAGES`**

- Purpose: Retrieve pinned messages in a conversation
- Payload: conversationId (UUID)
- Response: Array of pinned message records (max 3)

**Pattern: `MESSAGE_STORE_PATTERNS.GET_MESSAGE_BY_ID`**

- Purpose: Retrieve a single message by ID (for edit window validation in Chat Core)
- Payload: messageId (UUID)
- Response: Message entity or NOT_FOUND exception

### Timeout and Retry Behavior

- TCP requests timeout after default NestJS ClientProxy timeout (typically 10 seconds)
- No automatic retry logic at service level; clients must implement retry if needed
- Database query timeouts handled by TypeORM (typically 30 seconds)
- Kafka consumer uses at-least-once delivery with automatic retries on failure
- Failed Kafka event processing is logged and retried automatically by consumer group

### Idempotency

- `GET_MESSAGES` is inherently idempotent (read operation)
- `UPDATE_LAST_SEEN_OFFSET` is idempotent; cursor only increases (GREATEST logic)
- `GET_UNREAD_COUNT` is inherently idempotent (read operation)
- `HAS_REPLIED` is inherently idempotent (read operation)
- MESSAGE_ACCEPTED event processing is idempotent via messageId deduplication

## Asynchronous Communication

### Kafka Events Published

**Topic: `chat.event.message_saved`**

- Event Type: MESSAGE_SAVED
- Purpose: Notify Realtime Gateway that message has been persisted and can be broadcast
- Payload:
  - messageId (UUID) - Unique message identifier (from Chat Core)
  - conversationId (UUID) - Target conversation
  - senderId (UUID) - Message sender
  - offset (integer) - Assigned conversation-level offset
  - conversationType (enum) - DIRECT, GROUP, COMMUNITY
  - timestamp (ISO 8601) - Message save timestamp
  - traceId (string) - Distributed tracing identifier
- Important: Does NOT include message content for security and payload size optimization
- Partition Key: conversationId (ensures ordered delivery per conversation)
- Retention: 7 days
- Replication: 3 replicas with min-in-sync-replicas = 2
- Consumer: Realtime Gateway (broadcasts to conversation members)

### Kafka Events Consumed

**Topic: `chat.event.message_accepted`**

- Event Type: MESSAGE_ACCEPTED
- Consumer Group: `nest-chat.message-store`
- Purpose: Persist validated messages from Chat Core Service
- Payload:
  - messageId (UUID) - Unique message identifier
  - conversationId (UUID) - Target conversation
  - senderId (UUID) - Message sender
  - content (string) - Full message content
  - messageType (enum) - TEXT, IMAGE, FILE, AUDIO, VIDEO
  - conversationType (enum) - DIRECT, GROUP, COMMUNITY
  - metadata (object) - Additional message metadata
  - timestamp (ISO 8601) - Message creation timestamp
  - traceId (string) - Distributed tracing identifier
- Processing: See Event Processing Details below

**Topic: `media.ready` / `media.failed`** (AttachmentSyncConsumer)

- Consumer Group: `nest-chat.message-store`
- Purpose: Update attachment status when Media Worker finishes processing a file
- On `media.ready`: finds message by mediaId, updates attachment.status to READY, sets variantsReady, publishes `chat.event.message_updated` for realtime sync
- On `media.failed`: updates attachment.status to FAILED so client can show retry prompt

### Event Processing Details

**MESSAGE_ACCEPTED Processing Flow:**

1. Consume event from Kafka
2. Check if message already exists by messageId (deduplication)
3. If exists, skip processing and acknowledge event (idempotency)
4. Call Conversation Service to atomically increment maxOffset
5. Receive assigned offset from Conversation Service
6. Persist message to PostgreSQL with assigned offset
7. Publish MESSAGE_SAVED notification to Kafka (without content)
8. Acknowledge Kafka event

**Key Characteristics:**

- Sequential processing within conversation partition for ordering guarantees
- At-least-once delivery; deduplication ensures no duplicate messages
- Failed processing retries automatically via consumer group
- Database transaction ensures message persistence is atomic
- Kafka publish failure does not block acknowledgment (fire-and-forget for notification)

## Data Model

### Database Type

**PostgreSQL** - Relational database for structured message data with ACID guarantees and efficient indexing for time-series queries.

### Tables

**Table: `messages`**

- **id** (UUID, Primary Key) - Unique message identifier (from Chat Core)
- **conversationId** (UUID, Indexed) - Target conversation reference
- **senderId** (UUID, Indexed) - Message sender user ID
- **content** (TEXT) - Full message content
- **messageType** (ENUM: TEXT, IMAGE, FILE, AUDIO, VIDEO, SYSTEM) - Message content type
- **conversationType** (ENUM: DIRECT, GROUP, COMMUNITY) - Conversation type at message creation
- **offset** (BIGINT) - Sequential offset within conversation (1-indexed)
- **metadata** (JSONB, Nullable) - Additional metadata (replies, mentions, attachments URLs, reactions)
- **createdAt** (TIMESTAMP) - Message creation timestamp
- **updatedAt** (TIMESTAMP) - Last modification timestamp (for edits, future feature)
- **deletedAt** (TIMESTAMP, Nullable) - Soft delete timestamp (future feature)

**Indexes:**

- Primary index on `id`
- Composite index on `conversationId`, `offset` (DESC) for efficient message retrieval
- Index on `conversationId`, `createdAt` (DESC) for time-based queries
- Index on `senderId` for user message history queries
- Unique index on `conversationId`, `offset` for offset uniqueness

**Constraints:**

- NOT NULL on `id`, `conversationId`, `senderId`, `content`, `messageType`, `conversationType`, `offset`, `createdAt`
- UNIQUE constraint on `conversationId`, `offset` (prevents duplicate offsets)
- CHECK constraint: `offset > 0` (offsets are 1-indexed)

**Status Tracking:**

- Uses cursor-based approach in `conversation_members` table (managed by Conversation Service)
- No per-message receipts table
- Status computed on-demand by comparing message.offset with user cursors:
  - `offset <= lastSeenOffset` → seen
  - `offset <= lastDeliveredOffset` → delivered
  - `offset > lastDeliveredOffset` → sent
- Invariant: `lastSeenOffset ≤ lastDeliveredOffset ≤ maxOffset`

### Cache Usage

None currently implemented. All queries go directly to PostgreSQL. Future optimization may introduce Redis caching for recent messages per conversation.

### Data Retention

- Messages retained indefinitely unless explicitly deleted (soft delete future feature)
- No automatic archival or cleanup currently implemented
- Production deployments should implement partitioning by createdAt for efficient archival

## Dependencies

### Internal Microservices

**Conversation Service (TCP):**

- Purpose: Atomic offset increment and cursor updates
- Patterns Used: `CONVERSATION_PATTERNS.INCREMENT_MAX_OFFSET`, `CONVERSATION_PATTERNS.UPDATE_SEEN_CURSOR`, `CONVERSATION_PATTERNS.UPDATE_DELIVERED_CURSOR`, `CONVERSATION_PATTERNS.GET_UNREAD_COUNT`
- Required: Yes (cannot assign offsets without Conversation Service)
- Fallback: Retry or fail event processing if unavailable

### Shared Libraries

- `@app/common` - Shared utilities, constants, logging, configuration
- `@app/database-postgres` - PostgreSQL database module
- `@app/kafka` - Kafka consumer and producer for events

### External Systems

**PostgreSQL:**

- Purpose: Persistent storage for messages and read receipts
- Connection: Configured via CHAT_DB_* environment variables (shared with Message Store schema)
- Required: Yes (service cannot function without database)

**Kafka:**

- Purpose: Consuming MESSAGE_ACCEPTED events and publishing MESSAGE_SAVED notifications
- Connection: Configured via KAFKA_BROKERS
- Required: Yes (service cannot function without event streaming)

## Important Behaviors

### Message Offset Assignment

- Offsets are 1-indexed (first message has offset 1)
- Offsets are sequential and monotonically increasing within a conversation
- Offset assignment is atomic via Conversation Service INCREMENT_MAX_OFFSET
- Offsets are conversation-scoped, not global
- Offset gaps may occur if message persistence fails after offset increment (rare)
- No offset reuse; offsets never decrease

### Message Deduplication

- Deduplication is based on messageId (UUID from Chat Core)
- Check for existing message by messageId before processing
- If exists, acknowledge event and skip processing
- Enables at-least-once Kafka delivery without duplicate messages
- No additional client-side deduplication required

### Cursor-Based Status Tracking

- Uses `conversation_members` table (managed by Conversation Service)
- Two cursors per user per conversation:
  - `lastSeenOffset`: User has seen messages up to this offset (for unread count)
  - `lastDeliveredOffset`: User has received messages up to this offset (for delivery status)
- Cursors only increase (via GREATEST SQL function), never decrease
- Status computed on-demand: compare message.offset with user's cursors
- No per-message receipt records needed
- Unread count: `maxOffset - lastSeenOffset`
- Fire-and-forget cursor updates (async, non-blocking)
- Updated via WebSocket events: `conversation:update_seen_cursor`, `conversation:update_delivered_cursor`
- Used to calculate unread count: maxOffset - lastSeenOffset
- Only updates if new offset is greater than current (prevents backwards movement)
- Enables efficient unread count without counting individual receipts

### Message Retrieval

- Messages returned in descending offset order (newest first)
- Pagination via limit and offset parameters
- Offset-based pagination enables efficient cursor-based queries
- No full-text search currently implemented (future feature)
- Supports all conversation types with unified query interface

### Processing Order

1. Consume MESSAGE_ACCEPTED event from Kafka
2. Check message existence by messageId (deduplication)
3. Call Conversation Service INCREMENT_MAX_OFFSET
4. Receive assigned offset
5. Insert message to PostgreSQL with offset
6. Publish MESSAGE_SAVED notification (lightweight, no content)
7. Acknowledge Kafka event

### Consistency Model

- Strong consistency within database transaction (message persistence)
- Offset assignment is atomic via Conversation Service
- Kafka event processing is at-least-once with deduplication (effectively once)
- MESSAGE_SAVED publishing is fire-and-forget (eventual consistency with Realtime Gateway)
- Read receipts are eventually consistent across clients

### Error Handling

- Duplicate messageId: Skip processing, acknowledge event (idempotency)
- Conversation Service timeout: Retry event processing via consumer group
- Database insert failure: Retry event processing via consumer group
- Offset increment failure: Retry event processing (may create offset gaps)
- MESSAGE_SAVED publish failure: Log error, acknowledge event (notification lost, client resyncs)
- Unhandled exceptions: Log error, do not acknowledge event (automatic retry)

### Scalability

- Horizontally scalable with multiple consumer instances
- Kafka consumer group distributes event processing across instances
- Database connection pooling handles concurrent writes
- Partitioning by conversationId enables parallel processing of different conversations
- Single conversation messages processed sequentially (ordered)
- No shared in-memory state across instances

## Configuration

### Required Environment Variables

- `MESSAGE_STORE_SERVICE_PORT` - TCP service port (default: 3005)
- `CHAT_DB_HOST` - PostgreSQL host (default: localhost)
- `CHAT_DB_PORT` - PostgreSQL port (default: 5432)
- `CHAT_DB_USER` - PostgreSQL username (default: postgres)
- `CHAT_DB_PASSWORD` - PostgreSQL password
- `CHAT_DB_NAME` - PostgreSQL database name (default: chat_db)
- `KAFKA_CLIENT_ID` - Kafka client identifier (default: nest-api-system)
- `KAFKA_BROKERS` - Comma-separated list of Kafka broker addresses
- `CONVERSATION_SERVICE_HOST` - Conversation Service hostname (default: conversation-service)
- `CONVERSATION_SERVICE_PORT` - Conversation Service TCP port (default: 3007)
- `NODE_ENV` - Environment mode (development, production)

### Optional Configuration

- `GET_MESSAGES_DEFAULT_LIMIT` - Default pagination limit (default: 50)
- `GET_MESSAGES_MAX_LIMIT` - Maximum pagination limit (default: 100)
- `DB_SYNCHRONIZE` - Auto-sync database schema (default: true in development, false in production)
- `DB_LOGGING` - Enable SQL query logging (default: true in development, false in production)
- `KAFKA_CONSUMER_GROUP` - Kafka consumer group ID (default: nest-chat.message-store)

### Feature Flags

None currently implemented.

### Runtime Assumptions

- PostgreSQL database is available with messages and message_receipts tables
- Kafka cluster is available with MESSAGE_ACCEPTED and MESSAGE_SAVED topics pre-created
- Conversation Service is available for offset management
- Database schema is pre-created via migrations or synchronize flag
- Offsets are 1-indexed and monotonically increasing
- Chat Core Service publishes well-formed MESSAGE_ACCEPTED events
- Clients handle MESSAGE_SAVED notifications and fetch full messages via GET_MESSAGES

## Design Notes

### Architectural Decisions

**Why Separate Storage from Validation:**

Separating validation (Chat Core) from storage (Message Store) enables independent scaling and failure isolation. Chat Core can validate thousands of messages per second while Message Store handles I/O-bound persistence asynchronously.

**Why Event-Driven Architecture:**

Kafka-based event pipeline decouples services and provides durability, replay capability, and buffering for high-throughput scenarios. Enables adding new consumers (analytics, moderation) without modifying existing services.

**Why Delegate Offset Management to Conversation Service:**

Offsets are conversation-level metadata, not message metadata. Centralizing offset management in Conversation Service ensures atomic increments and consistent unread count calculations without distributed locking.

**Why MESSAGE_SAVED Without Content:**

Lightweight notifications reduce WebSocket payload size and improve scalability. Clients fetch full message content via HTTP on demand, enabling better caching, compression, and rate limiting at Gateway layer.

**Why Store conversationType in Messages:**

Denormalizing conversationType enables efficient queries filtered by conversation type without joining to Conversation Service.

### Trade-offs

**Deduplication by MessageID vs Client Message ID:**

Current design relies on messageId generated by Chat Core Service. Client-side message IDs would enable better client-side deduplication but add complexity and potential ID collisions.

**Fire-and-Forget MESSAGE_SAVED vs Guaranteed Delivery:**

Fire-and-forget publishing prioritizes throughput over guaranteed notification delivery. Clients resync on reconnection to handle missed notifications. Alternative guaranteed delivery would add latency and complexity.

**Offset Gaps vs Strict Sequential:**

Rare offset increment followed by persistence failure creates offset gap. Gap is acceptable since offsets are identifiers, not counts. Preventing gaps would require distributed transactions and significantly reduce throughput.

**No Message Content in MESSAGE_SAVED vs Full Message:**

Lightweight notifications improve WebSocket scalability and reduce bandwidth but require clients to fetch full message via HTTP. Full message in event would enable faster client rendering but increase Kafka and network load.

### Future Extensions

- Implement Redis caching for recent messages per conversation
- Add full-text search capabilities using PostgreSQL full-text search or Elasticsearch
- Support message editing with version history
- Implement soft delete for messages (deletedAt timestamp, hide but preserve)
- Add message reactions and emoji support
- Support threaded replies and message threads
- Implement message pinning within conversations
- Add message forwarding and copy functionality
- Support message templates and quick replies
- Implement message priority levels
- Add message retention policies per conversation type
- Support for message attachments with media storage integration
- Implement message moderation queue for COMMUNITY conversations
- Add message translation capabilities
- Support message scheduling (send at specific time)
- Implement message status tracking (sent, delivered, read)
- Add message encryption at rest
- Support message export and backup
- Implement message analytics (read rate, response time)
- Add database partitioning by conversation or date for scalability
- Implement read receipt aggregation for large groups
- Support message search across conversations
- Add message mentions and notifications
- Implement message drafts and auto-save
