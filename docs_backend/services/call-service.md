# Call Service

## Overview

Call Service is a TCP microservice that orchestrates meetings tied to conversations. It manages meeting state, waiting room admission, moderation, media-state tracking, recording orchestration, cleanup, and health reporting.

It does not transport WebRTC media itself. LiveKit handles signaling and media plane. Realtime Gateway consumes call Kafka events and broadcasts them to WebSocket clients.

---

## Core Model

### Meetings

`meetings` rows store:

- `conversationId`
- `hostId`
- `status`: `ACTIVE | ENDED`
- `allowWaitingRoom`
- `startedAt`
- `endedAt`

### Participants

`meeting_participants` rows store:

- `meetingId`
- `userId`
- `role`: `HOST | CO_HOST | PARTICIPANT`
- `joinedAt`
- `leftAt`
- `mediaState`: `{ micOn, cameraOn, screenSharing }`

Default media state in code:

- `micOn: true`
- `cameraOn: false`
- `screenSharing: false`

### Waiting participants

`meeting_waiting_participants` rows store:

- `meetingId`
- `userId`
- `status`: `WAITING | APPROVED | REJECTED`
- `requestedAt`
- `decidedBy`
- `decidedAt`
- `rejectionReason`

### Recordings

`meeting_recordings` rows store:

- `meetingId`
- `conversationId`
- `status`: `RECORDING | PAUSED | STOPPED | FAILED`
- `startedBy`
- `egressId`
- `outputUrl`
- `errorMessage`
- timestamps

---

## Access Control

`CallAccessService` enforces both account state and conversation-level permission.

### Account state

- Looks up the user through Users Service
- Caches `isActive` for 30 seconds in memory
- If Users Service is temporarily unavailable, the check fails open and the user is allowed through
- If account is inactive, call operations are rejected

### Membership and role resolution

`CallMembershipValidator` is cache-first:

- membership set key: `chat:conversation:{conversationId}:members`
- role key: `chat:conversation:{conversationId}:members:{userId}:role`
- conversation context key: `call:conversation:{conversationId}:context`

Warm path uses Redis only. Cold path falls back to Conversation Service and then populates cache.

### Permission matrix in code

- `HOST`: start, join, moderate, share screen, record, approve joins, end meeting
- `OWNER`: start, join, moderate, share screen, record, approve joins, end meeting
- `ADMIN`: start, join, moderate, share screen, record, approve joins, end meeting
- `MODERATOR`: start, join, moderate, share screen, record
- `MEMBER`: start, join, share screen
- `GUEST`: join, share screen

---

## Meeting Rules

### Starting a meeting

`START_MEETING` first checks conversation access and then normalizes waiting-room behavior by conversation type:

- direct conversation: waiting room is forced off
- announcement conversation: waiting room is forced on
- everything else: `dto.allowWaitingRoom ?? true`

The service then:

- locks on user and conversation
- prevents the same user from being active in another meeting
- returns the existing active meeting if one already exists for the conversation
- creates a new meeting otherwise
- writes `call.event.started` to the outbox in the same transaction

### Joining a meeting

`REQUEST_JOIN_MEETING` does this:

- locks on user and meeting
- rejects if the user is already active in another meeting
- validates conversation membership and `CALL_JOIN`
- enforces max participants (`CALL_MAX_PARTICIPANTS`, default `100`)
- direct meetings bypass waiting room
- announcement meetings always use waiting room
- otherwise waiting room follows the meeting setting

If waiting room applies and the user is not the host:

- create waiting row if not already waiting
- enqueue `call.event.join_requested`

Otherwise:

- add participant directly
- enqueue `call.event.participant_joined`

### Approve / reject waiting users

- `APPROVE_WAITING_PARTICIPANT` updates waiting status to `APPROVED`, adds participant, enqueues `call.event.waiting_approved`
- `REJECT_WAITING_PARTICIPANT` updates waiting status to `REJECTED`, enqueues `call.event.waiting_rejected`

### Leaving and host succession

When a participant leaves:

- mark `leftAt`
- if the host leaves and someone else remains, promote the next active participant to host
- if the host leaves and nobody remains, end the meeting

When the meeting ends because the host leaves with no successor:

- summary is upserted
- `call.event.ended` is written
- recording cleanup is triggered
- LiveKit room is closed

### Membership revocation

`MembershipEventsConsumer` listens to `MEMBER_REMOVED`.

It does two things:

- invalidate call-service membership cache
- call `handleMembershipRevoked(conversationId, userId)`

If the removed user is:

- an active participant: force leave flow
- a waiting participant: mark waiting request rejected with `rejectionReason = membership_revoked`

---

## Moderation and Media State

### Participant media state

`UPDATE_MEDIA_STATE`:

- requires the user to already be an active participant
- requires `CALL_SHARE_SCREEN` if `screenSharing=true`
- updates `meeting_participants.media_state`
- enqueues `call.event.media_state_updated`

### Moderation actions

Actual action set from the service contracts:

- `MUTE_AUDIO`
- `MUTE_VIDEO`
- `DISABLE_SCREEN`
- `KICK`

Behavior:

- `MUTE_AUDIO`: set `micOn=false`
- `MUTE_VIDEO`: set `cameraOn=false`
- `DISABLE_SCREEN`: set `screenSharing=false`
- `KICK`: run the leave flow for the target user

All moderation operations enqueue `call.event.participant_moderated`.

---

## Media Tokens and WebRTC Boundary

`ISSUE_MEDIA_TOKEN` does not perform signaling itself. It issues a LiveKit access token.

Flow:

1. Find active meeting
2. Re-check conversation access with `CALL_JOIN`
3. Verify the user is already an active participant
4. Build LiveKit JWT with room join grants

Response includes:

- `token`
- `roomName`
- `identity`
- `participantName`
- `livekitUrl`
- `expiresInSeconds`

Important boundary:

- Call Service owns meeting orchestration and token issuance
- LiveKit owns signaling and media transport
- Realtime Gateway owns WebSocket fan-out of call state events

---

## Recording

Only LiveKit recording provider is implemented.

### Provider behavior

`RecordingProviderResolver` always resolves to `LiveKitRecordingProvider`.

`LiveKitRecordingProvider`:

- requires `LIVEKIT_RECORDING_ENABLED=true`
- starts room composite egress
- writes output to MinIO/S3-compatible storage
- retries provider calls using configurable retry count and base delay

### Recording flow

- `START_RECORDING`: create DB row, call provider, update to `RECORDING`, enqueue `call.event.recording_state_updated`
- `PAUSE_RECORDING`: pause provider egress if present, persist `PAUSED`
- `RESUME_RECORDING`: resume provider egress, persist `RECORDING`
- `STOP_RECORDING`: stop provider egress, persist `STOPPED`

There can be only one active recording per meeting. If one already exists, `START_RECORDING` returns it.

Cleanup also stops recordings when meetings are ended by cleanup logic.

---

## Cleanup and Health

### Cleanup

`CallCleanupService` runs on an interval (`CALL_CLEANUP_INTERVAL_MS`, default `60000`) and uses distributed leader locking.

It ends stale meetings when:

- there are zero active participants
- meeting age exceeds `CALL_MAX_MEETING_AGE_MINUTES` (default `720`)

It also expires waiting-room requests after `CALL_WAITING_ROOM_TIMEOUT_MS` (default `300000`) with `rejectionReason = waiting_room_timeout`.

### Health

`GET_HEALTH` reports:

- active meetings
- active participants
- waiting participants
- zero-participant active meetings
- recording status snapshot
- call outbox counts and lag
- cleanup config
- degraded issues such as outbox lag or unavailable recording provider

---

## Kafka and Outbox

Call Service writes events through `OutboxRepository` inside the same database transaction as the domain mutation.

Main topics written by the audited code path:

- `call.event.started`
- `call.event.join_requested`
- `call.event.participant_joined`
- `call.event.waiting_approved`
- `call.event.waiting_rejected`
- `call.event.media_state_updated`
- `call.event.participant_moderated`
- `call.event.recording_state_updated`
- `call.event.ended`

Consumed topic in this service:

- `chat.event.member_added`
- `chat.event.member_removed`

`MEMBER_ADDED` pre-warms Redis membership cache. `MEMBER_REMOVED` invalidates cache and auto-kicks affected users from active calls.
