# System Messages — FE Integration Guide

System messages are activity records automatically injected into a conversation's
message history whenever a significant event occurs (member joins/leaves, role change,
group rename, etc.).

FE receives them via **two parallel channels** so rendering is always immediate:

1. **`message:new`** — persisted record stored in message history (same as normal messages).
2. **Dedicated action socket events** — instant pre-computed events emitted the moment the
   action is committed, carrying full display names so no extra HTTP fetch is needed.

---

## 1. How FE Receives System Messages

### 1a. Via `message:new` (persisted history)

System messages flow through the standard `message:new` WebSocket event emitted to the
`conversation:{id}` room.  All `metadata` fields now include **pre-resolved display names**
so FE can render without a separate user lookup:

```jsonc
// WebSocket event: "message:new"
{
  "messageId": "uuid",
  "conversationId": "uuid",
  "senderId": "SYSTEM",          // ← always "SYSTEM" (not a real user ID)
  "offset": 42,
  "content": "",                 // ← always empty string
  "type": "system",              // ← discriminator
  "createdAt": "2026-01-01T00:00:00.000Z",
  "metadata": {                  // ← see section 2 for all shapes
    "action": "MEMBER_ADDED",
    "actorId": "user-uuid",
    "actorName": "Nguyen Van A",          // ← display name, always present
    "targetIds": ["user-uuid-1", "user-uuid-2"],
    "targetNames": ["Tran Thi B", "Le C"] // ← parallel array, same order as targetIds
  },
  "attachments": null,
  "replyToId": null,
  "forwardedFrom": null
}
```

**Detection rule:** `message.type === 'system'`

### 1b. Via dedicated action events (real-time, immediate)

The realtime-gateway also emits a **dedicated WebSocket event** the moment each action is
committed — before the `message:new` record is persisted — so UI updates are instant.
These events include the same display-name fields.

| Action | Dedicated event | Emitted to |
|---|---|---|
| Member added | `conversation:member-added` | added users' personal rooms |
| Member removed / left | `conversation:member-removed` | removed users' personal rooms |
| Member kicked | `group:member_kicked` | kicked user + all remaining members |
| Role changed | `group:member_role_changed` | all group members |
| Group settings updated | `group:settings_updated` | all group members |

See section 3 for full payload shapes.

---

## 2. `metadata.action` Values and Their Payloads

All system messages have `senderId === "SYSTEM"` and `content === ""`.
`actorName` and `targetNames` are **always pre-populated** by the `message-store` service
via a batch call to the Users service before the message is persisted; FE never needs a
separate lookup.

### `MEMBER_ADDED`
> Someone was added to the group.

```jsonc
{
  "action": "MEMBER_ADDED",
  "actorId": "uuid",
  "actorName": "Nguyen Van A",         // display name of the user who performed the add
  "targetIds": ["uuid", …],
  "targetNames": ["Tran Thi B", …]     // parallel array — same order as targetIds
}
```
**Render:** *"[actorName] added [targetNames] to the group"*

---

### `MEMBER_LEFT`
> A member voluntarily left the group.

```jsonc
{
  "action": "MEMBER_LEFT",
  "actorId": "uuid",
  "actorName": "Nguyen Van A",
  "targetIds": ["uuid"],
  "targetNames": ["Nguyen Van A"],     // same person as actor
  "ownershipTransferredTo": "uuid",    // present only when leaver was OWNER
  "visibility": "all" | "admins"       // see "Silent leave" below
}
```
**Render:** *"[actorName] left the group"*

#### Silent leave (`visibility: "admins"`)

When the user passes `silent: true` to `POST /conversations/:id/leave`, the
emitted event sets `metadata.visibility = "admins"`. The realtime-gateway
**only fanouts the `message:new` payload to OWNER/ADMIN sockets** in that
conversation (via `notifyUsersSelf(adminUserIds, …)`); regular MEMBERs never
receive the system message and therefore never see a "left the group" line in
their history.

FE rule of thumb: the visibility filtering is enforced server-side, but if you
do receive such a message you can render it normally — by construction the
recipient is an admin/owner.

---

### `MEMBER_REMOVED`
> A member was removed by an admin.

```jsonc
{
  "action": "MEMBER_REMOVED",
  "actorId": "uuid",
  "actorName": "Admin Name",
  "targetIds": ["uuid", …],
  "targetNames": ["Removed User", …]
}
```
**Render:** *"[actorName] removed [targetNames] from the group"*

---

### `MEMBER_KICKED`
> A member was kicked by an admin (hard-kick flow, distinct from removal).

```jsonc
{
  "action": "MEMBER_KICKED",
  "actorId": "uuid",
  "actorName": "Admin Name",
  "targetIds": ["uuid"],
  "targetNames": ["Kicked User"]
}
```
**Render:** *"[actorName] kicked [targetNames[0]] from the group"*

---

### `ROLE_CHANGED`
> A member's role was changed.

```jsonc
{
  "action": "ROLE_CHANGED",
  "actorId": "uuid",
  "actorName": "Admin Name",
  "targetIds": ["uuid"],
  "targetNames": ["Promoted User"],
  "newRole": "ADMIN"                   // "ADMIN" | "MEMBER"
```
**Render:** *"[actorName] made [targetNames[0]] an [newRole]"*

---

### `GROUP_INFO_UPDATED`
> Group name or avatar was changed (or both simultaneously).

```jsonc
{
  "action": "GROUP_INFO_UPDATED",
  "actorId": "uuid",
  "actorName": "Nguyen Van A",
  "changes": {
    "name": "New Name",       // present only if name changed
    "avatarChanged": true     // present only if avatar changed
  }
}
```
**Render (name):** *"[actorName] renamed the group to '[changes.name]'"*  
**Render (avatar):** *"[actorName] changed the group photo"*  
**Render (both):** show both lines, or *"[actorName] updated the group info"*

---

## 3. Dedicated Action Socket Events (Realtime)

These events are emitted **immediately** when an action is committed (before the
`message:new` persisted record arrives). Subscribe to them to update UI in real time
without waiting for the history record.

### `conversation:member-added`
Emitted to each added user's personal room (`user:{id}`).

```jsonc
{
  "conversationId": "uuid",
  "addedBy": "uuid",
  "addedByName": "Nguyen Van A",        // display name of who performed the add
  "addedUsers": [                       // all users added in this batch
    { "id": "uuid", "displayName": "Tran Thi B" },
    { "id": "uuid", "displayName": "Le C" }
  ],
  "conversationType": "GROUP",
  "memberCount": 12,
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

### `conversation:member-removed`
Emitted to each removed user's personal room (`user:{id}`).

```jsonc
{
  "conversationId": "uuid",
  "removedBy": "uuid",
  "removedByName": "Admin Name",
  "removedUsers": [
    { "id": "uuid", "displayName": "Removed User" }
  ],
  "conversationType": "GROUP",
  "memberCount": 11,
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

### `group:member_kicked`
Emitted to the kicked user's personal room AND all remaining members.

```jsonc
{
  "conversationId": "uuid",
  "userId": "uuid",                     // the kicked user
  "userName": "Kicked User",
  "kickedBy": "uuid",
  "kickedByName": "Admin Name",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

### `group:member_role_changed`
Emitted to all group members.

```jsonc
{
  "conversationId": "uuid",
  "userId": "uuid",                     // the affected member
  "userName": "Promoted User",
  "newRole": "ADMIN",
  "changedBy": "uuid",
  "changedByName": "Admin Name",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

### `group:settings_updated`
Emitted to all group members when group name/avatar is changed.

```jsonc
{
  "conversationId": "uuid",
  "changes": { "name": "New Name", "avatarChanged": true },
  "updatedBy": "uuid",
  "updatedByName": "Nguyen Van A",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

---

| Rule | Detail |
|------|--------|
| **No reply** | System messages cannot be replied to. Hide the reply action. |
| **No reactions** | System messages cannot be reacted to. |
| **No delete / revoke** | System messages are permanent. Hide delete/revoke actions. |
| **No sender bubble** | Do not render an avatar or name bubble; `senderId` is `"SYSTEM"`, not a user. |
| **Centre-aligned chip** | Render as a full-width, centre-aligned status chip (e.g. grey pill). |
| **No notification** | System messages do NOT trigger push notifications or unread-count increments. The `message:saved` delivery confirmation is also suppressed (`notifySelf` is skipped for `senderId === "SYSTEM"` — see realtime-gateway). |

---

## 4. Pagination / History

System messages are stored with a regular sequential `offset` in the message table.
They appear inline when fetching message history via `GET /messages?conversationId=…`.

```jsonc
// HTTP response item (same shape as normal messages)
{
  "id": "uuid",
  "conversationId": "uuid",
  "senderId": "SYSTEM",
  "content": "",
  "type": "system",
  "offset": 42,
  "metadata": { "action": "MEMBER_ADDED", … },
  "createdAt": "…"
}
```

FE should apply the same rendering rules as for the real-time `message:new` payload.

---

## 5. Covered Events Summary

| Kafka Topic | `action` value | Triggered by |
|---|---|---|
| `chat.event.member_added` | `MEMBER_ADDED` | Adding members to group/announcement |
| `chat.event.member_removed` | `MEMBER_LEFT` | Self-leave |
| `chat.event.member_removed` | `MEMBER_REMOVED` | Admin removes member |
| `group.event.member_kicked` | `MEMBER_KICKED` | Hard-kick by admin |
| `group.event.member_role_changed` | `ROLE_CHANGED` | Admin changes member role |
| `chat.event.conversation_updated` | `GROUP_INFO_UPDATED` | Group rename / avatar change |

> Note: `GROUP.DISBANDED` is not yet covered — the group disband flow pushes
> `group:disbanded` WebSocket directly; system message support can be added later.
