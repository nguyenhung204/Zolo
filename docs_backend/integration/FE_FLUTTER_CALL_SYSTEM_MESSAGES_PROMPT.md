# Flutter App — Implement Call System Messages & Updated Call Signaling

## Context

Two recent backend commits changed how calls are signaled (enriched `call:ringing` payload) and added system messages to conversations for every terminal call state. This prompt covers **everything the Flutter app needs to update**, including push handling, Socket.IO events, and conversation message rendering.

---

## Commit 1 — Upgraded Call Signaling Payloads

### Breaking change: `call:ringing` — enriched `caller` object

The `callerId: String` field has been **removed** and replaced with a nested `caller` object.

**Before (old — no longer sent):**
```dart
// Old payload fields
String callId;
String conversationId;
String callerId;     // ← REMOVED
List<String> calleeIds;
String startedAt;
```

**After (new):**
```dart
class IncomingCallPayload {
  final String callId;
  final String conversationId;
  final CallCaller caller;    // ← NEW
  final List<String> calleeIds;
  final String startedAt;

  const IncomingCallPayload({
    required this.callId,
    required this.conversationId,
    required this.caller,
    required this.calleeIds,
    required this.startedAt,
  });

  factory IncomingCallPayload.fromJson(Map<String, dynamic> json) {
    return IncomingCallPayload(
      callId: json['callId'] as String,
      conversationId: json['conversationId'] as String,
      caller: CallCaller.fromJson(json['caller'] as Map<String, dynamic>),
      calleeIds: List<String>.from(json['calleeIds'] as List),
      startedAt: json['startedAt'] as String,
    );
  }
}

class CallCaller {
  final String id;
  final String name;
  final String avatar;   // URL or mediaId — use with your avatar resolver

  const CallCaller({required this.id, required this.name, required this.avatar});

  factory CallCaller.fromJson(Map<String, dynamic> json) => CallCaller(
    id: json['id'] as String,
    name: json['name'] as String,
    avatar: json['avatar'] as String? ?? '',
  );
}
```

**Update your Socket.IO listener:**
```dart
// BEFORE
_callSocket.on('call:ringing', (data) {
  final payload = data as Map<String, dynamic>;
  _showIncomingCall(callerId: payload['callerId']); // had to fetch user after
});

// AFTER
_callSocket.on('call:ringing', (data) {
  final payload = IncomingCallPayload.fromJson(data as Map<String, dynamic>);
  _showIncomingCall(
    callId: payload.callId,
    conversationId: payload.conversationId,
    callerName: payload.caller.name,
    callerAvatar: payload.caller.avatar,
    calleeIds: payload.calleeIds,
  );
  _callSocket.emit('call:join_room', {'callId': payload.callId});
});
```

---

### FCM Push — Updated data payload parsing

Incoming call and ringing cancellation pushes are **data-only** (no `notification` object). The app owns all native UI via Flutter's `CallKit` / Android ConnectionService integration.

FCM data values are all **Strings** (FCM encodes everything as string). `caller` and `calleeIds` are JSON-encoded strings.

```dart
enum CallPushType { incoming, cancelled }

class IncomingCallPushPayload {
  final String callId;
  final String conversationId;
  final CallCaller caller;
  final List<String> calleeIds;
  final String startedAt;
}

class CancelledCallPushPayload {
  final String callId;
  final String reason; // 'caller_cancelled' | 'ringing_timeout' | 'declined' | ...
}

// Parser
({CallPushType type, dynamic payload})? parseCallPush(Map<String, dynamic> data) {
  final type = data['type'] as String?;

  if (type == 'CALL_INCOMING') {
    final payload = IncomingCallPushPayload(
      callId: data['callId'] as String,
      conversationId: data['conversationId'] as String,
      caller: CallCaller.fromJson(
        jsonDecode(data['caller'] as String) as Map<String, dynamic>,
      ),
      calleeIds: List<String>.from(
        jsonDecode(data['calleeIds'] as String) as List,
      ),
      startedAt: data['startedAt'] as String,
    );
    return (type: CallPushType.incoming, payload: payload);
  }

  if (type == 'CALL_CANCELLED') {
    final payload = CancelledCallPushPayload(
      callId: data['callId'] as String,
      reason: data['reason'] as String? ?? 'unknown',
    );
    return (type: CallPushType.cancelled, payload: payload);
  }

  return null;
}
```

**Background handler (firebase_messaging):**
```dart
@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  final parsed = parseCallPush(message.data);
  if (parsed == null) return;

  if (parsed.type == CallPushType.incoming) {
    final p = parsed.payload as IncomingCallPushPayload;
    await NativeCallUi.showIncomingCall(
      callId: p.callId,
      callerName: p.caller.name,
      callerAvatar: p.caller.avatar,
    );
    return;
  }

  if (parsed.type == CallPushType.cancelled) {
    final p = parsed.payload as CancelledCallPushPayload;
    await NativeCallUi.endCall(p.callId, reason: p.reason);
  }
}
```

**APNs (iOS VoIP pushes):**
The `caller` and `calleeIds` fields in the APNs payload are already decoded objects (not JSON strings), since APNs supports nested JSON natively. Adjust your `CXProvider` / CallKit handler:

```swift
// In your Flutter PushKit handler (via method channel)
// payload["caller"] is already a dictionary — no JSON.parse needed
let caller = payload["caller"] as? [String: String]
let callerName = caller?["name"] ?? "Unknown"
let callerAvatar = caller?["avatar"] ?? ""
```

### `409 CALL_CALLEE_BUSY` — do not create local state

If `POST /calls/start` returns `409` with code `CALL_CALLEE_BUSY`:
- Close the dialing UI.
- **Do NOT** insert a local "missed call" entry into the conversation.
- The backend has already persisted a missed call and will deliver a `message:new` system message to the conversation room.

```dart
final response = await callApi.startCall(conversationId, calleeIds);

if (response.statusCode == 409) {
  final code = response.data['errorCode'];
  if (code == 'CALL_CALLEE_BUSY') {
    _dismissDialingUI();
    // System message will arrive via message:new — no local insertion needed
    return;
  }
}
```

---

## Commit 2 — System Messages for All Terminal Call States

The backend now emits a standard `message:new` event to the conversation room whenever a call reaches a terminal state. These arrive via the existing Socket.IO `message:new` handler.

### System message shape

```dart
// Part of your existing MessageModel
class MessageModel {
  // ... existing fields ...
  final String type;             // 'text' | 'image' | 'system' | ...
  final String? content;
  final MessageMetadata? metadata;
}

class MessageMetadata {
  // ... existing fields ...
  final String? systemType;      // 'system_call' for call messages
  final String? action;          // see table below
  final String? callId;
  final String? callerId;
  final String? callerName;
  final int? durationMs;
  final bool? isMissed;
  final String? reason;
}
```

### Content strings and when they appear

| `metadata.action` | `content` | Trigger |
|---|---|---|
| `CALL_MISSED_BUSY` | `Cuộc gọi nhỡ (Đường dây bận)` | Start call failed — callee was already busy |
| `CALL_MISSED` | `Cuộc gọi nhỡ` | No answer (60s timeout) **or** caller cancelled |
| `CALL_REJECTED` | `Cuộc gọi bị từ chối` | Callee explicitly declined |
| `CALL_ENDED` | `Cuộc gọi đã kết thúc • {duration}` | Call ended normally, e.g. `Cuộc gọi đã kết thúc • 5 phút 30 giây` |

Duration format (backend-formatted, no need to reformat): `{h} giờ {m} phút {s} giây`, zero parts omitted. Just render `content` directly.

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

### Rendering call system messages

In your message list widget, add a case for `type == 'system'` + `metadata?.systemType == 'system_call'`:

```dart
Widget _buildMessage(MessageModel message) {
  if (message.type == 'system') {
    if (message.metadata?.systemType == 'system_call') {
      return CallSystemMessageBubble(message: message);
    }
    return GenericSystemMessageBubble(message: message);
  }
  // ... existing cases
}

class CallSystemMessageBubble extends StatelessWidget {
  final MessageModel message;
  const CallSystemMessageBubble({required this.message});

  @override
  Widget build(BuildContext context) {
    final isMissed = message.metadata?.isMissed ?? false;
    final isRejected = message.metadata?.action == 'CALL_REJECTED';
    final icon = (isMissed || isRejected)
        ? Icons.phone_missed          // missed/rejected
        : Icons.phone_in_talk;        // ended

    return Center(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        margin: const EdgeInsets.symmetric(vertical: 4),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surfaceVariant,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16,
              color: (isMissed || isRejected) ? Colors.red : Colors.green),
            const SizedBox(width: 6),
            Text(
              message.content ?? '',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}
```

### Conversation list preview

Update your conversation list tile's subtitle builder to render call system messages correctly:

```dart
String buildPreviewText(MessageModel? lastMessage) {
  if (lastMessage == null) return '';

  if (lastMessage.type == 'system') {
    if (lastMessage.metadata?.systemType == 'system_call') {
      // content is already human-readable — use directly
      return lastMessage.content ?? '';
    }
    // other system messages (member added, role changed, etc.)
    return lastMessage.content ?? '';
  }

  // ... existing logic for text/image/video/etc.
}
```

### Push notification for missed calls

When the user is offline and misses a call, no separate "missed call" push is sent. The system message arrives in the conversation via the normal message pipeline. If you have a local notification for new messages, the `message:notify` event will fire with the call content and you can show it as a regular unread notification.

### Call UI dismissal — do not duplicate system messages

When `call:declined` or `call:ended` arrives on the call socket, dismiss the in-app call screen. **Do not** insert a local system message — the backend system message will arrive via `message:new` and be the authoritative record.

```dart
_callSocket.on('call:declined', (data) {
  _dismissCallScreen();
  // Do NOT add a local system message — backend sends one via message:new
});

_callSocket.on('call:ended', (data) {
  _dismissCallScreen();
  // Do NOT add a local system message — backend sends one via message:new
});
```

---

## Summary checklist

- [ ] Update `IncomingCallPayload` model: add `CallCaller caller`, remove `String callerId`
- [ ] Update `call:ringing` Socket.IO handler: use `payload.caller.name` and `payload.caller.avatar`
- [ ] Update FCM background handler: parse `caller` and `calleeIds` as JSON-encoded strings
- [ ] Update iOS APNs / PushKit handler: read `caller` as nested dict (no JSON decode needed)
- [ ] `POST /calls/start` 409 `CALL_CALLEE_BUSY`: dismiss dialing UI, no local state
- [ ] Add `CallSystemMessageBubble` widget for `type == 'system'` + `systemType == 'system_call'`
- [ ] Update conversation list subtitle: render call system message `content` directly
- [ ] `call:declined` / `call:ended` handlers: dismiss call screen only, no local message insertion
