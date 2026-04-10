# Common Library (@app/common)

## Purpose

The Common library serves as the central shared utilities and business constants repository for the entire microservices ecosystem. It exists to prevent code duplication across services, enforce consistent patterns for authentication, logging, error handling, and pagination, and provide type-safe message pattern definitions for inter-service communication.

This library solves the problem of scattered business logic and inconsistent implementations by providing a single source of truth for:
- Authentication and authorization patterns
- Service communication protocols
- Data transformation utilities
- Logging and metrics infrastructure
- Shared domain constants and enums

## Exported Modules

### Authentication & Authorization

**KeycloakGuard**
- NestJS guard that verifies JWT tokens with Keycloak via JWKS
- Validates RS256 signature using public keys fetched from Keycloak
- Caches JWKS keys in Redis (TTL: 1 hour)
- Injects KeycloakUser into request.user
- Checks for Public decorator to allow unauthenticated routes
- Validates role requirements from Roles decorator

**Decorators:**
- **@Public()** - Marks routes as publicly accessible (bypasses KeycloakGuard)
- **@Roles(...roles)** - Defines required roles for route access (admin, manager, user)
- **@CurrentUser()** - Parameter decorator to inject KeycloakUser from request

**Interfaces:**
- **KeycloakUser** - Typed interface for decoded JWT payload (sub, email, roles, realm_access, etc.)

### Configuration Utilities

**getBootstrapConfig(service)**
- Reads service host/port from environment at startup, before NestJS app creation
- Calls `process.setMaxListeners(25)` once per process (idempotent). NestJS services load ~3-4 libraries (KafkaJS, TypeORM/pg, IORedis) each registering process exit handlers; the default limit of 10 is easily exceeded without this.
- Use in `main.ts` before `NestFactory.createMicroservice(...)`

**getServiceTcpConfig(host, port)**
- Builds NestJS TCP transport options
- Socket options: `keepAlive: true`, `keepAliveInitialDelay: 5_000ms`, `noDelay: true`
- Note: In-process socket read timeout removed to prevent false-positive disconnections under temporary broker pressure

### Logging Infrastructure

**createLogger(context: string)**
- Factory function that creates Pino-based structured logger instances
- Automatically injects context into all log entries
- Supports log levels: debug, info, warn, error, fatal
- Formats logs as JSON for centralized logging systems
- Includes trace IDs, request IDs, correlation IDs in all logs

**Log Format:**
- Structured JSON output
- Timestamp in ISO 8601 format
- Context (service/class name)
- Trace identifiers for distributed tracing
- Stack traces for errors

### Metrics & Monitoring

**Prometheus Integration**
- Counter, Gauge, Histogram, Summary metric types
- HTTP request duration histogram
- TCP message pattern metrics
- Kafka consumer lag metrics
- Custom business metrics (message count, user count, etc.)

### Constants & Enums

**SERVICES**
- Service names for dependency injection
- Used in ClientProxy registration: USERS, CHAT_CORE, CONVERSATION_SERVICE, FRIENDSHIP_SERVICE, MESSAGE_STORE, PRESENCE_SERVICE, REALTIME_GATEWAY

**PORTS**
- Default port numbers for each service
- Gateway: 3000 (HTTP), Realtime Gateway: 3002 (WS), Users: 3001, Presence: 3003, Chat Core: 3004, Message Store: 3005, Notification: 3006, Conversation: 3007, Friendship: 3008, Media: 3009, Call: 3011

**Message Patterns**
- USERS_PATTERNS: CREATE_USER, GET_USER, GET_USERS_BY_IDS, UPDATE_USER, DELETE_USER, LIST_USERS, SEARCH_USERS, UPDATE_SETTINGS
- CHAT_PATTERNS: SEND_MESSAGE
- CONVERSATION_PATTERNS: CREATE_CONVERSATION, GET_CONVERSATION, FIND_BY_ID, LIST_CONVERSATIONS, UPDATE_INFO, ADD_MEMBERS, REMOVE_MEMBERS, IS_MEMBER, GET_MEMBER_IDS, GET_MEMBERS_WITH_ROLES, SET_MEMBER_ROLE, INCREMENT_MAX_OFFSET, UPDATE_LAST_SEEN_OFFSET (deprecated), UPDATE_SEEN_CURSOR, UPDATE_DELIVERED_CURSOR, GET_MEMBER_CURSORS, GET_UNREAD_COUNT, GET_OUTBOX_HEALTH, GET_USER_CONVERSATION_IDS
- FRIENDSHIP_PATTERNS: SEND_FRIEND_REQUEST, ACCEPT_FRIEND_REQUEST, REJECT_FRIEND_REQUEST, UNFRIEND, BLOCK_USER, UNBLOCK_USER, GET_FRIENDS, GET_PENDING_REQUESTS, GET_FRIEND_STATUS, IS_FRIEND
- MEDIA_PATTERNS: LIST_MEDIA, CREATE_UPLOAD, FINALIZE_UPLOAD, VALIDATE_MEDIA, GET_MEDIA_URL, DELETE_MEDIA, VALIDATE_FOR_SEND, BIND_TO_MESSAGE, GET_ACCESS_URL, CROSS_SHARE, **GET_AVATARS_BATCH** (batch avatar URL resolution for conversation avatars), **DELETE_AVATAR_SYSTEM** (system-level avatar deletion, tenant-scoped, no owner check)

**REDIS_KEYS**
- `REDIS_KEYS.CACHE.CONVERSATION(conversationId)` — `cache:conversation:{id}`
- `REDIS_KEYS.CACHE.AVATAR_URL(mediaId)` — `media:avatar_url:{mediaId}` — Value: JSON `{ url: string; expiresAt: number }` (Unix ms). TTL set by ConversationGatewayService as `expiresAt - now - 5 min buffer`.

**KAFKA_TOPICS**
- MESSAGE_ACCEPTED: chat.event.message_accepted
- MESSAGE_SAVED: chat.event.message_saved
- MESSAGE_REJECTED: chat.event.message_rejected
- MESSAGE_READ: chat.event.read
- MESSAGE_DELETED: chat.event.deleted
- MESSAGE_UPDATED: chat.event.message_updated
- MESSAGE_EDITED: chat.event.message_edited
- MESSAGE_PINNED: chat.event.message_pinned
- MESSAGE_UNPINNED: chat.event.message_unpinned
- CONVERSATION_CREATED: chat.event.conversation_created
- CONVERSATION_UPDATED: chat.event.conversation_updated
- MEMBER_ADDED: chat.event.member_added
- MEMBER_REMOVED: chat.event.member_removed
- COMMUNITY_NOTIFY: chat.event.community_notify
- FRIENDSHIP_REQUEST_ACCEPTED: friendships
- FRIENDSHIP_BLOCKED: friendships
- FRIENDSHIP_UNBLOCKED: friendships

**CONVERSATION_LIMITS**
- DIRECT_MEMBERS: 2
- GROUP_MIN_MEMBERS: 3 (minimum members for GROUP conversations)
- GROUP_MAX_MEMBERS: 500
- MESSAGE_MAX_LENGTH: 10000

**ConversationType Enum**
- DIRECT - One-to-one conversation (exactly 2 members)
- GROUP - Group chat (3+ members, role-based permissions)
- COMMUNITY - Broadcast channel (only OWNER/ADMIN/MODERATOR can post; MEMBER/GUEST can react only)

**FriendshipStatus Enum**
- FRIEND - Active friendship
- PENDING_IN - Received request
- PENDING_OUT - Sent request
- BLOCKED - User is blocked
- NONE - No relationship

### DTOs (Data Transfer Objects)

**PaginationQueryDto**
- page: number (default: 1, min: 1)
- limit: number (default: 10, min: 1, max: 100)
- Used by all list endpoints for consistent pagination

**PaginationResponseDto<T>**
- data: T[] - Array of items
- meta: PaginationMeta
  - total: Total number of items
  - page: Current page number
  - limit: Items per page
  - totalPages: Calculated total pages
  - hasNextPage: boolean
  - hasPreviousPage: boolean

**CreateUserDto, UpdateUserDto, CreateConversationDto, etc.**
- DTOs for all major operations
- Class-validator decorators for validation
- OpenAPI documentation decorators

### Pagination Utilities

**normalizePagination(query, options?)**
- Takes PaginationQueryDto and optional max limit
- Returns normalized values: page, limit, skip (for database queries)
- Enforces minimum and maximum limits
- Calculates skip value for offset-based queries

**createPaginationResponse(data, total, page, limit)**
- Creates standardized pagination response
- Calculates metadata (totalPages, hasNextPage, etc.)
- Returns PaginationResponseDto<T>

### Event Interfaces

**MessageAcceptedEvent**
- Payload structure for MESSAGE_ACCEPTED Kafka event
- Fields: messageId, conversationId, senderId, content, type, metadata, timestamp

**MessageSavedEvent**
- Payload for MESSAGE_SAVED event
- Fields: messageId, conversationId, latestOffset, timestamp

**MemberAddedEvent, MemberRemovedEvent**
- Payload for member changes
- Fields: conversationId, userIds, addedBy/removedBy

**FriendshipRequestAcceptedEvent**
- Payload for friendship acceptance
- Fields: userId, targetUserId, timestamp

### Interceptors

**LoggingInterceptor**
- Logs all incoming requests and outgoing responses
- Measures request duration
- Injects trace IDs into request context
- Logs request method, path, status code, duration

**TransformInterceptor**
- Transforms responses to standard format
- Wraps successful responses in consistent structure
- Handles error transformation

### Filters

**GlobalExceptionFilter**
- Catches all unhandled exceptions
- Logs exception details with stack trace
- Returns standardized error response
- Maps `RpcException` to appropriate HTTP status codes
- For TCP microservice contexts, returns `throwError(() => ...)` (RxJS Observable error) instead of throwing synchronously. This prevents unhandled Promise rejections that would crash the process in NestJS 11.x TCP transport.

### Custom Exceptions

**EntityNotFoundException**
- Thrown when requested entity doesn't exist
- Maps to HTTP 404

**UnauthorizedException**
- Thrown when authentication fails
- Maps to HTTP 401

**ForbiddenException**
- Thrown when user lacks permissions
- Maps to HTTP 403

**BadRequestException**
- Thrown for invalid input data
- Maps to HTTP 400

**ConflictException**
- Thrown for constraint violations (duplicate, conflict)
- Maps to HTTP 409

## Configuration

### Environment Variables

The Common library doesn't require its own environment variables but provides utilities to parse configuration for other services:

**For Authentication:**
- KEYCLOAK_URL - External Keycloak URL
- KEYCLOAK_URL_INTERNAL - Internal Docker network URL
- KEYCLOAK_REALM - Realm name
- KEYCLOAK_CLIENT_ID - OAuth client ID
- KEYCLOAK_CLIENT_SECRET - Client secret

**For Databases:**
- DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS
- DB_SSL_ENABLED - Enable SSL connections

**For Redis:**
- REDIS_HOST, REDIS_PORT, REDIS_DB, REDIS_PASSWORD

**For Kafka:**
- KAFKA_BROKERS - Comma-separated broker list
- KAFKA_CLIENT_ID - Client identifier
- KAFKA_GROUP_ID - Consumer group

**For Logging:**
- LOG_LEVEL - Minimum log level (debug, info, warn, error)
- LOG_PRETTY - Pretty print logs in development (default: false)

### Default Behavior

- Pagination: Default page=1, limit=10, max=100
- JWKS Cache: TTL 1 hour
- Log Level: info in production, debug in development
- Request Timeout: 5000ms for all TCP calls

### Override Configuration

Services can override defaults when importing Common library modules:

**KeycloakGuard Configuration:**
- Can configure cache TTL for JWKS
- Can set custom validation rules

**Logger Configuration:**
- Can set log level per service
- Can enable/disable pretty printing
- Can customize log transport

## Services Using This Library

**ALL services use Common library:**

**Gateway:**
- KeycloakGuard for JWT verification
- Message patterns for TCP communication
- Logging and error handling
- Pagination utilities for list endpoints

**Realtime Gateway:**
- KeycloakGuard for WebSocket authentication
- Kafka event interfaces for consuming events
- Logger for WebSocket connection tracking
- CONVERSATION_LIMITS for validation

**Users Service:**
- Message patterns (USERS_PATTERNS)
- Pagination utilities
- Logger and exception filters
- DTOs for user operations

**Chat Core:**
- Message patterns for calling other services
- Kafka event interfaces (MESSAGE_ACCEPTED)
- CONVERSATION_LIMITS for validation
- Logger for audit trail

**Conversation Service:**
- CONVERSATION_PATTERNS for TCP
- Kafka event interfaces
- CONVERSATION_LIMITS for auto-upgrade logic
- ConversationType enum
- Pagination utilities

**Friendship Service:**
- FRIENDSHIP_PATTERNS for TCP
- Kafka event interfaces
- FriendshipStatus enum
- Logger and exceptions

**Message Store:**
- MESSAGE_STORE_PATTERNS
- Kafka event interfaces
- Pagination utilities with offset logic
- Logger for message audit

**Presence Service:**
- PRESENCE_PATTERNS
- Logger for activity tracking
- Custom exceptions

## Design Notes

### Scope Limitations

The Common library should ONLY contain:
- Truly shared utilities used by 3+ services
- Business constants that are immutable
- Cross-cutting concerns (auth, logging, metrics)
- Communication protocol definitions

### When NOT to Use

**Do NOT add to Common library:**
- Service-specific business logic
- Database entities (belongs in service domain layer)
- Service-specific DTOs (unless used by 3+ services)
- Heavy dependencies that bloat bundle size
- Mutable configuration (use ConfigService instead)

**Avoid circular dependencies:**
- Common should never import from services
- Common should never import from other shared libs (except types)
- Services import from Common, not vice versa

### Design Philosophy

**Single Responsibility:**
- Each exported module has one clear purpose
- Utilities are pure functions when possible
- No side effects in utility functions

**Backward Compatibility:**
- Changes to Common library affect ALL services
- Breaking changes require coordinated deployment
- Version carefully, use deprecation warnings

**Performance Considerations:**
- JWKS caching reduces Keycloak calls by 99%
- Message pattern constants are compile-time (zero runtime cost)
- Pagination utilities are lightweight (no heavy processing)

### Future Extensions

**Planned improvements:**
- OpenAPI schema decorators for auto-documentation
- Request ID propagation middleware
- Circuit breaker utilities
- Distributed tracing integration (Jaeger/Zipkin)
- Service mesh configuration helpers
- Advanced rate limiting utilities
- Webhooks event schemas
- GraphQL resolvers base classes
