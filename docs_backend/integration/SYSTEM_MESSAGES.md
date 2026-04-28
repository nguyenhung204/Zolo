# System Messages — FE Integration Guide

System messages are activity records automatically injected into a conversation's
message history whenever a significant event occurs (member joins/leaves, role change,
group rename, etc.).  They arrive via the **same WebSocket event** as normal messages
(`message:new`) so no extra subscription is needed.

---

## 1. How FE Receives System Messages

System messages flow through the standard `message:new` WebSocket event emitted to the
`conversation:{id}` room:

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
    "targetIds": ["user-uuid-1", "user-uuid-2"]
  },
  "attachments": null,
  "replyToId": null,
  "forwardedFrom": null
}
```

**Detection rule:** `message.type === 'system'`

---

## 2. `metadata.action` Values and Their Payloads

All system messages have `senderId === "SYSTEM"` and `content === ""`.

### `MEMBER_ADDED`
> Someone was added to the group.

```jsonc
{
  "action": "MEMBER_ADDED",
  "actorId": "uuid",        // user who performed the add
  "targetIds": ["uuid", …]  // users who were added
}
```
**Render:** *"[Actor] added [targets] to the group"*

---

### `MEMBER_LEFT`
> A member voluntarily left the group.

```jsonc
{
  "action": "MEMBER_LEFT",
  "actorId": "uuid",        // the user who left (same as targetIds[0])
  "targetIds": ["uuid"]
}
```
**Render:** *"[Actor] left the group"*

---

### `MEMBER_REMOVED`
> A member was removed by an admin.

```jsonc
{
  "action": "MEMBER_REMOVED",
  "actorId": "uuid",        // admin who removed
  "targetIds": ["uuid", …]  // users who were removed
}
```
**Render:** *"[Actor] removed [targets] from the group"*

---

### `MEMBER_KICKED`
> A member was kicked by an admin (hard-kick flow, distinct from removal).

```jsonc
{
  "action": "MEMBER_KICKED",
  "actorId": "uuid",        // admin who kicked
  "targetIds": ["uuid"]     // the kicked user
}
```
**Render:** *"[Actor] kicked [target] from the group"*

---

### `ROLE_CHANGED`
> A member's role was changed.

```jsonc
{
  "action": "ROLE_CHANGED",
  "actorId": "uuid",        // admin who changed the role
  "targetIds": ["uuid"],    // the affected member
  "newRole": "ADMIN"        // "ADMIN" | "MEMBER" | "MODERATOR" (etc.)
}
```
**Render:** *"[Actor] made [target] an [newRole]"*

---

### `GROUP_INFO_UPDATED`
> Group name or avatar was changed (or both simultaneously).

```jsonc
{
  "action": "GROUP_INFO_UPDATED",
  "actorId": "uuid",
  "changes": {
    "name": "New Name",       // present only if name changed
    "avatarChanged": true     // present only if avatar changed
  }
}
```
**Render (name):** *"[Actor] renamed the group to '[changes.name]'"*  
**Render (avatar):** *"[Actor] changed the group photo"*  
**Render (both):** show both lines, or *"[Actor] updated the group info"*

---

## 3. Message List Rendering Rules

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
| `chat.event.member_added` | `MEMBER_ADDED` | Adding members to group/community |
| `chat.event.member_removed` | `MEMBER_LEFT` | Self-leave |
| `chat.event.member_removed` | `MEMBER_REMOVED` | Admin removes member |
| `group.event.member_kicked` | `MEMBER_KICKED` | Hard-kick by admin |
| `group.event.member_role_changed` | `ROLE_CHANGED` | Admin changes member role |
| `chat.event.conversation_updated` | `GROUP_INFO_UPDATED` | Group rename / avatar change |

> Note: `GROUP.DISBANDED` is not yet covered — the group disband flow pushes
> `group:disbanded` WebSocket directly; system message support can be added later.
