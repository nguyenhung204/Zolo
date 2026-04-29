# Realtime Gateway — FE Integration Notes

The FE does not perform Realtime Gateway business logic, but it relies on the gateway's routing guarantees to keep social and group UI current without reloads.

## Routing Guarantees

- Friendship lifecycle events are sent to affected users' own sockets.
- `conversation:new` is sent to the exact sockets of initial conversation members after the conversation is ready.
- Group membership/lifecycle events are sent to own sockets, not only to users in `conversation:{id}` rooms.
- Kick/disband force sockets to leave `conversation:{id}` and emit `conversation:removed` as a safety event.
- Disband uses a member snapshot captured before member deletion, so old members still receive `group:disbanded`.

## Friend Accept Flow

```text
User B accepts User A
  ├─ HTTP POST /friendships/requests/{userA}/accept
  ├─ WS friendship:request_accepted -> both users patch friend state
  ├─ Conversation Service creates DIRECT conversation
  └─ WS conversation:new { type: "direct" } -> both users insert/fetch the chat row
```

FE rules:

- Do not block the friend state on direct chat creation.
- Keep the friend CTA/list optimistic after the HTTP ACK.
- Use `conversation:new` as the only "DIRECT chat is ready" signal.

## Invite-Link Group Flow

```text
Invite link, approval off
  └─ WS conversation:member-added { source: "invite_link" }

Invite link, approval on
  ├─ WS group:join_requested { source: "invite_link" }
  ├─ WS group:join_approved { reviewedByName }
  └─ or WS group:join_rejected { reviewedByName }
```

FE rules:

- For `conversation:member-added`, if current user is included in `addedUsers`, fetch/insert the group row immediately.
- For `group:join_requested`, update the admin pending queue without refetch when possible.
- For approve/reject, remove the pending request and show reviewer display name when available.

## Removal Safety

Use domain events for nice UX copy, and `conversation:removed` as the generic teardown path.

| Event | FE action |
| --- | --- |
| `conversation:member-removed` | Remove member from cache; if self, remove row and navigate away |
| `group:member_kicked` | If self, remove row, clear room state, show kicked copy |
| `group:disbanded` | Remove row for every member and block sends/retries |
| `conversation:removed` | Always clear room subscriptions/caches if the richer event was missed |

Current FE implementation registers these globally in `useSocket`, so events received on own sockets update caches even when the group conversation is not open. The conversation screen also registers `useGroupSocketEvents` for active-room UX and navigation.

## Optimistic UI + WS Reconcile

Recommended pattern:

1. Run HTTP mutation.
2. On HTTP success, optimistically update local cache/button state.
3. On WS event, reconcile cache with server payload and update other tabs/devices.
4. Fetch in the background only for heavy data such as full conversation rows or presigned avatar URLs.
5. Never rely on a manual reload to see accepted friends, invite joins, kicks, or disbands.
