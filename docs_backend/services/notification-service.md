# Notification Service

## Overview

Notification Service is a TCP NestJS microservice that handles:

- Push device registration and preference APIs (via TCP patterns called by Gateway)
- Kafka-driven push fanout jobs
- BullMQ-based background dispatch with retries
- Transactional email sending (OTP and password-changed alerts)

Bootstrap entrypoint is `apps/notification-service/src/main.ts`:

- Transport: TCP
- Global filter: `GlobalExceptionFilter`
- Global validation: `createValidationPipe({ forbidNonWhitelisted: false })`

## TCP Patterns (Controller Surface)

Defined in `libs/common/src/constants/patterns/notification.patterns.ts` and handled in `apps/notification-service/src/notification.controller.ts`.

- `REGISTER_DEVICE`
- `UNREGISTER_DEVICE`
- `UPDATE_NOTIFICATION_PREF`
- `GET_NOTIFICATION_PREFS`
- `SEND_OTP_EMAIL`
- `SEND_REGISTRATION_OTP_EMAIL`

### Behavior

- Device operations and preference CRUD are delegated to `NotificationDeviceService`.
- OTP email handlers return `{ success: true|false }` and do not throw to callers on mail send failure.

## Queue And Worker

### Queue

Implemented in `apps/notification-service/src/queue/notification.queue.ts`:

- Queue name: `notification.dispatch`
- Default job options:
  - `attempts: 3`
  - `backoff: { type: 'exponential', delay: 1000 }`
  - `removeOnComplete: true`
  - `removeOnFail: 100`
- Priority mapping:
  - high -> BullMQ priority `1`
  - normal -> no explicit priority

### Worker

Implemented in `apps/notification-service/src/queue/notification.worker.ts`:

- Concurrency from `NOTIFICATION_WORKER_CONCURRENCY` (default `10`).
- Worker consumes `notification.dispatch` jobs and calls `NotificationDispatchService.dispatch(...)`.

## Dispatch Logic

Implemented in `apps/notification-service/src/services/notification-dispatch.service.ts`.

Dispatch order for each job:

1. Presence check via Redis key `REDIS_KEYS.PRESENCE.USER_STATUS(userId)`.
2. Preference check via `NotificationPreferenceService.isAllowed(...)`.
3. Dedup check when `messageId` exists:
   - key: `push:dedup:{userId}:{messageId}`
   - TTL: 30 seconds
4. Load active tokens via `DeviceTokenRepository.findActiveByUserId(...)`.
5. Group by platform and send through `PushProviderFactory`.
6. If at least one send succeeds and `messageId` exists, set dedup key (`EX 30`).

Notes:

- High priority events bypass mute and quiet-hours checks in `NotificationPreferenceService`.
- If user is online, dispatch is skipped.

## Kafka Consumers And Produced Push Payloads

### MessageSavedConsumer

Source: `apps/notification-service/src/consumers/message-saved.consumer.ts`

- Topic: `KAFKA_TOPICS.MESSAGE_SAVED`
- Reads conversation members from Redis set `chat:conversation:{conversationId}:members`
- Excludes sender
- Priority:
  - `high` for mentioned users
  - `normal` otherwise
- Push payload:
  - title: sender display name from the event (`payload.senderName`, fallback `Someone`)
  - body: type-aware copy derived from the event:
    - media messages: `${senderName} sent you a <image|video|audio|file>`
    - text messages: short content preview when available, otherwise `You have a new message`
  - data: `{ conversationId, messageId, type: 'message' }`

### FriendshipConsumer

Source: `apps/notification-service/src/consumers/friendship.consumer.ts`

- Topic: `KAFKA_TOPICS.FRIENDSHIP.REQUEST_SENT`
- Enqueues one `normal` job to recipient
- Push payload:
  - title: `New friend request`
  - body: `${senderName} sent you a friend request`
  - data: `{ fromUserId, type: 'friend_request' }`

### CallEventConsumer

Source: `apps/notification-service/src/consumers/call-event.consumer.ts`

- **Transport: Redis Pub/Sub** (channel `realtime:call_events`), NOT Kafka.
  Call signaling intentionally bypasses the outbox→Kafka pipeline so the
  ringing FCM push goes out within ~50 ms. The `call.event.*` Kafka topics
  are reserved for the durable `ended` event only.
- Filters on `eventType === 'call.event.ringing'` (ignores `accepted` /
  `declined` / `ended` — those are realtime-only UI signals; the device is
  already ringing and pushing again would re-ring an already-handled call).
- Enqueues one `high` priority push per callee with
  `notificationType: 'call'`, `dedupId: 'call_ringing:{callId}'` for
  idempotency.
- Push payload:
  - title: `Incoming call`
  - body: `You have an incoming call`
  - data: `{ callId, conversationId, callerId, type: 'incoming_call' }`

### PollEventsConsumer

Source: `apps/notification-service/src/consumers/poll-events.consumer.ts`

- Topic: `KAFKA_TOPICS.GROUP.POLL_CREATED` (vote/close events do **not** push
  — they would spam every member every time anyone clicks).
- Reads conversation members from Redis set
  `chat:conversation:{conversationId}:members` (or from `payload.memberIds`
  if the producer embeds it).
- Excludes the creator.
- Enqueues `normal` priority jobs with `notificationType: 'message'`, so
  per-conversation mute, global mute, quiet hours and `notifyOnMessage`
  are all respected.
- `dedupId: 'poll_created:{pollId}'` for idempotency.
- Push payload:
  - title: `New poll`
  - body: `{creatorName}: {question}` (truncated to 60 chars)
  - data: `{ type: 'group_poll_created', conversationId, pollId, creatorId }`

### MemberChangesConsumer

Source: `apps/notification-service/src/consumers/member-changes.consumer.ts`

- Topic: `KAFKA_TOPICS.MEMBER_ADDED`
- Enqueues `normal` priority jobs for added users
- Push payload:
  - title: `Added to channel`
  - body: `You were added to a conversation`
  - data: `{ conversationId, type: 'member_added' }`

### AuthEventConsumer

Source: `apps/notification-service/src/consumers/auth-event.consumer.ts`

- Topic: `KAFKA_TOPICS.AUTH_EVENTS`
- Group: `CONSUMER_GROUPS.NOTIFICATION_AUTH_EVENTS`
- Sends security alert email only for:
  - `PASSWORD_RESET_SUCCESS`
  - `PASSWORD_CHANGED`
- Ignores `FORGOT_PASSWORD_REQUESTED`
- Email failures are logged and swallowed (consume loop continues).

## Providers

### FCM (`FcmProvider`)

- Uses `firebase-admin`
- Maps high priority to Android high priority
- Deactivates token on:
  - `messaging/registration-token-not-registered`
  - `messaging/invalid-registration-token`

### APNS (`ApnsProvider`)

- Uses `firebase-admin`
- High priority maps to APNs headers with immediate delivery behavior
- Invalid token handling matches FCM (deactivate token)

### Web Push (`WebPushProvider`)

- Uses `web-push`
- Requires `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (optional subject configurable)
- Stored token is JSON serialized browser `PushSubscription`
- Deactivates token on parse failure or Web Push `404/410`

## Persistence

Repositories under `apps/notification-service/src/infrastructure/repositories`:

- `DeviceTokenRepository`
  - upsert by `(userId, deviceId)`
  - soft deactivate by token or device
  - query active tokens by user
- `NotificationPreferenceRepository`
  - fetch conversation-level override
  - fetch global preference (`conversationId IS NULL`)
  - upsert by `(userId, conversationId)`

## Preference Resolution Rules

From `NotificationPreferenceService`:

| `notificationType` | `priority` | `muteUntil` | quiet hours | `notifyOnX` toggle |
|--------------------|------------|-------------|-------------|---------------------|
| `call`             | `high`     | bypass      | bypass      | bypass (always urgent) |
| `mention`          | `high`     | bypass      | bypass      | respected (`notifyOnMention`) |
| `message`          | `normal`   | respected   | respected   | respected (`notifyOnMessage`) |

Resolution order:

1. If `notificationType === 'call'` and `priority === 'high'` → always allowed.
2. Else, if a per-conversation preference row exists, evaluate it (and stop —
   the conversation row overrides the global row even if it allows the push).
3. Else, evaluate the global preference (`conversationId IS NULL`).
4. If neither row exists → allowed.

Checks include `notifyOnMessage`, `muteUntil`, and the quiet-hours window
(`quietHoursStart`, `quietHoursEnd`, `timezone`). Quiet hours support
overnight windows (e.g. 22:00 → 07:00).

The product policy is "tuân theo setting; chỉ bypass nếu độ ưu tiên cao":
only HIGH-priority pushes may bypass mute / quiet hours. Even high-priority
mentions still respect the explicit `notifyOnMention` toggle, so a user who
turned mention notifications off will not be paged.
