

Đây là toàn bộ call flow và reconnect logic trên cả BE và FE:

---

## Call Flow Tổng Quan

### Backend — Status Lifecycle

```
POST /calls/start
        │
        ▼
    RINGING ──── callee declines ──────────────────► REJECTED
        │         (caller cancels / timeout) ──────► MISSED
        │
        └── callee accepts ──► ACTIVE ──── user ends ──► ENDED
```

---

## BE — Call Flow Chi Tiết

### 1. Start Call (`POST /calls/start`)
1. Validate caller là member của conversation
2. Acquire **conversation-scoped distributed lock**
3. Kiểm tra busy state — 409 `CALL_CALLEE_BUSY` / `CALL_CALLER_BUSY`
4. DB transaction: tạo `calls` row (RINGING) + `call_participants` rows (CALLER `joinedAt=now`, CALLEE `joinedAt=null`)
5. **Fast-track**: publish `call.event.ringing` → Redis `realtime:call_events` → Realtime Gateway broadcast `call:ringing` đến từng callee's WS room → Notification Service push notification

### 2. Accept Call (`POST /calls/:callId/accept` — callee only)
1. Call-scoped lock
2. Validate `RINGING`, user là CALLEE
3. DB transaction: RINGING → ACTIVE, set `joinedAt=now` cho callee participant
4. Fast-track: publish `call.event.accepted` → Gateway broadcast `call:accepted` đến `call:{callId}` WS room
5. Issue LiveKit JWT cho callee, return `CallAcceptResponseDto { call, token, roomName, livekitUrl }`

### 3. Decline / End / Timeout
| Trigger | Final Status | Event published |
|---|---|---|
| `POST /decline` | REJECTED | `call.event.declined` |
| `POST /end` (caller while RINGING) | MISSED | `call.event.ended` |
| `POST /end` (either party while ACTIVE) | ENDED | `call.event.ended` (→ **Kafka Outbox** cho chat-service) |
| Ringing > 60s (cleanup sweep) | MISSED | `call.event.ended` via Outbox |
| Ghost ACTIVE (no live participants) | ENDED | `call.event.ended` via Outbox + closeRoom LiveKit |

### 4. Get LiveKit Token (`GET /calls/:callId/token` — caller & reconnecting)
1. Validate call `ACTIVE`
2. Validate user là participant
3. Issue JWT: `canPublish: true, canSubscribe: true, expiresIn: 3600s`
4. Return `{ token, roomName, livekitUrl }`

---

## FE — Call Flow Chi Tiết

### Caller Flow
```
startInstantCall()  →  setOutgoingCall()  →  OutgoingCallModal (ringtone)
        │
        └── WS: call:accepted
                │
                └── getInstantCallToken(callId)
                        │
                        └── setActiveCall() + setLiveKitCredentials()
                                │
                                └── ActiveCallModal → LiveKitRoom.connect(url, token)
```

### Callee Flow
```
WS: call:ringing  →  setIncomingCall()  →  IncomingCallModal (ringtone)
        │
        ├── User accepts → acceptInstantCall(callId)
        │       └── { call, token, roomName, livekitUrl }
        │               └── setActiveCall() + setLiveKitCredentials()
        │                       └── ActiveCallModal → LiveKitRoom.connect()
        │
        └── User declines → declineInstantCall(callId) (fire-and-forget)
                └── direct: clearCallState() + call:leave_room
                    group:  clearCallState() + setDeclinedGroupCall() (giữ WS room để nhận call:ended)
```

### End / Cancel
- **Caller cancel** (RINGING): `call:leave_room` emit + `clearCallState()` + `endInstantCall()` fire-and-forget
- **End call** (ACTIVE, 1:1): `room.disconnect()` + `call:leave_room` + `clearCallState()` + `endInstantCall()`
- **Leave group call** (ACTIVE): `room.disconnect()` + `clearCallState()` + `setDeclinedGroupCall()` — **KHÔNG** gọi `endInstantCall()`, call vẫn live cho người khác

---

## Reconnect Flow

### 1. Page Reload Mid-Call (Auto-reconnect)
Xử lý trong useCallWebSocketListeners.ts — chạy một lần sau khi `token` auth sẵn sàng:

```typescript
// Persisted callStore state (localStorage via zustand/persist)
const { activeCall, liveKitCredentials } = useCallStore.getState();
if (!activeCall) return;

// 1. Verify call still ACTIVE on server
const call = await getInstantCallById(activeCall.id);
if (!call || call.status !== "ACTIVE") {
  clearCallState(); // call đã kết thúc khi đang reload
  return;
}

// 2. Fetch fresh LiveKit token (token cũ có thể expired)
const creds = await getInstantCallToken(activeCall.id);
setLiveKitCredentials(creds);       // → ActiveCallModal re-renders → LiveKitRoom reconnects
setActiveCall({ ...activeCall, ...call });
```

### 2. Socket Reconnect (Runtime)
```typescript
// Trong useCallWebSocketListeners
socket.on("connect", () => socket.emit("authenticate", { token }));
// Khi socket reconnect → re-authenticate → re-subscribe các events
```

### 3. Group Call Re-join (Declined/Kicked)
`GroupCallBanner` hiển thị "Join" button khi user đã decline group call:

```typescript
// GroupCallBanner.handleJoin()
const call = await getInstantCallById(groupCall.callId);
if (call.status === "ACTIVE") {
  const creds = await getInstantCallToken(call.id);   // fresh token
  setActiveCall(call); setLiveKitCredentials(creds);
} else if (call.status === "RINGING") {
  const res = await acceptInstantCall(call.id);       // callee accept path
  setActiveCall(res.call); setLiveKitCredentials(res);
} else {
  toast.info("Call đã kết thúc"); clearGroupCall();
}
```

### 4. LiveKit Room Reconnect
LiveKit client tự handle reconnect nội bộ (network blip, ICE restart). Nếu token expire trong khi call đang active, chỉ có page reload mới trigger auto-reconnect — không có runtime token refresh loop.

---

## Sơ đồ tổng hợp

```
BE:  startCall ──kafka/redis──► Gateway ──WS──► FE: call:ringing
         │                                              │
BE:  acceptCall ──redis──► Gateway ──WS──► FE: call:accepted
         │                                     caller: GET /token
         │                                              │
     LiveKit SFU ◄─────── FE: LiveKitRoom.connect(token) ──────►
         │
BE:  endCall ──outbox──► Kafka ──► chat-service (CallSummaryBubble)
              ──redis──► Gateway ──WS──► FE: call:ended → clearCallState()
```