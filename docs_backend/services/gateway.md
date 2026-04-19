# Gateway Service

## Overview

Gateway Service is the single entry point for all HTTP API requests from clients. This service is responsible for authenticating JWT tokens with Keycloak, routing requests to corresponding microservices via TCP protocol, and hiding the complexity of microservice communication behind HTTP endpoints.

Gateway uses the **Facade Pattern** with Gateway Services (UsersGatewayService, ChatGatewayService, etc.) to encapsulate complex TCP operations and only expose simple methods for controllers to use.

## Service Dependencies (from code)

**TCP Clients Injected:**
- `SERVICES.USERS` - User profile operations (also used by AuthModule for registration)
- `SERVICES.CONVERSATION` - Conversation management — **PooledTcpClientProxy** (round-robin N connections)
- `SERVICES.FRIENDSHIP` - Social relationships — **PooledTcpClientProxy** (round-robin N connections)
- `SERVICES.MESSAGE_STORE` - Message queries
- `SERVICES.PRESENCE` - Online/offline status
- `SERVICES.CHAT_CORE` - Message validation (send message) — **PooledTcpClientProxy** (round-robin N connections)
- `SERVICES.NOTIFICATION` - Email OTP dispatch (registration, password reset)

**HTTP Proxy:**
- Media Service (port 3009) - File upload/download operations

## Responsibilities

**Gateway is responsible for:**

- Authenticating JWT tokens from Keycloak via JWKS (RS256 signature verification)
- **Login / Registration / Refresh / Logout** — full auth lifecycle with session management
- **Session Management**: exactly 1 web session + 1 mobile session per user, backed by Redis; kicks old session on conflict
- **Session Guard (APP_GUARD)**: validates `session_state` (sid) claim on every authenticated request. **Fast path**: checks `SessionCacheService` (in-memory Map, 30s TTL) — 0 Redis calls on hit. **Slow path** (cache miss): Redis GET, then populates SessionCacheService for 30s.
- Managing access control based on roles (Role-Based Access Control - RBAC)
- Routing HTTP requests to microservices via TCP transport
- Aggregating and transforming data from multiple microservices when needed
- Converting responses from TCP to HTTP format
- Global error handling and returning standard HTTP status codes
- Rate limiting and throttling
- Proxying media upload/download requests to Media Service (HTTP to HTTP)

**Gateway is NOT responsible for:**

- Processing business logic - all logic resides in microservices
- Storing data - no direct database connections
- Managing WebSocket connections - responsibility of Realtime Gateway

## External Communication

### HTTP Endpoints

#### General Endpoints

- **GET /** - Public endpoint to check service status
  - No authentication required
  - Returns welcome message

- **GET /health** - Health check endpoint for monitoring
  - No authentication required
  - Returns service status and dependency health

- **GET /health/circuit-breakers** - Circuit breaker status for all downstream services
  - No authentication required
  - Returns combined circuit breaker status from Gateway and Chat Core

- **GET /protected** - Example protected route
  - Requires valid JWT token
  - Returns user information from token

#### Auth Endpoints

> All auth endpoints under `/auth/*` are **Public** (no JWT required) unless noted.
> Login / register / logout require the `X-Client-Platform: web | mobile` header (defaults to `web` if absent/invalid).

- **POST /auth/login** — Login with email + password
  - Body: `{ email, password, platform: 'web'|'mobile', deviceInfo?: { deviceName?, userAgent?, ipAddress? } }`
  - **Email must be @gmail.com** (validated via `@Matches(/@gmail\.com$/i)` on DTO). Non-Gmail emails return 400.
  - Returns: `{ accessToken, refreshToken, expiresIn }`
  - Creates / replaces session for the given platform (at most 1 web + 1 mobile per user). If a session already exists on that platform, it is kicked: Redis session deleted → `SessionCacheService.invalidate()` → WS revocation published → Keycloak session revoked (non-fatal).

- **POST /auth/refresh** — Refresh access token
  - Header: `X-Client-Platform: web | mobile`
  - Body: `{ refreshToken: string }`
  - Returns: `{ accessToken, refreshToken, expiresIn }`
  - Validates session still exists in Redis. **SID mismatch** (Keycloak session_state rotated unexpectedly) now throws `401 SESSION_REVOKED` instead of silently accepting the new SID.

- **POST /auth/logout** — Logout (**requires JWT**)
  - Header: `Authorization: Bearer <accessToken>`, `X-Client-Platform: web | mobile`
  - No body required
  - Deletes Redis session, revokes Keycloak session, publishes WS revocation event

- **POST /auth/register/init** — Step 1: Initiate registration
  - Body: `{ email, firstName, lastName }`
  - **Email must be @gmail.com** (validated on DTO). Non-Gmail returns 400.
  - Checks email uniqueness against Keycloak; generates display `username = firstName + ' ' + lastName`; stores init data in Redis (`auth:reg:init:{emailHash}`, TTL 900s); sends 6-digit OTP email (TTL 10 min)
  - Returns: `{ cooldownSeconds: 60 }`
  - Rate limit: 5 requests / 15 min / email, 60s cooldown

- **POST /auth/register/verify-otp** — Step 2: Verify registration OTP
  - Body: `{ email, otp }` (otp: exactly 6 digits)
  - Returns: `{ registrationToken: UUID, expiresIn: 600 }` (token TTL: 10 min)
  - Max 3 wrong attempts before lockout (OTP deleted, must restart)

- **POST /auth/register/complete** — Step 3: Complete registration
  - Body: `{ registrationToken, password, platform: 'web'|'mobile', deviceInfo?: { deviceName?, userAgent?, ipAddress? } }`
  - Creates user in Keycloak + users-service (Saga-lite rollback: Keycloak user deleted if users-service fails)
  - Auto-logs in and returns: `{ accessToken, refreshToken, expiresIn }`

- **POST /auth/forgot-password** — Request OTP for password reset
  - No authentication required
  - Body: `{ email: string }` — **must be @gmail.com**.
  - Returns 404 if email not registered
  - Rate limited: 5 requests / 15 minutes / email, 60s cooldown

- **POST /auth/verify-otp** — Verify 6-digit OTP
  - No authentication required
  - Body: `{ email: string, otp: string }`
  - Returns `{ resetToken: string, expiresIn: number }` on success (10-min TTL)
  - Max 3 incorrect attempts before lockout

- **POST /auth/reset-password** — Set new password using resetToken
  - No authentication required
  - Body: `{ resetToken: string, newPassword: string }`
  - resetToken is one-time-use (atomic GETDEL)
  - Revokes all existing Keycloak sessions on success

#### Media Endpoints (Proxied to Media Service)

- **GET /media** - List user's media
  - Requires valid JWT token
  - Returns paginated list of user-owned media records

- **POST /media/upload** - Create upload session with pre-signed URL
  - Requires valid JWT token
  - Proxies to Media Service HTTP API
  - Returns uploadId and pre-signed MinIO PUT URL (15-min TTL)

- **POST /media/upload/complete** - Finalize upload with checksum
  - Requires valid JWT token
  - Body: `{ uploadId, checksum?, checksumAlgorithm? }`
  - Verifies file exists in MinIO, validates checksum, triggers background processing

- **GET /media/:mediaId/url** - Get pre-signed access URLs for media
  - Requires valid JWT token
  - Returns pre-signed GET URLs for original and variant files (5-min TTL)

- **DELETE /media/:mediaId** - Delete media
  - Requires valid JWT token
  - Soft deletes media record; fails cleanly if MinIO delete fails (DELETION_PENDING)

- **POST /media/:mediaId/cross-share** - Share media across conversations (ADMIN only)
  - Requires valid JWT token and ADMIN role
  - Grants `canShare=true` on a media item for cross-conversation sharing

#### Users Module

- **GET /users/me** - Get current user's profile
  - Requires authentication
  - Query param: `avatarVariant` (thumb|original, default: thumb)
  - Returns profile with resolved `avatarUrl` presigned URL

- **PUT /users/me** - Update current user's profile
  - Requires authentication
  - Payload: `{ firstName?, lastName?, phone?, title?, avatarMediaId? }`
  - Query param: `avatarVariant` (thumb|original, default: thumb)

- **PATCH /users/me/settings** - Update user settings (partial merge)
  - Requires authentication
  - Payload: `{ statusMessage?, theme?, messageDensity?, enterToSend?, notifications? }`

- **GET /users/me/sessions** - List active Keycloak sessions
  - Requires authentication
  - Returns session list with IP, device, last access

- **DELETE /users/me/sessions** - Revoke all sessions except current
  - Requires authentication
  - Uses `sid` claim from JWT to preserve the calling session

- **DELETE /users/me/sessions/:sessionId** - Revoke a specific session
  - Requires authentication
  - Params: sessionId (Keycloak session ID)

- **POST /users/me/change-password** - Change password (logged-in user)
  - Requires authentication
  - Body: `{ currentPassword, newPassword }`
  - Verifies current password, then revokes all sessions on success

- **GET /users** - List all users (paginated)
  - Requires authentication
  - Query params: page, limit
  - Returns user list with pagination metadata

- **GET /users/search** - Search users
  - Requires authentication
  - Query params: q, page, limit
  - Searches by username, email, firstName, lastName

- **GET /users/:id** - Get user by ID
  - Requires authentication
  - Params: id (user Keycloak ID)

#### Chat Module

- **POST /chat/messages** - Send a message (HTTP fallback / circuit-breaker test)
  - Requires authentication and conversation membership
  - In production, messages are sent via WebSocket (Realtime Gateway)
  - Body: `{ conversationId, content, mediaId?, type?, clientMessageId? }`

- **POST /chat/pre-check-media** - Pre-validate media before upload (Phase 1 of two-phase upload)
  - Requires authentication
  - Body: `{ conversationId, mimeType, fileSize }`
  - Validates membership, mime type allowlist, file size limit before client uploads to MinIO
  - Returns `{ approved: boolean, conversationId, userId, timestamp }`

#### Message Operations Module

- **PATCH /messages/:id** - Edit message (own, within 10 minutes)
  - Requires authentication
  - Body: `{ content, metadata? }`
  - Only sender can edit; enforces 10-minute time window

- **DELETE /messages/:id** - Delete message
  - Requires authentication
  - Own messages: within 24h (soft delete)
  - OWNER/ADMIN: can delete any message within 24h with audit log

- **POST /messages/:id/pin** - Pin a message
  - Requires authentication with MSG.PIN permission (OWNER/ADMIN/MODERATOR)
  - Body: `{ conversationId }`
  - Max 3 pinned messages per conversation

- **DELETE /messages/:id/pin** - Unpin a message
  - Requires authentication with MSG.PIN permission
  - Params: id (message ID)

#### Conversation Module

- **GET /conversations** - List current user's conversations
  - Requires authentication
  - Query params: page, limit, avatarVariant (`thumb` | `original`, default: `thumb`)
  - Returns only conversations where user is a member

- **POST /conversations** - Create new conversation
  - Requires authentication
  - Payload: `type` (`direct` | `group` | `community`), `memberIds`, `name?`, `description?`
  - Gateway normalizes `type` to lowercase before forwarding
  - Validates member count by kind:
    - DIRECT: exactly 2 total members (including current user)
    - GROUP: minimum 3 total members, maximum 500
    - COMMUNITY: read-only channel for broadcast messages

- **GET /conversations/:id** - Get conversation details
  - Requires authentication and membership
  - Params: id (conversation ID)
  - Query params: avatarVariant (`thumb` | `original`, default: `thumb`)
  - Returns conversation info enriched with:
    - `avatarUrl` (presigned URL resolved from `avatarMediaId` via Redis cache + Media Service batch)
    - `participants` array enriched with username, displayName, **avatarUrl** from Users Service
      - `avatarUrl` is resolved via `enrichParticipantsWithAvatarUrls()` — collects all participant `avatarMediaId` values, does Redis MGET for cached presigned URLs, batch-fetches misses from Media Service, then caches results
      - This fixes the issue where `participants[].avatarUrl` was `null` (deprecated DB column)

- **GET /conversations/:id/messages** - Get messages (offset-based pagination)
  - Requires authentication and conversation membership
  - Query params: after (offset), before (offset), limit (default: 30)
  - Delegates to Message Store Service

- **POST /conversations/:id/members** - Add members to conversation
  - Requires authentication and OWNER/ADMIN role
  - Params: id (conversation ID)
  - Body: `{ userIds: string[] }`
  - Not applicable for DIRECT conversations

- **DELETE /conversations/:id/members** - Remove members from conversation
  - Requires authentication and OWNER/ADMIN role
  - Params: id (conversation ID)
  - Body: `{ userIds: string[] }`

- **GET /conversations/:id/members** - Get member list
  - Requires authentication
  - Params: id (conversation ID)
  - Returns member IDs array

- **GET /conversations/:id/unread** - Get unread message count
  - Requires authentication and membership
  - Params: id (conversation ID)
  - Calculated by comparing lastSeenOffset with conversation's maxOffset

- **PATCH /conversations/:id/offset** - Update last seen offset (mark as read)
  - Requires authentication and membership
  - Params: id (conversation ID)
  - Body: `{ offset: number }` (last seen message offset)

- **PATCH /conversations/:id/info** - Update conversation name/description/avatar
  - Requires OWNER or ADMIN role (CH.UPDATE_INFO permission)
  - Body: `{ name?, description?, avatarMediaId? }`
  - `avatarMediaId` is the UUID of a media record (uploaded via Media Service)
  - On success, the previous avatar cache key is busted and old MinIO object is soft-deleted

- **PATCH /conversations/:id/members/:userId/role** - Set member role
  - Requires OWNER or ADMIN role (MBR.SET_ROLE permission)
  - Body: `{ role: string }` (MemberRole value)
  - OWNER can promote to ADMIN; ADMIN cannot change OWNER role

- **GET /conversations/:id/pinned** - Get pinned messages
  - Requires authentication and membership
  - Returns up to 3 pinned messages per conversation

- **GET /conversations/health/outbox** - Outbox health check
  - No authentication required
  - Returns pending outbox event count and lag metrics

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

#### Call Module

- **GET /calls/health** - Health check for Call Service (public, no auth)
  - Returns LiveKit connectivity and DB state

- **POST /calls/start** - Start a meeting in a conversation
  - Requires authentication
  - Body: `{ conversationId, allowWaitingRoom? }`
  - Rate limit: 120/min

- **GET /calls/active/:conversationId** - Get active meeting for a conversation
  - Requires authentication
  - Rate limit: 60/min

- **GET /calls/me/active** - Get current user's active meeting
  - Requires authentication
  - Rate limit: 120/min

- **POST /calls/:meetingId/join** - Request to join a meeting
  - Requires authentication
  - Rate limit: 1500/min (users may retry on network hiccup)

- **POST /calls/:meetingId/waiting/:userId/approve** - Approve waiting participant (host only)
  - Requires authentication
  - Rate limit: 30/min

- **POST /calls/:meetingId/waiting/:userId/reject** - Reject waiting participant (host only)
  - Requires authentication

- **POST /calls/:meetingId/leave** - Leave a meeting
  - Requires authentication

- **POST /calls/:meetingId/end** - End a meeting (host only)
  - Requires authentication

- **PATCH /calls/:meetingId/media-state** - Update own audio/video/screen state
  - Requires authentication

- **GET /calls/:meetingId/snapshot** - Get current meeting participants
  - Requires authentication

- **GET /calls/history/:conversationId** - List past meetings for a conversation
  - Requires authentication

- **GET /calls/:meetingId/summary** - Get meeting summary (duration, participants)
  - Requires authentication

- **POST /calls/:meetingId/token** - Issue LiveKit WebRTC access token
  - Requires authentication
  - Body: `{ participantName?, canPublish?, canSubscribe? }`

- **POST /calls/:meetingId/recording/start** - Start recording (host only)
  - Requires authentication; Rate limit: 20/min

- **POST /calls/:meetingId/recording/pause** - Pause recording
  - Requires authentication; Rate limit: 30/min

- **POST /calls/:meetingId/recording/resume** - Resume recording
  - Requires authentication; Rate limit: 30/min

- **POST /calls/:meetingId/recording/stop** - Stop recording
  - Requires authentication; Rate limit: 20/min

- **GET /calls/:meetingId/recordings** - List recordings for a meeting
  - Requires authentication; Rate limit: 30/min

- **POST /calls/:meetingId/participants/:userId/moderate** - Moderate participant
  - Requires authentication (host only)
  - Body: `{ action: 'MUTE_AUDIO' | 'MUTE_VIDEO' | 'DISABLE_SCREEN' | 'KICK', reason? }`
  - Rate limit: 30/min

#### Notification Module

- **GET /notifications/vapid-public-key** - Get VAPID public key for Web Push (public, no auth)
  - Returns `{ publicKey: string }` for browser Web Push subscription

- **POST /notifications/devices** - Register push notification device token
  - Requires authentication
  - Body: `{ token, platform: 'FCM' | 'APNS' | 'WEB', deviceId }`

- **DELETE /notifications/devices/:deviceId** - Unregister device (logout/uninstall)
  - Requires authentication

- **PUT /notifications/preferences** - Save mute settings and quiet hours
  - Requires authentication
  - Body: `{ conversationId? (null = global), muteUntil?, notifyOnMention?, notifyOnMessage?, quietHoursEnabled?, quietHoursStart?, quietHoursEnd?, timezone? }`

- **GET /notifications/preferences** - Get notification preferences
  - Requires authentication
  - Query: `conversationId?` (returns both global + conversation override)

### TCP Message Patterns

Gateway uses TCP transport to communicate with all microservices. Each microservice is injected into Gateway via ClientProxy with corresponding service name:

**Users Service:**
- CREATE_USER
- GET_USER (accepts Keycloak ID as id)
- GET_USERS_BY_IDS (batch, used for participant profile enrichment)
- UPDATE_USER (accepts Keycloak ID as id)
- DELETE_USER
- LIST_USERS
- SEARCH_USERS
- UPDATE_SETTINGS

**Chat Core:**
- SEND_MESSAGE - Validate and forward message send request

**Conversation Service:**
- CREATE_CONVERSATION
- GET_CONVERSATION (returns raw participants: `[{ userId, role }]`)
- LIST_CONVERSATIONS (returns raw `otherUserId` field for DIRECT conversations)
- ADD_MEMBERS
- REMOVE_MEMBERS
- GET_MEMBER_IDS
- UPDATE_INFO (returns `{ conversation, previousAvatarMediaId }`)
- SET_MEMBER_ROLE
- UPDATE_LAST_SEEN_OFFSET
- GET_UNREAD_COUNT

**Media Service (TCP):**
- CREATE_UPLOAD
- FINALIZE_UPLOAD
- GET_ACCESS_URL
- VALIDATE_FOR_SEND
- BIND_TO_MESSAGE
- CROSS_SHARE
- GET_AVATARS_BATCH (batch presigned URL resolution for avatar enrichment)
- DELETE_AVATAR_SYSTEM (system-level avatar deletion, tenant-scoped, no owner check)

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
- GET_MESSAGE_BY_ID
- HAS_REPLIED
- GET_PINNED_MESSAGES

**Presence Service:**
- GET_STATUS (single user last-seen / analytics)
- GET_BULK_STATUS (friend list online indicators — UI only)
- GET_ONLINE_COUNT (dashboard metrics)
- SCHEDULE_OFFLINE (anti-flap: grace period before marking offline)
- CANCEL_OFFLINE (cancel grace period on reconnect)
- UPDATE_ACTIVITY (heartbeat to extend TTL)

**Call Service (TCP):**
- START_MEETING
- GET_ACTIVE_MEETING
- GET_MY_ACTIVE_MEETING
- REQUEST_JOIN_MEETING
- APPROVE_WAITING_PARTICIPANT
- REJECT_WAITING_PARTICIPANT
- LEAVE_MEETING
- END_MEETING
- UPDATE_MEDIA_STATE
- GET_MEETING_SNAPSHOT
- LIST_MEETING_HISTORY
- GET_MEETING_SUMMARY
- ISSUE_MEDIA_TOKEN
- MODERATE_PARTICIPANT
- START_RECORDING
- PAUSE_RECORDING
- RESUME_RECORDING
- STOP_RECORDING
- LIST_RECORDINGS
- GET_CALL_HEALTH

**Notification Service (TCP):**
- REGISTER_DEVICE
- UNREGISTER_DEVICE
- UPDATE_NOTIFICATION_PREF
- GET_NOTIFICATION_PREFS
- SEND_OTP_EMAIL

**Timeout & Retry:**
- All TCP requests have default timeout: 5000ms
- No automatic retry to avoid duplicate operations
- Returns HTTP 503 Service Unavailable if microservice does not respond
- Avatar enrichment calls (`GET_AVATARS_BATCH`, `DELETE_AVATAR_SYSTEM`) use a plain proxy (no circuit breaker) so failures do not trip the circuit breaker for critical operations

**Idempotency:**
- Gateway does not guarantee idempotency - responsibility of each microservice
- Sends idempotency key through metadata when necessary

## Asynchronous Communication (Kafka)

**Topic: `user.profile.updated`** (consumed)

- Consumer Group: `nest-chat.gateway.cache-invalidation`
- Handler: `UserProfileCacheConsumer` (`apps/gateway/src/modules/cache/user-profile-cache.consumer.ts`)
- Purpose: Evict stale presigned avatar URL entries from Redis when a user changes their avatar
- Logic: On event with `oldAvatarMediaId` present, delete:
  - `media:avatar_url:{oldAvatarMediaId}` (thumbnail variant)
  - `media:avatar_url:{oldAvatarMediaId}:original`
- No-op if `oldAvatarMediaId` is null/empty (non-avatar field change)
- Ensures next `GET /conversations/:id` call fetches a fresh presigned URL for the new avatar

For all other Kafka topics: Gateway does NOT participate directly. All other asynchronous communication is handled by backend microservices.

### Events Published

None.

### Events Consumed

None.

## Data Model

Gateway is a **stateless service** — it has no dedicated database.

**Cache Usage:**
- **`SessionCacheService`** (in-process Map, per-Pod): caches validated session `keycloakSid` per `userId:platform`, TTL 30s. Eliminates Redis GET on every authenticated request (cache hit = 0 Redis calls). Invalidated explicitly on login, logout, and session kick.
- **`TokenValidationService`** in-process cache: caches JWT validation result by signature (last JWT segment), TTL = min(token.exp, now+5min). Eliminates repeated RSA verify (~3ms each).
- Redis cache for JWT public keys (JWKS) from Keycloak
  - TTL: 3600 seconds (1 hour), key: `jwks:{realm}`
- Redis cache for avatar presigned URLs (ConversationGatewayModule)
  - Key: `media:avatar_url:{mediaId}`, value: JSON `{ url, expiresAt (Unix ms) }`
  - TTL: dynamic — `(presignedUrlExpiresAt - now) - 5 min buffer`
  - A dedicated `CONV_REDIS_CLIENT` (IORedis instance) is provided in `ConversationGatewayModule`

## ConversationGatewayService — Response Enrichment

**ConversationGatewayService** enriches raw Conversation Service responses before returning them to the HTTP client. Conversation Service returns only database IDs; the Gateway resolves human-readable data.

### List Conversations (`GET /conversations`)

1. Call Conversation Service `LIST_CONVERSATIONS` — receives raw list with `otherUserId` (DIRECT) and `avatarMediaId` fields
2. Batch-resolve presigned avatar URLs:
   - Deduplicate `avatarMediaId` values
   - Redis `MGET` for all keys in one round-trip
   - Skip near-expired entries (< 60s remaining)
   - Batch-fetch misses from Media Service via `GET_AVATARS_BATCH`
   - Cache results with smart TTL (`expiresAt - now - 5 min`)
3. Batch-fetch `otherUser` profiles for DIRECT conversations via `GET_USERS_BY_IDS` (soft-fail)
4. Return merged result: each conversation has `avatarUrl` (presigned) and `otherUser` (for DIRECT)

### Get Conversation (`GET /conversations/:id`)

1. Call Conversation Service `GET_CONVERSATION` — receives `{ ...conversation, participants: [{ userId, role }] }`
2. Resolve presigned avatar URL for `avatarMediaId` (same Redis + Media Service strategy)
3. Batch-fetch participant profiles from Users Service (soft-fail)
4. Return enriched result: `avatarUrl` resolved, each participant has `username`, `displayName`, `avatarUrl`

### Update Conversation Info (`PATCH /conversations/:id/info`)

1. Call Conversation Service `UPDATE_INFO` — receives `{ conversation, previousAvatarMediaId }`
2. If `previousAvatarMediaId` exists and differs from the new `avatarMediaId`:
   - Immediately delete Redis avatar URL cache key for the old mediaId
   - Soft-fail call to `DELETE_AVATAR_SYSTEM` on Media Service (no circuit breaker)
3. Return the updated conversation to the client

### Enrichment Error Handling

- Avatar URL resolution failures are logged as warnings; conversations are returned without `avatarUrl` (null)
- User profile fetch failures are logged as warnings; participants are returned without profile fields
- These are soft-fail paths — they must not block or fail the primary response

## Dependencies

**Other Services:**
- **Keycloak** - JWT token authentication via JWKS endpoint
- **Users Service** - User profile management and participant enrichment
- **Chat Core** - Validate and forward messages
- **Conversation Service** - Manage conversation lifecycle
- **Friendship Service** - Manage friends and blocks
- **Media Service** - File upload, avatar URL resolution, avatar deletion (TCP)
- **Message Store** - Read messages
- **Presence Service** - Track online/offline status
- **Call Service** - Meeting lifecycle, recording, moderation (TCP)
- **Notification Service** - Device token management, notification preferences (TCP)

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
- `PORT` - HTTP port Gateway listens on (default: 3000)
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
- `CALL_SERVICE_HOST` - Call Service hostname
- `CALL_SERVICE_PORT` - Call Service TCP port
- `NOTIFICATION_SERVICE_HOST` - Notification Service hostname
- `NOTIFICATION_SERVICE_PORT` - Notification Service TCP port

**Redis Configuration:**
- `REDIS_HOST` - Redis hostname
- `REDIS_PORT` - Redis port (default: 6379)
- `REDIS_DB` - Redis database number (default: 0)
- `REDIS_CHAT_HOST` - Redis hostname for avatar URL cache in ConversationGatewayModule (default: redis-chat)
- `REDIS_CHAT_PORT` - Redis port (default: 6379)
- `REDIS_CHAT_DB` - Redis database number (default: 0)

**MinIO / Media:**
- `PRESIGNED_GET_URL_EXPIRY` - Expiry in seconds for presigned GET URLs (default: 300)

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
