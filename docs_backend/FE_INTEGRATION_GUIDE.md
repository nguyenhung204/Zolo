# Frontend Integration Guide — Group Management Module

**Version:** 1.0  
**Date:** 2026-04-25  
**Backend contact:** Lead Backend Engineer  
**Scope:** All new REST endpoints, Socket.IO events, and state-management patterns introduced by the Group Management sprint.

---

## Table of Contents

1. [Authentication Model](#1-authentication-model)
2. [REST API Contract](#2-rest-api-contract)
3. [Socket.IO Event Registry](#3-socketio-event-registry)
4. [Optimistic UI & State Management](#4-optimistic-ui--state-management)
5. [Error Handling Reference](#5-error-handling-reference)
6. [End-to-End Flows](#6-end-to-end-flows)

---

## 1. Authentication Model

All REST calls require a **Bearer JWT** issued by Keycloak in the `Authorization` header:

```
Authorization: Bearer <access_token>
```

Socket.IO connections authenticate via the `auth` handshake object:

```ts
const socket = io(WS_URL, {
  auth: { token: accessToken },
});
```

Token expiry: the gateway returns `401 Unauthorized` when the Keycloak access token expires. Refresh via the Keycloak `/token` endpoint (handled by your auth lib) and **reconnect** the Socket.IO client.

---

## 2. REST API Contract

Base URL: `https://<host>/api/v1`  
All payloads are `application/json`.  
All timestamps are **ISO 8601 UTC** strings.

---

### 2.1 Group Settings

#### `PATCH /conversations/:conversationId/settings`

Update group visibility, messaging permissions, or join approval policy.

| Field            | Value                                |
|------------------|--------------------------------------|
| **Auth**         | Required — caller must be OWNER or ADMIN |
| **Path param**   | `conversationId` — UUID              |

**Request body** (all fields optional — send only what changes):
```json
{
  "allowMemberMessage": false,
  "isPublic": true,
  "joinApprovalRequired": true
}
```

**Responses:**

| Status | Body |
|--------|------|
| `200 OK` | Updated `Conversation` object |
| `403 Forbidden` | Caller is below ADMIN |
| `404 Not Found` | Conversation does not exist |

**Updated `Conversation` shape (relevant new fields):**
```jsonc
{
  "id": "uuid",
  "name": "Engineering Team",
  "type": "group",
  "isPublic": true,
  "joinApprovalRequired": false,
  "allowMemberMessage": true,
  "linkVersion": 3,
  "memberCount": 14,
  "updatedAt": "2026-04-25T10:00:00.000Z"
}
```

> **FE note:** After a successful PATCH, update the React Query cache entry for `["conversation", conversationId]` with the returned object — do **not** invalidate and refetch, as other clients will receive the `group.settings_updated` Socket event.

---

### 2.2 Member Role Management

#### `PATCH /conversations/:conversationId/members/:userId/role`

Change a member's role.

| Field  | Value                                         |
|--------|-----------------------------------------------|
| **Auth** | Required — OWNER may set any role except OWNER; ADMIN cannot change roles |

**Request body:**
```json
{
  "role": "admin"
}
```

Valid `role` values (hierarchy, lowest → highest): `member` `admin` `owner`

**Responses:**

| Status | Body |
|--------|------|
| `200 OK` | `{ "message": "Role updated" }` |
| `403 Forbidden` | Caller lacks permission (e.g., ADMIN trying to promote to ADMIN) |
| `404 Not Found` | Member not found |

---

#### `DELETE /conversations/:conversationId/members/:userId`

Kick a member.

| Field  | Value                           |
|--------|---------------------------------|
| **Auth** | Required — ADMIN or above; cannot kick OWNER |

**Responses:**

| Status | Body |
|--------|------|
| `200 OK` | `{ "message": "Member removed" }` |
| `403 Forbidden` | Attempting to kick OWNER |
| `404 Not Found` | Member not in group |

---

#### `DELETE /conversations/:conversationId`

Disband the group entirely (OWNER only).

**Responses:**

| Status | Body |
|--------|------|
| `200 OK` | `{ "message": "Group disbanded" }` |
| `403 Forbidden` | Not the OWNER |

---

### 2.3 Invite Links

#### `POST /conversations/:conversationId/invite-link`

Generate a 7-day invite link.

| Field  | Value                    |
|--------|--------------------------|
| **Auth** | ADMIN or above required |

**Response `200 OK`:**
```json
{
  "url": "https://zolo.chat/join/<signed-jwt>",
  "expiresAt": "2026-05-02T10:00:00.000Z"
}
```

---

#### `POST /conversations/:conversationId/invite-link/reset`

Revoke **all** previously issued invite links instantly. Increments `linkVersion` on the conversation row — every older JWT immediately fails validation regardless of expiry.

| Field  | Value                    |
|--------|--------------------------|
| **Auth** | ADMIN or above required |

**Response `200 OK`:**
```json
{ "message": "Invite link reset. All previous links are now invalid." }
```

---

#### `POST /join/:token`

Validate a token and add the caller to the group.

| Field  | Value                                |
|--------|--------------------------------------|
| **Auth** | Required (any authenticated user)   |

**Responses:**

| Status | Meaning |
|--------|---------|
| `200 OK` | Joined — body contains the `Conversation` object |
| `401 Unauthorized` | Token is expired or has an invalid signature |
| `403 Forbidden` | Token was revoked (link was reset after this token was issued) |
| `404 Not Found` | Group no longer exists |
| `409 Conflict` | Already a member |

---

### 2.4 Polls

#### `POST /conversations/:conversationId/polls`

Create a poll.

**Request body:**
```json
{
  "question": "When should we ship?",
  "options": ["This Friday", "Next Monday", "Next Wednesday"],
  "multipleChoice": false,
  "deadline": "2026-04-28T18:00:00.000Z"
}
```

Constraints: 2–10 options. `deadline` is optional. `multipleChoice` defaults to `false`.

**Response `201 Created`:**
```jsonc
{
  "id": "uuid",
  "conversationId": "uuid",
  "creatorId": "uuid",
  "question": "When should we ship?",
  "options": [
    { "id": "uuid", "text": "This Friday",    "voterIds": [] },
    { "id": "uuid", "text": "Next Monday",    "voterIds": [] },
    { "id": "uuid", "text": "Next Wednesday", "voterIds": [] }
  ],
  "multipleChoice": false,
  "deadline": "2026-04-28T18:00:00.000Z",
  "isClosed": false,
  "createdAt": "2026-04-25T10:00:00.000Z"
}
```

---

#### `POST /polls/:pollId/vote`

Cast or update your vote. **Idempotent** — submitting the same `optionIds` twice is safe.

**Request body:**
```json
{
  "optionIds": ["<option-uuid>"]
}
```

For `multipleChoice: true`, include multiple IDs.  
For `multipleChoice: false`, include exactly one ID.

**Response `200 OK`:** Updated `Poll` object with new `voterIds`.

**Responses:**

| Status | Meaning |
|--------|---------|
| `200 OK` | Vote recorded — body is updated Poll |
| `400 Bad Request` | Empty `optionIds`, invalid IDs, or too many IDs for single-choice |
| `403 Forbidden` | Poll is closed or deadline passed |
| `404 Not Found` | Poll not found |

---

#### `POST /polls/:pollId/close`

Close a poll (no more votes accepted). Only the OWNER, ADMIN, or poll creator may close.

**Response `200 OK`:** Updated `Poll` object with `isClosed: true`.

---

### 2.5 Appointments

#### `POST /conversations/:conversationId/appointments`

**Request body:**
```json
{
  "title": "Sprint Planning",
  "description": "Q2 planning session",
  "scheduledAt": "2026-05-10T09:00:00.000Z",
  "location": "https://meet.google.com/xyz"
}
```

`scheduledAt` must be in the future. A reminder BullMQ job fires 15 minutes before `scheduledAt`.

**Response `201 Created`:** `Appointment` object.

---

#### `PATCH /appointments/:appointmentId`

Update title, description, time, or location. If `scheduledAt` changes the reminder is automatically rescheduled.

**Request body** (all fields optional):
```json
{
  "scheduledAt": "2026-05-10T10:00:00.000Z",
  "location": "Room 4B"
}
```

**Response `200 OK`:** Updated `Appointment` object.

---

#### `DELETE /appointments/:appointmentId`

Soft-delete. BullMQ reminder is cancelled.

**Response `204 No Content`**

---

### 2.6 Join Requests (for `joinApprovalRequired` groups)

#### `POST /conversations/:conversationId/join-requests`

Request to join.

**Request body** (optional):
```json
{ "requestMessage": "Hi, I'm Alice from Marketing" }
```

---

#### `PATCH /conversations/:conversationId/join-requests/:requestId`

Approve or reject.

**Request body:**
```json
{ "status": "approved" }
```

Valid values: `approved`, `rejected`.

---

## 3. Socket.IO Event Registry

The Realtime Gateway (port `3002` by default) re-publishes Kafka group events as Socket.IO room events. **Every event listed here is scoped to a `conversationId` room** — the client must be subscribed to that room to receive it.

### How to join a room

```ts
socket.emit('join_conversation', { conversationId: 'uuid' });
```

### Timestamp & Clock Skew

Every event payload includes a `timestamp` field. This is the **Kafka broker ingestion time** — not the client's wall clock. Always use this field for ordering, deduplication, and display.

```ts
// Good
const sorted = messages.sort((a, b) =>
  new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
);

// Bad — client clock may drift by ±30s
const sorted = messages.sort((a, b) => a.localTime - b.localTime);
```

---

### Event: `group.settings_updated`

Fired when an ADMIN/OWNER changes group settings.

```jsonc
{
  "conversationId": "uuid",
  "updatedBy": "user-uuid",
  "changes": {
    "allowMemberMessage": false   // only changed fields present
  },
  "timestamp": "2026-04-25T10:01:00.000Z"
}
```

**FE action:** Merge `changes` into your local `Conversation` cache entry. Do **not** refetch from REST — the diff is already here.

```ts
socket.on('group.settings_updated', (payload) => {
  queryClient.setQueryData(['conversation', payload.conversationId], (old) => ({
    ...old,
    ...payload.changes,
  }));
});
```

---

### Event: `group.member_role_changed`

```jsonc
{
  "conversationId": "uuid",
  "userId": "user-uuid",
  "newRole": "admin",
  "timestamp": "2026-04-25T10:02:00.000Z"
}
```

**FE action:** Update the `role` field for `userId` in your member list cache. If `userId === currentUser.id`, re-evaluate which UI controls are visible (show/hide admin panel, poll creation button, etc.).

---

### Event: `group.member_kicked`

```jsonc
{
  "conversationId": "uuid",
  "userId": "user-uuid",
  "kickedBy": "admin-uuid",
  "timestamp": "2026-04-25T10:03:00.000Z"
}
```

**FE action:**

- If `payload.userId === currentUser.id`: show a toast ("You were removed from this group"), then navigate to `/chats`. Evict the conversation from all local caches.
- Otherwise: remove the member from the member list cache entry.

```ts
socket.on('group.member_kicked', (payload) => {
  if (payload.userId === currentUser.id) {
    toast.error('You have been removed from this group');
    queryClient.removeQueries(['conversation', payload.conversationId]);
    navigate('/chats');
  } else {
    queryClient.setQueryData(
      ['members', payload.conversationId],
      (old: Member[]) => old.filter((m) => m.userId !== payload.userId),
    );
  }
});
```

---

### Event: `group.disbanded`

```jsonc
{
  "conversationId": "uuid",
  "disbandedBy": "owner-uuid",
  "timestamp": "2026-04-25T10:04:00.000Z"
}
```

**FE action:** Show toast "This group has been disbanded", evict ALL caches for this conversation, navigate to `/chats`. No REST call needed.

---

### Event: `group.invite_link_reset`

```jsonc
{
  "conversationId": "uuid",
  "resetBy": "admin-uuid",
  "timestamp": "2026-04-25T10:05:00.000Z"
}
```

**FE action:** If the local UI is showing a previously fetched invite URL, clear it and show a "Link has been reset — generate a new one" message. Do not display the old URL.

---

### Event: `poll.created`

```jsonc
{
  "pollId": "uuid",
  "conversationId": "uuid",
  "creatorId": "uuid",
  "question": "When should we ship?",
  "options": [
    { "id": "uuid", "text": "This Friday",    "voterIds": [] },
    { "id": "uuid", "text": "Next Monday",    "voterIds": [] }
  ],
  "multipleChoice": false,
  "deadline": "2026-04-28T18:00:00.000Z",
  "timestamp": "2026-04-25T10:06:00.000Z"
}
```

**FE action:** Prepend the new poll to the polls list for this conversation. No refetch needed.

---

### Event: `poll.voted`

This is the most performance-critical event. The payload carries the **full updated options snapshot** so the UI can render without a round trip.

```jsonc
{
  "pollId": "uuid",
  "conversationId": "uuid",
  "userId": "voter-uuid",
  "optionIds": ["opt-uuid"],
  "updatedOptions": [
    { "id": "opt-uuid-1", "text": "This Friday",  "voterIds": ["user-a", "user-b"] },
    { "id": "opt-uuid-2", "text": "Next Monday",  "voterIds": [] }
  ],
  "timestamp": "2026-04-25T10:07:00.000Z"
}
```

**FE action:** Skip this event if `payload.userId === currentUser.id` **and** you already applied the vote optimistically. Otherwise replace `poll.options` in your local cache with `updatedOptions`.

```ts
socket.on('poll.voted', (payload) => {
  // Skip: our own optimistic update already applied this
  if (payload.userId === currentUser.id) return;

  queryClient.setQueryData(['poll', payload.pollId], (old: Poll) => ({
    ...old,
    options: payload.updatedOptions,
  }));
});
```

---

### Event: `poll.closed`

```jsonc
{
  "pollId": "uuid",
  "conversationId": "uuid",
  "closedBy": "user-uuid",
  "finalOptions": [ /* same shape as updatedOptions */ ],
  "timestamp": "2026-04-25T10:08:00.000Z"
}
```

**FE action:** Set `isClosed = true` and update `options` in the poll cache. Disable the voting UI.

---

### Event: `group.appointment_created` / `group.appointment_updated` / `group.appointment_deleted`

```jsonc
// appointment_created / appointment_updated
{
  "appointmentId": "uuid",
  "conversationId": "uuid",
  "title": "Sprint Planning",
  "scheduledAt": "2026-05-10T09:00:00.000Z",
  "location": "https://meet.google.com/xyz",
  "timestamp": "2026-04-25T10:09:00.000Z"
}

// appointment_deleted
{
  "appointmentId": "uuid",
  "conversationId": "uuid",
  "deletedBy": "user-uuid",
  "timestamp": "2026-04-25T10:10:00.000Z"
}
```

---

### Event: `group.appointment_reminder`

Fired **15 minutes before** the appointment's `scheduledAt`.

```jsonc
{
  "appointmentId": "uuid",
  "conversationId": "uuid",
  "title": "Sprint Planning",
  "scheduledAt": "2026-05-10T09:00:00.000Z",
  "timestamp": "2026-05-10T08:45:00.000Z"
}
```

**FE action:** Show a push notification or in-app toast: _"Sprint Planning starts in 15 minutes."_

---

### Event: `group.join_requested` / `group.join_approved` / `group.join_rejected`

For groups with `joinApprovalRequired = true`:

```jsonc
// join_requested (sent to group admins)
{
  "conversationId": "uuid",
  "userId": "requester-uuid",
  "requestMessage": "Hi, I'm Alice",
  "timestamp": "2026-04-25T10:11:00.000Z"
}

// join_approved / join_rejected (sent to the requester)
{
  "conversationId": "uuid",
  "userId": "requester-uuid",
  "reviewedBy": "admin-uuid",
  "status": "approved",
  "timestamp": "2026-04-25T10:12:00.000Z"
}
```

---

## 4. Optimistic UI & State Management

### 4.1 Which actions to make optimistic

| Action | Optimistic? | Rationale |
|--------|-------------|-----------|
| Vote on a poll | **Yes** | Latency-sensitive; visually instant |
| Pin/unpin a message | **Yes** | Same pattern as voting |
| Send a message | **Yes** | Core UX requirement |
| Kick a member | **No** | Destructive; wait for confirmation |
| Change member role | **No** | RBAC state must be authoritative |
| Disband group | **No** | Irreversible; require server ack |
| Reset invite link | **No** | Security-critical; wait for ack |
| Update group settings | **No** | Other members' UX depends on consistency |
| Create/update appointment | **No** | BullMQ scheduling must complete first |

---

### 4.2 Optimistic vote pattern (React Query `useMutation`)

```ts
const voteMutation = useMutation({
  mutationFn: ({ pollId, optionIds }: VoteArgs) =>
    api.post(`/polls/${pollId}/vote`, { optionIds }),

  onMutate: async ({ pollId, optionIds }) => {
    // 1. Cancel any in-flight refetches
    await queryClient.cancelQueries({ queryKey: ['poll', pollId] });

    // 2. Snapshot for rollback
    const snapshot = queryClient.getQueryData<Poll>(['poll', pollId]);

    // 3. Apply optimistic update
    queryClient.setQueryData<Poll>(['poll', pollId], (old) => {
      if (!old) return old;
      const voteSet = new Set(optionIds);
      return {
        ...old,
        options: old.options.map((opt) => {
          const alreadyVoted = opt.voterIds.includes(currentUser.id);
          const nowVoting   = voteSet.has(opt.id);

          let voters = opt.voterIds.filter((id) => id !== currentUser.id);
          if (nowVoting) voters = [...voters, currentUser.id];
          return { ...opt, voterIds: voters };
        }),
      };
    });

    return { snapshot };
  },

  onError: (err, { pollId }, ctx) => {
    // Roll back to snapshot
    if (ctx?.snapshot) {
      queryClient.setQueryData(['poll', pollId], ctx.snapshot);
    }
    // Surface "allowMemberMessage" guard errors
    if (err.response?.status === 403) {
      toast.error('You do not have permission to vote in this group.');
    }
  },

  onSettled: (_, __, { pollId }) => {
    // Always re-sync to ensure consistency with other voters
    queryClient.invalidateQueries({ queryKey: ['poll', pollId] });
  },
});
```

---

### 4.3 Handling `allowMemberMessage: false`

When the group setting `allowMemberMessage` is `false`, the backend rejects message sends and votes from members with a `403 Forbidden`. The FE must:

1. **Proactively disable** the message input and vote controls before the user tries (check `conversation.allowMemberMessage && member.role === 'member'`).
2. **Handle the 403 defensively** in `onError` callbacks because settings can change mid-session (the Socket event will update the cache, but there is a race window).
3. Show a clear, non-disruptive notification: _"Only admins can post in this group."_

```ts
const canInteract =
  conversation.allowMemberMessage || ['owner', 'admin'].includes(myRole);
```

---

### 4.4 Cache invalidation vs. incremental update

| Trigger | Strategy | Reason |
|---------|----------|--------|
| `group.settings_updated` Socket event | **Merge** diff into cache | Payload already contains the full diff |
| `poll.voted` Socket event | **Replace** `options` array | Payload carries the authoritative full snapshot |
| `poll.closed` Socket event | **Merge** `isClosed + finalOptions` | No refetch needed |
| `group.member_kicked` (other user) | **Remove** member from list | Precise incremental update |
| `group.member_kicked` (self) | **Evict** entire conversation from cache | User is no longer a member |
| `group.disbanded` | **Evict** entire conversation | Conversation no longer exists |
| Vote `onSettled` | **Invalidate** poll query | Reconcile with server after optimistic |
| Appointment created/updated/deleted REST response | **Invalidate** appointments list | Reliable server state |
| Invite link reset REST response | **Delete** invite URL from local state | Old URL is now invalid |

---

### 4.5 Role-aware UI rendering

The member's resolved role is available on every request via the `X-Group-Role` response header (set by `GroupRoleGuard`). Cache this per-conversation:

```ts
// In your API interceptor
const role = response.headers['x-group-role'];
if (role) store.setGroupRole(conversationId, role);
```

Role hierarchy for client-side checks:
```
member < admin < owner
```

```ts
const ROLE_INDEX = { member: 0, admin: 1, owner: 2 };

function hasRole(userRole: string, minRole: string): boolean {
  return ROLE_INDEX[userRole] >= ROLE_INDEX[minRole];
}
```

---

## 5. Error Handling Reference

All errors follow a consistent envelope:

```jsonc
{
  "statusCode": 403,
  "message": "Only the OWNER can change member roles",
  "errorCode": "FORBIDDEN",
  "timestamp": "2026-04-25T10:00:00.000Z"
}
```

| HTTP Status | When it appears | FE action |
|-------------|-----------------|-----------|
| `400 Bad Request` | Invalid payload (e.g., <2 poll options, past `scheduledAt`) | Show inline field error |
| `401 Unauthorized` | Token expired or invalid | Trigger token refresh → retry |
| `403 Forbidden` | Insufficient role, closed poll, `allowMemberMessage` guard | Toast + rollback optimistic state |
| `404 Not Found` | Resource deleted between render and action | Evict stale cache, show "no longer available" |
| `409 Conflict` | Already a member (invite join) | Navigate to the existing conversation |

---

## 6. End-to-End Flows

### Flow A: Member votes on a poll (happy path)

```
FE → PATCH /polls/:id/vote        (optimistic UI applied immediately)
      ↓
BE  → PollService.votePoll()       (SELECT … FOR UPDATE → mutate → outbox)
      ↓
BE  → Outbox relay → Kafka         (topic: group.event.poll_voted)
      ↓
BE  → Realtime Gateway consumes    (Socket.IO emit to conversationId room)
      ↓
All FE clients in room ← poll.voted event  (skip if userId === self)
      ↓
FE  → onSettled: invalidate ['poll', id]   (sync with authoritative state)
```

### Flow B: Admin kicks a member

```
FE → DELETE /conversations/:id/members/:userId  (no optimistic update)
     ↓
BE  → GroupMemberService.kickMember()            (DB + outbox + Redis HDEL)
     ↓
BE  → Outbox relay → Kafka (group.event.member_kicked)
     ↓
BE  → Realtime Gateway → Socket room emit
     ↓
Kicked user's FE ← group.member_kicked  (userId === self → navigate away)
Other members' FE ← group.member_kicked (remove from member list cache)
```

### Flow C: Appointment reminder (passive, BullMQ-driven)

```
AppointmentService.createAppointment()
     ↓
BullMQ delayed job scheduled (delay = scheduledAt − now − 15min)
     ↓
[15 min before scheduledAt] BullMQ fires AppointmentWorker.process()
     ↓
Worker writes outbox record (idempotencyKey prevents duplicate on retry)
     ↓
Outbox relay → Kafka (group.event.appointment_reminder)
     ↓
Realtime Gateway → Socket emit to conversationId room
     ↓
All FE clients ← group.appointment_reminder → show push notification
```

---

*Questions? Slack `#backend-platform` or open a ticket tagged `group-management`.*
