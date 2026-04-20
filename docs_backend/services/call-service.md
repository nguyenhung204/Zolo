# Call Service

## Overview

Call Service is a TCP microservice that orchestrates **instant voice/video calls** in the Zalo/Messenger style. When a caller dials, the callee's device rings immediately — there is no waiting room, no host role, and no recording. The call either gets accepted, declined, or auto-expires.

It does not transport WebRTC media itself. **LiveKit SFU** handles signaling and the media plane. Realtime Gateway consumes call Kafka events and broadcasts them to connected WebSocket clients. Push notifications are delivered by Notification Service.

---

## Core Model

### Status lifecycle

```
startCall
    │
    ▼
 RINGING ──────────────────────────────────────────────────► MISSED
    │  (callee declines)                                     (timeout or caller cancels)
    ├─────────────────────────────────────────────────────── REJECTED
    │  (callee accepts)
    ▼
 ACTIVE ─────────────────────────────────────────────────── ENDED
```

| Status | Meaning |
|---|---|
| `RINGING` | Call initiated; waiting for callee to respond |
| `ACTIVE` | Callee accepted; LiveKit room is live |
| `REJECTED` | Callee declined |
| `MISSED` | Callee didn't answer in time, or caller cancelled |
| `ENDED` | Active call explicitly ended by a participant |

### calls

`calls` rows store:

- `conversationId` — conversation this call belongs to
- `callerId` — user who initiated the call
- `status` — `RINGING | ACTIVE | REJECTED | MISSED | ENDED`
- `startedAt` — when the call was created (RINGING)
- `endedAt` — set on terminal transition
- `createdAt`

### call_participants

`call_participants` rows store:

- `callId`
- `userId`
- `role` — `CALLER | CALLEE`
- `joinedAt` — `null` for callee until they accept; set immediately for caller
- `leftAt` — set when participant leaves or call ends
- `createdAt`

### call_summaries

`call_summaries` rows store aggregate metrics written atomically when a call transitions to any terminal status:

- `callId`, `conversationId`
- `startedAt`, `endedAt`
- `durationMs` — 0 for REJECTED/MISSED, elapsed ms for ENDED
- `endedBy` — userId or `'system'` for cleanup-expired calls
- `endReason` — `'user_ended' | 'declined' | 'caller_cancelled' | 'ringing_timeout' | 'ghost_call_cleanup' | 'membership_revoked'`
- `participantCount`
- `generatedAt`, `updatedAt`

---

## Access Control

`CallAccessService` validates conversation membership. No external Users Service call is made — membership is resolved via `CallMembershipValidator` which is Redis-cache-first, cold-path falls back to Conversation Service TCP.

### Permission matrix

| Role | Start call | Join (accept) |
|---|---|---|
| `OWNER` | ✓ | ✓ |
| `ADMIN` | ✓ | ✓ |
| `MODERATOR` | ✓ | ✓ |
| `MEMBER` | ✓ | ✓ |
| `GUEST` | ✗ | ✓ |

### Membership cache keys

- membership set: `chat:conversation:{conversationId}:members`
- role: `chat:conversation:{conversationId}:members:{userId}:role`
- conversation context: `call:conversation:{conversationId}:context`

---

## Call Flow

### Starting a call

`startCall`:

1. Validates caller's conversation membership (`CALL_START`)
2. Acquires a **conversation-scoped distributed lock**
3. Checks busy state — rejects `409 CALL_CALLEE_BUSY` if any callee is in a live (RINGING/ACTIVE) call; rejects `409 CALL_CALLER_BUSY` if caller is in one
4. Within a single DB transaction:
   - Creates `calls` row with status `RINGING`
   - Creates `call_participants` row for CALLER (with `joinedAt = now`)
   - Creates `call_participants` row(s) for CALLEE(s) (with `joinedAt = null`)
   - Writes `call.event.ringing` to outbox
5. Returns `CallDto`

The caller receives the call DTO. To connect to LiveKit they call `GET /calls/:callId/token` once the callee accepts (call status = ACTIVE).

### Accepting a call

`acceptCall` (callee only):

1. Acquires a **call-scoped distributed lock**
2. Validates call is `RINGING`
3. Verifies the user is a `CALLEE` participant
4. Within a single DB transaction:
   - Transitions call → `ACTIVE`
   - Sets `joinedAt = now` for the callee participant row
   - Writes `call.event.accepted` to outbox
5. **After** the transaction commits, issues a LiveKit JWT for the callee
6. Returns `CallAcceptResponseDto` — `{ call, token, roomName, livekitUrl }`

The Realtime Gateway broadcasts `call:accepted` to the `call:{callId}` room. The caller then polls or reacts to the WS event and calls `GET /calls/:callId/token` to get their own token.

### Declining a call

`declineCall`:

1. Lock on callId
2. Validates call is `RINGING`
3. Atomically: transitions → `REJECTED`, marks all participants left, writes `CallSummaryEntity`, enqueues `call.event.declined`

### Ending a call

`endCall`:

1. Lock on callId
2. Rejects if already in a terminal state
3. Determines final status:
   - Caller hangs up while `RINGING` → `MISSED`
   - Otherwise → `ENDED`
4. Atomically: transitions status, marks all participants left, writes `CallSummaryEntity`, enqueues `call.event.ended`
5. Fire-and-forget `liveKit.closeRoom(callId).catch(log)` — LiveKit is best-effort

### Getting a LiveKit token

`getCallToken` — caller (and reconnecting participants) fetch their LiveKit JWT after the call becomes `ACTIVE`:

1. Validates call is `ACTIVE`
2. Validates user is a participant
3. Issues LiveKit JWT with `canPublish: true, canSubscribe: true, expiresInSeconds: 3600`
4. Returns `{ token, roomName, livekitUrl }`

---

## Busy State Detection

`findLiveCallByUserId(userId)` — queries `call_participants` joined to `calls` where `status IN ('RINGING', 'ACTIVE')` and `leftAt IS NULL`. Used both at `startCall` and can be queried directly.

If the callee is busy, `startCall` returns `409` with `CALL_CALLEE_BUSY`. If the caller is busy, it returns `409` with `CALL_CALLER_BUSY`.

---

## Cleanup and Health

### Cleanup sweeps

`CallCleanupService` runs on a configurable interval (`CALL_CLEANUP_INTERVAL_MS`, default 60 s). Distributed leader election via `tryRunCleanupLeader` — only one service replica runs the sweep per interval.

#### RINGING timeout sweep

Finds all RINGING calls older than `CALL_RINGING_TIMEOUT_SECONDS` (default 60 s). For each:

1. Acquires call lock (skips if locked — active transaction in progress)
2. Re-fetches fresh state inside lock
3. Atomically: transitions → `MISSED`, marks all participants left, writes `CallSummaryEntity`, enqueues `call.event.ended` with `endReason: 'ringing_timeout'`

#### Ghost ACTIVE call sweep

Finds all ACTIVE calls where every participant has `leftAt != null`. For each:

1. Acquires call lock, re-checks fresh state
2. Atomically: transitions → `ENDED`, writes `CallSummaryEntity`, enqueues `call.event.ended` with `endReason: 'ghost_call_cleanup'`
3. Fire-and-forget `closeRoom`

### Health

`GET /calls/health` (no auth) returns `CallHealthDto`:

```json
{
  "timestamp": "2026-04-20T00:00:00.000Z",
  "calls": {
    "ringing": 3,
    "active": 7,
    "activeParticipants": 14,
    "zeroParticipantActiveCalls": 0,
    "oldestRingingCallAgeMs": 12400
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

`status` is `DEGRADED` when `ghost_active_calls_detected` or `outbox_lag_high` (lag > 30 s).

---

## Kafka and Outbox

Call Service writes events through `OutboxRepository` inside the same DB transaction as each domain mutation. `aggregateType: 'call'`, `aggregateId: callId`.

### Topics produced

| Topic | Trigger | Payload key fields |
|---|---|---|
| `call.event.ringing` | `startCall` | `callId, conversationId, callerId, calleeIds[], startedAt` |
| `call.event.accepted` | `acceptCall` | `callId, conversationId, calleeId, acceptedAt` |
| `call.event.declined` | `declineCall` | `callId, conversationId, declinedBy, finalStatus, declinedAt` |
| `call.event.ended` | `endCall`, cleanup | `callId, conversationId, endedBy, endReason, durationMs, endedAt` |

### Topics consumed

| Topic | Consumer group | Purpose |
|---|---|---|
| `chat.event.member_removed` | `nest-chat.call-service` | Auto-end active/ringing call when a user is removed from the conversation |

`handleMembershipRevoked` finds any live call for the conversation and calls `endCall` gracefully.

---

## Distributed Locking

`CallLockService` wraps Redis SET NX PX:

| Lock scope | Method | Key pattern |
|---|---|---|
| Conversation | `withConversationLock` | `call:lock:conversation:{conversationId}` |
| Call | `withCallLock` | `call:lock:meeting:{callId}` |
| User | `withUserLock` | `call:lock:user:{userId}` |
| Cleanup leader | `tryRunCleanupLeader` | `call:lock:job:cleanup` |

`CallLockAcquisitionError` is thrown when a lock cannot be acquired within the wait timeout. Cleanup sweeps catch this and skip the call silently.

---

## LiveKit Boundary

- Call Service owns: call orchestration, LiveKit token issuance, room lifecycle
- LiveKit owns: WebRTC signaling, media transport, SFU mixing
- Realtime Gateway owns: WebSocket fan-out of call state events

LiveKit room name pattern: built by `LiveKitService.buildRoomName(callId)`.

Caller token flow: caller calls `GET /calls/:callId/token` after receiving `call:accepted` WS event. Callee token is returned inline in `POST /calls/:callId/accept` response.

---

## TCP Patterns

| Pattern | Handler |
|---|---|
| `start_call` | `CallController.startCall` |
| `accept_call` | `CallController.acceptCall` |
| `decline_call` | `CallController.declineCall` |
| `end_call` | `CallController.endCall` |
| `get_call` | `CallController.getCall` |
| `list_call_history` | `CallController.listCallHistory` |
| `get_call_summary` | `CallController.getCallSummary` |
| `get_call_token` | `CallController.getCallToken` |
| `get_call_health` | `CallController.getHealth` |
