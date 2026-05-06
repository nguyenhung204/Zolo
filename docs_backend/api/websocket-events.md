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
   - [message:pinned](#messagepinned)
   - [message:unpinned](#messageunpinned)
   - [message:reaction_updated](#messagereaction_updated)
   - [message:status](#messagestatus)
   - [typing:started](#typingstarted)
   - [typing:stopped](#typingstopped)
   - [user:online](#useronline)
   - [user:offline](#useroffline)
   - [session_revoked](#session_revoked)
   - [account:status-changed](#accountstatus-changed)
4. [Call — Client-to-Server Events](#4-call--client-to-server-events)
   - [call:accept](#callaccept)
   - [call:decline](#calldecline)
   - [call:end](#callend)
   - [call:join_room](#calljoin_room)
   - [call:leave_room](#callleave_room)
5. [Call — Server-to-Client Events](#5-call--server-to-client-events)
   - [call:ringing](#callringing)
   - [call:accepted](#callaccepted)
   - [call:declined](#calldeclined)
   - [call:ended](#callended)
6. [Call — Rate Limits](#6-call--rate-limits)
7. [Client Implementation Guides](#7-client-implementation-guides)
   - [Guide 1: Fast-Ack Message Send Flow](#guide-1-fast-ack-message-send-flow)
   - [Guide 2: Cursor Tracking & Read Receipts](#guide-2-cursor-tracking--read-receipts)
   - [Guide 3: Instant Call Flow (Zalo/Messenger style)](#guide-3-instant-call-flow-zalomessenger-style)

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

| Field        | Type              | Required | Notes                                        |
| ------------ | ----------------- | -------- | -------------------------------------------- |
| `token`      | `string`          | ✓        | Valid JWT access token                       |
| `platform`   | `'web'\|'mobile'` |          | Default: `'web'`                             |
| `deviceId`   | `string`          |          | Device identifier                            |
| `deviceType` | `string`          |          | Fallback platform hint if `platform` not set |

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

After authentication the socket joins `user:{userId}` (personal room) to receive **incoming call notifications** (`call:ringing`).

**authenticate payload:**

| Field   | Type     | Required |
| ------- | -------- | -------- |
| `token` | `string` | ✓        |

---

## 2. Chat — Client-to-Server Events

All events in this section require a prior successful `authenticate` call. All are guarded by `WsKeycloakGuard`.

---

### conversation:join

Join the stream room for a conversation. **Auto-updates the seen cursor** to `maxOffset` on join.

```typescript
socket.emit('conversation:join', {
  conversationId: 'conv-uuid',
});
```

**ACK / response event: `conversation:joined`**

```typescript
{
  conversationId: string;
  success: true;
  latestOffset: number; // Current max offset — use to mark as seen immediately
}
// or on failure:
{
  success: false;
  error: string; // e.g. "NOT_MEMBER"
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

Signal that the current user started typing. Disabled for `ANNOUNCEMENT` conversations (scale optimization).

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
  upToOffset: 42,
});
```

**ACK event: `cursor:seen_updated`**

```typescript
{
  conversationId: string;
  upToOffset: number;
  status: 'processing'; // Actual write is async (OffsetSyncJob every 5s)
}
```

---

### conversation:update_delivered_cursor

Mark messages up to `upToOffset` as **delivered** (device received them). Call this when messages are fetched or received while the conversation is in the background.

```typescript
socket.emit('conversation:update_delivered_cursor', {
  conversationId: 'conv-uuid',
  upToOffset: 42,
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
  timestamp: string; // ISO datetime
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
  offset: number;              // Sequential message number within conversation
  type: 'text' | 'image' | 'video' | 'audio' | 'file' | 'sticker' | 'media';
  content?: string;            // Text content; empty string for media-only messages
  replyToId?: string;          // ID of the message being replied to
  createdAt: string;           // ISO timestamp
  metadata?: Record<string, any>;
  mentions?: string[];         // User IDs mentioned in this message

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

> The gateway emits `senderId` but does not embed a richer sender profile in `message:new`. Resolve sender display data separately if the UI needs it.

**FE behavior per message type:**

| Type      | On `message:new`                                                     | On play/view                                 | After `message:media_ready`                   |
| --------- | -------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------- |
| `text`    | Render `content` directly                                            | —                                            | —                                             |
| `image`   | Show skeleton; fetch `GET /media/:mediaId/url?prefer=ORIGINAL`       | —                                            | Switch to optimized: fetch `prefer=OPTIMIZED` |
| `video`   | Show placeholder + metadata; render filename/size                    | User taps → fetch `prefer=OPTIMIZED`, stream | Fetch poster from `prefer=OPTIMIZED` variant  |
| `audio`   | Render waveform from `metadata.waveform`, duration; show play button | User taps → fetch URL, play                  | — (no server processing for audio)            |
| `file`    | File card: icon + `fileName` + `sizeBytes` + `mimeType`              | User taps → fetch URL, download              | —                                             |
| `sticker` | Render `metadata.stickerId` from package `metadata.packageId`        | —                                            | —                                             |

> **Sender optimization:** The sender already has the file in local memory from the upload. Render from local `blob:` URL directly — do not fetch from server.

---

### message:saved

**Tier 1 — NOTIFY** · Target: sender's own sockets only.

Delivery confirmation for the sender. Indicates the message has been persisted to the database.

```typescript
socket.on('message:saved', (payload: {
  messageId: string;
  conversationId: string;
  offset: number;
}) => { ... });
```

**FE behavior:** update the message's local state from "sending" (⏳) to "sent" (✓✓). Store `offset` for cursor tracking. This event is delivered only to the sender's own sockets, not the shared `user:{senderId}` room.

---

### message:notify

**Tier 1 — NOTIFY** · Target: all members' personal rooms `user:{memberId}`.

Lightweight notification — sent to all conversation members except the sender. Includes preview metadata so the client can update unread badges and list previews without fetching the full thread immediately.

```typescript
socket.on('message:notify', (payload: {
  conversationId: string;
  latestOffset: number;
  senderName?: string;
  content?: string;
  type?: string;
  mentions?: string[];         // FE can check mentions.includes(currentUserId)
  conversationName?: string;
}) => { ... });
```

**FE behavior:** increment unread badge for this conversation if not currently open. If `mentions` includes the current user, show a mention badge/highlight. Use `senderName` + `content` + `type` for preview text; call `GET /conversations/:id/messages` if the UI needs the full message list or exact attachments.

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

### message:pinned

**Tier 2 — STREAM** · Target: `conversation:{id}` room.

Emitted after a pin is persisted in `message-store`. This event is not emitted when the pin is rejected by the max-3 rule or when the message was already pinned.

```typescript
socket.on('message:pinned', (payload: {
  messageId: string;
  conversationId: string;
  pinnedBy: string;
  pinnedByName?: string;
  pinnedAt: string;
}) => { ... });
```

**FE behavior:** mark the message as pinned, add/update it in the pinned-message bar/list, and keep at most the server-authoritative 3 pinned messages. A persisted `message:new` system message with `metadata.action = 'MESSAGE_PINNED'` also arrives for history rendering.

---

### message:unpinned

**Tier 2 — STREAM** · Target: `conversation:{id}` room.

Emitted after an existing pin is removed from `message-store`. This event is not emitted when the target message was not pinned.

```typescript
socket.on('message:unpinned', (payload: {
  messageId: string;
  conversationId: string;
  unpinnedBy: string;
  unpinnedByName?: string;
  unpinnedAt: string;
}) => { ... });
```

**FE behavior:** remove the message from the pinned-message bar/list and clear the local pinned state. A persisted `message:new` system message with `metadata.action = 'MESSAGE_UNPINNED'` also arrives for history rendering.

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

### friendship:request_sent

**Target**: sender's own sockets only.

Emitted after `POST /friendships/requests/:targetUserId` succeeds and the friendship outbox event reaches the Realtime Gateway.

```typescript
socket.on('friendship:request_sent', (payload: {
  fromUserId: string;
  fromUserName?: string;
  toUserId: string;
  toUserName?: string;
  timestamp: string;
}) => { ... });
```

**FE behavior:** switch the target user's action button to "Request sent" immediately after the HTTP ACK, then use this event as the server-confirmed state for other tabs/devices.

---

### friendship:request_received

**Target**: receiver's own sockets only.

```typescript
socket.on('friendship:request_received', (payload: {
  fromUserId: string;
  fromUserName?: string;
  toUserId: string;
  toUserName?: string;
  timestamp: string;
}) => { ... });
```

**FE behavior:** add the request to the incoming-request tray, show a badge/toast, and update the sender's profile CTA to "Accept / Reject" without a page reload.

---

### friendship:request_accepted

**Target**: both users' own sockets.

```typescript
socket.on('friendship:request_accepted', (payload: {
  acceptedBy: string;
  acceptedByName?: string;
  requesterId: string;
  requesterName?: string;
  userIds: string[];
  timestamp: string;
}) => { ... });
```

**FE behavior:** mark both profiles as friends immediately. The direct chat is created asynchronously by Conversation Service; listen for `conversation:new` with `type: 'direct'` and then insert/open the chat row.

---

### friendship:request_rejected

**Target**: both users' own sockets.

```typescript
socket.on('friendship:request_rejected', (payload: {
  rejectedBy: string;
  rejectedByName?: string;
  requesterId: string;
  requesterName?: string;
  userIds: string[];
  timestamp: string;
}) => { ... });
```

**FE behavior:** remove the pending request from both incoming/outgoing lists and restore the profile CTA to "Add friend".

---

### friendship:removed / friendship:blocked / friendship:unblocked

**Target**: affected users' own sockets.

Use these to keep friend list/profile CTAs in sync across tabs/devices:

```typescript
socket.on('friendship:removed', ({ userIds, removedBy, targetUserId, timestamp }) => { ... });
socket.on('friendship:blocked', ({ blocker, blocked, timestamp }) => { ... });
socket.on('friendship:unblocked', ({ unblocker, unblocked, timestamp }) => { ... });
```

---

### conversation:new

**Target**: each member's own sockets.

Emitted when a conversation is created. For friend acceptance this is the event that makes the new DIRECT chat available in the conversation list.

```typescript
socket.on('conversation:new', (payload: {
  conversationId: string;
  type: 'direct' | 'group' | 'announcement';
  createdBy: string;
  timestamp: string;
}) => { ... });
```

**FE behavior:** prepend/update the conversation row. If `type === 'direct'` after `friendship:request_accepted`, bind the row to the accepted friend and optionally auto-open it.

---

### conversation:updated

**Target**: each member's own sockets.

```typescript
socket.on('conversation:updated', (payload: {
  conversationId: string;
  changes: Record<string, any>;
  updatedBy?: string;
  timestamp?: string;
}) => { ... });
```

**FE behavior:** patch lightweight fields immediately. If avatar/name settings changed and the UI needs presigned URLs, refetch `GET /conversations/:id` in the background.

---

### conversation:member-added

**Target**: all current members' own sockets, including the newly added/joined users.

This event covers admin add, invite-link self join, and join-request approval.

```typescript
socket.on('conversation:member-added', (payload: {
  conversationId: string;
  addedBy: string;
  addedByName?: string;
  addedUsers: Array<{ id: string; displayName?: string }>;
  conversationType: string;
  memberCount: number;
  timestamp: string;
  source: 'member_add' | 'invite_link' | 'join_approved';
}) => { ... });
```

**FE behavior:** if the current user is in `addedUsers`, insert the conversation row and allow opening it immediately. Existing members should update member count/list and show a small system toast.

---

### conversation:member-removed

**Target**: remaining members and removed users' own sockets.

```typescript
socket.on('conversation:member-removed', (payload: {
  conversationId: string;
  removedBy: string;
  removedByName?: string;
  removedUsers: Array<{ id: string; displayName?: string }>;
  conversationType: string;
  memberCount: number;
  timestamp: string;
  source: 'member_left' | 'member_removed';
}) => { ... });
```

**FE behavior:** if the current user is removed, close the active conversation, remove/archive the row, clear local room state, and show "You were removed" or "You left". Remaining members update member list/count.

---

### group:settings_updated

**Target**: all current members' own sockets.

```typescript
socket.on('group:settings_updated', (payload: {
  conversationId: string;
  changes: Record<string, any>;
  updatedBy: string;
  updatedByName?: string;
  timestamp: string;
}) => { ... });
```

---

### group:join_requested

**Target**: all current members' own sockets; clients should show it only to OWNER/ADMIN.

```typescript
socket.on('group:join_requested', (payload: {
  conversationId: string;
  userId: string;
  userName?: string;
  requestId: string;
  requestMessage?: string;
  source: 'invite_link' | 'request';
  timestamp: string;
}) => { ... });
```

**FE behavior:** add a pending item to the admin approval queue in realtime. Non-admin clients should ignore it. If `source === 'invite_link'`, label it as "joined/requested via invite link" so admins understand why it appeared.

---

### group:join_approved

**Target**: requester and current members' own sockets.

```typescript
socket.on('group:join_approved', (payload: {
  conversationId: string;
  userId: string;
  userName?: string;
  requestId: string;
  reviewedBy: string;
  reviewedByName?: string;
  timestamp: string;
}) => { ... });
```

**FE behavior:** requester inserts the group row and can open the group immediately. Admin/member UIs remove the pending request and update the member list; `conversation:member-added` follows for the member-list patch.

---

### group:join_rejected

**Target**: requester and current members' own sockets.

```typescript
socket.on('group:join_rejected', (payload: {
  conversationId: string;
  userId: string;
  userName?: string;
  requestId: string;
  reviewedBy: string;
  reviewedByName?: string;
  timestamp: string;
}) => { ... });
```

**FE behavior:** requester shows who rejected the request; admin UIs remove the pending item from the review queue.

---

### group:member_kicked

**Target**: kicked user and remaining members' own sockets.

```typescript
socket.on('group:member_kicked', (payload: {
  conversationId: string;
  userId: string;
  userName?: string;
  kickedBy: string;
  kickedByName?: string;
  timestamp: string;
}) => { ... });
```

**FE behavior:** if `userId === currentUserId`, immediately close the chat, remove/archive the row, clear composer drafts, and show "You were removed by {kickedByName}". Remaining members remove that user from the member list.

---

### group:disbanded

**Target**: all members from the pre-disband snapshot.

```typescript
socket.on('group:disbanded', (payload: {
  conversationId: string;
  disbandedBy: string;
  disbandedByName?: string;
  timestamp: string;
}) => { ... });
```

**FE behavior:** remove/archive the group row without waiting for reload, navigate away if the conversation is active, and block sending/retry actions for that conversation. Show "Group was disbanded by {disbandedByName}" when available.

---

### conversation:removed

**Target**: affected user's own sockets.

Emitted when the backend forcibly removes a socket from `conversation:{conversationId}` after a member remove, kick, or group disband. This is a generic safety event; prefer the richer domain events above for UX copy.

```typescript
socket.on('conversation:removed', (payload: {
  conversationId: string;
  reason:
    | 'removed-from-conversation'
    | 'group-member-kicked'
    | 'group-disbanded';
  message: string;
}) => { ... });
```

**FE behavior:** close the active room, clear typing/subscription state, and prevent sending. Use `group:member_kicked`, `group:disbanded`, or `conversation:member-removed` if they arrived to decide exact toast/copy.

---

### group:member_role_changed

**Target**: all current members' own sockets.

```typescript
socket.on('group:member_role_changed', (payload: {
  conversationId: string;
  userId: string;
  userName?: string;
  newRole: 'owner' | 'admin' | 'member';
  changedBy: string;
  changedByName?: string;
  timestamp: string;
}) => { ... });
```

**FE behavior:** patch role badges/admin controls immediately. If the current user is demoted, hide admin actions before the next API call.

---

## 4. Call — Client-to-Server Events

All Call namespace events require `authenticate` first. All are guarded by `WsKeycloakGuard`.

---

### call:accept

Accept an incoming ringing call. The server atomically transitions the call to `ACTIVE`, issues a LiveKit token for the callee, and broadcasts `call:accepted` to the `call:{callId}` room.

```typescript
callSocket.emit('call:accept', { callId: 'call-uuid' });
```

**ACK event: `call:accepted`**

```typescript
{
  event: 'call:accepted',
  data: {
    callId: string;
    conversationId: string;
    calleeId: string;
    acceptedAt: string;       // ISO-8601
    livekitToken: string;     // LiveKit JWT — callee connects to SFU with this
    livekitUrl: string;       // Public LiveKit server URL
  }
}
```

Side effects: `call:accepted` broadcast to the `call:{callId}` room so the caller receives it and can fetch their own token via `GET /calls/:callId/token`.

Errors: `CALL_NOT_RINGING` if the call is not in `RINGING` status; `CALL_CALLEE_BUSY` if the callee is already in an active call.

---

### call:decline

Decline an incoming ringing call. Transitions the call to `REJECTED` and writes a call summary with `durationMs: 0`.

```typescript
callSocket.emit('call:decline', { callId: 'call-uuid' });
```

**ACK event: `call:declined`**

```typescript
{
  event: 'call:declined',
  data: {
    callId: string;
    conversationId: string;
    declinedBy: string;       // userId
    finalStatus: 'REJECTED';
    declinedAt: string;
  }
}
```

Side effects: `call:declined` broadcast to the `call:{callId}` room.

---

### call:end

End an active (or still-ringing) call. Transitions the call to `ENDED`, closes the LiveKit room, and writes a call summary.

```typescript
callSocket.emit('call:end', { callId: 'call-uuid' });
```

**ACK event: `call:ended`**

```typescript
{
  event: 'call:ended',
  data: {
    callId: string;
    conversationId: string;
    endedBy: string;
    endReason: 'user_ended' | 'caller_cancelled';
    durationMs: number;
    endedAt: string;
  }
}
```

Side effects: `call:ended` broadcast to the `call:{callId}` room.

---

### call:join_room

Join the Socket.IO room `call:{callId}` to receive call-level broadcast events (`call:accepted`, `call:declined`, `call:ended`). Call this after `POST /calls/start` (caller) or after receiving `call:ringing` (callee).

```typescript
callSocket.emit('call:join_room', { callId: 'call-uuid' });
```

**ACK event: `call:room_joined`**

```typescript
{ event: 'call:room_joined', data: { callId: string } }
```

---

### call:leave_room

Leave the Socket.IO room `call:{callId}`. Call this after the call ends and the UI has cleaned up.

```typescript
callSocket.emit('call:leave_room', { callId: 'call-uuid' });
```

**ACK event: `call:room_left`**

```typescript
{ event: 'call:room_left', data: { callId: string } }
```

---

## 5. Call — Server-to-Client Events

### call:ringing

**Target**: each callee's **personal room** `user:{calleeId}` (one push per callee).

Delivered by the Realtime Gateway from the call-service fast-track signaling event. The durable Kafka `call.event.ringing` event carries the same payload. Because it is delivered to personal rooms (not a shared room), each callee receives it independently regardless of whether they have joined any call room.

```typescript
callSocket.on(
  'call:ringing',
  (payload: {
    callId: string;
    conversationId: string;
    caller: {
      id: string;
      name: string;
      avatar: string;
    };
    calleeIds: string[];        // only non-busy callees in group calls
    calleeProfiles: {           // NEW — profile of every non-busy callee
      id: string;
      name: string;
      avatar: string;
    }[];
    startedAt: string; // ISO-8601
  }) => {
    // Seed profileMap with caller + calleeProfiles before rendering UI
    // Show incoming call UI
    // Emit call:join_room to start receiving call-level broadcasts
    callSocket.emit('call:join_room', { callId: payload.callId });
  },
);
```

**FE behavior:** seed `profileMap` with `caller` and each entry in `calleeProfiles`, then display the incoming call banner. Offer "Accept" (`POST /calls/:callId/accept`) and "Decline" (`POST /calls/:callId/decline`) actions.

---

### call:accepted

**Target**: `call:{callId}` room.

Broadcast by the Realtime Gateway when it consumes the `call.event.accepted` Kafka event. Both the caller and any other callees in the room receive this.

```typescript
callSocket.on(
  'call:accepted',
  (payload: {
    callId: string;
    conversationId: string;
    calleeId: string;
    callee: {               // NEW — full profile of the accepting callee
      id: string;
      name: string;
      avatar: string;
    };
    acceptedAt: string;
  }) => {
    // Seed profileMap with callee profile
    // Caller: fetch LiveKit token via GET /calls/:callId/token
    // Connect to LiveKit SFU room
  },
);
```

**FE behavior (caller):** add `payload.callee` to `profileMap`, call `GET /calls/:callId/token`, receive `{ token, roomName, livekitUrl }`, connect to LiveKit SFU.

---

### call:declined

**Target**: `call:{callId}` room.

Broadcast when the callee declines or when the call is auto-declined (ringing timeout, membership revoked).

```typescript
callSocket.on(
  'call:declined',
  (payload: {
    callId: string;
    conversationId: string;
    declinedBy: string;
    finalStatus: 'REJECTED' | 'MISSED';
    declinedAt: string;
  }) => {
    // Dismiss call UI, show "Call declined" or "Missed call" indicator
  },
);
```

**FE behavior:** dismiss the ringing/calling UI. Display appropriate status in the conversation history.

---

### call:ended

**Target**: `call:{callId}` room **AND** each participant's personal room `user:{uid}`.

Broadcast when any participant ends the call, or when cleanup processes terminate a ghost/stuck call.

> **Why personal rooms?** A callee who accepts a call via FCM notification may open the app directly into LiveKit without first connecting to the Socket.IO `call:{callId}` room. Emitting to `user:{uid}` ensures that participant still receives `call:ended` and can cleanly leave the LiveKit meeting.

```typescript
// Option A — callee joined the call:* room
callSocket.on('call:ended', handler);

// Option B — callee never joined the call:* room (FCM deep-link flow)
// Listen on the personal room socket instead
socket.on('call:ended', handler);

// Shared handler:
function handler(payload: {
  callId: string;
  conversationId: string;
  endedBy: string;
  endReason:
    | 'user_ended'
    | 'declined'
    | 'caller_cancelled'
    | 'ringing_timeout'
    | 'ghost_call_cleanup'
    | 'stale_call_cleanup'
    | 'membership_revoked';
  durationMs: number;
  endedAt: string;
}) {
  // Disconnect from LiveKit SFU
  // Stop local media tracks
  // Leave call room: callSocket.emit('call:leave_room', { callId })
}
```

**FE behavior:** disconnect from LiveKit, stop all local media tracks, leave the `call:{callId}` Socket.IO room, show call duration summary.

---

## 6. Call — Rate Limits

The Call gateway enforces per-client sliding-window rate limits to prevent abuse:

| Event(s)                                  | Window | Max events |
| ----------------------------------------- | ------ | ---------- |
| `call:accept`, `call:decline`, `call:end` | 10 s   | 20         |
| `call:join_room`, `call:leave_room`       | 10 s   | 30         |

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
               WS message:saved ◄────┘   (sender's own sockets — persistence confirmed)
               WS message:new  ◄──────── (conversation room — full payload for all viewers)
               WS message:notify ◄─────  (user rooms — lightweight notification with preview metadata)
```

**WS event timeline for recipient:**

1. **`message:notify`** arrives in personal room — increment unread badge and optionally show sender/content preview if conversation is in background.
2. **`message:new`** arrives in conversation room (if joined) — render the message immediately.
3. **After render** — emit `conversation:update_delivered_cursor` (background) or `conversation:update_seen_cursor` (foreground).

---

### Guide 2: Cursor Tracking & Read Receipts

See the HTTP API Reference [Guide 4](../API_REFERENCE.md#guide-4-cursor-tracking--read-receipts) for the complete state machine. Key WebSocket events:

| WS Event                               | Direction     | When to emit                                             |
| -------------------------------------- | ------------- | -------------------------------------------------------- |
| `conversation:join`                    | Client→Server | When user opens a conversation                           |
| `conversation:leave`                   | Client→Server | When user closes a conversation                          |
| `conversation:update_seen_cursor`      | Client→Server | When conversation is open and new messages arrive        |
| `conversation:update_delivered_cursor` | Client→Server | When messages arrive while conversation is in background |
| `cursor:seen_updated`                  | Server→Client | ACK of seen cursor update                                |
| `cursor:delivered_updated`             | Server→Client | ACK of delivered cursor update                           |

**Connection:join auto-update:** `conversation:join` automatically updates the seen cursor to `latestOffset`. This means opening a conversation marks all current messages as read without requiring a separate cursor event.

---

### Guide 3: Zalo-Style Realtime Social & Group UX

Keep HTTP as the source of mutation and WebSocket as the source of cross-device/cross-user confirmation:

1. **Optimistic local update after HTTP ACK** — disable buttons and patch obvious local state immediately (`request sent`, `approved`, `kick`, `disband`).
2. **Server event reconciles all devices** — use `friendship:*`, `conversation:*`, and `group:*` events to update other tabs/devices and other users.
3. **Never wait for reload** — remove kicked/disbanded conversations from memory immediately on `group:member_kicked` / `group:disbanded`.
4. **Fetch only when data is heavy** — for `conversation:new` or avatar/name changes, insert a skeleton row then fetch `GET /conversations/:id` in the background.
5. **Use actor display names in events** — show "Approved by Minh", "Removed by Lan", or "Kicked by Admin" from `reviewedByName`, `removedByName`, `kickedByName`.

**Friend accept flow:**

```
User B accepts User A
  │
  ├─ HTTP POST /friendships/requests/{userA}/accept
  │
  ├─ WS friendship:request_accepted ───► both users update friend state
  │
  └─ WS conversation:new (type=direct) ─► both users insert/open direct chat row
```

**Invite-link join flow:**

```
User opens invite link
  │
  ├─ If approval is off:
  │    HTTP returns { requiresApproval: false, conversationId }
  │    WS conversation:member-added { source: 'invite_link' } ─► all members update UI
  │
  └─ If approval is on:
       HTTP returns { requiresApproval: true, requestId }
       WS group:join_requested { source: 'invite_link' } ─► admins see pending queue
       WS group:join_approved / group:join_rejected ─► requester sees result and reviewer
```

**Group removal/disband rules for FE:**

- On `conversation:member-removed` where current user is included: leave/close the screen and remove or archive the row.
- On `group:member_kicked` where `userId === currentUserId`: show a blocking toast and remove the row immediately.
- On `group:disbanded`: remove the row for every member and prevent retries/sends for that conversation.
- On `conversation:removed`: always tear down local room state even if the richer event was missed or processed later.
- On any removed/disbanded path: clear drafts, pending uploads, typing indicators, and local message subscriptions for that conversation.

---

### Guide 4: Instant Call Flow (Zalo/Messenger style)

Complete lifecycle for a 1-to-1 instant call using the LiveKit SFU. There is no waiting room or host role — calls ring immediately and participants connect to the SFU directly.

```
Caller                        Server                        Callee
  │                              │                              │
  ├─ POST /calls/start ─────────►│                              │
  │◄─ 201 { callId, ... } ───────┤                              │
  │                              │── call:ringing ─────────────►│ (personal WS room user:{calleeId})
  │                              │                              │ (shows incoming call UI)
  │                              │                              │
  ├─ call:join_room { callId } ─►│                              │
  │◄─ call:room_joined ──────────┤                              │
  │                              │                              │
  │  [waiting for call:accepted] │◄─ POST /calls/:id/accept ───┤
  │                              │── call:accepted (room) ─────►│ (callee receives livekitToken in ACK)
  │◄─ call:accepted (room) ──────┤                              │
  │                              │                              │
  ├─ GET /calls/:id/token ──────►│                              │
  │◄─ { token, roomName, url } ──┤                              │
  │                              │                              │
  │  [both connect to LiveKit SFU independently]                │
  │                              │                              │
  ├─ POST /calls/:id/end ───────►│                              │
  │                              │── call:ended (room) ────────►│
  │◄─ call:ended (room) ─────────┤                              │
  │                              │                              │
  ├─ call:leave_room { callId } ►│                              │
```

**Step-by-step (Caller):**

1. `POST /calls/start` with `{ conversationId, calleeIds }` → receive `CallDto` with `callId`.
2. Emit `call:join_room { callId }` to subscribe to call-level broadcasts.
3. Wait for `call:accepted` event on the `call:{callId}` room.
4. On `call:accepted`: add `payload.callee` to `profileMap`, call `GET /calls/:callId/token` → receive `{ token, roomName, livekitUrl }`.
5. Connect to LiveKit SFU using the token.
6. When done: `POST /calls/:callId/end` → receive `call:ended` broadcast.
7. Disconnect from LiveKit, emit `call:leave_room { callId }`.

**Step-by-step (Callee):**

1. Receive `call:ringing` in personal room `user:{userId}` — seed `profileMap` from `caller` and `calleeProfiles`, then display incoming call UI.
2. Emit `call:join_room { callId }` to subscribe to call-level broadcasts.
3. On "Accept": `POST /calls/:callId/accept` → ACK contains `livekitToken` and `livekitUrl`.
4. Connect to LiveKit SFU using the token from the accept response.
5. On "Decline": `POST /calls/:callId/decline` → `call:declined` broadcast to room.
6. When done: `POST /calls/:callId/end` or wait for `call:ended` broadcast.
7. Disconnect from LiveKit, emit `call:leave_room { callId }`.

**Reconnect / tab refresh:** call `GET /calls/:callId` — the response now includes `displayName` and `avatarUrl` on every participant so `profileMap` can be fully rebuilt without separate user-service lookups.

**Important notes:**

- The callee's LiveKit token is returned directly in the `POST /calls/:callId/accept` HTTP response — no extra token fetch required.
- The caller's LiveKit token requires a separate `GET /calls/:callId/token` call, which is only valid once the call is `ACTIVE`.
- Media flows entirely through the LiveKit SFU — no P2P WebRTC signaling via this WebSocket gateway.
