# WebSocket Events — Realtime Gateway Reference

> **Chat namespace**: `wss://{host}/chat`
> **Call namespace**: `wss://{host}/call`
> Both namespaces use Socket.IO. Authentication is performed **after** connection via an `authenticate` event.

---

## Table of Contents

1. [Connection & Authentication](#1-connection--authentication)
   - [Chat Namespace — /chat](#chat-namespace--chat)
   - [Call Namespace — /call](#call-namespace--call)
2. [Chat — Client-to-Server Events](#2-chat--client-to-server-events)
   - [conversation:join](#conversationjoin)
   - [conversation:leave](#conversationleave)
   - [typing:start](#typingstart)
   - [typing:stop](#typingstop)
   - [conversation:update_seen_cursor](#conversationupdate_seen_cursor)
   - [conversation:update_delivered_cursor](#conversationupdate_delivered_cursor)
   - [message:get_status](#messageget_status)
   - [heartbeat](#heartbeat)
3. [Chat — Server-to-Client Events](#3-chat--server-to-client-events)
   - [message:new](#messagenew)
   - [message:saved](#messagesaved)
   - [message:notify](#messagenotify)
   - [message:media_ready](#messagemedia_ready)
   - [message:edited](#messageedited)
   - [message:revoked](#messagerevoked)
   - [message:deleted](#messagedeleted)
   - [message:deleted_for_me](#messagedeleted_for_me)
   - [message:reaction_updated](#messagereaction_updated)
   - [message:status](#messagestatus)
   - [typing:started](#typingstarted)
   - [typing:stopped](#typingstopped)
   - [user:online](#useronline)
   - [user:offline](#useroffline)
   - [session_revoked](#session_revoked)
   - [account:status-changed](#accountstatus-changed)
4. [Call — Client-to-Server Events](#4-call--client-to-server-events)
   - [meeting:start](#meetingstart)
   - [meeting:get_active](#meetingget_active)
   - [meeting:join](#meetingjoin)
   - [meeting:approve_waiting](#meetingapprove_waiting)
   - [meeting:reject_waiting](#meetingreject_waiting)
   - [meeting:leave](#meetingleave)
   - [meeting:end](#meetingend)
   - [meeting:media_state](#meetingmedia_state)
   - [meeting:snapshot](#meetingsnapshot)
   - [meeting:hand_raise](#meetinghand_raise)
   - [meeting:invite](#meetinginvite)
   - [meeting:moderate](#meetingmoderate)
   - [webrtc:offer](#webrtcoffer)
   - [webrtc:answer](#webrtcanswer)
   - [webrtc:ice_candidate](#webrtcice_candidate)
   - [webrtc:leave](#webrtcleave)
5. [Call — Server-to-Client Events](#5-call--server-to-client-events)
   - [meeting:updated](#meetingupdated)
   - [meeting:ended](#meetingended)
   - [meeting:participant_joined](#meetingparticipant_joined)
   - [meeting:participant_moderated](#meetingparticipant_moderated)
   - [meeting:hand_raise (broadcast)](#meetinghand_raise-broadcast)
   - [meeting:invited](#meetinginvited)
   - [meeting:kicked](#meetingkicked)
   - [meeting:moderated_you](#meetingmoderated_you)
   - [webrtc:offer (incoming)](#webrtcoffer-incoming)
   - [webrtc:answer (incoming)](#webrtcanswer-incoming)
   - [webrtc:ice_candidate (incoming)](#webrtcice_candidate-incoming)
   - [webrtc:peer_left](#webrtcpeer_left)
6. [Call — Rate Limits](#6-call--rate-limits)
7. [Client Implementation Guides](#7-client-implementation-guides)
   - [Guide 1: Fast-Ack Message Send Flow](#guide-1-fast-ack-message-send-flow)
   - [Guide 2: Cursor Tracking & Read Receipts](#guide-2-cursor-tracking--read-receipts)
   - [Guide 3: Voice / Video Call Flow](#guide-3-voice--video-call-flow)
   - [Guide 4: WebRTC P2P Connection Setup](#guide-4-webrtc-p2p-connection-setup)

---

## 1. Connection & Authentication

### Chat Namespace — /chat

```
1. socket = io('wss://{host}/chat')
2. socket.emit('authenticate', { token, platform, deviceId?, deviceType? })
3. socket.on('authenticated', ({ success, userId, socketId }) => { ... })
```

After authentication the socket is automatically placed in:
- `user:{userId}` — personal room (Tier 1 / NOTIFY)
- `user:{friendId}` — all friends' personal rooms (for presence broadcasts)

To receive real-time updates in a conversation:
```
socket.emit('conversation:join', { conversationId })
socket.on('conversation:joined', ({ conversationId, success, latestOffset }) => { ... })
```

**authenticate payload:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `token` | `string` | ✓ | Valid JWT access token |
| `platform` | `'web'\|'mobile'` | | Default: `'web'` |
| `deviceId` | `string` | | Device identifier |
| `deviceType` | `string` | | Fallback platform hint if `platform` not set |

**authenticated response:**
```typescript
{
  success: true;
  userId: string;
  socketId: string;
}
```

**Auth timeout:** if `authenticate` is not sent within the configured timeout, the connection is automatically closed.

**Per-platform soft-limit:** max 1 web socket + 1 mobile socket per user per Keycloak session. If exceeded, the oldest socket for that platform/session is kicked with `session_revoked`.

---

### Call Namespace — /call

```
1. callSocket = io('wss://{host}/call')
2. callSocket.emit('authenticate', { token })
3. callSocket.on('authenticated', ({ success, userId, socketId }) => { ... })
```

After authentication the socket joins `user:{userId}` (personal room) to receive meeting invitations.

**authenticate payload:**

| Field | Type | Required |
|---|---|---|
| `token` | `string` | ✓ |

---

## 2. Chat — Client-to-Server Events

All events in this section require a prior successful `authenticate` call. All are guarded by `WsKeycloakGuard`.

---

### conversation:join

Join the stream room for a conversation. **Auto-updates the seen cursor** to `maxOffset` on join.

```typescript
socket.emit('conversation:join', {
  conversationId: 'conv-uuid'
});
```

**ACK / response event: `conversation:joined`**
```typescript
{
  conversationId: string;
  success: true;
  latestOffset: number;    // Current max offset — use to mark as seen immediately
}
// or on failure:
{
  success: false;
  error: string;           // e.g. "NOT_MEMBER"
}
```

> After joining, immediately emit `conversation:update_seen_cursor` with `upToOffset: latestOffset` to mark all current messages as read.

---

### conversation:leave

Leave a conversation's stream room.

```typescript
socket.emit('conversation:leave', { conversationId: 'conv-uuid' });
```

No response event.

---

### typing:start

Signal that the current user started typing. Disabled for `COMMUNITY` conversations (scale optimization).

```typescript
socket.emit('typing:start', { conversationId: 'conv-uuid' });
```

No response event. Broadcasts `typing:started` to others in `conversation:{id}`.

---

### typing:stop

Signal that the current user stopped typing.

```typescript
socket.emit('typing:stop', { conversationId: 'conv-uuid' });
```

No response event. Broadcasts `typing:stopped` to others.

---

### conversation:update_seen_cursor

Mark all messages up to `upToOffset` as **seen** by the current user. Fire-and-forget — ACK is immediate.

```typescript
socket.emit('conversation:update_seen_cursor', {
  conversationId: 'conv-uuid',
  upToOffset: 42
});
```

**ACK event: `cursor:seen_updated`**
```typescript
{
  conversationId: string;
  upToOffset: number;
  status: 'processing';    // Actual write is async (OffsetSyncJob every 5s)
}
```

---

### conversation:update_delivered_cursor

Mark messages up to `upToOffset` as **delivered** (device received them). Call this when messages are fetched or received while the conversation is in the background.

```typescript
socket.emit('conversation:update_delivered_cursor', {
  conversationId: 'conv-uuid',
  upToOffset: 42
});
```

**ACK event: `cursor:delivered_updated`**
```typescript
{
  conversationId: string;
  upToOffset: number;
  status: 'processing';
}
```

---

### message:get_status

Get the read/delivery status of a specific message on-demand (e.g. when user long-presses a message for status display).

```typescript
socket.emit('message:get_status', { messageId: 'msg-uuid' });
```

**ACK event: `message:status`**
```typescript
{
  messageId: string;
  status: 'sending' | 'sent' | 'delivered' | 'read';
  seenByCount: number;
  deliveredToCount: number;
}
```

---

### heartbeat

Keep-alive ping. Also refreshes the `USER_SOCKETS` TTL in Redis to prevent premature expiration.

```typescript
socket.emit('heartbeat');
```

**ACK event: `heartbeat:ack`**
```typescript
{
  timestamp: string;    // ISO datetime
}
```

Send this every **30–60 seconds** while connected.

---

## 3. Chat — Server-to-Client Events

### message:new

**Tier 2 — STREAM** · Target: `conversation:{id}` room (must join via `conversation:join`).

Emitted when a new message is persisted and ready for display. Includes full message content.

```typescript
socket.on('message:new', (payload: {
  messageId: string;           // Server-assigned UUID
  clientMessageId?: string;    // Echo of client's dedup ID
  conversationId: string;
  senderId: string;
  sender?: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
  offset: number;              // Sequential message number within conversation
  type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'sticker' | 'media';
  content?: string;            // Text content; null for media-only messages
  replyToId?: string;          // ID of the message being replied to
  createdAt: string;           // ISO timestamp
  metadata?: Record<string, any>;

  // Present for media messages (image/video/audio/file)
  attachments?: Array<{
    mediaId: string;           // Use with GET /media/:mediaId/url to get download URL
    kind: 'image' | 'video' | 'audio' | 'file';
    status: 'PROCESSING' | 'READY';
    mimeType?: string;
    fileName?: string;
    sizeBytes?: number;
    meta?: {
      width?: number;
      height?: number;
      durationMs?: number;
    };
  }>;

  // Present for forwarded messages
  forwardedFrom?: {
    messageId: string;
    conversationId?: string;
    senderId?: string;
    forwardedAt?: string;
    snapshot?: {
      text?: string;           // Preview (up to 80 chars)
      type: string;
      thumbUrl?: string;
    };
  };
}) => { ... });
```

**FE behavior per message type:**

| Type | On `message:new` | On play/view | After `message:media_ready` |
|---|---|---|---|
| `text` | Render `content` directly | — | — |
| `image` | Show skeleton; fetch `GET /media/:mediaId/url?prefer=ORIGINAL` | — | Switch to optimized: fetch `prefer=OPTIMIZED` |
| `video` | Show placeholder + metadata; render filename/size | User taps → fetch `prefer=OPTIMIZED`, stream | Fetch poster from `prefer=OPTIMIZED` variant |
| `audio` | Render waveform from `metadata.waveform`, duration; show play button | User taps → fetch URL, play | — (no server processing for audio) |
| `file` | File card: icon + `fileName` + `sizeBytes` + `mimeType` | User taps → fetch URL, download | — |
| `sticker` | Render `metadata.stickerId` from package `metadata.packageId` | — | — |

> **Sender optimization:** The sender already has the file in local memory from the upload. Render from local `blob:` URL directly — do not fetch from server.

---

### message:saved

**Tier 1 — NOTIFY** · Target: sender's personal room `user:{senderId}`.

Delivery confirmation for the sender. Indicates the message has been persisted to the database.

```typescript
socket.on('message:saved', (payload: {
  messageId: string;
  conversationId: string;
  offset: number;
}) => { ... });
```

**FE behavior:** update the message's local state from "sending" (⏳) to "sent" (✓✓). Store `offset` for cursor tracking.

---

### message:notify

**Tier 1 — NOTIFY** · Target: all members' personal rooms `user:{memberId}`.

Lightweight notification — sent to all conversation members including those not currently viewing the conversation. Contains only metadata (no message content).

```typescript
socket.on('message:notify', (payload: {
  conversationId: string;
  messageId: string;
  senderId: string;
  type: string;
  offset: number;
  createdAt: string;
}) => { ... });
```

**FE behavior:** increment unread badge for this conversation if not currently open. The notification contains no content — call `GET /conversations/:id/messages` if needed.

---

### message:media_ready

**Target**: personal room `user:{ownerId}` and the conversation room.

Emitted when async media processing (thumbnail generation, transcoding) is complete.

```typescript
socket.on('message:media_ready', (payload: {
  messageId: string;
  conversationId: string;
  mediaId: string;
  status: 'READY';
  variants?: {
    thumb?: string;       // Presigned thumbnail URL
    original?: string;   // Presigned original URL
  };
}) => { ... });
```

**FE behavior:** replace the processing placeholder with the final rendered media. Fetch `GET /media/:mediaId/url?prefer=OPTIMIZED` to get a fresh presigned URL if not included in `variants`.

---

### message:edited

**Tier 2 — STREAM** · Target: `conversation:{id}` room.

Emitted when a message is edited.

```typescript
socket.on('message:edited', (payload: {
  messageId: string;
  conversationId: string;
  content: string;
  editedAt: string;
  editedBy: string;
}) => { ... });
```

**FE behavior:** find the message by `messageId`, update `content`, add an "edited" indicator.

---

### message:revoked

**Tier 2 — STREAM** · Target: `conversation:{id}` room.

Emitted when a message is revoked (tombstoned).

```typescript
socket.on('message:revoked', (payload: {
  messageId: string;
  conversationId: string;
  revokedAt: string;
  revokedBy: string;
}) => { ... });
```

**FE behavior:** replace the message content with "Message has been recalled" placeholder. Remove attachments/reactions from the UI.

---

### message:deleted

**Tier 2 — STREAM** · Target: `conversation:{id}` room.

Emitted when a message is soft-deleted by its sender or a conversation admin.

```typescript
socket.on('message:deleted', (payload: {
  messageId: string;
  conversationId: string;
  deletedAt: string;
  deletedBy: string;
}) => { ... });
```

**FE behavior:** remove the message from the conversation view for all members.

---

### message:deleted_for_me

**Target**: personal room `user:{userId}`.

Emitted only to the user who triggered "delete for me" on a message.

```typescript
socket.on('message:deleted_for_me', (payload: {
  messageId: string;
  conversationId: string;
}) => { ... });
```

**FE behavior:** hide the message from this user's view only.

---

### message:reaction_updated

**Tier 2 — STREAM** · Target: `conversation:{id}` room (broadcast via Redis Pub/Sub → ReactionPubSubService).

Emitted after any reaction add/remove. Contains the authoritative reaction state from Redis.

```typescript
socket.on('message:reaction_updated', (payload: {
  messageId: string;
  conversationId: string;
  reactions: {
    [emoji: string]: {
      count: number;
      reactors: string[];      // User IDs who added this reaction
      myReaction: boolean;     // Whether the receiving user has this reaction
    }
  };
}) => { ... });
```

**FE behavior:** replace the entire `reactions` map on the corresponding message with the server-authoritative value. This supersedes any optimistic update.

---

### message:status

**Response to `message:get_status`** · Target: requesting socket only.

```typescript
socket.on('message:status', (payload: {
  messageId: string;
  status: 'sending' | 'sent' | 'delivered' | 'read';
  seenByCount: number;
  deliveredToCount: number;
}) => { ... });
```

---

### typing:started

**Tier 2 — STREAM** · Target: `conversation:{id}` room.

```typescript
socket.on('typing:started', (payload: {
  conversationId: string;
  userId: string;
  username: string;
}) => { ... });
```

**FE behavior:** show "{username} is typing..." indicator. Auto-hide after ~3 s if no `typing:stopped` arrives.

---

### typing:stopped

**Tier 2 — STREAM** · Target: `conversation:{id}` room.

```typescript
socket.on('typing:stopped', (payload: {
  conversationId: string;
  userId: string;
}) => { ... });
```

**FE behavior:** remove the typing indicator for `userId`.

---

### user:online

**Target**: all friends' personal rooms (O(M) fan-out where M = number of friends).

```typescript
socket.on('user:online', (payload: {
  userId: string;
  timestamp: string;
}) => { ... });
```

**FE behavior:** update the friend's status to online (green dot). No need to call `GET /presence/friends`.

---

### user:offline

**Target**: all friends' personal rooms.

```typescript
socket.on('user:offline', (payload: {
  userId: string;
  lastSeen: string;    // ISO timestamp
}) => { ... });
```

**FE behavior:** update the friend's status to offline, display `lastSeen`.

---

### session_revoked

**Target**: personal room `user:{userId}` (or direct to the specific socket being revoked).

Emitted when the user's session on the current platform is revoked (e.g. by login from another device, explicit logout, or admin deactivation).

```typescript
socket.on('session_revoked', (payload: {
  reason: 'new_login' | 'explicit_logout' | 'admin_action';
  platform: 'web' | 'mobile';
}) => { ... });
```

**FE behavior:** immediately disconnect the socket, clear local auth state, redirect to login page, and show a message like "You've been signed out because you logged in on another device."

---

### account:status-changed

**Target**: personal room `user:{userId}`.

Emitted when an admin deactivates the user's account.

```typescript
socket.on('account:status-changed', (payload: {
  userId: string;
  status: 'INACTIVE' | 'ACTIVE';
  reason?: string;
}) => { ... });
```

**FE behavior:** if `status === 'INACTIVE'`, disconnect socket, clear auth state, and display "Your account has been deactivated."

---

## 4. Call — Client-to-Server Events

All Call namespace events require `authenticate` first. All are guarded by `WsKeycloakGuard`.

---

### meeting:start

Start a new meeting for a conversation. The caller becomes the **host**.

```typescript
callSocket.emit('meeting:start', {
  conversationId: 'conv-uuid',
  allowWaitingRoom: false    // Optional: enable waiting room
});
```

**ACK event: `meeting:started`**
```typescript
{ event: 'meeting:started', data: Meeting }
```

Side effects: all meeting members receive `meeting:updated` broadcast.

---

### meeting:get_active

Get the active meeting for a conversation (if any).

```typescript
callSocket.emit('meeting:get_active', { conversationId: 'conv-uuid' });
```

**ACK event: `meeting:active`**
```typescript
{ event: 'meeting:active', data: Meeting | null }
```

---

### meeting:join

Request to join a meeting. If a waiting room is enabled, the request may go to `meeting:waiting` state until the host approves.

```typescript
callSocket.emit('meeting:join', { meetingId: 'meeting-uuid' });
```

**ACK event: `meeting:joined` or `meeting:waiting`**
```typescript
// Joined immediately:
{ event: 'meeting:joined', data: Meeting }

// Waiting for host approval:
{ event: 'meeting:waiting', data: Meeting }
```

Side effects on join: `meeting:participant_joined` is broadcast to the meeting room.

---

### meeting:approve_waiting

Host approves a waiting participant.

```typescript
callSocket.emit('meeting:approve_waiting', {
  meetingId: 'meeting-uuid',
  userId: 'waiting-user-id'
});
```

**ACK event: `meeting:waiting_approved`**

Side effects: `meeting:updated` broadcast to meeting room.

---

### meeting:reject_waiting

Host rejects a waiting participant.

```typescript
callSocket.emit('meeting:reject_waiting', {
  meetingId: 'meeting-uuid',
  userId: 'waiting-user-id',
  reason: 'optional reason'    // optional
});
```

**ACK event: `meeting:waiting_rejected`**

---

### meeting:leave

Leave the current meeting.

```typescript
callSocket.emit('meeting:leave', { meetingId: 'meeting-uuid' });
```

**ACK event: `meeting:left`**
```typescript
{ event: 'meeting:left', data: Meeting }
```

Side effects: `meeting:updated` broadcast to meeting room.

---

### meeting:end

End the meeting (host only).

```typescript
callSocket.emit('meeting:end', { meetingId: 'meeting-uuid' });
```

**ACK event: `meeting:ended`**

Side effects: `meeting:ended` broadcast to all meeting participants.

---

### meeting:media_state

Update the current user's media state (mic, camera, screen share).

```typescript
callSocket.emit('meeting:media_state', {
  meetingId: 'meeting-uuid',
  micOn: true,
  cameraOn: false,
  screenSharing: false
});
```

**ACK event: `meeting:media_updated`**
```typescript
{ event: 'meeting:media_updated', data: Meeting }
```

> Side effects: if `CALL_WS_LOCAL_MEDIA_SNAPSHOT_FANOUT=true` (env), `meeting:updated` is also broadcast to the meeting room.

---

### meeting:snapshot

Get the current meeting state (participant list, media states, status). Also re-joins the meeting room if the caller is an active participant.

```typescript
callSocket.emit('meeting:snapshot', { meetingId: 'meeting-uuid' });
```

**ACK event: `meeting:snapshot`**
```typescript
{
  event: 'meeting:snapshot',
  data: {
    meeting: Meeting;
    participants: Participant[];
  }
}
```

Use this on reconnect or when rejoining an active call.

---

### meeting:hand_raise

Raise or lower hand in a meeting.

```typescript
callSocket.emit('meeting:hand_raise', {
  meetingId: 'meeting-uuid',
  raised: true    // false to lower
});
```

**ACK event: `meeting:hand_raise_ack`**

Side effects: `meeting:hand_raise` is broadcast to the entire meeting room.

---

### meeting:invite

Invite another user to join the current meeting. The target receives a `meeting:invited` event in their personal room.

```typescript
callSocket.emit('meeting:invite', {
  meetingId: 'meeting-uuid',
  toUserId: 'target-user-id',
  message: 'Join our call!'    // optional
});
```

**ACK event: `meeting:invite_sent`**
```typescript
{
  event: 'meeting:invite_sent',
  data: { meetingId, toUserId, sentAt }
}
```

Constraints: caller must be in the meeting; cannot invite themselves.

---

### meeting:moderate

Host/co-host action to moderate a participant (mute, disable camera/screen, or kick).

```typescript
callSocket.emit('meeting:moderate', {
  meetingId: 'meeting-uuid',
  targetUserId: 'target-user-id',
  action: 'MUTE_AUDIO',    // 'MUTE_AUDIO' | 'MUTE_VIDEO' | 'DISABLE_SCREEN' | 'KICK'
  reason: 'optional'
});
```

**ACK event: `meeting:moderate_applied`**

Side effects:
- `meeting:participant_moderated` broadcast to meeting room
- For `KICK`: `meeting:kicked` sent to target's personal room
- For `MUTE_*`/`DISABLE_*`: `meeting:moderated_you` sent to target's personal room

---

### webrtc:offer

Send a WebRTC offer to another participant. Relayed via the server through the target's personal room.

```typescript
callSocket.emit('webrtc:offer', {
  meetingId: 'meeting-uuid',
  toUserId: 'peer-user-id',
  offer: RTCSessionDescriptionInit    // { type: 'offer', sdp: '...' }
});
```

**ACK event: `webrtc:offer_sent`**

Constraints: payload size limit enforced (rejects oversized SDPs). Caller must be in the meeting.

---

### webrtc:answer

Send a WebRTC answer back to the initiating peer.

```typescript
callSocket.emit('webrtc:answer', {
  meetingId: 'meeting-uuid',
  toUserId: 'peer-user-id',
  answer: RTCSessionDescriptionInit    // { type: 'answer', sdp: '...' }
});
```

**ACK event: `webrtc:answer_sent`**

---

### webrtc:ice_candidate

Send an ICE candidate to a peer during connection negotiation.

```typescript
callSocket.emit('webrtc:ice_candidate', {
  meetingId: 'meeting-uuid',
  toUserId: 'peer-user-id',
  candidate: RTCIceCandidateInit
});
```

**ACK event: `webrtc:ice_sent`**

Rate limit: 300 ICE events per 10 s window.

---

### webrtc:leave

Signal P2P departure to a specific peer (before closing the peer connection).

```typescript
callSocket.emit('webrtc:leave', {
  meetingId: 'meeting-uuid',
  toUserId: 'peer-user-id'
});
```

**ACK event: `webrtc:left`**

Side effects: `webrtc:peer_left` is sent to `toUserId`'s personal room.

---

## 5. Call — Server-to-Client Events

### meeting:updated

**Target**: `meeting:{meetingId}` room.

Broadcast after any meeting state change (join, leave, media state update, waiting room actions).

```typescript
callSocket.on('meeting:updated', (meeting: Meeting) => { ... });
```

Use this to re-render the participant grid, media state icons, and meeting status.

---

### meeting:ended

**Target**: `meeting:{meetingId}` room.

Broadcast when the host calls `meeting:end`.

```typescript
callSocket.on('meeting:ended', (meeting: Meeting) => { ... });
```

**FE behavior:** show "Meeting has ended" modal, disconnect from meeting room, stop all local media tracks.

---

### meeting:participant_joined

**Target**: `meeting:{meetingId}` room.

Broadcast when a new participant successfully joins.

```typescript
callSocket.on('meeting:participant_joined', (payload: {
  meetingId: string;
  userId: string;
}) => { ... });
```

**FE behavior:** add the participant to the grid, initiate WebRTC offer to the new peer (if mesh topology).

---

### meeting:participant_moderated

**Target**: `meeting:{meetingId}` room.

Broadcast when a participant is moderated by the host.

```typescript
callSocket.on('meeting:participant_moderated', (payload: {
  meetingId: string;
  targetUserId: string;
  action: 'MUTE_AUDIO' | 'MUTE_VIDEO' | 'DISABLE_SCREEN' | 'KICK';
  appliedAt: string;
}) => { ... });
```

**FE behavior:** update the participant's media state indicators in the UI.

---

### meeting:hand_raise (broadcast)

**Target**: `meeting:{meetingId}` room.

Broadcast when a participant raises or lowers their hand.

```typescript
callSocket.on('meeting:hand_raise', (payload: {
  meetingId: string;
  userId: string;
  raised: boolean;
  raisedAt: string;
}) => { ... });
```

---

### meeting:invited

**Target**: invitee's personal room `user:{toUserId}`.

Delivered when another meeting participant sends an invitation.

```typescript
callSocket.on('meeting:invited', (payload: {
  meetingId: string;
  fromUserId: string;
  message: string | null;
  sentAt: string;
}) => { ... });
```

**FE behavior:** show an incoming call / meeting invitation banner. Offer "Join" and "Decline" actions. Joining: emit `meeting:join { meetingId }`.

---

### meeting:kicked

**Target**: kicked user's personal room `user:{targetUserId}`.

```typescript
callSocket.on('meeting:kicked', (payload: {
  meetingId: string;
  moderatorId: string;
  reason?: string;
}) => { ... });
```

**FE behavior:** stop local media tracks, leave the meeting room, show "You were removed from the meeting" message.

---

### meeting:moderated_you

**Target**: moderated user's personal room `user:{targetUserId}`.

Sent for `MUTE_AUDIO`, `MUTE_VIDEO`, `DISABLE_SCREEN` actions so the client can immediately stop the local media track.

```typescript
callSocket.on('meeting:moderated_you', (payload: {
  meetingId: string;
  action: 'MUTE_AUDIO' | 'MUTE_VIDEO' | 'DISABLE_SCREEN';
  reason?: string;
}) => { ... });
```

**FE behavior:** immediately stop the relevant local track (mic.stop(), camera.stop(), screenShare.stop()). Update UI to show muted state.

---

### webrtc:offer (incoming)

**Target**: `toUserId`'s personal room — relayed by server.

```typescript
callSocket.on('webrtc:offer', (payload: {
  meetingId: string;
  fromUserId: string;
  offer: RTCSessionDescriptionInit;
}) => { ... });
```

**FE behavior:** call `pc.setRemoteDescription(offer)`, create an answer, emit `webrtc:answer`.

---

### webrtc:answer (incoming)

**Target**: `toUserId`'s personal room.

```typescript
callSocket.on('webrtc:answer', (payload: {
  meetingId: string;
  fromUserId: string;
  answer: RTCSessionDescriptionInit;
}) => { ... });
```

**FE behavior:** call `pc.setRemoteDescription(answer)`.

---

### webrtc:ice_candidate (incoming)

**Target**: `toUserId`'s personal room.

```typescript
callSocket.on('webrtc:ice_candidate', (payload: {
  meetingId: string;
  fromUserId: string;
  candidate: RTCIceCandidateInit;
}) => { ... });
```

**FE behavior:** call `pc.addIceCandidate(candidate)`.

---

### webrtc:peer_left

**Target**: `toUserId`'s personal room.

Sent when a peer calls `webrtc:leave` before closing their connection.

```typescript
callSocket.on('webrtc:peer_left', (payload: {
  meetingId: string;
  fromUserId: string;
}) => { ... });
```

**FE behavior:** close the `RTCPeerConnection` for `fromUserId`, remove their video tile from the UI.

---

## 6. Call — Rate Limits

The Call gateway enforces per-client sliding-window rate limits to prevent abuse:

| Event(s) | Window | Max events |
|---|---|---|
| `meeting:start`, `meeting:join`, `meeting:leave`, `meeting:end`, `meeting:snapshot`, `meeting:hand_raise`, `meeting:approve_waiting`, `meeting:reject_waiting`, `meeting:invite`, `meeting:moderate` | 10 s | 20 |
| `meeting:media_state` | 10 s | 40 |
| `webrtc:offer`, `webrtc:answer` | 10 s | 60 |
| `webrtc:ice_candidate` | 10 s | 300 |
| `webrtc:leave` | 10 s | 30 |

When a limit is exceeded the server returns:
```typescript
{ event: '<eventName>', data: { throttled: true, retryAfterMs: number } }
```

---

## 7. Client Implementation Guides

---

### Guide 1: Fast-Ack Message Send Flow

See the HTTP API Reference [Guide 1](../API_REFERENCE.md#guide-1-fast-ack-message-send-flow) for the full flow. From the WebSocket perspective:

```
POST /chat/messages  →  201 { messageId, status: 'accepted' }
                                     │
               WS message:saved ◄────┘   (sender's user room — persistence confirmed)
               WS message:new  ◄──────── (conversation room — full payload for all viewers)
               WS message:notify ◄─────  (user rooms — lightweight notification for all members)
```

**WS event timeline for recipient:**

1. **`message:notify`** arrives in personal room — increment unread badge if conversation is in background.
2. **`message:new`** arrives in conversation room (if joined) — render the message immediately.
3. **After render** — emit `conversation:update_delivered_cursor` (background) or `conversation:update_seen_cursor` (foreground).

---

### Guide 2: Cursor Tracking & Read Receipts

See the HTTP API Reference [Guide 4](../API_REFERENCE.md#guide-4-cursor-tracking--read-receipts) for the complete state machine. Key WebSocket events:

| WS Event | Direction | When to emit |
|---|---|---|
| `conversation:join` | Client→Server | When user opens a conversation |
| `conversation:leave` | Client→Server | When user closes a conversation |
| `conversation:update_seen_cursor` | Client→Server | When conversation is open and new messages arrive |
| `conversation:update_delivered_cursor` | Client→Server | When messages arrive while conversation is in background |
| `cursor:seen_updated` | Server→Client | ACK of seen cursor update |
| `cursor:delivered_updated` | Server→Client | ACK of delivered cursor update |

**Connection:join auto-update:** `conversation:join` automatically updates the seen cursor to `latestOffset`. This means opening a conversation marks all current messages as read without requiring a separate cursor event.

---

### Guide 3: Voice / Video Call Flow

Complete lifecycle for a peer-to-peer voice/video call through the Call namespace.

```
Host                          Server                         Participant
 │                               │                               │
 ├─ meeting:start ──────────────►│                               │
 │◄─ meeting:started ────────────┤                               │
 │                               │──── meeting:invited ─────────►│
 │                               │                               │
 │                               │◄──── meeting:join ────────────┤
 │                               │──── meeting:joined ──────────►│
 │                               │                               │
 │◄─────────────── meeting:participant_joined (room broadcast) ──┤
 │                               │                               │
 │──── webrtc:offer ────────────►│──── webrtc:offer ────────────►│
 │                               │                               │
 │◄──── webrtc:answer ───────────┤◄──── webrtc:answer ───────────┤
 │                               │                               │
 │──── webrtc:ice_candidate ────►│──── webrtc:ice_candidate ────►│ (repeated)
 │◄─── webrtc:ice_candidate ─────┤◄─── webrtc:ice_candidate ─────┤ (repeated)
 │                               │                               │
 │         [ Connected: P2P media flowing ]                      │
 │                               │                               │
 │──── meeting:end ─────────────►│                               │
 │                               │──────── meeting:ended (room broadcast) ──────►│
 │◄─ meeting:ended ──────────────┤                               │
```

**Step-by-step:**

1. **Connect to Call namespace** and `authenticate`.
2. **Host starts meeting** — emit `meeting:start { conversationId }`. Save `meetingId` from response.
3. **Invite participants** — emit `meeting:invite { meetingId, toUserId }` for each participant.
4. **Participants join** — on receiving `meeting:invited`, show call banner. On "Accept": emit `meeting:join { meetingId }`.
5. **On `meeting:participant_joined`** — initiate WebRTC handshake (see Guide 4).
6. **Media state** — emit `meeting:media_state` whenever mic/camera/screen changes.
7. **End call** — host emits `meeting:end { meetingId }`. All participants receive `meeting:ended`.
8. **Cleanup** — on `meeting:ended` or `meeting:kicked`: stop all local tracks, close all `RTCPeerConnection` objects.

---

### Guide 4: WebRTC P2P Connection Setup

The server acts as a **signaling relay** only. Actual media flows peer-to-peer.

```
Peer A (new joiner)             Server              Peer B (existing member)
    │                              │                        │
    │── (joins meeting) ──────────►│                        │
    │                              │── meeting:participant_joined ──►│
    │                              │                        │
    │                              │◄─ webrtc:offer ────────┤  (B initiates offer to A)
    │◄─ webrtc:offer ──────────────┤                        │
    │                              │                        │
    │─ webrtc:answer ─────────────►│─ webrtc:answer ───────►│
    │                              │                        │
    │─ webrtc:ice_candidate ──────►│─ webrtc:ice_candidate ►│ (repeated until connected)
    │◄─ webrtc:ice_candidate ──────┤◄─ webrtc:ice_candidate ┤ (repeated)
    │                              │                        │
    │     ════════ P2P media stream (direct) ════════       │
```

**Implementation (existing member — Peer B — initiates offer to new joiner Peer A):**

```javascript
callSocket.on('meeting:participant_joined', async ({ userId: newUserId }) => {
  // Create a new RTCPeerConnection for each peer
  const pc = new RTCPeerConnection(iceConfig);
  peerConnections.set(newUserId, pc);

  // Add local tracks
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  // Collect ICE candidates
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      callSocket.emit('webrtc:ice_candidate', {
        meetingId,
        toUserId: newUserId,
        candidate: candidate.toJSON()
      });
    }
  };

  // Render remote stream
  pc.ontrack = ({ streams }) => {
    renderRemoteVideo(newUserId, streams[0]);
  };

  // Create and send offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  callSocket.emit('webrtc:offer', { meetingId, toUserId: newUserId, offer });
});

// New joiner (Peer A) handles incoming offer
callSocket.on('webrtc:offer', async ({ fromUserId, offer }) => {
  const pc = new RTCPeerConnection(iceConfig);
  peerConnections.set(fromUserId, pc);

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      callSocket.emit('webrtc:ice_candidate', { meetingId, toUserId: fromUserId, candidate: candidate.toJSON() });
    }
  };
  pc.ontrack = ({ streams }) => renderRemoteVideo(fromUserId, streams[0]);

  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  callSocket.emit('webrtc:answer', { meetingId, toUserId: fromUserId, answer });
});

// Handle answer
callSocket.on('webrtc:answer', async ({ fromUserId, answer }) => {
  const pc = peerConnections.get(fromUserId);
  if (pc) await pc.setRemoteDescription(answer);
});

// Handle ICE candidates
callSocket.on('webrtc:ice_candidate', async ({ fromUserId, candidate }) => {
  const pc = peerConnections.get(fromUserId);
  if (pc) await pc.addIceCandidate(candidate);
});

// Peer disconnected
callSocket.on('webrtc:peer_left', ({ fromUserId }) => {
  const pc = peerConnections.get(fromUserId);
  if (pc) { pc.close(); peerConnections.delete(fromUserId); }
  removeRemoteVideo(fromUserId);
});
```

**Moderation response:**
```javascript
callSocket.on('meeting:moderated_you', ({ action }) => {
  if (action === 'MUTE_AUDIO') localStream.getAudioTracks().forEach(t => t.enabled = false);
  if (action === 'MUTE_VIDEO') localStream.getVideoTracks().forEach(t => t.enabled = false);
  if (action === 'DISABLE_SCREEN') screenShareStream?.getTracks().forEach(t => t.stop());
});
```
