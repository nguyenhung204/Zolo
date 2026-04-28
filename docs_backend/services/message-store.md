# Message Store Service

## Overview

Message Store is the persistence and read layer for chat messages. It consumes validated message events from Chat Core, assigns conversation offsets, stores message rows in PostgreSQL, and publishes realtime-facing events after persistence.

It also owns three Domain 3 concerns that are easy to miss in older docs:

- Zero-Kafka reactions: Redis hash + Redis Pub/Sub fast path
- Attachment sync: consumes `media.ready` / `media.failed` and updates message attachments
- Sticker catalog reads: packages and stickers are read directly from PostgreSQL

This service does not enforce ACL windows or membership rules. Those stay in Chat Core and Conversation Service.

---

## Responsibilities

### Write path

- Consume `chat.message.accepted`
- Assign offsets using Redis warm path with TCP cold fallback
- Persist messages to PostgreSQL
- Bind media IDs to messages via Media Service for later access control
- Publish `chat.message_saved`

### Mutation path

- Consume `chat.event.message_edited`
- Consume `chat.event.message_deleted`
- Consume `chat.event.message_pinned`
- Consume `chat.event.message_unpinned`
- Consume `chat.event.message_revoked`
- Persist edit history and soft-delete / revoke flags
- Publish `chat.event.message_updated` for realtime fan-out

### Read path

- Return offset-based message history using `after` / `before`
- Apply per-user `deleted_until` visibility filtering
- Return pinned messages
- Return single message lookup by ID
- Answer `hasReplied` checks
- Serve sticker package and sticker list queries

### Reaction path

- Accept `REACT_MESSAGE` over TCP
- Store reactions in Redis immediately without Kafka
- Publish live reaction changes through Redis Pub/Sub
- Flush reaction state back into `messages.metadata.reactions` every 5 seconds

---

## TCP Patterns

| Pattern | Behavior |
|---------|----------|
| `GET_MESSAGES` | Returns message history for `{ conversationId, userId, after?, before?, limit }` |
| `GET_MESSAGE_BY_ID` | Returns a single message row or `null` |
| `HAS_REPLIED` | Returns `true` if the user has sent any message in the conversation |
| `GET_PINNED_MESSAGES` | Returns pinned messages with `pinnedBy` and `pinnedAt` |
| `GET_STICKER_PACKAGES` | Returns all sticker packages ordered by `createdAt ASC` |
| `GET_PACKAGE_STICKERS` | Returns `{ items, total }` for a package with `limit` / `offset` |
| `REACT_MESSAGE` | Zero-Kafka reaction fast path |

### `GET_MESSAGES`

Actual query model from code:

- `after`: fetch newer messages with `offset > after`
- `before`: fetch older messages with `offset < before`
- `limit`: default `50`, capped at `100`
- Reads `conversation_members.deleted_until` for the requesting user and hides older bulk-deleted messages

The service itself does not update seen or delivered cursors. Those belong to Conversation Service.

---

## Write Path

### Message acceptance

`MessageAcceptedConsumer` handles `chat.message.accepted` as follows:

1. Rejects old non-UUID message IDs
2. Checks whether the message already exists for idempotency
3. Assigns offset
4. Persists the message with its final offset
5. Binds all media IDs to the message through Media Service
6. Publishes `chat.message_saved`

### Offset assignment

Warm path:

- Redis Lua script on `chat:conv:{conversationId}:max_offset`
- If the counter exists, increment in Redis and avoid TCP/DB work

Cold path:

- If the Redis key is absent, call `CONVERSATION_PATTERNS.INCREMENT_MAX_OFFSET`
- Seed Redis with `SET NX`
- Continue using Redis on the next message

When Redis assigns the offset, Message Store also marks `chat:conv:dirty_offsets` so Conversation Service can sync `conversations.max_offset` back to PostgreSQL later.

### `chat.message_saved` payload

The current code publishes a full save event, not a tiny notification-only event. Payload includes:

- `messageId`
- `conversationId`
- `conversationType`
- `senderId`
- `senderName`
- `conversationName` (only for non-DIRECT conversations)
- `latestOffset`
- `createdAt`
- `content` (may be an empty string for media-only messages)
- `type`
- `replyToId`
- `metadata`
- `attachments`
- `forwardedFrom`

That is what enables Realtime Gateway to emit `message:new` to active conversation rooms without forcing an extra HTTP fetch.

---

## Reaction Architecture

Reactions are a Zero-Kafka fast path.

### Immediate write path

`reactToMessage()` does this synchronously:

1. Verify the message exists
2. Write or remove one field in Redis hash `msg:reaction:{messageId}`
   - field format: `{emoji}:{reactorId}`
   - value: `'1'`
3. Add the message ID to dirty set `msg:reaction:dirty`
4. Re-aggregate the current hash into `{ emoji: userId[] }`
5. Publish the aggregated state to Redis Pub/Sub channel `reactions:conv:{conversationId}`

Realtime Gateway subscribes to that Pub/Sub channel and emits `message:reaction_updated`.

### Persistence path

`ReactionSyncJob` runs every 5 seconds:

- Acquires Redis leader lock `message-store:reaction-sync:leader`
- Reads dirty message IDs from `msg:reaction:dirty`
- Reads each hash with `HGETALL`
- Rebuilds `{ emoji: userId[] }`
- Updates `messages.metadata.reactions` in PostgreSQL with `jsonb_set`
- Removes only successfully processed IDs from the dirty set

If a flush fails, the message ID stays dirty and retries on the next tick.

---

## Attachment Sync

`AttachmentSyncConsumer` listens to worker events:

- `media.ready`
- `media.failed`

On `media.ready`:

- Finds the message containing the `mediaId`
- Updates that attachment to `status: READY`
- Stores `variantsReady`, `thumbReady`, and `meta`
- Publishes `chat.event.message_updated` with `patch.attachment`

On `media.failed`:

- Updates the attachment to `status: FAILED`
- Stores the error payload
- Publishes `chat.event.message_updated` with the failed attachment patch

Audio does not participate in this path because Media Worker marks it ready without producing a `media.ready` event.

---

## Other Kafka Consumers

| Topic | Behavior |
|-------|----------|
| `chat.event.message_edited` | Save edit history and update message content |
| `chat.event.message_deleted` | Soft-delete message and publish `message_updated` |
| `chat.event.message_pinned` | Insert into `pinned_messages` |
| `chat.event.message_unpinned` | Remove from `pinned_messages` |
| `chat.event.message_revoked` | Mark `is_revoked=true` and publish tombstone patch |
| `chat.dlq.commands` / `chat.dlq.events` / `chat.dlq` | Structured error logging only |

The DLQ consumer currently logs for manual intervention. It does not replay messages.

---

## Storage Model

### PostgreSQL tables used directly in this service

- `messages`
- `message_edit_history`
- `pinned_messages`
- `sticker_packages`
- `stickers`

### `messages`

Relevant fields from the audited code path:

- `id`
- `conversationId`
- `senderId`
- `content` (nullable / empty for media-only messages)
- `type`
- `offset`
- `metadata`
- `attachments`
- `replyToId`
- `isDeleted`
- `deletedAt`
- `isRevoked`
- `revokedAt`
- `revokedBy`
- forwarding fields
- timestamps

### Sticker catalog

Sticker reads are plain TypeORM queries:

- packages: ordered by `createdAt ASC`
- stickers: ordered by `id ASC`, returned as `{ items, total }`

There is no Redis sticker cache in the current implementation.

---

## Scheduled Jobs

- `ReactionSyncJob`: every 5 seconds, Redis leader lock, flush reactions to PostgreSQL
- `OrphanMessageCleanupJob`: scheduled cleanup for orphaned messages in deleted conversations

---

## Boundaries

Message Store does not:

- validate send/edit/delete ACLs
- enforce membership
- issue media URLs
- broadcast directly to WebSocket clients
- own seen/delivered cursor updates
