# Gateway Service

## Overview

Gateway Service is the single entry point for all HTTP API requests from clients. This service is responsible for authenticating JWT tokens with Keycloak, routing requests to corresponding microservices via TCP protocol, and hiding the complexity of microservice communication behind HTTP endpoints.

Gateway uses the **Facade Pattern** with Gateway Services (UsersGatewayService, ChatGatewayService, etc.) to encapsulate complex TCP operations and only expose simple methods for controllers to use.

## Service Dependencies (from code)

**TCP Clients Injected:**
- `SERVICES.USERS` - User profile operations
- `SERVICES.CONVERSATION` - Conversation management
- `SERVICES.FRIENDSHIP` - Social relationships
- `SERVICES.MESSAGE_STORE` - Message queries
- `SERVICES.PRESENCE` - Online/offline status
- `SERVICES.CHAT_CORE` - Message validation (send message)

**HTTP Proxy:**
- Media Service (port 3009) - File upload/download operations

## Responsibilities

**Gateway is responsible for:**

- Authenticating JWT tokens from Keycloak via JWKS (RS256 signature verification)
- Managing access control based on roles (Role-Based Access Control - RBAC)
- Routing HTTP requests to microservices via TCP transport
- Aggregating and transforming data from multiple microservices when needed
- Converting responses from TCP to HTTP format
- Global error handling and returning standard HTTP status codes
- Rate limiting and throttling (if configured)
- Proxying token requests to Keycloak token endpoint
- Proxying media upload/download requests to Media Service (HTTP to HTTP)

**Gateway is NOT responsible for:**

- Processing business logic - all logic resides in microservices
- Storing data - no direct database connections
- Managing WebSocket connections - responsibility of Realtime Gateway
- Authentication logic - only verifies tokens, does not implement login/register

## External Communication

### HTTP Endpoints

#### General Endpoints

- **GET /** - Public endpoint to check service status
  - No authentication required
  - Returns welcome message

- **GET /health** - Health check endpoint for monitoring
  - No authentication required
  - Returns service status and dependency health

- **POST /auth/token** - Proxy request to Keycloak token endpoint
  - No authentication required
  - Forwards request to Keycloak to obtain JWT token
  - Payload: username, password, grant_type, client_id

- **GET /protected** - Example protected route
  - Requires valid JWT token
  - Returns user information from token

#### Media Endpoints (Proxied to Media Service)

- **POST /media/upload** - Create upload session with pre-signed URL
  - Requires valid JWT token
  - Proxies to Media Service HTTP API
  - Returns uploadId and pre-signed MinIO URL

- **POST /media/upload/complete** - Finalize upload with checksum
  - Requires valid JWT token
  - Validates file integrity
  - Triggers background processing

- **GET /media/:mediaId** - Get media download URLs
  - Requires valid JWT token
  - Returns pre-signed download URLs for original and variants

- **DELETE /media/:mediaId** - Delete media
  - Requires valid JWT token
  - Soft deletes media record

- **GET /admin** - Example admin-only route
  - Requires JWT token with 'admin' or 'manager' role
  - Verifies role in token payload

#### Users Module

- **POST /users** - Create new user profile
  - Requires authentication
  - Automatically assigns id from JWT token sub claim
  - Payload: email, username, firstName, lastName, avatarUrl

- **GET /users/me** - Get current user's profile
  - Requires authentication
  - Extracts id from JWT token and calls Users Service

- **PUT /users/me** - Update current user's profile
  - Requires authentication
  - Only allows updating own profile (id from JWT)
  - Payload: firstName, lastName, avatarUrl

- **GET /users** - List all users (paginated)
  - Requires authentication
  - Query params: page, limit
  - Returns user list with pagination metadata

- **GET /users/search** - Search users (admin only)
  - Requires admin role
  - Query params: query, page, limit
  - Searches by username, email, firstName, lastName

- **GET /users/:id** - Get user by ID (admin only)
  - Requires admin role
  - Params: id (user ID)

- **PUT /users/:id** - Update any user (admin only)
  - Requires admin role
  - Params: id (user ID)
  - Payload: email, username, firstName, lastName, phone, avatarUrl

- **DELETE /users/:id** - Delete user (admin only)
  - Requires admin role
  - Params: id (user ID)
  - Soft delete or hard delete depending on configuration

#### Chat Module

- **GET /conversations/:id/messages** - Get messages in conversation
  - Requires authentication and conversation membership
  - Params: id (conversation ID)
  - Query params: after (offset), before (offset), limit
  - Offset-based pagination ensures consistent ordering

#### Conversation Module

- **GET /conversations** - List current user's conversations
  - Requires authentication
  - Query params: page, limit
  - Returns only conversations where user is a member

- **POST /conversations** - Create new conversation
  - Requires authentication
  - Payload: kind (DIRECT/DEPARTMENT/PROJECT/ANNOUNCEMENT), memberIds, name, description
  - Validates member count by kind:
    - DIRECT: exactly 2 people
    - DEPARTMENT: auto-populated from department membership
    - PROJECT: manual member list (minimum 2 people)
    - ANNOUNCEMENT: read-only channel for broadcast messages

- **GET /conversations/:id** - Get conversation details
  - Requires authentication and membership
  - Params: id (conversation ID)
  - Returns conversation info and member list

- **POST /conversations/:id/members** - Add members to conversation
  - Requires authentication and current membership
  - Params: id (conversation ID)
  - Payload: userIds (array)
  - Not applicable for DIRECT conversations

- **GET /conversations/:id/members** - Get member list
  - Requires authentication and membership
  - Params: id (conversation ID)

- **GET /conversations/:id/unread** - Get unread message count
  - Requires authentication and membership
  - Params: id (conversation ID)
  - Calculated by comparing lastSeenOffset with conversation's maxOffset

- **PATCH /conversations/:id/offset** - Update last seen offset (mark as read)
  - Requires authentication and membership
  - Params: id (conversation ID)
  - Payload: offset (last seen message offset)

#### Friendship Module

- **POST /friendships/requests/:targetUserId** - Send friend request
  - Requires authentication
  - Params: targetUserId (recipient's ID)
  - Cannot send if already friends, pending request exists, or blocked

- **POST /friendships/requests/:fromUserId/accept** - Accept friend request
  - Requires authentication
  - Params: fromUserId (requester's ID)
  - Creates bidirectional friendship and automatically creates DIRECT conversation

- **POST /friendships/requests/:fromUserId/reject** - Reject friend request
  - Requires authentication
  - Params: fromUserId (requester's ID)

- **GET /friendships/requests** - Get pending friend requests
  - Requires authentication
  - Returns both sent and received requests

- **GET /friendships** - Get friends list
  - Requires authentication
  - Returns only friendships with status = FRIEND

- **GET /friendships/:targetUserId/status** - Check friendship status with a user
  - Requires authentication
  - Params: targetUserId
  - Returns: FRIEND, PENDING_IN, PENDING_OUT, BLOCKED, NONE

- **DELETE /friendships/:targetUserId** - Unfriend
  - Requires authentication
  - Params: targetUserId
  - Removes bidirectional relationship

- **POST /friendships/blocks/:targetUserId** - Block user
  - Requires authentication
  - Params: targetUserId
  - Automatically unfriends before blocking if currently friends

- **DELETE /friendships/blocks/:targetUserId** - Unblock user
  - Requires authentication
  - Params: targetUserId

#### Presence Module

- **GET /presence/status** - Get own presence status
  - Requires authentication
  - Returns: online, lastSeen, lastActivity

- **GET /presence/friends** - Get all friends' presence status
  - Requires authentication
  - Bulk query to display friend list with online/offline status

### TCP Message Patterns

Gateway uses TCP transport to communicate with all microservices. Each microservice is injected into Gateway via ClientProxy with corresponding service name:

**Users Service:**
- CREATE_USER
- GET_USER (accepts Keycloak ID as id)
- FIND_OR_CREATE_FROM_KEYCLOAK
- UPDATE_USER (accepts Keycloak ID as id)
- DELETE_USER
- LIST_USERS
- SEARCH_USERS

**Chat Core:**
- SEND_MESSAGE - Forward message send request, receive success/fail response

**Conversation Service:**
- CREATE_CONVERSATION
- GET_CONVERSATION
- LIST_CONVERSATIONS
- ADD_MEMBERS
- GET_MEMBER_IDS
- UPDATE_LAST_SEEN_OFFSET
- GET_UNREAD_COUNT

**Friendship Service:**
- SEND_FRIEND_REQUEST
- ACCEPT_FRIEND_REQUEST
- REJECT_FRIEND_REQUEST
- UNFRIEND
- BLOCK_USER
- UNBLOCK_USER
- GET_FRIENDS
- GET_PENDING_REQUESTS
- GET_FRIEND_STATUS

**Message Store:**
- GET_MESSAGES
- MARK_AS_READ

**Presence Service:**
- GET_STATUS
- GET_BULK_STATUS

**Timeout & Retry:**
- All TCP requests have default timeout: 5000ms
- No automatic retry to avoid duplicate operations
- Returns HTTP 503 Service Unavailable if microservice doesn't respond

**Idempotency:**
- Gateway doesn't guarantee idempotency - responsibility of each microservice
- Sends idempotency key through metadata when necessary

## Asynchronous Communication (Kafka)

Gateway does NOT participate directly in Kafka messaging. All asynchronous communication is handled by backend microservices.

### Events Published

None.

### Events Consumed

None.

## Data Model

Gateway is a **stateless service** - it has no dedicated database.

**Cache Usage:**
- Redis cache for JWT public keys (JWKS) from Keycloak
- TTL: 3600 seconds (1 hour)
- Cache key: `jwks:{realm}`

## Dependencies

**Other Services:**
- **Keycloak** - JWT token authentication via JWKS endpoint
- **Users Service** - User profile management
- **Chat Core** - Validate and forward messages
- **Conversation Service** - Manage conversation lifecycle
- **Friendship Service** - Manage friends and blocks
- **Message Store** - Read messages
- **Presence Service** - Track online/offline status

**Shared Libraries:**
- `@app/common` - KeycloakGuard, decorators, constants, DTOs, logger
- `@app/cache` - Redis cache for JWKS

**External Systems:**
- Keycloak server - Token verification

## Important Behaviors

### Processing Order

Gateway processes requests in **synchronous blocking** manner - waits for microservice response before returning to client. No queuing or background processing.

### Consistency

Gateway doesn't concern itself with consistency - it's just a proxy layer. All consistency issues are handled by microservices.

### Error Handling

**Errors from microservices:**
- Catches RpcException from microservices
- Converts to corresponding HTTP exceptions:
  - NOT_FOUND → 404
  - UNAUTHORIZED → 401
  - FORBIDDEN → 403
  - BAD_REQUEST → 400
  - INTERNAL_ERROR → 500

**Microservice connection errors:**
- Timeout after 5s → HTTP 503 Service Unavailable
- Service unavailable → HTTP 503

**Authentication errors:**
- Invalid token → HTTP 401 Unauthorized
- Insufficient permissions → HTTP 403 Forbidden

**Global Exception Filter:**
- Catches all unhandled exceptions
- Logs detailed error with trace ID
- Returns standardized JSON response:
  ```
  {
    "statusCode": number,
    "message": string,
    "error": string,
    "timestamp": ISO string,
    "path": string,
    "traceId": string
  }
  ```

### Scalability

Gateway can scale **horizontally** without limits because it's a stateless service:
- No shared state between instances
- Each instance connects independently to microservices
- Load balancer distributes requests (round-robin, least-connection)

**Notes when scaling:**
- JWKS cache is local per instance (no impact)
- Monitoring health checks must verify all instances

## Configuration

### Required Environment Variables

**Keycloak Configuration:**
- `KEYCLOAK_URL` - External Keycloak URL (used by clients)
- `KEYCLOAK_URL_INTERNAL` - Internal URL within Docker network
- `KEYCLOAK_REALM` - Realm name (default: nest-realm)
- `KEYCLOAK_CLIENT_ID` - OAuth client ID
- `KEYCLOAK_CLIENT_SECRET` - OAuth client secret (if using confidential client)

**Service Ports:**
- `PORT` - HTTP port Gateway listens on (default: 3001)
- `USERS_SERVICE_HOST` - Users Service hostname
- `USERS_SERVICE_PORT` - Users Service TCP port
- `CHAT_CORE_HOST` - Chat Core hostname
- `CHAT_CORE_PORT` - Chat Core TCP port
- `CONVERSATION_SERVICE_HOST`
- `CONVERSATION_SERVICE_PORT`
- `FRIENDSHIP_SERVICE_HOST`
- `FRIENDSHIP_SERVICE_PORT`
- `MESSAGE_STORE_HOST`
- `MESSAGE_STORE_PORT`
- `PRESENCE_SERVICE_HOST`
- `PRESENCE_SERVICE_PORT`

**Redis Configuration:**
- `REDIS_HOST` - Redis hostname
- `REDIS_PORT` - Redis port (default: 6379)
- `REDIS_DB` - Redis database number (default: 0)

**Logging:**
- `LOG_LEVEL` - Log level (debug, info, warn, error)

### Feature Flags

- `ENABLE_FRIENDSHIP_SERVICE` - Enable/disable FriendshipModule (default: `true`). When set to `false`, friendship endpoints return 503 Service Unavailable and the module skips connecting to the Friendship Service.

### Runtime Assumptions

- All microservices must be online before Gateway starts
- Keycloak must be available and realm must be configured
- Redis must be running (if not, Gateway still works but doesn't cache JWKS)

## Design Notes

### Architectural Decisions

**1. Why not implement authentication in Gateway?**
- Keycloak is the single source of truth for authentication
- Gateway only verifies tokens, doesn't manage user credentials
- Reduces dependencies and simplifies Gateway
- Easy to change authentication provider

**2. Why use TCP instead of HTTP for internal communication?**
- Better performance than HTTP REST
- Built into NestJS microservices
- Type-safe with message patterns
- Lighter than gRPC, easier to setup

**3. Why need Gateway Service layer (Facade)?**
- Controllers shouldn't know about TCP patterns
- Easier to test - mock Gateway Service instead of ClientProxy
- Centralize error handling and retry logic
- Easier to refactor later (switch from TCP to gRPC for example)

**4. Why not aggregate data from multiple services in one endpoint?**
- Not needed yet - frontend calls multiple endpoints
- Avoids overloading Gateway with business logic
- BFF (Backend for Frontend) pattern can be added later if needed

### Trade-offs

**Advantages:**
- Simple and easy to understand
- Stateless - easy to scale
- Centralized authentication
- Clear separation of concerns

**Disadvantages:**
- Single point of failure (needs load balancer + health check)
- Adds one network hop latency
- No response caching (every request calls microservice)

### Future Extensions

**Can be added later:**
- **Response caching** - Cache GET requests with Redis
- **Rate limiting** - Limit requests per user/IP
- **API Gateway features** - Request transformation, response aggregation
- **GraphQL Gateway** - Replace REST endpoints
- **BFF pattern** - Create specialized gateway for mobile/web
- **Circuit breaker** - Automatically block requests to failing services
- **Request tracing** - Distributed tracing with Jaeger/Zipkin
