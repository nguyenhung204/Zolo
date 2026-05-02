# FE React — Implement Call System Messages & Updated Call Signaling

## Context

Two recent backend commits changed how calls are signaled and added system messages to conversations for every terminal call state. This prompt covers **everything the React web client needs to update**.

---

## Commit 1 — Upgraded Call Signaling Payloads

### Breaking change: `call:ringing` payload

The `callerId: string` field has been **removed** and replaced with a `caller` object:

**Before (old — no longer sent):**
```typescript
{
  callId: string;
  conversationId: string;
  callerId: string;       // ← REMOVED
  calleeIds: string[];
  startedAt: string;
}
```

**After (new):**
```typescript
{
  callId: string;
  conversationId: string;
  caller: {              // ← NEW enriched object
    id: string;
    name: string;        // display name, ready to render
    avatar: string;      // avatar URL or mediaId
  };
  calleeIds: string[];
  startedAt: string;     // ISO-8601
}
```

**What to update:**
- Find every place that reads `payload.callerId` from a `call:ringing` event and replace with `payload.caller.id`.
- The incoming call UI now has `payload.caller.name` and `payload.caller.avatar` available immediately — no need to fetch the user profile separately.

```typescript
// BEFORE
callSocket.on('call:ringing', (payload) => {
  showIncomingCall({ callerId: payload.callerId }); // had to fetch user after
});

// AFTER
callSocket.on('call:ringing', (payload) => {
  showIncomingCall({
    callId: payload.callId,
    conversationId: payload.conversationId,
    callerName: payload.caller.name,
    callerAvatar: payload.caller.avatar,
    calleeIds: payload.calleeIds,
    startedAt: payload.startedAt,
  });
  callSocket.emit('call:join_room', { callId: payload.callId });
});
```

### `409 CALL_CALLEE_BUSY` — do not create local UI

If `POST /calls/start` returns `409` with code `CALL_CALLEE_BUSY`:
- **Do NOT** show a local "calling..." screen.
- The backend has already persisted a missed call and injected a system message into the conversation.
- Just close the dialing UI; the system message will arrive via `message:new` (see Commit 2 below).

---

## Commit 2 — System Messages for All Terminal Call States

The backend now emits a `message:new` WebSocket event to the conversation room for every call that ends. These messages have `type: 'system'` and `metadata.systemType: 'system_call'`.

### New system message shape

```typescript
// Arrives via the existing message:new WebSocket event
socket.on('message:new', (payload: {
  messageId: string;
  conversationId: string;
  senderId: 'SYSTEM';
  type: 'system';
  content: string;          // human-readable string (Vietnamese)
  offset: number;
  createdAt: string;
  metadata: {
    action: 'CALL_MISSED' | 'CALL_MISSED_BUSY' | 'CALL_REJECTED' | 'CALL_ENDED';
    systemType: 'system_call';
    callId: string;
    callerId: string;
    callerName: string;
    durationMs: number;     // 0 for missed/rejected
    isMissed: boolean;
    reason: string;         // see table below
  };
}) => { ... });
```

### Content strings and when they appear

| `metadata.action` | `content` | Trigger |
|---|---|---|
| `CALL_MISSED_BUSY` | `Cuộc gọi nhỡ (Đường dây bận)` | Start call failed — callee was already busy |
| `CALL_MISSED` | `Cuộc gọi nhỡ` | No answer (60s timeout) **or** caller cancelled while RINGING |
| `CALL_REJECTED` | `Cuộc gọi bị từ chối` | Callee explicitly declined (group: after ALL callees decline) |
| `CALL_ENDED` | `Cuộc gọi đã kết thúc • {duration}` | Call ended normally, e.g. `Cuộc gọi đã kết thúc • 5 phút 30 giây` |

### `metadata.reason` values

| reason | Meaning |
|---|---|
| `callee_busy` | Callee was in another call |
| `ringing_timeout` | 60s elapsed, callee never answered |
| `caller_cancelled` | Caller hung up during RINGING |
| `declined` | Callee manually declined |
| `user_ended` | Participant ended active call |
| `ghost_call_cleanup` | System swept a dead call |
| `stale_call_cleanup` | System swept an overaged call |

### How to render call system messages

In your message list renderer, add a branch for `type === 'system'` + `metadata?.systemType === 'system_call'`:

```tsx
function CallSystemMessage({ message }: { message: MessagePayload }) {
  const { content, metadata } = message;
  const { action, callerName, durationMs, isMissed } = metadata;

  const icon = isMissed || action === 'CALL_REJECTED'
    ? '📵'   // missed/rejected
    : '📞';  // ended

  return (
    <div className="system-message call-system-message">
      <span className="icon">{icon}</span>
      <span className="text">{content}</span>
      {/* Optional: show who called */}
      {callerName && (
        <span className="caller-hint">Người gọi: {callerName}</span>
      )}
    </div>
  );
}
```

```typescript
// In your message renderer switch/if block:
if (message.type === 'system') {
  if (message.metadata?.systemType === 'system_call') {
    return <CallSystemMessage message={message} />;
  }
  return <GenericSystemMessage message={message} />;
}
```

### Duration formatting (for display consistency)

The backend already formats the duration into the `content` string, so **you don't need to format it yourself**. Just render `content` directly. The format is: `{h} giờ {m} phút {s} giây` (parts with zero value omitted).

Examples:
- `0 giây` — effectively 0 ms
- `45 giây`
- `5 phút 30 giây`
- `1 giờ 2 phút 15 giây`

### Conversation list preview

The `message:notify` event is emitted for these system messages too. Update the conversation list preview renderer to handle `type === 'system'` with call content:

```typescript
function getPreviewText(message: { type: string; content: string; metadata?: any }): string {
  if (message.type === 'system' && message.metadata?.systemType === 'system_call') {
    // content is already human-readable
    return message.content; // e.g. "Cuộc gọi nhỡ"
  }
  // ... existing logic
}
```

### Call UI dismissal — do not duplicate system messages

When the call UI receives `call:declined` or `call:ended`, dismiss the call screen. **Do not** insert a local "missed call" card into the conversation — the backend system message will arrive via `message:new` and be the authoritative record.

```typescript
// Dismiss call UI on these events
callSocket.on('call:declined', (payload) => {
  dismissCallUI(payload.callId);
  // Do NOT add a local system message — backend will send one via message:new
});

callSocket.on('call:ended', (payload) => {
  dismissCallUI(payload.callId);
  // Do NOT add a local system message — backend will send one via message:new
});
```

---

## Summary checklist

- [ ] Update `call:ringing` handler: replace `payload.callerId` → `payload.caller.id / .name / .avatar`
- [ ] Incoming call UI: use `caller.name` and `caller.avatar` directly (no extra profile fetch)
- [ ] `POST /calls/start` 409 `CALL_CALLEE_BUSY`: close dialing UI, do not create local state
- [ ] Message renderer: render `type === 'system'` + `systemType === 'system_call'` with icon + `content`
- [ ] Conversation list preview: use `content` directly for call system messages
- [ ] `call:declined` / `call:ended` handlers: dismiss UI only, no local system message insertion
