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
  - title: `New message`
  - body: `You have a new message`
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

- Topic: `KAFKA_TOPICS.CALL.STARTED`
- Reads conversation members from Redis
- Excludes host
- Enqueues `high` priority jobs
- Push payload:
  - title: `Incoming call`
  - body: `You have an incoming call`
  - data: `{ callId, conversationId, type: 'incoming_call' }`

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

1. High priority -> always allowed.
2. If conversation preference exists, evaluate it first.
3. Else evaluate global preference.
4. If none exists -> allowed.

Checks include `notifyOnMessage`, `muteUntil`, and quiet-hours window (`quietHoursStart`, `quietHoursEnd`, `timezone`).
