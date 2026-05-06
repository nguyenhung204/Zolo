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
| Role changed / ownership transferred | `group:member_role_changed` | all group members |
| Group settings updated | `group:settings_updated` | all group members |
| Poll created | `group:poll_created` | all group members |
| Poll voted | `group:poll_voted` | all group members |
| Poll closed | `group:poll_closed` | all group members |
| Message pinned | `message:pinned` | active `conversation:{id}` room |
| Message unpinned | `message:unpinned` | active `conversation:{id}` room |

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
  "newRole": "ADMIN"                   // "ADMIN" | "MEMBER" | "MODERATOR"
}
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

### `OWNERSHIP_TRANSFERRED`
> The group owner transferred ownership to another member (usually when the owner leaves).

```jsonc
{
  "action": "OWNERSHIP_TRANSFERRED",
  "actorId": "uuid",
  "actorName": "Nguyen Van A",          // the outgoing owner
  "targetIds": ["uuid"],
  "targetNames": ["Tran Thi B"]          // the new owner
}
```
**Render:** *"[actorName] transferred group ownership to [targetNames[0]]"*

---

### `GROUP_SETTINGS_UPDATED`
> Admin/owner changed group behaviour settings (`allowMemberMessage`, `isPublic`, `joinApprovalRequired`).

```jsonc
{
  "action": "GROUP_SETTINGS_UPDATED",
  "actorId": "uuid",
  "actorName": "Nguyen Van A",
  "changes": {
    "allowMemberMessage": false,      // present only when this field changed
    "isPublic": true,                 // present only when this field changed
    "joinApprovalRequired": true      // present only when this field changed
  }
}
```

Render each changed field as a separate line (or join with "; "):

| `changes` field | value `true` | value `false` |
|---|---|---|
| `allowMemberMessage` | *"[actorName] allowed members to send messages"* | *"[actorName] restricted messaging to admins only"* |
| `isPublic` | *"[actorName] made the group public"* | *"[actorName] made the group private"* |
| `joinApprovalRequired` | *"[actorName] enabled join approval"* | *"[actorName] disabled join approval"* |

If multiple fields changed at once, render one line per field. Fallback if an unknown field appears: *"[actorName] updated group settings"*.

---

### `POLL_CLOSED`
> A poll was closed (by creator, owner, or admin).

```jsonc
{
  "action": "POLL_CLOSED",
  "actorId": "uuid",
  "actorName": "Nguyen Van A",
  "pollId": "uuid"
}
```
**Render:** *"[actorName] closed a poll"*

---

### `POLL_VOTED`
> A member cast or updated their vote on a poll.

```jsonc
{
  "action": "POLL_VOTED",
  "actorId": "uuid",
  "actorName": "Tran Thi B",
  "pollId": "uuid",
  "optionIds": ["opt-uuid-1"],          // the options they voted for
  "optionTexts": ["This Friday"]         // human-readable labels, parallel array to optionIds
}
```
**Render:** *"[actorName] voted for '[optionTexts.join(', ')]' on a poll"*

---

### `MESSAGE_PINNED`
> A message was pinned after the pin row was persisted successfully.

```jsonc
{
  "action": "MESSAGE_PINNED",
  "actorId": "uuid",
  "actorName": "Nguyen Van A",
  "messageId": "message-uuid"
}
```
**Render:** *"[actorName] pinned a message"*

---

### `MESSAGE_UNPINNED`
> A message was unpinned after the pin row was removed successfully.

```jsonc
{
  "action": "MESSAGE_UNPINNED",
  "actorId": "uuid",
  "actorName": "Nguyen Van A",
  "messageId": "message-uuid"
}
```
**Render:** *"[actorName] unpinned a message"*

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
Emitted to all group members when **group behaviour settings** change (`allowMemberMessage`, `isPublic`, `joinApprovalRequired`).

```jsonc
{
  "conversationId": "uuid",
  "changes": {
    "allowMemberMessage": false,   // only fields that changed are present
    "joinApprovalRequired": true
  },
  "updatedBy": "uuid",
  "updatedByName": "Nguyen Van A",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

### `group:poll_created`
Emitted to all group members when a new poll is created.

```jsonc
{
  "conversationId": "uuid",
  "poll": {
    "id": "uuid",
    "question": "When should we ship?",
    "options": [{ "id": "opt-uuid", "text": "This Friday", "voterIds": [] }],
    "multipleChoice": false,
    "deadline": "2026-05-10T18:00:00.000Z",  // null if no deadline
    "isClosed": false
  },
  "createdBy": "uuid",
  "createdByName": "Nguyen Van A",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

### `group:poll_voted`
Emitted to all group members when anyone casts or updates their vote.

```jsonc
{
  "conversationId": "uuid",
  "pollId": "uuid",
  "voterId": "uuid",
  "voterName": "Tran Thi B",
  "optionIds": ["opt-uuid-1"],           // options the voter chose
  "options": [                            // full updated snapshot — replace local state
    { "id": "opt-uuid-1", "text": "This Friday", "voterIds": ["uuid"] },
    { "id": "opt-uuid-2", "text": "Next Monday", "voterIds": [] }
  ],
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

### `group:poll_closed`
Emitted to all group members when a poll is closed.

```jsonc
{
  "conversationId": "uuid",
  "pollId": "uuid",
  "closedBy": "uuid",
  "closedByName": "Nguyen Van A",
  "options": [                            // final results snapshot
    { "id": "opt-uuid-1", "text": "This Friday", "voterIds": ["uuid-a", "uuid-b"] },
    { "id": "opt-uuid-2", "text": "Next Monday", "voterIds": [] }
  ],
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

### `message:pinned`
Emitted to the active `conversation:{id}` room after `message-store` persists a new pin. Not emitted when the pin is rejected by the max-3 rule or when the message was already pinned.

```jsonc
{
  "conversationId": "uuid",
  "messageId": "uuid",
  "pinnedBy": "uuid",
  "pinnedByName": "Nguyen Van A",
  "pinnedAt": "2026-01-01T00:00:00.000Z"
}
```

### `message:unpinned`
Emitted to the active `conversation:{id}` room after `message-store` removes an existing pin.

```jsonc
{
  "conversationId": "uuid",
  "messageId": "uuid",
  "unpinnedBy": "uuid",
  "unpinnedByName": "Nguyen Van A",
  "unpinnedAt": "2026-01-01T00:00:00.000Z"
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
| `group.event.member_role_changed` | `ROLE_CHANGED` | Admin/owner changes member role |
| `group.event.member_role_changed` | `OWNERSHIP_TRANSFERRED` | Owner leaves and appoints new owner |
| `chat.event.conversation_updated` | `GROUP_INFO_UPDATED` | Group rename / avatar change |
| `group.event.settings_updated` | `GROUP_SETTINGS_UPDATED` | Admin/owner changes behaviour settings |
| `group.event.poll_closed` | `POLL_CLOSED` | Poll closed by creator / admin / owner |
| `group.event.poll_voted` | `POLL_VOTED` | Member casts or updates a vote |
| `chat.event.message_updated` | `MESSAGE_PINNED` | MessageStore persisted a new pin |
| `chat.event.message_updated` | `MESSAGE_UNPINNED` | MessageStore removed an existing pin |

> Note: `GROUP.DISBANDED` is not yet covered — the group disband flow pushes
> `group:disbanded` WebSocket directly; system message support can be added later.
