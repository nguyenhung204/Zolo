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
- `conversationType` — `'direct' | 'group' | 'announcement'`; set on creation, used for system message routing
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
- `endReason` — `'user_ended' | 'declined' | 'caller_cancelled' | 'ringing_timeout' | 'ghost_call_cleanup' | 'stale_call_cleanup' | 'membership_revoked'`
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
| `MEMBER` | ✓ | ✓ |

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
   - ~~Writes `call.event.ringing` to outbox~~ *(removed — see fast-track below)*
5. **Post-transaction fast-track:** publishes `call.event.ringing` to Redis `realtime:call_events` channel
6. Returns `CallDto`

The caller receives the call DTO. To connect to LiveKit they call `GET /calls/:callId/token` once the callee accepts (call status = ACTIVE).

### Accepting a call

`acceptCall` (callee only):

1. Acquires a **call-scoped distributed lock**
2. Validates call is `RINGING`
3. Verifies the user is a `CALLEE` participant
4. Within a single DB transaction:
   - Transitions call → `ACTIVE`
   - Sets `joinedAt = now` for the callee participant row
   - ~~Writes `call.event.accepted` to outbox~~ *(removed — see fast-track below)*
5. **Post-transaction fast-track:** publishes `call.event.accepted` to Redis `realtime:call_events` channel
6. **After** all of the above, issues a LiveKit JWT for the callee
7. Returns `CallAcceptResponseDto` — `{ call, token, roomName, livekitUrl }`

The Realtime Gateway broadcasts `call:accepted` to the `call:{callId}` room via the Redis subscriber. The caller then reacts to the WS event and calls `GET /calls/:callId/token` to get their own token.

### Declining a call

`declineCall`:

1. Lock on callId
2. Validates call is `RINGING`
3. Atomically: transitions → `REJECTED`, marks all participants left, writes `CallSummaryEntity`, **writes `MESSAGE_ACCEPTED` system message to Outbox** — content: `"Cuộc gọi bị từ chối"` (action: `CALL_REJECTED`)
4. **Post-transaction fast-track:** publishes `call.event.declined` to Redis `realtime:call_events` channel

> Group call: each callee declines independently. The call only becomes `REJECTED` when all callees have declined. Only then is the system message enqueued.

### Ending a call

`endCall`:

1. Lock on callId
2. Rejects if already in a terminal state
3. Determines final status:
   - Caller hangs up while `RINGING` → `MISSED`
   - Otherwise → `ENDED`
4. Atomically: transitions status, marks all participants left, writes `CallSummaryEntity`, **writes `call.event.ended` to Outbox** (Kafka signaling), **writes `MESSAGE_ACCEPTED` system message to Outbox**:
   - `MISSED` (caller cancelled): content `"Cuộc gọi nhỡ"` (action: `CALL_MISSED`)
   - `ENDED`: content `"Cuộc gọi đã kết thúc • {duration}"` (action: `CALL_ENDED`), e.g. `"Cuộc gọi đã kết thúc • 5 phút 30 giây"`
5. **Post-transaction fast-track:** also publishes `call.event.ended` to Redis `realtime:call_events` channel
6. Fire-and-forget `liveKit.closeRoom(callId).catch(log)` — LiveKit is best-effort

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

### Inline staleness sweep on busy hits

`startCall` calls `isUserBusy(userId)` rather than the raw repository finder. When a "live" call is found, the orchestration service first asks `CallCleanupService.expireSingleStuckCallIfStale(call)` to opportunistically retire it if:

- it is `RINGING` past `CALL_RINGING_TIMEOUT_SECONDS` (default 60 s), or
- it is `ACTIVE` with zero live participants (ghost call), or
- it is `ACTIVE` past `CALL_MAX_ACTIVE_DURATION_SECONDS` (default 4 h).

The same per-call lock used by the periodic sweep guards the inline path, so concurrent cleanups are safe — a `CallLockAcquisitionError` is treated as "another worker is already cleaning this up" and the call is reported as no longer blocking.

This protects users from "phantom busy" errors when a previous call crashed mid-flight (browser closed, pod restart, network drop) and the periodic sweep hasn't fired yet. Without this, callers could be locked out for up to `CALL_RINGING_TIMEOUT_SECONDS + CALL_CLEANUP_INTERVAL_MS` after a crashed call.

---

## Cleanup and Health

### Cleanup sweeps

`CallCleanupService` runs on a configurable interval (`CALL_CLEANUP_INTERVAL_MS`, default 60 s). Distributed leader election via `tryRunCleanupLeader` — only one service replica runs the sweep per interval. It also runs one immediate cleanup pass roughly 5 seconds after startup to sweep stale rows left behind by a restart.

#### RINGING timeout sweep

Finds all RINGING calls older than `CALL_RINGING_TIMEOUT_SECONDS` (default 60 s). For each:

1. Acquires call lock (skips if locked — active transaction in progress)
2. Re-fetches fresh state inside lock
3. Atomically: transitions → `MISSED`, marks all participants left, writes `CallSummaryEntity`, writes `call.event.ended` to Outbox (Kafka path), **writes `MESSAGE_ACCEPTED` system message** — content: `"Cuộc gọi nhỡ"` (action: `CALL_MISSED`, reason: `ringing_timeout`)
4. **Post-transaction fast-track:** publishes `call.event.ended` to Redis `realtime:call_events` channel

#### Ghost ACTIVE call sweep

Finds all ACTIVE calls where every participant has `leftAt != null`, or where the call age exceeds `CALL_MAX_ACTIVE_DURATION_SECONDS` (default 4 h). For each:

1. Acquires call lock, re-checks fresh state
2. Atomically: transitions → `ENDED`, marks all participants left, writes `CallSummaryEntity`, writes `call.event.ended` to Outbox (Kafka path), **writes `MESSAGE_ACCEPTED` system message** — content: `"Cuộc gọi đã kết thúc • {duration}"` (action: `CALL_ENDED`)
3. **Post-transaction fast-track:** publishes `call.event.ended` to Redis `realtime:call_events` channel
4. Fire-and-forget `closeRoom`

The summary `endReason` is `ghost_call_cleanup` when the call has no live participants, and `stale_call_cleanup` when cleanup terminates an over-age session after a restart or leaked heartbeat.

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

## Redis Pub/Sub Fast-Track Signaling

Call signaling events bypass the Transactional Outbox → Kafka pipeline for sub-50 ms UI delivery. Immediately after each DB transaction commits, `CallSignalingPublisher` publishes a JSON envelope to the Redis channel `realtime:call_events`.

```
call-service  ──PUBLISH──►  Redis realtime:call_events  ──SUBSCRIBE──►  realtime-gateway
   (post-TX)                                                              (CallSignalingSubscriber)
                                                                                    │
                                                                            Socket.IO emission
```

### Envelope format

```json
{
  "eventType": "call.event.ringing | call.event.accepted | call.event.declined | call.event.ended",
  "callId": "<uuid>",
  "conversationId": "<uuid>",
  "payload": { ... }
}
```

### Event routing table

| eventType | Publish source | WS emission | Target room |
|---|---|---|---|
| `call.event.ringing` | `startCall` post-TX | `call:ringing` | `user:{calleeId}` (for each callee) |
| `call.event.accepted` | `acceptCall` post-TX | `call:accepted` | `call:{callId}` |
| `call.event.declined` | `declineCall` post-TX | `call:declined` | `call:{callId}` |
| `call.event.ended` | `endCall` / cleanup post-TX | `call:ended` | `call:{callId}` |

### Dual-path signaling

`call.event.ringing` and `call.event.ended` travel both paths:
- **Kafka Outbox** for `call.event.ringing`: durable enriched incoming-call event for async consumers.
- **Kafka Outbox** for `call.event.ended`: Kafka signaling for `realtime-gateway` / `notification-service`.
- **Redis Pub/Sub**: provides sub-50 ms UI signaling for connected clients and triggers urgent call pushes.

`call.event.accepted` and `call.event.declined` remain Redis fast-track events.

---

## System Messages in Conversation

Every terminal call state writes a `MESSAGE_ACCEPTED` outbox event (topic: `message.accepted`) which is consumed by `message-store` and persisted as a system message (`type: 'system'`) in the conversation.

| Scenario | `metadata.action` | Content |
|---|---|---|
| Callee busy when called | `CALL_MISSED_BUSY` | `"Cuộc gọi nhỡ (Đường dây bận)"` |
| Ringing timeout (no answer) | `CALL_MISSED` | `"Cuộc gọi nhỡ"` |
| Caller cancelled (hung up during RINGING) | `CALL_MISSED` | `"Cuộc gọi nhỡ"` |
| Callee declined | `CALL_REJECTED` | `"Cuộc gọi bị từ chối"` |
| Call ended normally | `CALL_ENDED` | `"Cuộc gọi đã kết thúc • {duration}"` e.g. `"Cuộc gọi đã kết thúc • 5 phút 30 giây"` |
| Ghost/stale cleanup ended | `CALL_ENDED` | `"Cuộc gọi đã kết thúc • {duration}"` |

Message `metadata` shape:
```json
{
  "action": "CALL_MISSED | CALL_REJECTED | CALL_ENDED | CALL_MISSED_BUSY",
  "systemType": "system_call",
  "callId": "<uuid>",
  "callerId": "<userId>",
  "callerName": "<display name or userId>",
  "durationMs": 0,
  "isMissed": true,
  "reason": "ringing_timeout | declined | caller_cancelled | callee_busy | ..."
}
```

Message IDs are deterministic (`uuidv5`) keyed to `"{event}:{callId}"`, ensuring idempotency across retries.

`call.event.ringing` payload:

```json
{
  "callId": "<uuid>",
  "conversationId": "<uuid>",
  "caller": {
    "id": "<caller-user-id>",
    "name": "Caller Name",
    "avatar": "https://..."
  },
  "calleeIds": ["<callee-user-id>"],
  "startedAt": "2026-05-02T10:00:00.000Z"
}
```

---

## Kafka and Outbox

Call Service writes events through `OutboxRepository` inside the same DB transaction as each domain mutation. `aggregateType: 'call'`, `aggregateId: callId`.

### Topics produced

| Topic | Trigger | Payload key fields | Notes |
|---|---|---|---|
| `call.event.ringing` | `startCall` | `callId, conversationId, caller, calleeIds, startedAt` | Enriched durable incoming-call event |
| `call.event.ended` | `endCall`, cleanup | `callId, conversationId, endedBy, endReason, durationMs, endedAt` | Only durable event — triggers chat-service Call Summary |

> `call.event.accepted` and `call.event.declined` are not written to the Outbox. They are delivered via Redis Pub/Sub fast-track.

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
