# Call API

> **Base URL**: `https://{host}/calls`
> All endpoints except `GET /calls/health` require a valid `Authorization: Bearer <token>` header (Keycloak JWT).

---

## Table of Contents

1. [Overview](#overview)
2. [Endpoints](#endpoints)
   - [GET /calls/health](#get-callshealth)
   - [POST /calls/start](#post-callsstart)
   - [POST /calls/:callId/accept](#post-callscallidaccept)
   - [POST /calls/:callId/decline](#post-callscalliddecline)
   - [POST /calls/:callId/end](#post-callscallidend)
   - [GET /calls/:callId](#get-callscallid)
   - [GET /calls/:callId/token](#get-callscallidtoken)
   - [GET /calls/history/:conversationId](#get-callshistoryconversationid)
   - [GET /calls/:callId/summary](#get-callscallidsummary)
3. [Data Types](#data-types)
4. [Error Codes](#error-codes)
5. [Integration Guide](#integration-guide)

---

## Overview

The Call API enables Zalo/Messenger-style instant calls. There are no waiting rooms, recording controls, or host roles. The lifecycle is:

```
POST /calls/start  →  RINGING
                          │  callee accepts  →  ACTIVE  →  POST /calls/:id/end → ENDED
                          │  callee declines  →           REJECTED
                          │  timeout or caller cancels  → MISSED
```

Media transport is handled by **LiveKit SFU**. The API only orchestrates call state and issues LiveKit JWTs.

---

## Endpoints

### GET /calls/health

Health check for the Call Service. No authentication required.

**Response `200`**

```json
{
  "timestamp": "2026-04-20T10:00:00.000Z",
  "calls": {
    "ringing": 2,
    "active": 5,
    "activeParticipants": 10,
    "zeroParticipantActiveCalls": 0,
    "oldestRingingCallAgeMs": 8200
  },
  "outbox": {
    "pending": 0,
    "processing": 0,
    "failed": 0,
    "lagMs": 0
  },
  "cleanup": {
    "ringingTimeoutSeconds": 60,
    "intervalMs": 60000
  },
  "health": {
    "status": "HEALTHY",
    "issues": []
  }
}
```

`health.status` is `DEGRADED` when `issues` contains `ghost_active_calls_detected` or `outbox_lag_high`.

---

### POST /calls/start

Initiate a new call. The caller's device starts ringing on the callee's side.

**Rate limit**: 5 requests / minute

**Request body**

```json
{
  "conversationId": "conv-uuid",
  "calleeIds": ["user-uuid-1", "user-uuid-2"]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `conversationId` | `string` | ✓ | Conversation the call belongs to |
| `calleeIds` | `string[]` | ✓ | At least one callee user ID |

**Response `201`** — `CallDto`

```json
{
  "id": "call-uuid",
  "conversationId": "conv-uuid",
  "callerId": "caller-uuid",
  "status": "RINGING",
  "createdAt": "2026-04-20T10:00:00.000Z",
  "startedAt": "2026-04-20T10:00:00.000Z",
  "endedAt": null,
  "participants": [
    { "userId": "caller-uuid", "role": "CALLER", "joinedAt": "2026-04-20T10:00:00.000Z", "leftAt": null, "createdAt": "..." },
    { "userId": "user-uuid-1", "role": "CALLEE", "joinedAt": null, "leftAt": null, "createdAt": "..." }
  ]
}
```

**Error responses**

| Status | Code | Reason |
|---|---|---|
| 403 | `FORBIDDEN_NOT_MEMBER` | Caller not a member of the conversation |
| 409 | `CALL_CALLEE_BUSY` | A callee is already in an active or ringing call |
| 409 | `CALL_CALLER_BUSY` | Caller is already in an active or ringing call |

**Side effects**: `call.event.ringing` published to Kafka → Realtime Gateway broadcasts `call:ringing` to each callee's personal WS room → Notification Service sends a push notification.

---

### POST /calls/:callId/accept

Accept an incoming call. Transitions `RINGING → ACTIVE` and returns a LiveKit JWT so the callee can connect to the SFU room immediately.

**Rate limit**: 30 requests / minute

**Path params**: `callId` — the call UUID

**Request body**: none

**Response `200`** — `CallAcceptResponseDto`

```json
{
  "call": { ...CallDto with status: "ACTIVE" },
  "token": "eyJhbGciOiJS...",
  "roomName": "call-<callId>",
  "livekitUrl": "wss://livekit.example.com"
}
```

| Field | Type | Notes |
|---|---|---|
| `token` | `string` | LiveKit JWT — pass to `new Room().connect(livekitUrl, token)` |
| `roomName` | `string` | LiveKit room identifier |
| `livekitUrl` | `string` | WSS endpoint for LiveKit |

**Error responses**

| Status | Code | Reason |
|---|---|---|
| 404 | `CALL_NOT_FOUND` | Call does not exist |
| 403 | `FORBIDDEN_NOT_MEMBER` | User is not a callee on this call |
| 409 | `CALL_NO_LONGER_RINGING` | Call already ended or expired |

**Side effects**: `call.event.accepted` → Realtime Gateway broadcasts `call:accepted` to `call:{callId}` WS room. The caller receives this event and then calls `GET /calls/:callId/token` to get their own LiveKit JWT.

---

### POST /calls/:callId/decline

Decline an incoming call. Transitions `RINGING → REJECTED`.

**Rate limit**: 30 requests / minute

**Path params**: `callId`

**Request body**: none

**Response `200`** — `CallDto` with `status: "REJECTED"`

**Error responses**

| Status | Code | Reason |
|---|---|---|
| 404 | `CALL_NOT_FOUND` | — |
| 409 | `CALL_NO_LONGER_RINGING` | — |

**Side effects**: `call.event.declined` → Realtime Gateway broadcasts `call:declined`.

---

### POST /calls/:callId/end

End an active call or cancel a ringing call.

- Caller cancels while RINGING → final status `MISSED`
- Either party ends while ACTIVE → final status `ENDED`

**Rate limit**: 30 requests / minute

**Path params**: `callId`

**Request body**: none

**Response `200`** — `CallDto` with terminal status

**Error responses**

| Status | Code | Reason |
|---|---|---|
| 404 | `CALL_NOT_FOUND` | — |
| 409 | `CALL_ALREADY_ENDED` | Call is already in a terminal status |

**Side effects**: `call.event.ended` → Realtime Gateway broadcasts `call:ended`. LiveKit room is closed asynchronously (fire-and-forget).

---

### GET /calls/:callId

Fetch a single call record.

**Rate limit**: 60 requests / minute

**Path params**: `callId`

**Response `200`** — `CallDto` or `null`

---

### GET /calls/:callId/token

Issue a LiveKit JWT for the requesting user. Used by the **caller** and **reconnecting participants** to join the LiveKit room after the call becomes ACTIVE.

**Rate limit**: 30 requests / minute

**Path params**: `callId`

**Response `200`**

```json
{
  "token": "eyJhbGciOiJS...",
  "roomName": "call-<callId>",
  "livekitUrl": "wss://livekit.example.com"
}
```

**Error responses**

| Status | Code | Reason |
|---|---|---|
| 404 | `CALL_NOT_FOUND` | — |
| 409 | `CALL_NOT_ACTIVE` | Call is not in ACTIVE status |
| 403 | `CALL_NOT_PARTICIPANT` | User is not a participant on this call |

---

### GET /calls/history/:conversationId

Paginated list of completed calls for a conversation (all terminal statuses).

**Rate limit**: 60 requests / minute

**Path params**: `conversationId`

**Query params**

| Param | Type | Default | Notes |
|---|---|---|---|
| `page` | `number` | `1` | 1-based page number |
| `limit` | `number` | `20` | Max 50 |

**Response `200`** — `CallDto[]` (sorted newest first)

---

### GET /calls/:callId/summary

Fetch the post-call aggregate summary. Available once a call reaches a terminal status.

**Rate limit**: 30 requests / minute

**Path params**: `callId`

**Response `200`**

```json
{
  "callId": "call-uuid",
  "conversationId": "conv-uuid",
  "startedAt": "2026-04-20T10:00:00.000Z",
  "endedAt": "2026-04-20T10:05:30.000Z",
  "durationMs": 330000,
  "endedBy": "user-uuid",
  "endReason": "user_ended",
  "participantCount": 2,
  "generatedAt": "2026-04-20T10:05:30.000Z"
}
```

| `endReason` | Description |
|---|---|
| `user_ended` | Participant explicitly ended the call |
| `declined` | Callee declined the call |
| `caller_cancelled` | Caller hung up while still RINGING |
| `ringing_timeout` | Callee didn't respond within 60 s |
| `ghost_call_cleanup` | System ended an ACTIVE call with no live participants |
| `membership_revoked` | A participant was removed from the conversation |

---

## Data Types

### CallDto

```typescript
interface CallDto {
  id: string;
  conversationId: string;
  callerId: string;
  status: 'RINGING' | 'ACTIVE' | 'REJECTED' | 'MISSED' | 'ENDED';
  createdAt: Date;
  startedAt: Date;
  endedAt: Date | null;
  participants: CallParticipantDto[];
}

interface CallParticipantDto {
  userId: string;
  role: 'CALLER' | 'CALLEE';
  joinedAt: Date | null;   // null until ACTIVE for callee
  leftAt: Date | null;
  createdAt: Date;
}
```

### CallAcceptResponseDto

```typescript
interface CallAcceptResponseDto {
  call: CallDto;
  token: string;       // LiveKit JWT
  roomName: string;    // LiveKit room identifier
  livekitUrl: string;  // wss:// endpoint
}
```

### CallTokenDto

```typescript
interface CallTokenDto {
  token: string;
  roomName: string;
  livekitUrl: string;
}
```

---

## Error Codes

| Code | HTTP | Description |
|---|---|---|
| `CALL_CALLEE_BUSY` | 409 | Callee is already in an active or ringing call |
| `CALL_CALLER_BUSY` | 409 | Caller is already in an active or ringing call |
| `CALL_NOT_FOUND` | 404 | Call record does not exist |
| `CALL_NOT_ACTIVE` | 409 | Call must be ACTIVE for this operation |
| `CALL_NOT_RINGING` | 409 | Call is no longer in RINGING state |
| `CALL_NO_LONGER_RINGING` | 409 | Same as CALL_NOT_RINGING (context-specific) |
| `CALL_ALREADY_ENDED` | 409 | Call is already in a terminal status |
| `CALL_NOT_PARTICIPANT` | 403 | User is not a participant on this call |
| `FORBIDDEN_NOT_MEMBER` | 403 | User is not a member of the conversation |

---

## Integration Guide

### Caller flow

```
1. POST /calls/start { conversationId, calleeIds }
        → save callId, show "Calling..." UI

2. Listen on WS call:ringing (callee side)
   Listen on WS call:accepted

3. On call:accepted (WS event)
        → GET /calls/:callId/token
        → new Room().connect(livekitUrl, token)

4. When done: POST /calls/:callId/end
```

### Callee flow

```
1. Receive WS call:ringing { callId, callerId, conversationId, ... }
        → show incoming call UI with ringtone

2a. User accepts:
        → POST /calls/:callId/accept
        → use { token, roomName, livekitUrl } to connect to LiveKit room

2b. User declines:
        → POST /calls/:callId/decline
        → dismiss UI

3. When done: POST /calls/:callId/end
```

### Reconnection flow

```
1. Socket reconnects / token expires
2. GET /calls/:callId → confirm status is ACTIVE
3. GET /calls/:callId/token → get fresh LiveKit JWT
4. new Room().connect(livekitUrl, freshToken)
```
