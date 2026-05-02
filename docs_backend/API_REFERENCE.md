# API Reference — NestJS Chat System

> **Base URL HTTP**: `http://localhost:3000`
> **Base URL WebSocket (Chat)**: `ws://localhost:3002/chat`
> **Base URL WebSocket (Call)**: `ws://localhost:3002/call`
> All protected APIs require header `Authorization: Bearer <ACCESS_TOKEN>`
> All responses are wrapped in a standard envelope (see Section 1)

---

## Table of Contents

1. [Conventions & Response Format](#1-conventions--response-format)
2. [Auth — Authentication & Registration](#2-auth--authentication--registration)
   - [POST /auth/login](#post-authlogin)
   - [POST /auth/refresh](#post-authrefresh)
   - [POST /auth/logout](#post-authlogout)
   - [POST /auth/register/init](#post-authregisterinit)
   - [POST /auth/register/verify-otp](#post-authregisterverify-otp)
   - [POST /auth/register/complete](#post-authregistercomplete)
   - [POST /auth/forgot-password](#post-authforgot-password)
   - [POST /auth/verify-otp](#post-authverify-otp)
   - [POST /auth/reset-password](#post-authreset-password)
3. [Health & System](#3-health--system)
4. [Users — User Management](#4-users--user-management)
   - [GET /users/me](#get-usersme)
   - [PUT /users/me](#put-usersme)
   - [PATCH /users/me/settings](#patch-usersmesettings)
   - [GET /users/me/sessions](#get-usersme-sessions)
   - [DELETE /users/me/sessions](#delete-usersme-sessions)
   - [DELETE /users/me/sessions/:sessionId](#delete-usersme-sessionssessionid)
   - [POST /users/me/change-password](#post-usersmechange-password)
   - [DELETE /users/me](#delete-usersme)
   - [PATCH /users/:id/deactivate](#patch-usersiddeactivate)
   - [GET /users](#get-users)
   - [GET /users/search](#get-userssearch)
   - [GET /users/:id](#get-usersid)
5. [Conversations — Conversation Management](#5-conversations--conversation-management)
   - [GET /conversations](#get-conversations)
   - [POST /conversations](#post-conversations)
   - [GET /conversations/:id](#get-conversationsid)
   - [GET /conversations/:id/messages](#get-conversationsidmessages)
   - [POST /conversations/:id/members](#post-conversationsidmembers)
   - [DELETE /conversations/:id/members](#delete-conversationsidmembers)
   - [GET /conversations/:id/members](#get-conversationsidmembers)
   - [GET /conversations/:id/unread](#get-conversationsidunread)
   - [PATCH /conversations/:id/offset](#patch-conversationsidoffset)
   - [PATCH /conversations/:id/info](#patch-conversationsidinfo)
   - [PATCH /conversations/:id/members/:userId/role](#patch-conversationsidmembersuserid-role)
   - [GET /conversations/:id/pinned](#get-conversationsidpinned)
6. [Chat & Messages](#6-chat--messages)
   - [POST /chat/messages](#post-chatmessages)
   - [POST /chat/pre-check-media](#post-chatpre-check-media)
   - [PATCH /messages/:id](#patch-messagesid)
   - [DELETE /messages/:id](#delete-messagesid)
   - [POST /messages/:id/pin](#post-messagesidpin)
   - [DELETE /messages/:id/pin](#delete-messagesidpin)
   - [POST /messages/:id/revoke](#post-messagesidrevoke)
   - [DELETE /messages/:id/for-me](#delete-messagesidfor-me)
   - [POST /messages/forward](#post-messagesforward)
   - [POST /messages/:id/reactions](#post-messagesidreactions)
7. [Friendships](#7-friendships)
   - [POST /friendships/requests/:targetUserId](#post-friendshipsrequeststargetuserid)
   - [POST /friendships/requests/:fromUserId/accept](#post-friendshipsrequestsfromuseridaccept)
   - [POST /friendships/requests/:fromUserId/reject](#post-friendshipsrequestsfromuseridreject)
   - [GET /friendships/requests](#get-friendshipsrequests)
   - [GET /friendships](#get-friendships)
   - [GET /friendships/:targetUserId/status](#get-friendshipstargetuseridstatus)
   - [DELETE /friendships/:targetUserId](#delete-friendshipstargetuserid)
   - [POST /friendships/blocks/:targetUserId](#post-friendshipsblockstargetuserid)
   - [DELETE /friendships/blocks/:targetUserId](#delete-friendshipsblockstargetuserid)
8. [Media — File Upload & Access](#8-media--file-upload--access)
   - [GET /media](#get-media)
   - [POST /media/upload](#post-mediaupload)
   - [POST /media/upload/complete](#post-mediauploadcomplete)
   - [GET /media/:mediaId/url](#get-mediamediaidurl)
   - [GET /media/:mediaId/play-info](#get-mediamediaidplay-info)
   - [DELETE /media/:mediaId](#delete-mediamediaid)
   - [POST /media/:mediaId/cross-share](#post-mediamediaidcross-share)
   - [POST /media/multipart/init](#post-mediamultipartinit)
   - [POST /media/multipart/presign-parts](#post-mediamultipartpresign-parts)
   - [POST /media/multipart/complete](#post-mediamultipartcomplete)
   - [DELETE /media/multipart/:mediaId](#delete-mediamultipartmediaid)
9. [Notifications — Push Notifications & Preferences](#9-notifications--push-notifications--preferences)
   - [GET /notifications/vapid-public-key](#get-notificationsvapid-public-key)
   - [POST /notifications/devices](#post-notificationsdevices)
   - [DELETE /notifications/devices/:deviceId](#delete-notificationsdevicesdeviceid)
   - [PUT /notifications/preferences](#put-notificationspreferences)
   - [GET /notifications/preferences](#get-notificationspreferences)
10. [Presence — Online Status](#10-presence--online-status)
    - [GET /presence/status](#get-presencestatus)
    - [GET /presence/friends](#get-presencefriends)
11. [Stickers — Sticker Catalog](#11-stickers--sticker-catalog)
    - [GET /stickers/packages](#get-stickerspackages)
    - [GET /stickers/packages/:packageId/stickers](#get-stickerspacka gespackageidstickers)
12. [Calls — Instant Call](#12-calls--instant-call)
    - [GET /calls/health](#get-callshealth)
    - [POST /calls/start](#post-callsstart)
    - [POST /calls/:callId/accept](#post-callscallidaccept)
    - [POST /calls/:callId/decline](#post-callscalliddecline)
    - [POST /calls/:callId/end](#post-callscallidend)
    - [GET /calls/:callId](#get-callscallid)
    - [GET /calls/:callId/token](#get-callscallidtoken)
    - [GET /calls/history/:conversationId](#get-callshistoryconversationid)
    - [GET /calls/:callId/summary](#get-callscallidsummary)
13. [Client Implementation Guides](#13-client-implementation-guides)
    - [Guide 1: Fast-Ack Message Send Flow](#guide-1-fast-ack-message-send-flow)
    - [Guide 2: Single-File Media Upload (≤ 10 MB)](#guide-2-single-file-media-upload--10-mb)
    - [Guide 3: Multipart Media Upload (> 10 MB)](#guide-3-multipart-media-upload--10-mb)
    - [Guide 4: Cursor Tracking & Read Receipts](#guide-4-cursor-tracking--read-receipts)
    - [Guide 5: Reaction Optimistic Updates](#guide-5-reaction-optimistic-updates)

---

## 1. Conventions & Response Format

### Standard Envelope (all HTTP responses)

Every response from the Gateway is wrapped in a standard envelope. Clients always read the `data` field for results.

```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": { ... }
}
```

With pagination:

```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": [ ... ],
  "metadata": {
    "total": 100,
    "page": 1,
    "limit": 20
  }
}
```

### Default message by HTTP method

| HTTP Method | message |
|---|---|
| GET | `"Data retrieved successfully"` |
| POST | `"Resource created successfully"` |
| PUT / PATCH | `"Resource updated successfully"` |
| DELETE | `"Resource deleted successfully"` |

### Authentication

All protected routes require:
```
Authorization: Bearer <ACCESS_TOKEN>
```

Platform-sensitive routes (login, refresh, logout) also read:
```
X-Client-Platform: web | mobile
```
Defaults to `web` if the header is absent or invalid. The system enforces **1 web session + 1 mobile session** per user via Redis Session Store.

### Business error codes

| Code | Meaning |
|---|---|
| `FORBIDDEN_ACCOUNT_STATUS` | Account is locked or deactivated |
| `FORBIDDEN_NOT_MEMBER` | Caller is not a member of the conversation |
| `FORBIDDEN_ROLE_REQUIRED` | Insufficient conversation role |
| `FORBIDDEN_TIME_WINDOW` | Outside allowed edit/delete window |
| `FORBIDDEN_MEDIA_NOT_READY` | File still being processed |
| `FORBIDDEN_MEDIA_OWNERSHIP` | File not owned by caller |
| `FORBIDDEN_MEDIA_CLASSIFICATION` | File type restricted in this channel |
| `FORBIDDEN_REVOKE_WINDOW_EXPIRED` | Outside 1-hour revoke window |
| `FORBIDDEN_NOT_OWNER` | Message does not belong to caller |
| `SOURCE_MESSAGE_NOT_FOUND` | Source message missing or deleted (forward) |

### Rate limits

Global: **60 000 requests / 60 s per IP**. Per-endpoint limits are documented inline.

---

## 2. Auth — Authentication & Registration

The system uses **Keycloak** as the Identity Provider. Tokens are JWT RS256, verified at the Gateway via cached JWKS. Each user may have at most **1 web session + 1 mobile session**, managed by Redis Session Store.

> All Auth endpoints accept and return `Content-Type: application/json`.

---

### POST /auth/login

**Public — no token required**

Login with email + password. Creates or replaces the session for the given platform (max 1 web, 1 mobile). If a session already exists on that platform it is revoked — the old WebSocket socket receives `session_revoked` and is disconnected.

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@gmail.com",
    "password": "Secret123!",
    "platform": "web",
    "deviceInfo": { "deviceName": "Chrome / Windows" }
  }'
```

**Request body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `email` | `string` | ✓ | Must be `@gmail.com`. Normalized to lowercase. |
| `password` | `string` | ✓ | |
| `platform` | `'web'\|'mobile'` | ✓ | Session type |
| `deviceInfo.deviceName` | `string` | | Human-readable device label |
| `deviceInfo.userAgent` | `string` | | Falls back to HTTP `User-Agent` header |

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Resource created successfully",
  "data": {
    "accessToken": "eyJhbGci...",
    "refreshToken": "eyJhbGci...",
    "expiresIn": 300
  }
}
```

| HTTP | Scenario |
|---|---|
| 400 | Email not `@gmail.com` |
| 401 | Wrong credentials |
| 500 | Keycloak unavailable |

---

### POST /auth/refresh

**Public — no token required**

Refresh the access token. The stored Keycloak SID is updated if Keycloak rotates it on refresh.

```bash
curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -H "X-Client-Platform: web" \
  -d '{ "refreshToken": "<REFRESH_TOKEN>" }'
```

**Request body:**

| Field | Type | Required |
|---|---|---|
| `refreshToken` | `string` | ✓ |

**Response 200:** same structure as `/auth/login`.

| HTTP | Scenario |
|---|---|
| 401 | `refreshToken` expired or revoked |
| 401 `SESSION_REVOKED` | Session kicked by another login, or SID mismatch |

---

### POST /auth/logout

**Requires JWT**

Revokes the local Redis session, the Keycloak session, and publishes a WebSocket disconnect event for the current platform session.

```bash
curl -X POST http://localhost:3000/auth/logout \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "X-Client-Platform: web"
```

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Resource created successfully",
  "data": { "message": "Logged out successfully." }
}
```

---

### POST /auth/register/init

**Public — no token required**

Step 1 of 3-step registration. Verifies email uniqueness and sends a 6-digit OTP (valid 10 min).

**Rate limit:** 5 requests / 15 min per email, 60 s cooldown between requests.

```bash
curl -X POST http://localhost:3000/auth/register/init \
  -H "Content-Type: application/json" \
  -d '{
    "email": "bob@gmail.com",
    "firstName": "Bob",
    "lastName": "Nguyen"
  }'
```

**Request body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `email` | `string` | ✓ | Must be `@gmail.com`, must not already exist |
| `firstName` | `string` | ✓ | 1–20 characters; letters, spaces, apostrophes, dots, hyphens |
| `lastName` | `string` | ✓ | 1–20 characters; same rules as `firstName` |

> The display `username` is auto-generated from `firstName + " " + lastName`. It is non-unique and can be changed later.

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Resource created successfully",
  "data": { "cooldownSeconds": 60 }
}
```

| HTTP | Scenario |
|---|---|
| 400 | Email not `@gmail.com` |
| 409 | Email already registered |
| 429 | Rate limit or cooldown exceeded |

---

### POST /auth/register/verify-otp

**Public — no token required**

Step 2. Verifies the registration OTP and returns a short-lived `registrationToken`.

```bash
curl -X POST http://localhost:3000/auth/register/verify-otp \
  -H "Content-Type: application/json" \
  -d '{ "email": "bob@gmail.com", "otp": "482951" }'
```

**Request body:**

| Field | Type | Required |
|---|---|---|
| `email` | `string` | ✓ |
| `otp` | `string` | ✓ |

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Resource created successfully",
  "data": {
    "registrationToken": "550e8400-e29b-41d4-a716-446655440000",
    "expiresIn": 600
  }
}
```

> `registrationToken` is valid for **10 minutes** and is single-use.

| HTTP | Scenario |
|---|---|
| 400 | OTP expired, incorrect, already used, or > 3 wrong attempts (lockout) |

---

### POST /auth/register/complete

**Public — no token required**

Step 3. Creates accounts in Keycloak and the users service, then auto-logs in and returns tokens.

> **Saga-lite rollback:** if the users-service fails after Keycloak succeeds, the Keycloak account is deleted.

```bash
curl -X POST http://localhost:3000/auth/register/complete \
  -H "Content-Type: application/json" \
  -d '{
    "registrationToken": "550e8400-e29b-41d4-a716-446655440000",
    "password": "MyPass@2026",
    "platform": "web",
    "deviceInfo": { "deviceName": "Chrome / Windows" }
  }'
```

**Request body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `registrationToken` | `string` | ✓ | Token from step 2 |
| `password` | `string` | ✓ | Minimum 8 characters |
| `platform` | `'web'\|'mobile'` | ✓ | |
| `deviceInfo.deviceName` | `string` | | |
| `deviceInfo.userAgent` | `string` | | |

**Response 201:** same structure as `/auth/login`.

| HTTP | Scenario |
|---|---|
| 400 | `registrationToken` expired or invalid |
| 409 | Email already exists (race condition) |
| 500 | System error (both sides rolled back) |

---

### POST /auth/forgot-password

**Public — no token required**

Sends a 6-digit OTP to the registered email (valid 10 min). Returns `404` if the email does not exist.

**Rate limit:** 5 requests / 15 min per email, 60 s cooldown.

```bash
curl -X POST http://localhost:3000/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{ "email": "alice@gmail.com" }'
```

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": { "message": "OTP code has been sent to your email." }
}
```

| HTTP | Scenario |
|---|---|
| 400 | Invalid email format |
| 404 | Email not found |
| 429 | Rate limit or cooldown |

---

### POST /auth/verify-otp

**Public — no token required**

Verifies the password-reset OTP and returns a `resetToken`.

```bash
curl -X POST http://localhost:3000/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{ "email": "alice@gmail.com", "otp": "482951" }'
```

**Request body:**

| Field | Type | Required |
|---|---|---|
| `email` | `string` | ✓ |
| `otp` | `string` | ✓ |

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "resetToken": "eyJhbGci...",
    "expiresIn": 600
  }
}
```

---

### POST /auth/reset-password

**Public — no token required**

Applies the new password using the `resetToken` from `/auth/verify-otp`.

```bash
curl -X POST http://localhost:3000/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "resetToken": "eyJhbGci...",
    "newPassword": "NewPass@2026"
  }'
```

**Request body:**

| Field | Type | Required |
|---|---|---|
| `resetToken` | `string` | ✓ |
| `newPassword` | `string` | ✓ |

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": { "message": "Password has been reset successfully." }
}
```

---

## 3. Health & System

All health endpoints are **public** (no token required).

| Route | Description |
|---|---|
| `GET /` | Returns `"Hello World!"` string |
| `GET /health` | `{ status: 'ok', timestamp, service: 'gateway' }` |
| `GET /health/circuit-breakers` | Circuit-breaker state for gateway + chat-core services |
| `GET /me` | Returns decoded JWT claims **(requires auth)** |

**GET /health/circuit-breakers response:**
```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "timestamp": "2026-01-15T10:00:00.000Z",
    "circuitBreakers": {
      "gateway": { "conversation-service": "CLOSED" },
      "chatCore": { "message-store": "CLOSED" }
    },
    "health": {
      "status": "HEALTHY",
      "message": "All circuit breakers operational"
    }
  }
}
```

**GET /me response (requires auth):**
```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "id": "user-uuid",
    "username": "alice.nguyen",
    "email": "alice@gmail.com",
    "name": "Alice Nguyen",
    "roles": ["user"]
  }
}
```

---

## 4. Users — User Management

All routes require `Authorization: Bearer <TOKEN>` unless noted.

---

### GET /users/me

Returns the authenticated user's full profile with a presigned avatar URL.

```bash
curl "http://localhost:3000/users/me?avatarVariant=thumb" \
  -H "Authorization: Bearer $TOKEN"
```

**Query params:**

| Param | Type | Default | Notes |
|---|---|---|---|
| `avatarVariant` | `'thumb'\|'original'` | `'thumb'` | Presigned URL variant for avatar |

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "id": "user-uuid",
    "username": "Alice Nguyen",
    "email": "alice@gmail.com",
    "avatarUrl": "https://storage.../thumb_avatar.webp",
    "statusMessage": "Available",
    "language": "vi",
    "timezone": "Asia/Ho_Chi_Minh",
    "notifications": { "sound": true, "vibration": true },
    "createdAt": "2026-01-01T00:00:00.000Z"
  }
}
```

---

### PUT /users/me

Full update of the authenticated user's profile. Returns updated profile.

```bash
curl -X PUT http://localhost:3000/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "Alice N.",
    "avatarMediaId": "media-uuid"
  }'
```

**Request body (`UpdateUserDto`):**

| Field | Type | Required | Notes |
|---|---|---|---|
| `username` | `string` | | Display name |
| `avatarMediaId` | `string` (UUID) | | Media ID of uploaded avatar (from POST /media/upload) |
| `statusMessage` | `string` | | Short status text |

**Query params:** same `avatarVariant` as GET /users/me (default `'thumb'`).

---

### PATCH /users/me/settings

Partial update of user settings. **JSON merge** — only provided fields are changed; existing settings are preserved.

```bash
curl -X PATCH http://localhost:3000/users/me/settings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "language": "en",
    "timezone": "UTC",
    "notifications": { "sound": false }
  }'
```

**Request body (`UpdateUserSettingsDto`):**

| Field | Type | Required | Notes |
|---|---|---|---|
| `statusMessage` | `string` | | |
| `language` | `string` | | BCP 47 language code, e.g. `"vi"`, `"en"` |
| `timezone` | `string` | | IANA timezone, e.g. `"Asia/Ho_Chi_Minh"` |
| `notifications` | `object` | | Nested notification preferences object |

---

### GET /users/me/sessions

Lists all active Keycloak sessions for the authenticated user.

```bash
curl http://localhost:3000/users/me/sessions \
  -H "Authorization: Bearer $TOKEN"
```

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": [
    {
      "id": "keycloak-session-id",
      "ipAddress": "203.0.113.1",
      "started": "2026-01-15T08:00:00.000Z",
      "lastAccess": "2026-01-15T10:00:00.000Z",
      "clients": ["zolo-app"]
    }
  ]
}
```

---

### DELETE /users/me/sessions

Revoke **all** active sessions **except the current one**. Uses the `sid` claim from the current JWT to identify and preserve the current session.

```bash
curl -X DELETE http://localhost:3000/users/me/sessions \
  -H "Authorization: Bearer $TOKEN"
```

---

### DELETE /users/me/sessions/:sessionId

Revoke a specific session by its Keycloak session ID.

```bash
curl -X DELETE http://localhost:3000/users/me/sessions/keycloak-session-id \
  -H "Authorization: Bearer $TOKEN"
```

---

### POST /users/me/change-password

Change the authenticated user's password. Verifies `currentPassword` before applying. **All existing sessions are revoked on success** — the caller must re-login.

```bash
curl -X POST http://localhost:3000/users/me/change-password \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "currentPassword": "OldPass@123",
    "newPassword": "NewPass@2026"
  }'
```

**Request body (`ChangePasswordDto`):**

| Field | Type | Required | Notes |
|---|---|---|---|
| `currentPassword` | `string` | ✓ | Current password for verification |
| `newPassword` | `string` | ✓ | Must meet password policy (min 8 chars) |

| HTTP | Scenario |
|---|---|
| 400 | `currentPassword` incorrect or `newPassword` fails policy |

---

### DELETE /users/me

**IRREVERSIBLE.** Permanently deletes the authenticated user's account. Revokes all sessions, deletes the Keycloak account and all user data.

```bash
curl -X DELETE http://localhost:3000/users/me \
  -H "Authorization: Bearer $TOKEN"
```

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Resource deleted successfully",
  "data": { "message": "Account deleted successfully." }
}
```

---

### PATCH /users/:id/deactivate

**Admin only** — requires `admin` role in `realm_access.roles`.

Deactivates any user account by ID. The deactivated user will receive `account:status-changed` via WebSocket and will be unable to log in.

```bash
curl -X PATCH http://localhost:3000/users/target-user-id/deactivate \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Resource updated successfully",
  "data": { "message": "User account deactivated." }
}
```

| HTTP | Scenario |
|---|---|
| 403 | Caller does not have `admin` role |
| 404 | User not found |

---

### GET /users

List users with pagination.

```bash
curl "http://localhost:3000/users?page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

**Query params (`PaginationQueryDto`):**

| Param | Type | Default |
|---|---|---|
| `page` | `number` | `1` |
| `limit` | `number` | `20` |

**Response 200:** paginated envelope with `data: User[]` and `metadata: { total, page, limit }`.

---

### GET /users/search

Search users by display name or username.

```bash
curl "http://localhost:3000/users/search?q=alice&page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

**Query params:**

| Param | Type | Default | Notes |
|---|---|---|---|
| `q` | `string` | | Search query |
| `page` | `number` | `1` | |
| `limit` | `number` | `10` | |

---

### GET /users/:id

Get any user's public profile by their ID.

```bash
curl http://localhost:3000/users/target-user-id \
  -H "Authorization: Bearer $TOKEN"
```

---

## 5. Conversations — Conversation Management

All routes require authentication.

---

### GET /conversations

List all conversations the authenticated user is a member of. Results are enriched with avatar presigned URLs and (for DIRECT conversations) the other user's profile.

```bash
curl "http://localhost:3000/conversations?page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

**Query params:**

| Param | Type | Default | Notes |
|---|---|---|---|
| `page` | `number` | `1` | |
| `limit` | `number` | `20` | |
| `avatarVariant` | `'thumb'\|'original'` | `'thumb'` | Avatar URL variant |

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "conversations": [
      {
        "id": "conv-uuid",
        "type": "direct",
        "name": "Alice Nguyen",
        "avatarUrl": "https://storage.../thumb.webp",
        "maxOffset": 42,
        "myOffset": 42,
        "otherUser": {
          "id": "user-uuid",
          "username": "Alice Nguyen",
          "displayName": "Alice Nguyen",
          "avatarUrl": "https://storage.../thumb.webp"
        },
        "createdAt": "2026-01-01T00:00:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
}
```

> For `type: 'direct'`, `name` is resolved to the other participant's display name and `otherUser` contains the enriched user profile.

---

### POST /conversations

Create a new conversation.

```bash
curl -X POST http://localhost:3000/conversations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "group",
    "memberIds": ["user-uuid-1", "user-uuid-2"],
    "name": "Project Alpha",
    "description": "Work group"
  }'
```

**Request body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | `'direct'\|'group'\|'announcement'` | ✓ | Normalized to lowercase |
| `memberIds` | `string[]` | ✓ | User IDs to add (the creator is added automatically as `OWNER`) |
| `name` | `string` | | Required for `group` / `announcement` |
| `description` | `string` | | |
| `avatarMediaId` | `string` | | UUID of an uploaded media record; ignored for `direct` conversations |

---

### GET /conversations/:id

Get detailed conversation info enriched with participant profiles and avatar URL.

```bash
curl "http://localhost:3000/conversations/conv-uuid?avatarVariant=thumb" \
  -H "Authorization: Bearer $TOKEN"
```

**Query params:** `avatarVariant: 'thumb'|'original'` (default `'thumb'`).

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "id": "conv-uuid",
    "type": "group",
    "name": "Project Alpha",
    "avatarUrl": "https://storage.../thumb.webp",
    "maxOffset": 100,
    "participants": [
      {
        "userId": "user-uuid",
        "role": "OWNER",
        "username": "Alice Nguyen",
        "displayName": "Alice Nguyen",
        "avatarUrl": "https://storage.../thumb.webp"
      }
    ],
    "createdAt": "2026-01-01T00:00:00.000Z"
  }
}
```

> For DIRECT conversations, `name` is resolved to the other participant's display name.

---

### GET /conversations/:id/messages

Fetch messages using **offset-based pagination**. Supports forward and backward paging.

```bash
# Forward from offset 100
curl "http://localhost:3000/conversations/conv-uuid/messages?after=100&limit=30" \
  -H "Authorization: Bearer $TOKEN"

# Backward before offset 500
curl "http://localhost:3000/conversations/conv-uuid/messages?before=500&limit=30" \
  -H "Authorization: Bearer $TOKEN"
```

**Query params:**

| Param | Type | Required | Notes |
|---|---|---|---|
| `after` | `number` | | Return messages with `offset > after` |
| `before` | `number` | | Return messages with `offset < before` |
| `limit` | `number` | | Default `30` |

> Provide either `after` or `before`, not both. Messages are enriched with sender profiles (soft-fail: if users-service is unavailable, messages still return without sender enrichment).

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "data": [
      {
        "id": "msg-uuid",
        "conversationId": "conv-uuid",
        "senderId": "user-uuid",
        "sender": {
          "id": "user-uuid",
          "username": "Alice Nguyen",
          "displayName": "Alice Nguyen",
          "avatarUrl": "https://storage.../thumb.webp"
        },
        "type": "text",
        "content": "Hello!",
        "offset": 42,
        "createdAt": "2026-01-15T10:00:00.000Z"
      }
    ],
    "meta": { "total": 100, "hasMore": true }
  }
}
```

---

### POST /conversations/:id/members

Add one or more members to a conversation. Requires `OWNER` or `ADMIN` role.

```bash
curl -X POST http://localhost:3000/conversations/conv-uuid/members \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "userIds": ["user-uuid-3", "user-uuid-4"] }'
```

**Request body:**

| Field | Type | Required |
|---|---|---|
| `userIds` | `string[]` | ✓ |

---

### DELETE /conversations/:id/members

Remove one or more members. Requires `OWNER` or `ADMIN` role.

```bash
curl -X DELETE http://localhost:3000/conversations/conv-uuid/members \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "userIds": ["user-uuid-3"] }'
```

**Request body:**

| Field | Type | Required |
|---|---|---|
| `userIds` | `string[]` | ✓ |

---

### GET /conversations/:id/members

Returns the list of member IDs in a conversation.

```bash
curl http://localhost:3000/conversations/conv-uuid/members \
  -H "Authorization: Bearer $TOKEN"
```

---

### GET /conversations/:id/unread

Returns the unread message count for the authenticated user in a conversation.

```bash
curl http://localhost:3000/conversations/conv-uuid/unread \
  -H "Authorization: Bearer $TOKEN"
```

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": { "unreadCount": 5 }
}
```

---

### PATCH /conversations/:id/offset

Update the authenticated user's last-seen offset (HTTP alternative to WS `conversation:update_seen_cursor`). Works for all conversation types.

```bash
curl -X PATCH http://localhost:3000/conversations/conv-uuid/offset \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "offset": 42 }'
```

**Request body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `offset` | `number` | ✓ | Offset up to which messages have been seen |

> **Preferred path:** Use WS `conversation:update_seen_cursor` for lower latency. This HTTP endpoint is for initial page-load or reconnect scenarios.

---

### PATCH /conversations/:id/info

Update conversation metadata. Requires `OWNER` or `ADMIN` role (`CH.UPDATE_INFO`).

```bash
curl -X PATCH http://localhost:3000/conversations/conv-uuid/info \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New Group Name",
    "description": "Updated description",
    "avatarMediaId": "media-uuid"
  }'
```

**Request body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | `string` | | New conversation name |
| `description` | `string` | | New description |
| `avatarMediaId` | `string` | | Media ID of new avatar (must already be uploaded) |

---

### PATCH /conversations/:id/members/:userId/role

Set the role of a conversation member. Requires `OWNER` or `ADMIN` (`MBR.SET_ROLE`).

**Constraints:**
- `OWNER` can promote to `ADMIN`
- `ADMIN` cannot change the `OWNER` role
- At least 1 `OWNER` or `ADMIN` must remain

```bash
curl -X PATCH http://localhost:3000/conversations/conv-uuid/members/target-user-id/role \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "role": "ADMIN" }'
```

**Request body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `role` | `string` | ✓ | `owner`, `admin`, `member` |

---

### GET /conversations/:id/pinned

Returns the pinned messages in a conversation (max 3 per conversation).

```bash
curl http://localhost:3000/conversations/conv-uuid/pinned \
  -H "Authorization: Bearer $TOKEN"
```

---

## 6. Chat & Messages

All routes require authentication.

---

### POST /chat/messages

**201 Created** — Send a message.

**Fast-Ack flow**: the Gateway calls Chat Core synchronously for validation (rate limit, ACL, block check). If valid, Chat Core publishes to Kafka and returns the `messageId`. The Gateway responds 201 immediately — the message is **accepted but not yet persisted**. Persistence confirmation arrives via WS `message:saved`.

```bash
curl -X POST http://localhost:3000/chat/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clientMessageId": "550e8400-e29b-41d4-a716-446655440000",
    "conversationId": "conv-uuid",
    "content": "Hello everyone!",
    "type": "text"
  }'
```

**Request body (`SendMessageDto`):**

| Field | Type | Required | Notes |
|---|---|---|---|
| `clientMessageId` | `string` (UUID v4) | ✓ | Client-generated deduplication ID. Same ID = safe retry. |
| `conversationId` | `string` | ✓ | Target conversation |
| `content` | `string` | ✓* | Required for `text` type; optional for `sticker`, `media`, `image`, `video`, `audio`, `file` |
| `type` | `'text'\|'image'\|'video'\|'audio'\|'file'\|'sticker'\|'media'` | | Default: `'text'` |
| `replyToMessageId` | `string` | | ID of the message being replied to |
| `metadata` | `Record<string, any>` | | Additional metadata (sticker info, etc.) |
| `mentions` | `string[]` | | Mentioned user IDs. Supported only in `group` and `announcement`; max 50 explicit users. |
| `metadata.mentionAll` | `boolean` | | Mention every member except sender (`@all` / `@here` / `@channel`). OWNER/ADMIN only. |
| `attachments` | `AttachmentRefDto[]` | | Max 30 attachments |
| `attachments[].mediaId` | `string` (UUID v4) | ✓ | Media ID from completed upload |
| `attachments[].type` | `'image'\|'video'\|'audio'\|'file'` | | |

**Response 201:**
```json
{
  "statusCode": 201,
  "message": "Resource created successfully",
  "data": {
    "messageId": "server-assigned-uuid",
    "clientMessageId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "accepted"
  }
}
```

| HTTP | Scenario |
|---|---|
| 403 | Caller is blocked or not a member (`FORBIDDEN_NOT_MEMBER`) |
| 400 | Mentions are used in `direct` (`MENTIONS_NOT_SUPPORTED_FOR_CONVERSATION_TYPE`) or target is not a member (`MENTION_TARGET_NOT_MEMBER`) |
| 403 | Regular member uses `metadata.mentionAll` (`FORBIDDEN_MENTION_ALL`) |
| 429 | Rate limit exceeded |

> See [Guide 1: Fast-Ack Message Send Flow](#guide-1-fast-ack-message-send-flow) for full client implementation.

---

### POST /chat/pre-check-media

Validates whether a user can send a specific media type in a conversation **before** uploading the file. Call this before starting any upload to avoid wasting bandwidth.

```bash
curl -X POST http://localhost:3000/chat/pre-check-media \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "conv-uuid",
    "mimeType": "video/mp4",
    "fileSize": 52428800
  }'
```

**Request body:**

| Field | Type | Required |
|---|---|---|
| `conversationId` | `string` | ✓ |
| `mimeType` | `string` | ✓ |
| `fileSize` | `number` | ✓ |

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "approved": true,
    "conversationId": "conv-uuid",
    "userId": "user-uuid",
    "timestamp": "2026-01-15T10:00:00.000Z"
  }
}
```

---

### PATCH /messages/:id

Edit a message. **Business rule `MSG.EDIT_OWN`:** only the sender may edit; must be within 1 hour of sending; edit history is preserved.

```bash
curl -X PATCH http://localhost:3000/messages/msg-uuid \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "content": "Corrected message text" }'
```

**Request body:**

| Field | Type | Required |
|---|---|---|
| `content` | `string` | ✓ |
| `metadata` | `Record<string, any>` | |

**Response 200:** updated message object.

| HTTP | Scenario |
|---|---|
| 403 | Not the sender (`FORBIDDEN_NOT_OWNER`) |
| 403 | Outside 1-hour window (`FORBIDDEN_TIME_WINDOW`) |

---

### DELETE /messages/:id

Delete a message. **Business rules:**
- `MSG.DELETE_OWN`: sender only, within 24 hours, soft delete
- `MSG.DELETE_ANY`: `ADMIN` only, within 24 hours, soft delete + audit log

```bash
curl -X DELETE http://localhost:3000/messages/msg-uuid \
  -H "Authorization: Bearer $TOKEN"
```

**Response 200:** `{ message: 'Deleted.' }`

---

### POST /messages/:id/pin

Pin a message. **Business rule `MSG.PIN`:** `OWNER` or `ADMIN` only. Max 3 pinned messages per conversation.

**201 Created**

```bash
curl -X POST http://localhost:3000/messages/msg-uuid/pin \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "conversationId": "conv-uuid" }'
```

**Request body:**

| Field | Type | Required |
|---|---|---|
| `conversationId` | `string` | ✓ |

| HTTP | Scenario |
|---|---|
| 403 | Insufficient role (`FORBIDDEN_ROLE_REQUIRED`) |
| 400 | Already 3 pinned messages |

---

### DELETE /messages/:id/pin

Unpin a message. Pass `conversationId` as a query param.

```bash
curl -X DELETE "http://localhost:3000/messages/msg-uuid/pin?conversationId=conv-uuid" \
  -H "Authorization: Bearer $TOKEN"
```

**Query params:**

| Param | Type | Required |
|---|---|---|
| `conversationId` | `string` | ✓ |

---

### POST /messages/:id/revoke

Revoke a message (tombstone — both sides see placeholder text "Message has been recalled"). **Business rule `MSG.REVOKE_OWN`:** sender only, within 1 hour. Permanent and irreversible.

```bash
curl -X POST http://localhost:3000/messages/msg-uuid/revoke \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "conversationId": "conv-uuid" }'
```

**Request body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `conversationId` | `string` | ✓ | Required for Pub/Sub room routing |
| `reason` | `string` | | Optional reason |

| HTTP | Scenario |
|---|---|
| 403 | Outside 1-hour window (`FORBIDDEN_REVOKE_WINDOW_EXPIRED`) |
| 403 | Not the sender (`FORBIDDEN_NOT_OWNER`) |

---

### DELETE /messages/:id/for-me

Hide a message for the requesting user only. Other participants are unaffected.

```bash
curl -X DELETE "http://localhost:3000/messages/msg-uuid/for-me?conversationId=conv-uuid" \
  -H "Authorization: Bearer $TOKEN"
```

**Query params:**

| Param | Type | Required |
|---|---|---|
| `conversationId` | `string` | ✓ |

---

### POST /messages/forward

Forward a message to one or more target conversations. **201 Created**

```bash
curl -X POST http://localhost:3000/messages/forward \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceMessageId": "msg-uuid",
    "sourceConversationId": "conv-uuid-1",
    "targetConversationIds": ["conv-uuid-2", "conv-uuid-3"],
    "includeCaption": true
  }'
```

**Request body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `sourceMessageId` | `string` | ✓ | Message to forward |
| `sourceConversationId` | `string` | ✓ | Source conversation |
| `targetConversationIds` | `string[]` | ✓ | Destination conversations |
| `includeCaption` | `boolean` | | Include original caption/content |

| HTTP | Scenario |
|---|---|
| 404 | `SOURCE_MESSAGE_NOT_FOUND` |
| 403 | Not a member of source or target conversation |

---

### POST /messages/:id/reactions

Add or remove an emoji reaction. **Zero-Kafka path** — the server updates Redis and immediately broadcasts `message:reaction_updated` via Pub/Sub → WebSocket.

```bash
curl -X POST http://localhost:3000/messages/msg-uuid/reactions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "conv-uuid",
    "emoji": "👍",
    "action": "add"
  }'
```

**Request body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `conversationId` | `string` | ✓ | Required for Pub/Sub room routing |
| `emoji` | `string` | ✓ | Unicode emoji character |
| `action` | `'add'\|'remove'` | | Default: `'add'` |

**Response 200:** updated reactions map for the message.

> See [Guide 5: Reaction Optimistic Updates](#guide-5-reaction-optimistic-updates) for client implementation.

---

## 7. Friendships

All routes require authentication.

---

### POST /friendships/requests/:targetUserId

Send a friend request to another user.

```bash
curl -X POST http://localhost:3000/friendships/requests/target-user-id \
  -H "Authorization: Bearer $TOKEN"
```

| HTTP | Scenario |
|---|---|
| 400 | Sending request to yourself |
| 409 | Request already sent or already friends |

---

### POST /friendships/requests/:fromUserId/accept

Accept a pending friend request from `fromUserId`.

```bash
curl -X POST http://localhost:3000/friendships/requests/sender-user-id/accept \
  -H "Authorization: Bearer $TOKEN"
```

---

### POST /friendships/requests/:fromUserId/reject

Reject a pending friend request.

```bash
curl -X POST http://localhost:3000/friendships/requests/sender-user-id/reject \
  -H "Authorization: Bearer $TOKEN"
```

---

### GET /friendships/requests

Get all pending incoming friend requests for the authenticated user.

```bash
curl http://localhost:3000/friendships/requests \
  -H "Authorization: Bearer $TOKEN"
```

---

### GET /friendships

Get the authenticated user's friend list.

```bash
curl http://localhost:3000/friendships \
  -H "Authorization: Bearer $TOKEN"
```

---

### GET /friendships/:targetUserId/status

Get the friendship status between the authenticated user and a target user.

```bash
curl http://localhost:3000/friendships/target-user-id/status \
  -H "Authorization: Bearer $TOKEN"
```

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": { "status": "friends" }
}
```

Possible `status` values: `"none"`, `"pending_sent"`, `"pending_received"`, `"friends"`, `"blocked"`.

---

### DELETE /friendships/:targetUserId

Unfriend a user.

```bash
curl -X DELETE http://localhost:3000/friendships/target-user-id \
  -H "Authorization: Bearer $TOKEN"
```

---

### POST /friendships/blocks/:targetUserId

Block a user. Blocked users cannot send friend requests or messages to the blocker.

```bash
curl -X POST http://localhost:3000/friendships/blocks/target-user-id \
  -H "Authorization: Bearer $TOKEN"
```

---

### DELETE /friendships/blocks/:targetUserId

Unblock a user.

```bash
curl -X DELETE http://localhost:3000/friendships/blocks/target-user-id \
  -H "Authorization: Bearer $TOKEN"
```

---

## 8. Media — File Upload & Access

All routes require authentication.

The media system uses **MinIO** (S3-compatible) as object storage. Files are never served through the API itself — the client receives **presigned URLs** that expire after a configured TTL.

Two upload flows are available:
- **Single-file** (`POST /media/upload`): for files up to ~10 MB (images ≤ 15 MB)
- **Multipart** (`POST /media/multipart/init`): for large files, up to 1 GB for video/file

---

### GET /media

List all media files owned by the authenticated user.

```bash
curl http://localhost:3000/media \
  -H "Authorization: Bearer $TOKEN"
```

---

### POST /media/upload

**Step 1 of 3** — Initiate a single-file upload session. Returns a presigned PUT URL.

```bash
curl -X POST http://localhost:3000/media/upload \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "image",
    "mimeType": "image/jpeg",
    "size": 204800,
    "filename": "photo.jpg"
  }'
```

**Request body (`CreateMediaUploadDto`):**

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | `'image'\|'video'\|'audio'\|'file'` | ✓ | Media category (lowercase) |
| `mimeType` | `string` | ✓ | e.g. `"image/jpeg"`, `"video/mp4"` |
| `size` | `number` | ✓ | File size in bytes (1 – 2 147 483 648) |
| `filename` | `string` | | Original filename |

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Resource created successfully",
  "data": {
    "mediaId": "media-uuid",
    "uploadUrl": "https://storage.minio.../presigned-put-url",
    "expiresIn": 3600
  }
}
```

> **Step 2** (client action): `PUT <uploadUrl>` with the file binary.
> ```
> PUT <uploadUrl>
> Content-Type: <mimeType>    ← must match the mimeType sent in step 1
> Body: <raw file bytes>
> ```

---

### POST /media/upload/complete

**Step 3 of 3** — Notify the server the upload is complete. Triggers the media processing pipeline (thumbnail, transcoding).

```bash
curl -X POST http://localhost:3000/media/upload/complete \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mediaId": "media-uuid",
    "checksum": "sha256:abc123...",
    "checksumAlgorithm": "sha256"
  }'
```

**Request body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `mediaId` | `string` | ✓ | Media ID from step 1 |
| `checksum` | `string` | | File checksum for integrity validation |
| `checksumAlgorithm` | `string` | | e.g. `"sha256"`, `"md5"` |

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Resource updated successfully",
  "data": { "mediaId": "media-uuid", "status": "PROCESSING" }
}
```

> Processing is asynchronous. Listen for WS `message:media_ready` to know when the file is ready.

---

### GET /media/:mediaId/url

Get a time-limited presigned access URL for a media file. Call this immediately before displaying the file (URLs expire).

```bash
curl "http://localhost:3000/media/media-uuid/url?prefer=OPTIMIZED&conversationId=conv-uuid" \
  -H "Authorization: Bearer $TOKEN"
```

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `prefer` | `'ORIGINAL'\|'OPTIMIZED'` | `OPTIMIZED` returns the processed/transcoded version |
| `conversationId` | `string` | Required for media attached to a conversation (access control) |

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "url": "https://storage.minio.../presigned-get-url",
    "expiresAt": "2026-01-15T11:00:00.000Z"
  }
}
```

---

### GET /media/:mediaId/play-info

Get streaming metadata for video/audio files (HLS manifest URL, duration, dimensions).

```bash
curl "http://localhost:3000/media/media-uuid/play-info?conversationId=conv-uuid" \
  -H "Authorization: Bearer $TOKEN"
```

**Query params:** `conversationId` (optional, for access control).

---

### DELETE /media/:mediaId

Delete a media file. Only the owner may delete their own files.

```bash
curl -X DELETE http://localhost:3000/media/media-uuid \
  -H "Authorization: Bearer $TOKEN"
```

| HTTP | Scenario |
|---|---|
| 403 | `FORBIDDEN_MEDIA_OWNERSHIP` — not the owner |

---

### POST /media/:mediaId/cross-share

Share a media file to another conversation. **Business rule `DOC.CROSS_SHARE`:** caller must be `ADMIN` or `OWNER` in both conversations.

```bash
curl -X POST http://localhost:3000/media/media-uuid/cross-share \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceConversationId": "conv-uuid-1",
    "targetConversationId": "conv-uuid-2"
  }'
```

**Request body:**

| Field | Type | Required |
|---|---|---|
| `sourceConversationId` | `string` | ✓ |
| `targetConversationId` | `string` | ✓ |

---

### POST /media/multipart/init

**Step 1 of 4** — Initiate a multipart upload. For files **> 10 MB**.

Size limits: IMAGE ≤ 15 MB, VIDEO/FILE ≤ 1 GB.

**201 Created**

```bash
curl -X POST http://localhost:3000/media/multipart/init \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "lecture.mp4",
    "mimeType": "video/mp4",
    "type": "VIDEO",
    "totalSize": 104857600
  }'
```

**Request body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `filename` | `string` | ✓ | Original filename |
| `mimeType` | `string` | ✓ | e.g. `"video/mp4"` |
| `type` | `'IMAGE'\|'VIDEO'\|'AUDIO'\|'FILE'` | ✓ | Uppercase enum |
| `totalSize` | `number` | ✓ | Total file size in bytes |

**Response 201:**
```json
{
  "statusCode": 201,
  "message": "Resource created successfully",
  "data": {
    "mediaId": "media-uuid",
    "uploadId": "s3-multipart-upload-id",
    "objectKey": "uploads/media-uuid/lecture.mp4"
  }
}
```

---

### POST /media/multipart/presign-parts

**Step 2 of 4** — Get presigned PUT URLs for each chunk. Parts are 1-indexed.

Recommended chunk size: **5–50 MB**. Max 10 000 parts.

```bash
curl -X POST http://localhost:3000/media/multipart/presign-parts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mediaId": "media-uuid",
    "partNumbers": [1, 2, 3, 4],
    "expiresIn": 3600
  }'
```

**Request body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `mediaId` | `string` | ✓ | |
| `partNumbers` | `number[]` | ✓ | 1-indexed part numbers |
| `expiresIn` | `number` | | URL TTL in seconds |

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": [
    { "partNumber": 1, "url": "https://storage.minio.../part1" },
    { "partNumber": 2, "url": "https://storage.minio.../part2" }
  ]
}
```

> **Step 3** (client): `PUT <url>` each part in parallel. Save the `ETag` response header from each upload.

---

### POST /media/multipart/complete

**Step 4 of 4** — Assemble all parts and trigger the processing pipeline.

```bash
curl -X POST http://localhost:3000/media/multipart/complete \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mediaId": "media-uuid",
    "parts": [
      { "partNumber": 1, "eTag": "\"etag1\"" },
      { "partNumber": 2, "eTag": "\"etag2\"" }
    ]
  }'
```

**Request body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `mediaId` | `string` | ✓ | |
| `parts` | `Array<{ partNumber: number; eTag: string }>` | ✓ | Must be sorted by `partNumber` ascending |

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Resource updated successfully",
  "data": { "mediaId": "media-uuid", "status": "UPLOADED" }
}
```

---

### DELETE /media/multipart/:mediaId

Abort an in-progress multipart upload. Cleans up all uploaded parts from storage.

```bash
curl -X DELETE http://localhost:3000/media/multipart/media-uuid \
  -H "Authorization: Bearer $TOKEN"
```

---

## 9. Notifications — Push Notifications & Preferences

---

### GET /notifications/vapid-public-key

**Public — no token required**

Returns the VAPID public key needed to create a Web Push subscription in the browser.

```bash
curl http://localhost:3000/notifications/vapid-public-key
```

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": { "publicKey": "BNxx...base64url" }
}
```

---

### POST /notifications/devices

Register (or refresh) a push notification token for the authenticated user.

```bash
curl -X POST http://localhost:3000/notifications/devices \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "fcm-registration-token",
    "platform": "FCM",
    "deviceId": "device-unique-id"
  }'
```

**Request body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `token` | `string` | ✓ | FCM / APNS / Web Push subscription token |
| `platform` | `'FCM'\|'APNS'\|'WEB'` | ✓ | Token type |
| `deviceId` | `string` | ✓ | Unique device identifier (for de-registration) |

---

### DELETE /notifications/devices/:deviceId

Unregister a device (call on logout or app uninstall).

```bash
curl -X DELETE http://localhost:3000/notifications/devices/device-unique-id \
  -H "Authorization: Bearer $TOKEN"
```

---

### PUT /notifications/preferences

Save mute settings and quiet hours. Set `conversationId: null` for global preference (applies to all conversations without an override).

```bash
curl -X PUT http://localhost:3000/notifications/preferences \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "conv-uuid",
    "muteUntil": "2026-01-16T00:00:00.000Z",
    "notifyOnMention": true,
    "notifyOnMessage": false
  }'
```

**Request body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `conversationId` | `string\|null` | | `null` = global preference |
| `muteUntil` | `string` (ISO datetime) | | Mute until this time; `null` to unmute |
| `notifyOnMention` | `boolean` | | Notify when @mentioned |
| `notifyOnMessage` | `boolean` | | Notify for every new message |
| `quietHoursEnabled` | `boolean` | | Enable quiet hours schedule |
| `quietHoursStart` | `string` | | Time string e.g. `"22:00"` |
| `quietHoursEnd` | `string` | | Time string e.g. `"08:00"` |
| `timezone` | `string` | | IANA timezone for quiet hours |

---

### GET /notifications/preferences

Returns global preference and (optionally) a conversation-level override.

```bash
curl "http://localhost:3000/notifications/preferences?conversationId=conv-uuid" \
  -H "Authorization: Bearer $TOKEN"
```

**Query params:**

| Param | Type | Notes |
|---|---|---|
| `conversationId` | `string` | If provided, returns both global and conversation preferences |

---

## 10. Presence — Online Status

Online/offline status changes are driven automatically by **WebSocket connect/disconnect**. These HTTP endpoints are for **initial page-load data only**; do not poll them for real-time updates. Subscribe to WS `user:online` / `user:offline` events instead.

---

### GET /presence/status

Returns the authenticated user's own current presence.

```bash
curl http://localhost:3000/presence/status \
  -H "Authorization: Bearer $TOKEN"
```

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "userId": "user-uuid",
    "status": "online",
    "lastSeen": "2026-01-15T10:00:00.000Z"
  }
}
```

---

### GET /presence/friends

Returns presence status for all friends of the authenticated user.

```bash
curl http://localhost:3000/presence/friends \
  -H "Authorization: Bearer $TOKEN"
```

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": [
    { "userId": "friend-uuid", "status": "online", "lastSeen": null },
    { "userId": "friend-uuid-2", "status": "offline", "lastSeen": "2026-01-15T09:00:00.000Z" }
  ]
}
```

---

## 11. Stickers — Sticker Catalog

All routes require authentication.

---

### GET /stickers/packages

Returns all available sticker packages. Use `thumbnailUrl` for the tab icon in the sticker keyboard.

```bash
curl http://localhost:3000/stickers/packages \
  -H "Authorization: Bearer $TOKEN"
```

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": [
    {
      "id": "pck_sprite",
      "name": "Zolo Sprites",
      "thumbnailUrl": "https://storage.bcn.id.vn/zolo-stickers/sprite_thumb.webp",
      "isFree": true,
      "createdAt": "2026-04-12T00:00:00.000Z"
    }
  ]
}
```

---

### GET /stickers/packages/:packageId/stickers

Returns paginated stickers for a specific package.

```bash
curl "http://localhost:3000/stickers/packages/pck_sprite/stickers?limit=50&offset=0" \
  -H "Authorization: Bearer $TOKEN"
```

**Query params:**

| Param | Type | Default | Notes |
|---|---|---|---|
| `limit` | `number` | `50` | Max `100` |
| `offset` | `number` | `0` | Items to skip |

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": [
    {
      "id": "stk_001",
      "packageId": "pck_sprite",
      "url": "https://storage.bcn.id.vn/zolo-stickers/stk_001.webp",
      "tags": ["happy", "wave"]
    }
  ]
}
```

> To send a sticker, use `POST /chat/messages` with `type: 'sticker'` and put the sticker ID in `metadata.stickerId`, package ID in `metadata.packageId`.

---

## 12. Calls — Instant Call

> Full field-level documentation: [docs/api/call-api.md](../docs/api/call-api.md)

All endpoints require `Authorization: Bearer <token>` except `GET /calls/health`.

| Method | Path | Auth | Rate limit | Description |
|---|---|---|---|---|
| `GET` | `/calls/health` | Public | None | Service health summary |
| `POST` | `/calls/start` | ✓ | 5/min | Initiate a call (RINGING) |
| `POST` | `/calls/:callId/accept` | ✓ | 30/min | Callee accepts → ACTIVE + LiveKit JWT |
| `POST` | `/calls/:callId/decline` | ✓ | 30/min | Callee declines → REJECTED |
| `POST` | `/calls/:callId/end` | ✓ | 30/min | End or cancel a call |
| `GET` | `/calls/:callId` | ✓ | 60/min | Get call record |
| `GET` | `/calls/:callId/token` | ✓ | 30/min | Get LiveKit JWT (caller / reconnect) |
| `GET` | `/calls/history/:conversationId` | ✓ | 60/min | Paginated call history |
| `GET` | `/calls/:callId/summary` | ✓ | 30/min | Post-call summary |

### POST /calls/start

**Body**:
```json
{ "conversationId": "conv-uuid", "calleeIds": ["user-uuid"] }
```

**201** → `CallDto` with `status: "RINGING"`

**409** `CALL_CALLEE_BUSY` — callee already in a live call  
**409** `CALL_CALLER_BUSY` — caller already in a live call  
**403** `FORBIDDEN_NOT_MEMBER` — not a conversation member

### POST /calls/:callId/accept

**200** → `CallAcceptResponseDto`
```json
{
  "call": { ...CallDto },
  "token": "<LiveKit JWT>",
  "roomName": "call-<callId>",
  "livekitUrl": "wss://livekit.example.com"
}
```

Pass `token` to `new Room().connect(livekitUrl, token)` to join the SFU room.

**409** `CALL_NO_LONGER_RINGING` — call already ended or accepted by another device

### POST /calls/:callId/decline

**200** → `CallDto` with `status: "REJECTED"`

### POST /calls/:callId/end

**200** → `CallDto` with terminal status (`"ENDED"` or `"MISSED"` if caller cancels while RINGING)

**409** `CALL_ALREADY_ENDED` — already in a terminal state

### GET /calls/:callId/token

Issues a fresh LiveKit JWT for a participant in an ACTIVE call. Use this for the caller side and for reconnection.

**200**:
```json
{ "token": "<LiveKit JWT>", "roomName": "call-<callId>", "livekitUrl": "wss://..." }
```

**409** `CALL_NOT_ACTIVE` — call is not ACTIVE  
**403** `CALL_NOT_PARTICIPANT` — user is not a participant

### GET /calls/history/:conversationId

**Query**: `page` (default 1), `limit` (default 20, max 50)  
**200** → `CallDto[]` sorted newest first

### GET /calls/:callId/summary

**200**:
```json
{
  "callId": "...",
  "conversationId": "...",
  "startedAt": "...",
  "endedAt": "...",
  "durationMs": 330000,
  "endedBy": "user-uuid",
  "endReason": "user_ended",
  "participantCount": 2,
  "generatedAt": "..."
}
```

---

## 13. Client Implementation Guides

Implement these flows in the exact order shown to avoid race conditions and data inconsistencies.

---

### Guide 1: Fast-Ack Message Send Flow

The message lifecycle has **two asynchronous confirmation stages** after the HTTP response.

```
POST /chat/messages
        │
        ▼ (< 200ms)
  201 Created { messageId, status:'accepted' }   ← Gateway fast-ack
        │
        ▼ (< 2s async via Kafka)
  WS message:saved { messageId, offset }         ← Persistence confirmed
        │
        ▼ (broadcast)
  WS message:new { full message object }         ← Stream delivery (conversation room)
  WS message:notify { conversationId, offset }   ← Notification (personal rooms)
```

**Step-by-step:**

1. **Generate `clientMessageId`** — create a UUID v4 on the client **before** the request.
2. **Optimistic UI** — immediately render the message with a "sending" indicator (single ✓) and local state `{ status: 'sending', clientMessageId }`.
3. **POST /chat/messages** — include `clientMessageId`, `conversationId`, `content`, `type`.
4. **On 201 response** — update local state: `{ status: 'accepted', messageId }`. UI shows pending ✓✓.
5. **On WS `message:saved`** — match by `messageId`. Update `status: 'saved'`, store `offset`. UI shows ✓✓ sent.
6. **On WS `message:new`** on sender's own socket — replace the optimistic copy with the full server message object (includes enriched fields, final offset).
7. **On network failure** — retry with the **same `clientMessageId`**. Chat Core deduplicates — no double-save.
8. **On 403 / 429** — show error, remove the optimistic message from UI.

---

### Guide 2: Single-File Media Upload (≤ 10 MB)

```
POST /chat/pre-check-media    ← Validate before upload (avoids wasted bandwidth)
POST /media/upload            ← Get presigned PUT URL
PUT  <presignedUrl>           ← Upload directly to MinIO (bypasses API server)
POST /media/upload/complete   ← Finalize + trigger processing
POST /chat/messages           ← Send message with attachments[]
```

**Step-by-step:**

1. **Pre-check** — `POST /chat/pre-check-media` with `{ conversationId, mimeType, fileSize }`. If `approved: false`, show error and abort.
2. **Initiate upload** — `POST /media/upload` with `{ type, mimeType, size, filename }`. Save `mediaId` and `uploadUrl`.
3. **Upload to MinIO** — `PUT <uploadUrl>` with the raw file binary:
   ```
   Content-Type: <mimeType>    ← must match step 2
   Body: <raw file bytes>
   ```
4. **Finalize** — `POST /media/upload/complete` with `{ mediaId }`. Response: `status: 'PROCESSING'`.
5. **Render locally** — use the local `blob:` URL for immediate preview. The sender does not need to fetch from server.
6. **Send message** — `POST /chat/messages` with `type: 'image'` (or other) and `attachments: [{ mediaId }]`.
7. **Listen for `message:media_ready`** — when fired, replace local blob URL with presigned server URL via `GET /media/:mediaId/url`.

---

### Guide 3: Multipart Media Upload (> 10 MB)

```
POST /media/multipart/init           ← Create session, get mediaId + uploadId
POST /media/multipart/presign-parts  ← Get N presigned PUT URLs
PUT  <url1>, PUT <url2>, ...         ← Upload chunks in parallel
POST /media/multipart/complete       ← Assemble + finalize (include ETags)
POST /chat/messages                  ← Send message
```

**Step-by-step:**

1. **Init** — `POST /media/multipart/init` with `{ filename, mimeType, type, totalSize }`. Save `mediaId`.
2. **Chunk the file** — split into parts of **5–50 MB**. Build `partNumbers = [1, 2, ..., N]`.
3. **Get presigned URLs** — `POST /media/multipart/presign-parts` with `{ mediaId, partNumbers }`.
4. **Upload parts in parallel** — `PUT <url>` for each part. Collect the `ETag` response header.
   ```javascript
   const etags = await Promise.all(
     parts.map(async ({ partNumber, url }, i) => {
       const resp = await fetch(url, { method: 'PUT', body: chunks[i] });
       return { partNumber, eTag: resp.headers.get('ETag') };
     })
   );
   ```
5. **Complete** — `POST /media/multipart/complete` with `{ mediaId, parts: etags }`. Parts **must be sorted by `partNumber` ascending**.
6. **Send message** — same as Guide 2 step 6.
7. **On failure** — call `DELETE /media/multipart/:mediaId` to remove orphaned parts from storage.

---

### Guide 4: Cursor Tracking & Read Receipts

The system uses **offset-based cursors** (monotonically increasing integers per conversation), not timestamps, for read receipts. Unread count = `maxOffset - myOffset`.

**Key values:**
- `conversation.maxOffset` — highest message offset in the conversation
- `myOffset` — last offset the current user has confirmed seen (stored per user per conversation)

**Client state machine:**

```
On app start / WS authenticate:
  → GET /conversations  (load list with maxOffset, myOffset for each)
  → Render unread badges: max(0, maxOffset - myOffset)

On open conversation:
  → Emit WS 'conversation:join' { conversationId }
  → Server replies: { latestOffset }
  → Immediately emit 'conversation:update_seen_cursor' { conversationId, upToOffset: latestOffset }
  → Clear unread badge for this conversation

On receive WS 'message:new' (conversation is OPEN):
  → Append message to UI
  → Emit 'conversation:update_seen_cursor' { conversationId, upToOffset: message.offset }

On receive WS 'message:new' (conversation is BACKGROUND):
  → Emit 'conversation:update_delivered_cursor' { conversationId, upToOffset: message.offset }
  → Increment unread badge by 1

On receive WS 'message:notify' (conversation not open):
  → Update maxOffset in conversation list
  → Increment unread badge

On close / leave conversation:
  → Emit WS 'conversation:leave' { conversationId }

On app background / suspend:
  → Stop emitting seen cursors
  → Switch to delivered-only updates

On reconnect / re-authenticate:
  → Re-join all open conversation rooms
  → PATCH /conversations/:id/offset for any cursors missed while offline
```

**Cursor types:**
- `conversation:update_delivered_cursor` → message received by device (sender sees ✓✓)
- `conversation:update_seen_cursor` → user actively viewed the message (sender sees "read" indicator)

Both are fire-and-forget — ACK immediately with `status: 'processing'`. The actual DB write is handled by `OffsetSyncJob` every 5 s via Write-Behind caching.

---

### Guide 5: Reaction Optimistic Updates

Reactions bypass Kafka for sub-100 ms delivery via Redis Pub/Sub.

```
User taps 👍
  │
  ├─ IMMEDIATELY update local UI (optimistic +1)
  │
  ├─ POST /messages/:id/reactions { conversationId, emoji: '👍', action: 'add' }
  │         │
  │         └─ Server: Redis HSET + SADD dirty + Redis PUBLISH
  │                    ReactionPubSubService → WS 'message:reaction_updated'
  │
  └─ Receive WS 'message:reaction_updated' (authoritative server state)
         │
         └─ Replace optimistic local state with server state
```

**Step-by-step:**

1. **Optimistic add** — immediately increment the `👍` count in local state.
2. **POST reaction** — `POST /messages/:id/reactions` with `{ conversationId, emoji, action: 'add' }`.
3. **On WS `message:reaction_updated`** — match by `messageId`, replace entire `reactions` map:
   ```typescript
   {
     messageId: string;
     reactions: {
       [emoji: string]: {
         count: number;
         reactors: string[];     // User IDs who reacted
         myReaction: boolean;    // Whether current user has this reaction
       }
     }
   }
   ```
4. **On HTTP error** — revert the optimistic change.
5. **Remove reaction** — same flow, `action: 'remove'`. Optimistically decrement, server confirms.
6. **Idempotency** — calling `add` twice for the same emoji by the same user is safe (Redis HSET is idempotent).
7. **Write-Behind note** — reaction state is written to Redis immediately and synced to the database every 5 s by `ReactionSyncJob`. The WS event reflects Redis-live state (may be slightly ahead of DB).
