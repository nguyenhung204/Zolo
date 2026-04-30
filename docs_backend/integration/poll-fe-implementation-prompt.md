# FE Implementation Prompt — Group Polls

> Send this verbatim to the FE engineer. It contains the exact REST routes,
> Socket.IO event names, payload shapes, and the optimistic-update + cache
> reconciliation contract.

---

## Goal

Implement the group-polls feature against the BCN backend so users can:

- See an existing poll without 404s
- Vote with an optimistic UI
- Receive other members' votes in realtime via Socket.IO
- See "poll created" / "poll closed" events in realtime
- Get an FCM push when someone in their group creates a poll (only when
  they are offline AND notification preferences allow it)

You are wiring up a feature whose backend is fully implemented and tested —
do not invent endpoints; the only valid surface is documented below.

---

## Common pitfalls (read first)

1. **The path is `/conversations/:conversationId/polls/:pollId/...`**, NOT
   top-level `/polls/:pollId/...`. Top-level URLs return `404 Not Found`.
2. The vote route ends in **`/votes`** (plural), not `/vote`.
3. There is no `GET /polls/:pollId`. Use
   `GET /conversations/:conversationId/polls/:pollId` instead.
4. Socket events are named **`group:poll_created`**, **`group:poll_voted`**,
   **`group:poll_closed`** (colon, snake_case). They are NOT `poll.created`
   etc.

---

## REST surface

Base URL: `https://api.bcn.id.vn`. All requests need
`Authorization: Bearer <jwt>` (Keycloak access token).

### Create a poll

```
POST /conversations/:conversationId/polls
Body:
  {
    "question": "When should we ship?",
    "options": ["This Friday", "Next Monday", "Next Wednesday"],
    "multipleChoice": false,
    "deadline": "2026-04-28T18:00:00.000Z"   // optional ISO-8601
  }
Response 201:
  Poll  (see schema below)
```

Constraints: 2–10 options, no duplicates (case-insensitive), deadline must
be in the future.

### List polls in a conversation

```
GET /conversations/:conversationId/polls?includeClosed=true
Response 200: { "polls": Poll[] }   // newest first
```

### Get a single poll

```
GET /conversations/:conversationId/polls/:pollId
Response 200: { "poll": Poll }
404 if poll doesn't belong to the conversation
```

### Vote (cast or update)

```
POST /conversations/:conversationId/polls/:pollId/votes
Body:
  { "optionIds": ["opt-uuid-1"] }                         // multipleChoice = false
  { "optionIds": ["opt-uuid-1", "opt-uuid-2"] }           // multipleChoice = true
  // single-choice clients may also send: { "optionId": "opt-uuid-1" }
Response 200: { "success": true, "poll": Poll }
```

Idempotent — submitting the same `optionIds` twice produces the same final
state. The backend wipes the user's previous selection then applies the
new one inside a `SELECT … FOR UPDATE` transaction.

### Close a poll (admin / owner only)

```
POST /conversations/:conversationId/polls/:pollId/close
Response 200: { "success": true, "poll": Poll }
```

After this, the backend rejects any further votes with `403 Forbidden`.

### Schema

```ts
type Poll = {
  id: string;
  conversationId: string;
  creatorId: string;
  question: string;
  options: PollOption[];
  multipleChoice: boolean;
  deadline: string | null;     // ISO-8601 or null
  isClosed: boolean;
  createdAt: string;
};

type PollOption = {
  id: string;
  text: string;
  voterIds: string[];          // user UUIDs
};
```

---

## Socket.IO surface

Socket URL: `wss://api.bcn.id.vn` (or whatever the realtime-gateway is
exposed at). Authenticate exactly as you do today (JWT in handshake).

Polls do not need a special room subscription — events are pushed to every
group member's personal `user:{userId}` room, so as long as the socket is
connected and authenticated you receive them.

### `group:poll_created`

```jsonc
{
  "conversationId": "uuid",
  "poll": Poll,                 // full poll object, isClosed: false
  "createdBy": "user-uuid",
  "createdByName": "Alice",
  "timestamp": "2026-04-25T10:06:00.000Z"
}
```

FE: prepend `payload.poll` to the polls list cache. No refetch.

### `group:poll_voted`

```jsonc
{
  "conversationId": "uuid",
  "pollId": "uuid",
  "voterId": "user-uuid",
  "voterName": "Bob",
  "optionIds": ["opt-uuid"],
  "options": PollOption[],      // FULL updated options snapshot
  "timestamp": "2026-04-25T10:07:00.000Z"
}
```

FE: replace `poll.options` with `payload.options`. Skip the event if
`voterId === currentUser.id` AND your optimistic update already applied
(see optimistic pattern below).

### `group:poll_closed`

```jsonc
{
  "conversationId": "uuid",
  "pollId": "uuid",
  "closedBy": "user-uuid",
  "closedByName": "Alice",
  "options": PollOption[],
  "timestamp": "2026-04-25T10:08:00.000Z"
}
```

FE: set `isClosed = true` and replace `options`. Disable the voting UI.

---

## Optimistic-update + cache contract

```ts
const voteMutation = useMutation({
  mutationFn: ({ conversationId, pollId, optionIds }: VoteArgs) =>
    api.post(
      `/conversations/${conversationId}/polls/${pollId}/votes`,
      { optionIds },
    ),

  onMutate: async ({ pollId, optionIds }) => {
    await queryClient.cancelQueries({ queryKey: ['poll', pollId] });
    const snapshot = queryClient.getQueryData<Poll>(['poll', pollId]);

    queryClient.setQueryData<Poll>(['poll', pollId], (old) => {
      if (!old) return old;
      const voteSet = new Set(optionIds);
      return {
        ...old,
        options: old.options.map((opt) => {
          let voters = opt.voterIds.filter((id) => id !== currentUser.id);
          if (voteSet.has(opt.id)) voters = [...voters, currentUser.id];
          return { ...opt, voterIds: voters };
        }),
      };
    });

    return { snapshot };
  },

  onError: (err, { pollId }, ctx) => {
    if (ctx?.snapshot) {
      queryClient.setQueryData(['poll', pollId], ctx.snapshot);
    }
    if (err.response?.status === 403) {
      toast.error('Voting is closed for this poll.');
    }
  },

  onSettled: (_, __, { pollId }) => {
    queryClient.invalidateQueries({ queryKey: ['poll', pollId] });
  },
});

socket.on('group:poll_voted', (payload) => {
  if (payload.voterId === currentUser.id) return;       // already applied
  queryClient.setQueryData<Poll>(['poll', payload.pollId], (old) =>
    old ? { ...old, options: payload.options } : old,
  );
});

socket.on('group:poll_closed', (payload) => {
  queryClient.setQueryData<Poll>(['poll', payload.pollId], (old) =>
    old ? { ...old, isClosed: true, options: payload.options } : old,
  );
});

socket.on('group:poll_created', (payload) => {
  queryClient.setQueryData<{ polls: Poll[] }>(
    ['polls', payload.conversationId],
    (old) => ({ polls: [payload.poll, ...(old?.polls ?? [])] }),
  );
});
```

---

## End-to-end flow (BE side, for reference)

1. FE → `POST /conversations/:cid/polls/:pid/votes`
2. Gateway → conversation-service via TCP `MessagePattern('group_vote_poll')`
3. conversation-service starts a transaction: locks the poll row with
   `SELECT … FOR UPDATE`, wipes the user's previous selection, applies
   the new one, commits.
4. In the same transaction, conversation-service writes a `poll.voted`
   event to the `outbox_events` table.
5. The outbox publisher reads the row and produces a Kafka message on
   topic `group.event.poll_voted`.
6. realtime-gateway's `GroupEventsConsumer` consumes the topic and
   emits `group:poll_voted` to every member's `user:{userId}` room.
7. notification-service does NOT push for vote events (intentional — would
   spam every member every time anyone clicks).

For `POLL_CREATED`, step 7 also fires: notification-service enqueues a
`normal`-priority FCM push for every member except the creator (subject to
the user's mute / quiet-hours / `notifyOnMessage` settings).

---

## Acceptance checklist

- [ ] `GET /polls/:pollId` is **never** called; only the conversation-scoped
      route is used.
- [ ] Vote URL ends in `/votes`, not `/vote`.
- [ ] Optimistic update is rolled back on `4xx`/`5xx`.
- [ ] Skip handler runs when `voterId === currentUser.id` and optimistic
      already applied (no double-toggle).
- [ ] `group:poll_created` prepends to cache without a refetch.
- [ ] `group:poll_closed` disables the voting UI.
- [ ] Socket reconnect refetches the poll list — Socket.IO does not buffer
      missed events across disconnects beyond the realtime-gateway's room
      semantics.

---

## Out of scope (do not change)

- Notification preferences UI — owned by Settings team.
- Call ringing UX — separate FCM track.
