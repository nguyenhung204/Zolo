# WebSocket Events — FE Contract

Chat realtime uses Socket.IO on the `/chat` namespace. The client authenticates after connect and should treat HTTP mutation responses as the first local confirmation, then reconcile all tabs/devices from WebSocket events.

## Friendship Events

All friendship events are emitted to the affected users' own sockets, not to an active conversation room.

```ts
socket.on("friendship:request_sent", (payload: {
  fromUserId: string;
  fromUserName?: string;
  toUserId: string;
  toUserName?: string;
  timestamp: string;
}) => {});

socket.on("friendship:request_received", (payload: {
  fromUserId: string;
  fromUserName?: string;
  toUserId: string;
  toUserName?: string;
  timestamp: string;
}) => {});

socket.on("friendship:request_accepted", (payload: {
  acceptedBy: string;
  acceptedByName?: string;
  requesterId: string;
  requesterName?: string;
  userIds: string[];
  timestamp: string;
}) => {});

socket.on("friendship:request_rejected", (payload: {
  rejectedBy: string;
  rejectedByName?: string;
  requesterId: string;
  requesterName?: string;
  userIds: string[];
  timestamp: string;
}) => {});

socket.on("friendship:removed", (payload: {
  userIds: string[];
  removedBy: string;
  targetUserId: string;
  timestamp: string;
}) => {});

socket.on("friendship:blocked", (payload: {
  blocker: string;
  blocked: string;
  timestamp: string;
}) => {});

socket.on("friendship:unblocked", (payload: {
  unblocker: string;
  unblocked: string;
  timestamp: string;
}) => {});
```

FE behavior:

- Patch friend request trays and profile CTA state immediately after the HTTP ACK.
- Use `friendship:*` events to reconcile other browser tabs/devices and the other user.
- On `friendship:request_accepted`, mark both profiles as friends immediately.
- Do not assume the direct chat exists at accept time; wait for `conversation:new` with `type: "direct"`.

## Conversation Events

```ts
socket.on("conversation:new", (payload: {
  conversationId: string;
  type: "direct" | "group" | "announcement";
  createdBy: string;
  timestamp: string;
}) => {});
```

`conversation:new` is emitted to each member's own sockets when a conversation is ready. For friend request acceptance, Conversation Service still auto-creates the DIRECT conversation, then Realtime Gateway emits `conversation:new` to the two users so the FE can insert/fetch the row without a reload.

```ts
socket.on("conversation:member-added", (payload: {
  conversationId: string;
  addedBy: string;
  addedByName?: string;
  addedUsers: Array<{ id: string; displayName?: string }>;
  conversationType: string;
  memberCount: number;
  source: "member_add" | "invite_link" | "join_approved";
  timestamp: string;
}) => {});

socket.on("conversation:member-removed", (payload: {
  conversationId: string;
  removedBy: string;
  removedByName?: string;
  removedUsers: Array<{ id: string; displayName?: string }>;
  conversationType: string;
  memberCount: number;
  source: "member_left" | "member_removed";
  timestamp: string;
}) => {});
```

Invite-link joins that do not require approval arrive as `conversation:member-added` with `source: "invite_link"`. If the current user is in `addedUsers`, insert/fetch the group row and allow opening it immediately.

## Group Events

```ts
socket.on("group:join_requested", (payload: {
  conversationId: string;
  userId: string;
  userName?: string;
  requestId: string;
  requestMessage?: string | null;
  source: "invite_link" | "request";
  timestamp: string;
}) => {});

socket.on("group:join_approved", (payload: {
  conversationId: string;
  userId: string;
  userName?: string;
  requestId: string;
  reviewedBy: string;
  reviewedByName?: string;
  timestamp: string;
}) => {});

socket.on("group:join_rejected", (payload: {
  conversationId: string;
  userId: string;
  userName?: string;
  requestId: string;
  reviewedBy: string;
  reviewedByName?: string;
  timestamp: string;
}) => {});
```

Join requests through invite links must preserve `source: "invite_link"` so admin UX can explain why the request appeared. Approve/reject events include `reviewedByName` for Zalo-style copy such as "Approved by Minh".

```ts
socket.on("group:member_kicked", (payload: {
  conversationId: string;
  userId: string;
  userName?: string;
  kickedBy: string;
  kickedByName?: string;
  timestamp: string;
}) => {});

socket.on("group:disbanded", (payload: {
  conversationId: string;
  disbandedBy: string;
  disbandedByName?: string;
  timestamp: string;
}) => {});

socket.on("conversation:removed", (payload: {
  conversationId: string;
  reason: "removed-from-conversation" | "group-member-kicked" | "group-disbanded";
  message?: string;
}) => {});
```

Kick, disband, add, and remove events are emitted to users' own sockets. They must work even when the user is not currently joined to `conversation:{id}`. Kick/disband also force sockets to leave the room and emit `conversation:removed` as a safety event.

## Zalo-Style UX

- Optimistically patch obvious local state after the HTTP ACK: request sent, request approved, removed member, disbanded group.
- Reconcile all tabs/devices from WS events; never wait for a full page reload.
- On `conversation:new`, insert a skeleton row or fetch `GET /conversations/:id` in the background for avatar/name details.
- On kick/disband/remove for the current user, close the active conversation, remove the row, clear typing/drafts/uploads, and block send retries.
- Prefer actor display names from events (`reviewedByName`, `removedByName`, `kickedByName`, `disbandedByName`) for toast copy.
