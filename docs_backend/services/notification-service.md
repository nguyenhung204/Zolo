# Notification Service

## Overview

The Notification Service is a **TCP microservice** (port 3006) responsible for delivering push notifications and transactional emails to users. It is a **consumer-only** service in the event-driven pipeline — it never initiates events but reacts to them to deliver notifications via FCM (Android), APNs (iOS), Web Push (browser), and email (Resend).

**Key Capabilities:**
- Multi-platform push notifications (FCM / APNs / Web Push)
- Notification preference management (per-user, per-conversation, quiet hours)
- Duplicate suppression (dedup key with 30-second TTL)
- Presence-aware delivery (online users receive real-time message, not push)
- BullMQ-backed job queue (retry with exponential backoff)
- Transactional email via Resend API (OTP, security alerts)

## Architecture

```
TCP Port 3006

           Notification Service              
                                             
  NotificationController (TCP)               
     REGISTER_DEVICE                       
     UNREGISTER_DEVICE                     
     UPDATE_NOTIFICATION_PREF              
     GET_NOTIFICATION_PREFS                
     SEND_OTP_EMAIL                        
                                             
  Kafka Consumers (5 consumers)              
     MessageSavedConsumer                  
     FriendshipConsumer                    
     CallEventConsumer                     
     MemberChangesConsumer                 
     AuthEventConsumer                     
                                             
  BullMQ Queue: notification.dispatch        
     NotificationWorker (concurrency: 10)  
          Presence check (Redis O(1))      
          Preference check                 
          Dedup check (Redis TTL 30s)      
          PushProviderFactory              
                FcmProvider (Android)      
                ApnsProvider (iOS)         
                WebPushProvider (Browser)  
                                             
  EmailService (Resend API)                  
     sendPasswordResetOtp()                
     sendPasswordChangedAlert()            
                                             
  PostgreSQL: notification_db (chat-db)      
     device_tokens                         
     notification_preferences              
                                             
  Redis: shared redis-chat                   
     DB 0: presence check                  
     DB 0: push:dedup:{userId}:{messageId} 

```

### What This Service IS Responsible For

- Managing device token registration and deactivation (FCM, APNs, Web Push)
- Managing notification preferences (mute, quiet hours, per-conversation overrides)
- Reacting to Kafka events and enqueuing push notification jobs
- Dispatching push notifications through the appropriate provider
- Sending transactional OTP and security alert emails
- Deduplicating notifications to prevent double-sending
- Checking user presence before sending (active users get real-time; no push spam)

### What This Service IS NOT Responsible For

- Validating message content or authorization (handled by Chat Core)
- Storing or retrieving message history (handled by Message Store)
- Managing conversation state or membership (handled by Conversation Service)
- Real-time WebSocket broadcasting (handled by Realtime Gateway)
- Delivering in-app notification badges or read receipts
- Constructing deep links or notification icons (delegated to client SDKs)

---

## TCP Patterns

All patterns are defined in `libs/common/src/constants/patterns/notification.patterns.ts`:

```typescript
export const NOTIFICATION_PATTERNS = {
  REGISTER_DEVICE:          { cmd: 'register_device' },
  UNREGISTER_DEVICE:        { cmd: 'unregister_device' },
  UPDATE_NOTIFICATION_PREF: { cmd: 'update_notification_pref' },
  GET_NOTIFICATION_PREFS:   { cmd: 'get_notification_prefs' },
  SEND_OTP_EMAIL:           { cmd: 'send_otp_email' },
} as const;
```

**Pattern: `NOTIFICATION_PATTERNS.REGISTER_DEVICE`**

- Purpose: Register a push device token for a user
- Payload: `RegisterDeviceDto` — `userId`, `token`, `platform` (FCM | APNS | WEB), `deviceId`
- Response: `{ success: true, id: string }`
- Side effects: Upserts `device_tokens` row (insert or update lastSeenAt + token)
- Called by: Gateway (on first app launch, on token refresh)

**Pattern: `NOTIFICATION_PATTERNS.UNREGISTER_DEVICE`**

- Purpose: Deregister a device (user logs out)
- Payload: `UnregisterDeviceDto` — `userId`, `deviceId`
- Response: `{ success: true }`
- Side effects: Soft-deletes all tokens for `(userId, deviceId)` by setting `isActive = false`
- Called by: Gateway (on logout)

**Pattern: `NOTIFICATION_PATTERNS.UPDATE_NOTIFICATION_PREF`**

- Purpose: Update mute or quiet-hour settings
- Payload: `UpdateNotificationPrefDto` — `userId`, `conversationId?` (null = global), optional fields: `muteUntil` (ISO8601), `notifyOnMention`, `notifyOnMessage`, `quietHoursEnabled`, `quietHoursStart/End` (HH:mm), `timezone` (IANA)
- Response: `{ success: true, id: string }`
- Scope rules:
  - `conversationId = null` → global preference (catch-all)
  - `conversationId = <uuid>` → per-conversation override (takes precedence over global)
- Called by: Gateway notification controller via `PUT /notifications/preferences`

**Pattern: `NOTIFICATION_PATTERNS.GET_NOTIFICATION_PREFS`**

- Purpose: Get notification preferences for a user (and optionally a conversation)
- Payload: `GetNotificationPrefsDto` — `userId`, `conversationId?`
- Response: `{ conversationPref: NotificationPreference | null, globalPref: NotificationPreference | null }`
- Called by: Gateway notification controller via `GET /notifications/preferences`

**Pattern: `NOTIFICATION_PATTERNS.SEND_OTP_EMAIL`**

- Purpose: Send a password-reset OTP email
- Payload: `SendOtpEmailDto` — `to` (email), `otp`, `expiresMinutes`, `ip?`, `requestTime?`, `userAgentParsed?`
- Response: `void` (throws on failure)
- Called by: Users Service (or Gateway Auth flow) when a password reset OTP is requested

---

## Kafka Event Consumers

**Consumer group**: `CONSUMER_GROUPS.NOTIFICATION` (most consumers)
**Consumer group**: `CONSUMER_GROUPS.NOTIFICATION_AUTH_EVENTS` (auth events consumer)

### MessageSavedConsumer

| Field | Value |
|-------|-------|
| Topic | `KAFKA_TOPICS.MESSAGE_SAVED` |
| Group | `CONSUMER_GROUPS.NOTIFICATION` |

**Trigger**: New message saved in Message Store.

**Logic**:
1. Read conversation member IDs from Redis Set `chat:conversation:{conversationId}:members`
2. Exclude sender (never notify self)
3. For each member: enqueue job with priority `'high'` if member in `mentions[]`, else `'normal'`

**Notification payload**: `{ title: 'New message', body: 'You have a new message', data: { conversationId, messageId, type: 'message' } }`

---

### FriendshipConsumer

| Field | Value |
|-------|-------|
| Topic | `KAFKA_TOPICS.FRIENDSHIP.REQUEST_SENT` |
| Group | `CONSUMER_GROUPS.NOTIFICATION` |

**Trigger**: A friend request is sent.

**Logic**: Enqueue single push to receiver with priority `'normal'`.

**Notification payload**: `{ title: 'New friend request', body: '<name> sent you a friend request', data: { fromUserId, type: 'friend_request' } }`

---

### CallEventConsumer

| Field | Value |
|-------|-------|
| Topic | `KAFKA_TOPICS.CALL.STARTED` |
| Group | `CONSUMER_GROUPS.NOTIFICATION` |

**Trigger**: A call starts in a conversation.

**Logic**:
1. Read member IDs from Redis Set
2. Exclude host (call initiator)
3. Enqueue push for each member with priority `'high'` (bypasses mute/quiet hours)

**Notification payload**: `{ title: 'Incoming call', body: 'You have an incoming call', data: { callId, conversationId, type: 'incoming_call' } }`

> **High priority**: Sets APNs priority=10 (`apns-priority: '10'`) + `content-available=1` for CallKit wakeup. On Android, FCM `android.priority: 'high'` bypasses Doze mode.

---

### MemberChangesConsumer

| Field | Value |
|-------|-------|
| Topic | `KAFKA_TOPICS.MEMBER_ADDED` |
| Group | `CONSUMER_GROUPS.NOTIFICATION` |

**Trigger**: Users are added to a conversation.

**Logic**: Enqueue push to each newly added user with priority `'normal'`.

**Notification payload**: `{ title: 'Added to channel', body: 'You were added to a conversation', data: { conversationId, type: 'member_added' } }`

---

### AuthEventConsumer

| Field | Value |
|-------|-------|
| Topic | `KAFKA_TOPICS.AUTH_EVENTS` |
| Group | `CONSUMER_GROUPS.NOTIFICATION_AUTH_EVENTS` |

**Trigger**: Auth events emitted by the authentication flow.

**Logic**: Processes only `PASSWORD_RESET_SUCCESS` and `PASSWORD_CHANGED` events. Skips `FORGOT_PASSWORD_REQUESTED` (unverified). Calls `EmailService.sendPasswordChangedAlert()`.

**Failure handling**: Errors are caught and logged without rethrowing — email alert failure must not block the Kafka consume loop.

---

## BullMQ Job Queue

**Queue name**: `notification.dispatch`
**Backed by**: Redis (shared `redis-chat`)

### Job Data Structure

```typescript
interface NotificationJobData {
  userId: string;
  notification: PushPayload;
  messageId?: string;       // For dedup key: push:dedup:{userId}:{messageId} (TTL 30s)
  conversationId?: string;  // For per-conversation preference check
  priority: 'normal' | 'high';
}
```

### Job Configuration

| Setting | Value |
|---------|-------|
| `attempts` | 3 |
| `backoff` | exponential, 1000ms base |
| `removeOnComplete` | true |
| `removeOnFail` | keep last 100 |
| `priority` (BullMQ) | `1` for high, unset for normal |

### Worker Dispatch Flow (`NotificationWorker`)

```
1. Presence check
    Read REDIS_KEYS.PRESENCE.USER_STATUS(userId)
    If online → skip (user sees realtime message, no push spam)

2. Preference check
    preferenceService.isAllowed(userId, conversationId, priority)
    high-priority jobs → always allowed (bypasses mute/quiet hours)
    If muted, in quiet hours, or notifyOnMessage=false → skip

3. Dedup check (when messageId present)
    Check Redis: push:dedup:{userId}:{messageId}
    If key exists → skip (already sent within 30s)

4. Fetch active device tokens (DB read)
    If no tokens → skip

5. Send via PushProviderFactory
    Promise.allSettled across all platforms (FCM + APNS + WEB)
    Invalid tokens auto-deactivated inside providers

6. Set dedup key
    SETEX push:dedup:{userId}:{messageId} 30 1 (after successful send)
```

---

## Push Providers

### PushProviderFactory

Routes push dispatch to the correct provider based on the `platform` field in the device token.

### FcmProvider (Firebase Cloud Messaging — Android)

- SDK: `firebase-admin`
- Config: `FIREBASE_SERVICE_ACCOUNT_JSON` environment variable
- Token invalidation: auto-deactivates token on `messaging/registration-token-not-registered` or `messaging/invalid-registration-token` errors
- Priority mapping: `payload.priority === 'high'` → `android.priority: 'high'` (bypasses Android Doze)

### ApnsProvider (Apple Push Notification service — iOS)

- SDK: `firebase-admin` (unified approach via Firebase APNs bridge)
- High-priority semantics:
  - `apns-priority: '10'` (immediate delivery)
  - `content-available: 1` (wakes app in background — enables CallKit)
  - `sound: 'default'` (plays tone)
- Normal-priority: `apns-priority: '5'` (battery-saver delivery)
- Token invalidation: same error-based deactivation as FCM

### WebPushProvider (W3C Web Push — Browser)

- Package: `web-push` npm package
- Config: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
  - Generate: `npx web-push generate-vapid-keys`
- Token: Stored as JSON string (browser `PushSubscription` object with `endpoint` + `keys`)
- Token invalidation: auto-deactivates on HTTP 410 or 404 responses

---

## Email Service (Resend)

### Configuration

| Env Var | Purpose |
|---------|---------|
| `RESEND_API_KEY` | Resend API key |
| `EMAIL_FROM` | Sender address (e.g. `noreply@bcn.id.vn`) |
| `APP_NAME` | App name used in email subjects |

### Email Templates

**`password-reset.hbs`**:
- Triggered by: `SEND_OTP_EMAIL` TCP pattern (OTP password reset flow)
- Subject: `[${appName}] Mã OTP đặt lại mật khẩu`
- Variables: `otp`, `expiresMinutes`, `ip`, `requestTime`, `userAgentParsed`
- Displays OTP in large monospace font; includes security warning

**`password-changed-alert.hbs`**:
- Triggered by: `AuthEventConsumer` (PASSWORD_RESET_SUCCESS or PASSWORD_CHANGED)
- Subject: changes based on `isReset` flag (`Mật khẩu đã được đặt lại` vs `đã được thay đổi`)
- Variables: `isReset`, `ip`, `userAgent`, `changedAt`
- Red alert box: "If not you — contact admin immediately"

---

## Database Schema

**Database**: `notification_db` (logical schema within `chat-db` PostgreSQL container, port 5433)
**ORM**: TypeORM, auto-synchronize disabled in production (use migrations)

### `device_tokens` Table

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | Auto-generated |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |
| `user_id` | UUID | Indexed |
| `token` | TEXT | Platform-specific token string |
| `platform` | ENUM | `FCM` \| `APNS` \| `WEB` |
| `device_id` | VARCHAR | Client-generated install UUID |
| `is_active` | BOOLEAN | `true` by default; `false` = soft-deleted |
| `last_seen_at` | TIMESTAMPTZ | Nullable; updated on each registration |

**Indexes**: `(user_id)`, `(user_id, is_active)`, `UNIQUE (user_id, device_id)`

### `notification_preferences` Table

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | Auto-generated |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |
| `user_id` | UUID | Indexed |
| `conversation_id` | UUID | Nullable; `NULL` = global preference |
| `mute_until` | TIMESTAMPTZ | Nullable; mute until this timestamp |
| `notify_on_mention` | BOOLEAN | Default: `true` |
| `notify_on_message` | BOOLEAN | Default: `true` |
| `quiet_hours_enabled` | BOOLEAN | Default: `false` |
| `quiet_hours_start` | VARCHAR | `HH:mm` format (e.g. `22:00`) |
| `quiet_hours_end` | VARCHAR | `HH:mm` format (e.g. `07:00`) |
| `timezone` | VARCHAR | IANA timezone (e.g. `Asia/Ho_Chi_Minh`), default `UTC` |

**Scoping logic**:
- `conversation_id IS NULL` → global catch-all preference
- `conversation_id IS NOT NULL` → per-conversation override (takes precedence)
- Overnight quiet-hour windows are handled correctly (e.g. 22:00 → 07:00 wraps past midnight)

**Indexes**: `(user_id)`, `UNIQUE (user_id, conversation_id)`

---

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `NOTIFICATION_SERVICE_HOST` | `localhost` | TCP bind host |
| `NOTIFICATION_SERVICE_PORT` | `3006` | TCP bind port |
| `NOTIFICATION_DB_HOST` | `postgres-chat` | PostgreSQL host |
| `NOTIFICATION_DB_PORT` | `5433` | PostgreSQL port |
| `NOTIFICATION_DB_NAME` | `notification_db` | Database name |
| `NOTIFICATION_DB_USER` | — | DB user |
| `NOTIFICATION_DB_PASSWORD` | — | DB password |
| `REDIS_HOST` | `redis-chat` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `KAFKA_BROKERS` | `kafka-1:29092` | Kafka broker list |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | — | Firebase admin SDK JSON |
| `VAPID_PUBLIC_KEY` | — | Web Push VAPID public key |
| `VAPID_PRIVATE_KEY` | — | Web Push VAPID private key |
| `VAPID_SUBJECT` | — | Web Push VAPID subject (`mailto:...`) |
| `RESEND_API_KEY` | — | Resend transactional email key |
| `EMAIL_FROM` | — | Sender address |
| `APP_NAME` | `Chat App` | App name for email subjects |
| `NOTIFICATION_WORKER_CONCURRENCY` | `10` | BullMQ worker concurrency |
| `NODE_ENV` | `development` | Runtime environment |

---

## Dependencies

| Dependency | Purpose |
|------------|---------|
| `@app/common` | Patterns, guards, logger, boot config |
| `@app/database-postgres` | TypeORM PostgreSQL setup |
| `@app/cache` | Redis client |
| `@app/kafka` | KafkaJS consumer/producer abstraction |
| `firebase-admin` | FCM + APNs push via Firebase |
| `web-push` | W3C Web Push (browser) |
| `@nestjs/bull` / `bullmq` | Job queue for notification dispatch |
| `resend` | Transactional email API |
| `handlebars` | Email template rendering |

---

## Kafka Event Summary

### Topics Consumed

| Topic | Consumer Group | Event | Action |
|-------|---------------|-------|--------|
| `chat.event.message_saved` | `notification` | New message saved | Enqueue push to offline members |
| `KAFKA_TOPICS.FRIENDSHIP.REQUEST_SENT` | `notification` | Friend request sent | Enqueue push to receiver |
| `KAFKA_TOPICS.CALL.STARTED` | `notification` | Call started | Enqueue high-priority push to members |
| `KAFKA_TOPICS.MEMBER_ADDED` | `notification` | User added to conversation | Enqueue push to new member |
| `KAFKA_TOPICS.AUTH_EVENTS` | `notification_auth_events` | Password changed/reset | Send security alert email |

### Topics Produced

**None** — Notification Service is a pure event consumer. It does not emit any Kafka events.

---

## Integration with Other Services

### Gateway → Notification Service (TCP)

The Gateway's `NotificationController` routes these HTTP endpoints to Notification Service TCP patterns:

| HTTP Endpoint | TCP Pattern |
|--------------|-------------|
| `GET /notifications/vapid-public-key` | (Resolved from env, no TCP call) |
| `POST /notifications/devices` | `REGISTER_DEVICE` |
| `DELETE /notifications/devices` | `UNREGISTER_DEVICE` |
| `GET /notifications/preferences` | `GET_NOTIFICATION_PREFS` |
| `PUT /notifications/preferences` | `UPDATE_NOTIFICATION_PREF` |

### Users Service → Notification Service (TCP)

The Users Service (or Gateway Auth flow) calls `SEND_OTP_EMAIL` to trigger OTP emails during the password-reset flow.

### Notification Service → Redis (Direct)

- **Read** `REDIS_KEYS.PRESENCE.USER_STATUS(userId)` → presence check (skip push if online)
- **Read/Write** `push:dedup:{userId}:{messageId}` (TTL 30s) → deduplication
- **Read** `chat:conversation:{conversationId}:members` → member lookup for MessageSaved + CallStarted events

---

## Debugging

### Push Notifications Not Delivered

1. Check if device token is registered: query `device_tokens` WHERE `user_id = <id>` AND `is_active = true`
2. Check user presence: `REDIS-CLI GET presence:status:<userId>` — if `"online"`, push is skipped by design
3. Check notification preferences: query `notification_preferences` for mute or quiet-hours settings
4. Inspect BullMQ queue via Redis Commander (http://localhost:8081): look for failed jobs in `notification.dispatch`
5. Check `is_active = false` tokens: provider may have reported token as invalid and auto-deactivated it

### OTP Email Not Received

1. Verify `RESEND_API_KEY` is correctly set in environment
2. Check service logs: `SEND_OTP_EMAIL` TCP call arrives → `EmailService.sendPasswordResetOtp()` called
3. Verify `EMAIL_FROM` domain is verified in Resend dashboard

### Kafka Consumer Not Processing

1. Confirm service is running: `docker ps | grep notification-service`
2. Inspect Kafdrop (http://localhost:9000): check consumer group `notification` lag
3. If lag is high: scale worker concurrency via `NOTIFICATION_WORKER_CONCURRENCY`
4. If consumer group is missing: service did not start; check Docker logs
