# Users Service

## Overview

The Users Service is a TCP microservice responsible for managing user profile data within the system. It serves as the single source of truth for user profile information, acting as a synchronization layer between Keycloak authentication data and application-level user profiles. This service provides CRUD operations for user records and settings management.

Authentication, session management, and role assignment are handled by Keycloak. The Gateway layer orchestrates profile updates by calling both this service (for DB persistence) and the Keycloak Admin API (for attribute sync and session revocation).

## Responsibilities

### What This Service IS Responsible For

- Creating, reading, updating, and deleting user profile records
- Maintaining mapping between Keycloak IDs and internal user IDs
- Storing user profile metadata: username, email, phone, avatar (`avatarMediaId`)
- Storing user settings as JSONB: statusMessage, theme, messageDensity, enterToSend, notification preferences
- Listing users with pagination and search
- Validating user existence for other services
- Enforcing unique constraints on email within application database

### What This Service IS NOT Responsible For

- User authentication or password management (handled by Keycloak)
- JWT token generation or validation (handled by Keycloak and Gateway)
- Authorization or role-based access control (handled by Keycloak)
- Session management or refresh tokens (handled by Keycloak via Gateway)
- User presence or online/offline status (handled by Presence Service)
- Friendship relationships or social graph (handled by Friendship Service)
- Avatar presigned URL resolution (handled at Gateway level via Media Service)

## External Communication

### HTTP Endpoints (via Gateway)

All endpoints require a valid JWT Bearer token unless noted. Gateway base: `http://gateway:3000`

#### User Profile

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/users/me` | Any | Get own profile (with resolved `avatarUrl`) |
| `PUT` | `/users/me` | Any | Update own profile (`username`, `phone`, `cccdNumber`, `avatarMediaId`) |
| `PATCH` | `/users/me/settings` | Any | Partial update of user settings (statusMessage, theme, messageDensity, enterToSend, notifications) |
| `POST` | `/users/me/change-password` | Any | Change password (verifies current password, revokes all sessions on success) |
| `DELETE` | `/users/me` | Any | Permanently delete own account (Keycloak + DB + `user.deleted` Kafka event — IRREVERSIBLE) |

#### Session Management

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/users/me/sessions` | Any | List active Keycloak sessions (IP, device, last access) |
| `DELETE` | `/users/me/sessions` | Any | Revoke all sessions except the current one |
| `DELETE` | `/users/me/sessions/:sessionId` | Any | Revoke a specific session by session ID |

#### User Directory

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/users` | Any | List users (paginated) |
| `GET` | `/users/search?q=...` | Any | Search users by email/username/name |
| `GET` | `/users/:id` | Any | Get specific user by ID |
| `PATCH` | `/users/:id/deactivate` | Admin role | Disable account: Keycloak `enabled=false` + revoke all sessions + `isActive=false` in DB + `user.deactivated` Kafka event |

### TCP Message Patterns

**Pattern: `USERS_PATTERNS.CREATE_USER`** (`create_user`)

- Purpose: Create a user DB record after Keycloak provisioning
- Payload: `CreateUserDto` + `{ id: string }`
- Response: Created user entity

**Pattern: `USERS_PATTERNS.GET_USER`** (`get_user`)

- Purpose: Retrieve user profile by Keycloak ID
- Payload: `{ id: string }`
- Response: User entity or RpcException (NOT_FOUND)

**Pattern: `USERS_PATTERNS.GET_USERS_BY_IDS`** (`get_users_by_ids`)

- Purpose: Batch-fetch multiple users for enrichment
- Payload: `{ ids: string[] }`
- Response: `User[]`

**Pattern: `USERS_PATTERNS.UPDATE_USER`** (`update_user`)

- Purpose: Update user profile fields
- Payload: `{ id: string } & UpdateUserDto`
- Response: Updated user entity
- Business rules:
  - `firstName`, `lastName` are editable profile fields
  - `email` is immutable after registration
  - `phone`, `cccdNumber` set-once (cannot overwrite existing non-null values)
  - `username` is the display name and is auto-synced from `firstName` + `lastName` when either field changes

**Pattern: `USERS_PATTERNS.UPDATE_SETTINGS`** (`update_user_settings`)

- Purpose: Partial merge of user settings JSON
- Payload: `{ id: string } & UpdateUserSettingsDto`
- Response: Updated user entity

**Pattern: `USERS_PATTERNS.DELETE_USER`** (`delete_user`)

- Purpose: Delete user record permanently
- Payload: `{ id: string }`
- Response: `{ success: boolean, message: string }`

**Pattern: `USERS_PATTERNS.LIST_USERS`** (`list_users`)

- Purpose: Paginated list of all users
- Payload: `{ page?, limit? }`
- Response: Paginated response (data, total, totalPages, hasNextPage, hasPreviousPage)

**Pattern: `USERS_PATTERNS.SEARCH_USERS`** (`search_users`)

- Purpose: Search users by email, username, or name
- Payload: `{ query: string, page?, limit? }`
- Response: Paginated response with matching users

### Timeout and Retry Behavior

- TCP requests timeout after default NestJS ClientProxy timeout (typically 10 seconds)
- No automatic retry logic at service level; clients must implement retry if needed
- Database query timeouts are handled by TypeORM default configuration

## Asynchronous Communication

### Kafka Events Published

**Topic: `user.profile.updated`** (KAFKA_TOPICS.USER.PROFILE_UPDATED)

Published after a user profile change is fully committed. Two distinct event paths:

**Path A — Non-avatar field change** (immediate, on DB update):
- Triggers: `firstName`, `lastName`, `username`, `phone`, `cccdNumber` updated via `PUT /users/me`
- Payload:
  ```json
  {
    "userId": "string",
    "changedFields": ["firstName", "lastName", "username"],
    "oldAvatarMediaId": null,
    "snapshot": { "displayName": "Nguyen Van A", "avatarMediaId": "uuid-or-null" },
    "timestamp": 1712345678000
  }
  ```
- Consumers: Realtime Gateway (broadcasts `user:profile-updated` WS event)

**Path B — Avatar change** (two-stage via `media.ready`):

1. User uploads file → Media Service (`status = UPLOADED`)
2. User calls `PUT /users/me` with new `avatarMediaId`:
   - DB updated immediately
   - Publishes event with **`changedFields: []`** and `oldAvatarMediaId: <previousMediaId>` → triggers cache eviction only (Realtime GW skips this)
3. Media Worker finishes scan → publishes `media.ready`
4. `MediaReadyConsumer` in Users Service detects `owner.avatarMediaId == mediaId`
   - Publishes event with **`changedFields: ['avatarMediaId']`** → triggers WebSocket broadcast

This two-stage design prevents WS broadcast before the file is safe/ready.

### Kafka Events Consumed

**Topic: `media.ready`** (KAFKA_TOPICS.MEDIA.READY)

- Consumer Group: `nest-chat.users-service`
- Purpose: Detect when a newly-uploaded avatar has been processed and is safe to broadcast
- Logic: Query `WHERE id = ownerId AND avatarMediaId = mediaId` — if match, publish `user.profile.updated` with `changedFields: ['avatarMediaId']`
- Handler: `MediaReadyConsumer` (`apps/users/src/consumers/media-ready.consumer.ts`)

## Data Model

### Database Type

**PostgreSQL** — Relational database for structured user profile data with ACID guarantees.

### Table: `users`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | VARCHAR(255) PK | No | Keycloak user ID (JWT sub claim) |
| `email` | VARCHAR, Unique | No | User email address |
| `username` | VARCHAR | No | Display username (non-unique) |
| `first_name` | VARCHAR | Yes | First name |
| `last_name` | VARCHAR | Yes | Last name |
| `phone` | VARCHAR | Yes | Phone number |
| `cccd_number` | VARCHAR(20) | Yes | Vietnamese national ID: 9 or 12 digits |
| `avatar_url` | VARCHAR | Yes | **Legacy** — raw URL (deprecated; use `avatar_media_id`) |
| `avatar_media_id` | VARCHAR | Yes | Media Service file reference for avatar |
| `settings` | JSONB | Yes | User preferences: statusMessage, theme, messageDensity, enterToSend, notifications |
| `is_active` | BOOLEAN | No | Account gate: `true` = active, `false` = banned/disabled |
| `created_at` | TIMESTAMP | No | Auto-managed by TypeORM |
| `updated_at` | TIMESTAMP | No | Auto-managed by TypeORM |

**Indexes:** `id` (PK), `email` (unique), `avatar_media_id`

### User Settings Schema (JSONB)

Stored in `settings` column. All fields are optional and can be partially updated via `PATCH /users/me/settings`. The merge strategy is **deep partial** — only provided keys are written; unset keys in the `notifications` sub-object are preserved.

```json
{
  "statusMessage": "Đang họp",
  "theme": "DARK",
  "messageDensity": "COMFORTABLE",
  "enterToSend": true,
  "notifications": {
    "desktopEnabled": true,
    "mobileEnabled": true,
    "notifyFor": "ALL",
    "muteUntil": null
  }
}
```

| Field | Type | Values / Notes |
|-------|------|----------------|
| `statusMessage` | string | Max 100 chars. Visible to colleagues. |
| `theme` | enum | `LIGHT` \| `DARK` \| `SYSTEM` — client applies CSS |
| `messageDensity` | enum | `COMFORTABLE` \| `COMPACT` — message list density |
| `enterToSend` | boolean | `true` = Enter sends (default); `false` = Ctrl+Enter sends |
| `notifications.desktopEnabled` | boolean | Desktop/browser push notifications |
| `notifications.mobileEnabled` | boolean | Mobile push notifications |
| `notifications.notifyFor` | enum | `ALL` \| `MENTIONS_ONLY` \| `NOTHING` — which messages trigger a push |
| `notifications.muteUntil` | ISO string \| null | Silence all pushes until this datetime; `null` clears the mute |

> **Removed from previous design**: `language` and `timezone` (derived from OS/browser — no server-side value needed).

> **Deep merge safety**: `notifications` sub-object is merged with `undefined`-key filtering before spread. Sending `{ "notifyFor": "NOTHING" }` will not wipe `desktopEnabled`.

### Cache Usage

None at service level. Avatar presigned URLs are cached at Gateway level in Redis (TTL tied to MinIO expiry).

## Dependencies

### Internal Microservices

None. This service operates independently and does not call other microservices via TCP.

### Shared Libraries

- `@app/common` — Shared utilities, constants, DTOs, validation, logging
- `@app/database-postgres` — PostgreSQL module with TypeORM integration

### External Systems

**PostgreSQL:**
- Connection: `USERS_DB_HOST`, `USERS_DB_PORT`, `USERS_DB_USER`, `USERS_DB_PASSWORD`, `USERS_DB_NAME`

**Keycloak (via Gateway only):**
- The Gateway calls Keycloak Admin API for: user provisioning, realm role assignment, profile attribute sync, session listing/revocation
- The Users Service itself does NOT call Keycloak directly

## Important Behaviors

### Avatar Update Flow (mediaId pattern)

Avatar is stored as `avatarMediaId` (reference to Media Service), not a URL. The flow mirrors conversation avatar updates:

1. Client uploads file via `POST /media/upload` → Media Service returns `mediaId`
2. Client calls `PUT /users/me` with `{ avatarMediaId: "<mediaId>" }`
3. Gateway fetches current user to capture `previousAvatarMediaId`
4. Gateway updates Users Service DB via `UPDATE_USER` TCP
5. Gateway soft-fails `deleteAvatarSystem(previousAvatarMediaId)` to clean up old file
6. Gateway enriches response with presigned `avatarUrl` via `MediaGatewayService.getAvatarsBatch()`

### User Settings (partial merge)

`PATCH /users/me/settings` merges provided fields into existing settings JSON:
- Only provided top-level keys are updated
- `notifications` sub-object is deeply merged: only provided keys are written; `undefined` values are filtered before spread to prevent accidental overwrites of existing values
- To clear `muteUntil`, send `{ "notifications": { "muteUntil": null } }` — `null` is preserved through the merge (only `undefined` is filtered)
- Unknown fields (e.g., `language`, `timezone`) are rejected by the ValidationPipe (`whitelist: true`)

### Session Management Flow

Sessions are pure Keycloak sessions. No local session state is stored in Users DB.

1. `GET /users/me/sessions` → Gateway calls Keycloak Admin API: `GET /users/{id}/sessions`
2. Response includes: `id`, `ipAddress`, `start`, `lastAccess`, `clients` (connected apps)
3. `DELETE /users/me/sessions/:sessionId` → Keycloak `DELETE /sessions/{sessionId}`
4. `DELETE /users/me/sessions` → Revoke all sessions except current (`sid` JWT claim identifies current)

The `sid` field in the JWT (`KeycloakUser.sid`) is the current Keycloak session ID used to exempt the current session from bulk revocation.

### Profile Immutability Rules

After registration:
1. `firstName`, `lastName`, `email` are immutable.
2. `phone` and `cccdNumber` can be set only when currently empty.
3. `username` remains editable and acts as the display name.

### Error Handling

- Not found → `RpcException({ code: 5, message: "User with ID ... not found" })`
- Already exists → `RpcException({ code: 6 })`
- Validation error → `RpcException({ code: 3 })`
- Internal error → `RpcException({ code: 13 })`

## Configuration

### Required Environment Variables

- `USERS_SERVICE_PORT` — TCP service port (default: 3001)
- `USERS_DB_HOST` — PostgreSQL host
- `USERS_DB_PORT` — PostgreSQL port (default: 5432)
- `USERS_DB_USER` — PostgreSQL username
- `USERS_DB_PASSWORD` — PostgreSQL password
- `USERS_DB_NAME` — PostgreSQL database name (default: users_db)

### Gateway-Side Environment Variables (for Keycloak Admin)

- `KEYCLOAK_URL_INTERNAL` or `KEYCLOAK_URL` — Keycloak base URL
- `KEYCLOAK_REALM` — Realm name (default: `nest-realm`)
- `KEYCLOAK_CLIENT_ID` — Client ID (default: `nest-api`)
- `KEYCLOAK_ADMIN_CLIENT_ID` — Admin client ID (falls back to `KEYCLOAK_CLIENT_ID`)
- `KEYCLOAK_ADMIN_CLIENT_SECRET` — Admin client secret (required for provisioning)

## Design Notes

### Why `avatarMediaId` Instead of `avatarUrl`

Storing a `mediaId` reference instead of a URL decouples the user profile from presigned URL expiry. URLs are resolved at Gateway level with Redis caching (TTL aligned to MinIO expiry). This is the same pattern used by the Conversation Service for channel avatars.

### Why JSONB for Settings

Settings are relatively free-form and extensible. JSONB allows partial updates without schema migrations for every new setting. The merge strategy ensures backward compatibility.

### Why Sessions Are Not Stored Locally

Keycloak is the authoritative session store. Duplicating session state locally would create consistency issues. The Gateway delegates session queries and revocations directly to the Keycloak Admin API using a service account (client_credentials flow).

### Soft-Fail for External Calls

Avatar cleanup and Keycloak profile sync are non-critical side effects that must not block the main operation. Gateway uses `.catch()` with warning logs for these paths — consistent with the conversation avatar cleanup pattern.
