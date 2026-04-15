# Message Flows

## Overview

This document illustrates the key message flows in the chat system using sequence diagrams. These flows show how data moves through services, databases, and Kafka for common user interactions.

## Send Message Flow

### Description
Complete flow from when a user sends a message via WebSocket until all conversation members receive the notification.

### Flow Diagram

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant RealtimeGW as Realtime Gateway
    participant ChatCore as Chat Core
    participant ConvSvc as Conversation Service
    participant FriendSvc as Friendship Service
    participant Kafka
    participant MsgStore as Message Store
    participant ConvDB as Conversation DB
    participant ChatDB as Chat DB
    participant Recipients as Other Clients

    %% Phase 1: Client sends message
    Client->>RealtimeGW: WS: message:send<br/>{conversationId, content}
    RealtimeGW->>ChatCore: TCP: SEND_MESSAGE<br/>{senderId, conversationId, content}
    
    %% Phase 2: Validate conversation
    ChatCore->>ConvSvc: TCP: GET_CONVERSATION<br/>{conversationId}
    ConvSvc->>ConvDB: SELECT conversation + members
    ConvDB-->>ConvSvc: Conversation data
    ConvSvc-->>ChatCore: {conversation, members}
    
    %% Phase 3: Check membership
    ChatCore->>ChatCore: Verify sender is member
    
    alt Sender not member
        ChatCore-->>RealtimeGW: Error: FORBIDDEN
        RealtimeGW-->>Client: error: Not a member
    end
    
    %% Phase 4: Check friendship (DIRECT only)
    alt Conversation type = DIRECT
        ChatCore->>FriendSvc: TCP: IS_FRIEND<br/>{userId, targetUserId}
        FriendSvc->>FriendSvc: Query friendship status
        FriendSvc-->>ChatCore: Status: FRIEND/BLOCKED/NONE
        
        alt Status = BLOCKED
            ChatCore-->>RealtimeGW: Error: BLOCKED
            RealtimeGW-->>Client: error: User blocked you
        end
        
        alt Status = NONE (strangers)
            ChatCore->>MsgStore: TCP: HAS_REPLIED<br/>{conversationId, recipientId}
            MsgStore-->>ChatCore: hasReplied: false
            ChatCore->>ChatCore: Apply rate limit<br/>(1 msg/hour)
            
            alt Rate limit exceeded
                ChatCore-->>RealtimeGW: Error: RATE_LIMIT
                RealtimeGW-->>Client: error: Rate limit
            end
        end
    end
    
    %% Phase 5: Validation passed, publish event
    ChatCore->>Kafka: Publish: MESSAGE_ACCEPTED<br/>{messageId, conversationId, senderId, content}
    ChatCore-->>RealtimeGW: Success: {messageId}
    RealtimeGW-->>Client: message:saved<br/>{messageId, status: "sending"}
    
    Note over Client: Shows "sent" checkmark<br/>(~50-100ms latency)
    
    %% Phase 6: Message Store consumes event
    Kafka->>MsgStore: Consume: MESSAGE_ACCEPTED
    MsgStore->>MsgStore: Check idempotency<br/>(messageId exists?)
    
    %% Phase 7: Get sequential offset
    MsgStore->>ConvSvc: TCP: INCREMENT_MAX_OFFSET<br/>{conversationId}
    ConvSvc->>ConvDB: UPDATE conversations<br/>SET maxOffset = maxOffset + 1<br/>WHERE id = ?
    ConvDB-->>ConvSvc: New offset: 42
    ConvSvc-->>MsgStore: offset: 42
    
    %% Phase 8: Persist message
    MsgStore->>ChatDB: BEGIN TRANSACTION
    MsgStore->>ChatDB: INSERT INTO messages<br/>(id, conversationId, senderId,<br/>content, offset, createdAt)
    MsgStore->>ChatDB: INSERT INTO message_receipts<br/>(messageId, userId, status='delivered')<br/>FOR EACH member
    MsgStore->>ChatDB: COMMIT TRANSACTION
    
    %% Phase 9: Publish saved event
    MsgStore->>Kafka: Publish: MESSAGE_SAVED<br/>{messageId, conversationId, latestOffset}
    
    %% Phase 10: Realtime Gateway broadcasts
    Kafka->>RealtimeGW: Consume: MESSAGE_SAVED
    RealtimeGW->>RealtimeGW: Batch events (80ms window)
    
    %% Tier 1: Personal rooms (all members)
    RealtimeGW->>Recipients: Broadcast to user:{userId} rooms<br/>message:notify<br/>{conversationId, latestOffset}
    
    Note over Recipients: Badge count increments<br/>for users not in conversation
    
    %% Tier 2: Conversation room (active viewers)
    RealtimeGW->>Recipients: Broadcast to conversation:{id}<br/>message:new<br/>{full message object}
    
    Note over Recipients: Message appears immediately<br/>for users viewing conversation
```

### Key Steps Explained

1. **Client Emits** - User sends message via WebSocket with conversationId and content
2. **TCP Forward** - Realtime Gateway forwards to Chat Core with authenticated senderId
3. **Validate Conversation** - Chat Core fetches conversation details and member list
4. **Check Membership** - Verifies sender is a member of the conversation
5. **Check Friendship** - For DIRECT conversations, validates friendship status
6. **Rate Limiting** - For non-friends, enforces 1 message/hour until recipient replies
7. **Publish Event** - Chat Core publishes MESSAGE_ACCEPTED to Kafka
8. **Quick Response** - Client receives success (~50-100ms) before persistence
9. **Consume Event** - Message Store picks up event from Kafka
10. **Idempotency Check** - Prevents duplicate messages if event replayed
11. **Get Sequential Offset** - Atomic increment of conversation's maxOffset
12. **Persist Message** - Insert message and delivery receipts in transaction
13. **Publish Saved** - Message Store publishes MESSAGE_SAVED to Kafka
14. **Batch Window** - Realtime Gateway batches events for 80ms to reduce broadcast storms
15. **Tier 1 Broadcast** - Notify all members in their personal rooms (badge updates)
16. **Tier 2 Broadcast** - Send full message to users currently viewing the conversation

### Error Scenarios

**Sender Not Member**
- Rejected at step 4 with FORBIDDEN error
- No Kafka event published
- Client shows "You are not a member"

**Recipient Blocked Sender**
- Rejected at step 7 with BLOCKED error
- No Kafka event published
- Client shows "Unable to send message"

**Rate Limit Exceeded**
- Rejected at step 8 with RATE_LIMIT error
- Applied only to non-friends
- Client shows "You can send 1 message per hour to non-friends until they reply"

**Kafka Unavailable**
- Chat Core fails to publish MESSAGE_ACCEPTED
- Returns error to client
- No persistence occurs (consistent failure)

**Database Write Failure**
- Message Store fails to persist
- MESSAGE_SAVED never published
- Recipients never receive message
- Sender's client shows "sending..." indefinitely

---

## Sticker Message Flow

### Description

End-to-end flow for sending a sticker. The key performance insight: a sticker message is **as fast as a text message** — the backend never touches any image file during the chat exchange. The sticker image URL was pre-loaded from `GET /stickers/packages` and the browser/app fetches it directly from storage.

### Phase 0: Pre-fetch (App Startup)

When the user opens the sticker keyboard, the client calls `GET /stickers/packages` (HTTP). The Gateway proxies to Message Store via TCP (`sticker.get_packages`), returning each package with a `thumbnailUrl` for its icon. The client then calls `GET /stickers/packages/:id/stickers` per package and caches all sticker URLs in memory.

### Flow Diagram

```mermaid
sequenceDiagram
    autonumber
    participant ClientA as Client A (Sender)
    participant GW as Gateway (HTTP)
    participant ChatCore as Chat Core (TCP)
    participant Kafka
    participant MsgStore as Message Store
    participant RealtimeGW as Realtime Gateway
    participant ClientB as Client B (Receiver)
    participant Storage as Public Storage (CDN)

    Note over ClientA: User opens sticker keyboard
    ClientA->>GW: GET /stickers/packages
    GW->>MsgStore: TCP: sticker.get_packages
    MsgStore-->>GW: [{id, name, thumbnailUrl, isFree}, ...]
    GW-->>ClientA: 200 OK — packages list

    ClientA->>GW: GET /stickers/packages/pck_sprite/stickers
    GW->>MsgStore: TCP: sticker.get_package_stickers
    MsgStore-->>GW: [{id, url}, ...] (50 per page)
    GW-->>ClientA: 200 OK — sticker list cached in RAM

    Note over ClientA: User taps sprite_45212

    ClientA->>GW: POST /chat/messages<br/>{clientMessageId, conversationId,<br/>type: "sticker", content: "",<br/>metadata: {url: "https://…/sprite_45212.webp"}}

    GW->>ChatCore: TCP: SEND_MESSAGE<br/>{senderId, conversationId,<br/>type: "sticker", content: "",<br/>metadata: {url: "…"}}

    Note over ChatCore: Rate limit check (shared bucket with text)
    Note over ChatCore: ACL chain — uses text chain (no mediaId)
    Note over ChatCore: Content validation bypassed for type=sticker

    ChatCore->>Kafka: Publish: MESSAGE_ACCEPTED<br/>{messageId, type: "sticker",<br/>content: "", metadata: {url: "…"}}
    ChatCore-->>GW: {success: true, messageId}
    GW-->>ClientA: 200 OK — message accepted

    Note over ClientA: Shows sticker immediately (optimistic UI)

    Kafka->>MsgStore: Consume: MESSAGE_ACCEPTED
    MsgStore->>MsgStore: Persist — type=STICKER,<br/>content="", metadata={url:"…"}
    MsgStore->>Kafka: Publish: MESSAGE_SAVED

    Kafka->>RealtimeGW: Consume: MESSAGE_SAVED
    RealtimeGW->>ClientB: WS: message:new<br/>{type: "sticker", metadata: {url: "…"}}

    Note over ClientB: Renders <img src="…"/>
    ClientB->>Storage: GET /zolo-stickers/sprite_45212.webp
    Storage-->>ClientB: 200 WebP image
    Note over ClientB: Sticker visible
```

### Key Design Decisions

**Why no server-side URL validation when sending?**
Sticker URLs are static public assets on a CDN — no ownership or access-control concern. Validating the URL against the DB on every send would add a DB round-trip for zero security benefit. The client only has valid URLs because they came from `GET /stickers/packages/:id/stickers` in the first place.

**Why use the text ACL chain for stickers?**
Stickers have no `mediaId`; they reference pre-uploaded static files that the server never processes. The text chain checks membership, account status, and conversation permissions — exactly what is needed. The `MediaValidationRule` fires only when `context.media` is present, so it naturally skips for stickers.

**Why is `content` empty for stickers?**
`content` is the searchable/indexable text body of a message. Stickers carry no textual content; the sticker identity and display URL live in `metadata.url`. This keeps the message model consistent and avoids storing redundant data.

---

## Typing Indicator Flow

### Description
Real-time typing indicators for DIRECT and GROUP conversations. Not supported for COMMUNITY channels (members cannot post, so typing is irrelevant).

### Flow Diagram

```mermaid
sequenceDiagram
    autonumber
    participant UserA as User A (Typing)
    participant RealtimeGW as Realtime Gateway
    participant ConvSvc as Conversation Service
    participant Kafka
    participant UserB as User B (Watching)
    participant UserC as User C (Watching)

    %% User A starts typing
    Note over UserA: User A starts typing...
    UserA->>RealtimeGW: WS: typing:start<br/>{conversationId}

    %% Validate membership
    RealtimeGW->>ConvSvc: TCP: IS_MEMBER<br/>{conversationId, userId}
    ConvSvc-->>RealtimeGW: isMember: true

    %% Check conversation kind
    RealtimeGW->>ConvSvc: TCP: GET_CONVERSATION<br/>{conversationId}
    ConvSvc-->>RealtimeGW: {kind: GROUP, memberCount: 8}

    alt kind = COMMUNITY
        RealtimeGW-->>UserA: error: Not supported for COMMUNITY
    else kind = DIRECT or GROUP
        %% Publish typing event to Kafka
        RealtimeGW->>Kafka: Publish: TYPING_STARTED<br/>{conversationId, userId, timestamp}

        %% Kafka delivers to Realtime Gateway
        Kafka->>RealtimeGW: Consume: TYPING_STARTED

        %% Broadcast to conversation room (exclude sender)
        RealtimeGW->>UserB: Broadcast to conversation:{id}<br/>typing:started<br/>{userId: userA, conversationId}
        RealtimeGW->>UserC: Broadcast to conversation:{id}<br/>typing:started<br/>{userId: userA, conversationId}

        Note over UserB,UserC: Shows "User A is typing..."

        %% Set TTL in Redis (auto-cleanup)
        RealtimeGW->>RealtimeGW: Set Redis key:<br/>typing:{conversationId}:{userA}<br/>TTL: 5 seconds
    end

    %% User A continues typing (heartbeat)
    Note over UserA: Still typing... (3s later)
    UserA->>RealtimeGW: WS: typing:start<br/>{conversationId}
    RealtimeGW->>RealtimeGW: Refresh Redis TTL<br/>typing:{conversationId}:{userA}<br/>TTL: 5 seconds
    Note over UserB,UserC: Indicator remains visible

    %% User A stops typing
    Note over UserA: User A stops typing<br/>(sends message or waits)
    UserA->>RealtimeGW: WS: typing:stop<br/>{conversationId}

    RealtimeGW->>Kafka: Publish: TYPING_STOPPED<br/>{conversationId, userId}
    Kafka->>RealtimeGW: Consume: TYPING_STOPPED

    RealtimeGW->>UserB: Broadcast to conversation:{id}<br/>typing:stopped<br/>{userId: userA}
    RealtimeGW->>UserC: Broadcast to conversation:{id}<br/>typing:stopped<br/>{userId: userA}
    Note over UserB,UserC: Hides "User A is typing..."

    RealtimeGW->>RealtimeGW: Delete Redis key:<br/>typing:{conversationId}:{userA}

    %% Auto-cleanup scenario
    Note over RealtimeGW: 5 seconds pass without heartbeat
    RealtimeGW->>RealtimeGW: Redis TTL expires<br/>typing:{conversationId}:{userA}
    RealtimeGW->>RealtimeGW: Trigger auto-cleanup handler

    RealtimeGW->>UserB: Broadcast: typing:stopped<br/>{userId: userA}
    RealtimeGW->>UserC: Broadcast: typing:stopped<br/>{userId: userA}
    Note over UserB,UserC: Auto-hides after 5s<br/>(network loss / tab switch)
```

### Key Steps Explained

1. **Start Typing** - User A begins typing, client emits `typing:start`
2. **Validate Membership** - Ensure user is member of conversation
3. **Check Kind** - Verify conversation kind is DIRECT or GROUP (not COMMUNITY)
4. **Publish to Kafka** - TYPING_STARTED event published
5. **Consume Event** - Realtime Gateway consumes event
6. **Broadcast to Room** - Notify all members in conversation room (except sender)
7. **Set TTL** - Redis key with 5-second expiration for auto-cleanup
8. **Heartbeat** - Client re-emits `typing:start` every 3 seconds to keep indicator alive
9. **Refresh TTL** - Redis key TTL refreshed on each heartbeat
10. **Stop Typing** - User stops typing, client emits `typing:stop`
11. **Publish Stop Event** - TYPING_STOPPED event to Kafka
12. **Broadcast Stop** - Hide typing indicator for all members
13. **Delete Key** - Remove Redis key
14. **Auto-Cleanup** - If TTL expires without heartbeat, auto-broadcast stop event

### Design Decisions

**Why Kafka for Typing?**
- Decouples Realtime Gateway instances
- Multiple Realtime Gateway replicas can broadcast consistently
- Event log for debugging (short retention)

**Why Not Kafka for Typing?**
- Adds latency (~10-50ms)
- Could use Redis Pub/Sub for lower latency
- **Trade-off**: Consistency vs. latency

**Why 5-Second TTL?**
- Balance between responsiveness and unnecessary broadcasts
- Handles tab switches, network hiccups
- Prevents "stuck" typing indicators

**Why Not COMMUNITY?**
- COMMUNITY channels are read-only for members
- Members cannot send messages, so typing indicators are irrelevant

### Client Implementation

**Throttling**:
```javascript
let typingTimeout;

textarea.addEventListener('input', () => {
  socket.emit('typing:start', { conversationId });

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('typing:stop', { conversationId });
  }, 2000); // Stop if no input for 2s
});
```

**Heartbeat** (every 3s):
```javascript
setInterval(() => {
  if (isTyping) {
    socket.emit('typing:start', { conversationId });
  }
}, 3000);
```

### Performance Considerations

**DIRECT or GROUP Conversation (10 members)**:
- 1 typing event -> 9 broadcasts (exclude sender)
- Kafka throughput: ~10,000 messages/sec
- Redis ops: ~100,000 ops/sec
- **Result**: No bottleneck

**Large GROUP (100 members)**:
- 1 typing event -> 99 broadcasts
- Still within capacity

**COMMUNITY Channel (many members)**:
- Typing not supported; members are read-only
- **Result**: Disabled for COMMUNITY kind

---

## Call Lifecycle Flow

### Description
Complete flow from when a user starts a meeting until all participants are notified and the meeting ends. Covers waiting room, media state changes, and recording.

### Flow Diagram

```mermaid
sequenceDiagram
    autonumber
    participant Host
    participant Gateway
    participant CallSvc as Call Service
    participant Redis
    participant Kafka
    participant RealtimeGW as Realtime Gateway
    participant Members as Other Clients

    %% Phase 1: Start meeting
    Host->>Gateway: POST /calls/{conversationId}/start
    Gateway->>CallSvc: TCP: START_MEETING<br/>{conversationId, hostId}
    CallSvc->>CallSvc: Create MeetingEntity (status=ACTIVE)
    CallSvc->>CallSvc: Create MeetingParticipant (role=HOST)
    CallSvc->>CallSvc: Write outbox: call.event.started
    CallSvc-->>Gateway: MeetingDto
    Gateway-->>Host: 200 MeetingDto

    Note over CallSvc: OutboxProcessor (~30s)
    CallSvc->>Kafka: Publish call.event.started
    Kafka->>RealtimeGW: Consume call.event.started
    RealtimeGW->>Members: WS broadcast to conversation room:<br/>call:started {meetingId, hostId}

    %% Phase 2: Issue LiveKit token
    Host->>Gateway: POST /calls/{meetingId}/token
    Gateway->>CallSvc: TCP: ISSUE_MEDIA_TOKEN<br/>{meetingId, userId}
    CallSvc->>CallSvc: Validate participant is in meeting
    CallSvc->>CallSvc: LiveKitService.createToken(userId, meetingId, role=HOST)
    CallSvc-->>Gateway: { token, livekitUrl }
    Gateway-->>Host: 200 { token, livekitUrl }
    Note over Host: Host connects directly to LiveKit SFU<br/>using the issued token

    %% Phase 3: Member requests to join (waiting room enabled)
    Members->>Gateway: POST /calls/{conversationId}/join
    Gateway->>CallSvc: TCP: REQUEST_JOIN_MEETING<br/>{conversationId, userId}
    CallSvc->>CallSvc: allowWaitingRoom = true
    CallSvc->>CallSvc: Create WaitingParticipant (status=WAITING)
    CallSvc->>CallSvc: Write outbox: call.event.join_requested
    CallSvc-->>Gateway: { status: WAITING }
    Gateway-->>Members: 200 { status: "waiting" }

    CallSvc->>Kafka: Publish call.event.join_requested
    Kafka->>RealtimeGW: Consume event
    RealtimeGW->>Host: WS broadcast to conversation room:<br/>call:join_requested {userId}

    %% Phase 4: Host approves
    Host->>Gateway: POST /calls/{meetingId}/approve/{userId}
    Gateway->>CallSvc: TCP: APPROVE_WAITING_PARTICIPANT
    CallSvc->>CallSvc: Update WaitingParticipant.status = APPROVED
    CallSvc->>CallSvc: Create MeetingParticipant (role=PARTICIPANT)
    CallSvc->>CallSvc: Write outbox: call.event.waiting_approved + call.event.participant_joined
    CallSvc-->>Gateway: MeetingDto
    CallSvc->>Kafka: Publish call.event.waiting_approved
    CallSvc->>Kafka: Publish call.event.participant_joined
    Kafka->>RealtimeGW: Consume events
    RealtimeGW->>Members: WS broadcast: call:approved (includes LiveKit room)
    RealtimeGW->>Host: WS broadcast: call:participant_joined {userId}

    %% Phase 5: Media state update
    Members->>Gateway: PATCH /calls/{meetingId}/media-state
    Gateway->>CallSvc: TCP: UPDATE_MEDIA_STATE<br/>{meetingId, userId, mediaState:{micOn:false}}
    CallSvc->>CallSvc: Update MeetingParticipant.mediaState
    CallSvc->>Kafka: Publish call.event.media_state_updated
    Kafka->>RealtimeGW: Consume event
    RealtimeGW->>Host: WS broadcast: call:media_state_updated {userId, micOn:false}

    %% Phase 6: End meeting
    Host->>Gateway: POST /calls/{meetingId}/end
    Gateway->>CallSvc: TCP: END_MEETING<br/>{meetingId, userId}
    CallSvc->>CallSvc: Validate caller is HOST
    CallSvc->>CallSvc: Set MeetingEntity.status = ENDED, endedAt = NOW()
    CallSvc->>CallSvc: Stop any RECORDING recordings via LiveKit egress
    CallSvc->>CallSvc: Generate MeetingSummaryEntity
    CallSvc->>CallSvc: Write outbox: call.event.ended
    CallSvc-->>Gateway: MeetingDto
    Gateway-->>Host: 200 MeetingDto

    CallSvc->>Kafka: Publish call.event.ended
    Kafka->>RealtimeGW: Consume event
    RealtimeGW->>Members: WS broadcast to conversation room:<br/>call:ended {meetingId, endedBy, durationMs}
```

### Key Steps Explained

1. **Start Meeting** - Host POSTs to Gateway; Call Service creates `MeetingEntity` + first participant with HOST role
2. **Publish Start Event** - Outbox publishes `call.event.started`; Realtime Gateway broadcasts to conversation room
3. **Issue Token** - Call Service generates signed LiveKit JWT; host uses it to connect directly to SFU (media bypasses the Call Service)
4. **Join Request** - Member requests join; if waiting room enabled, a `WaitingParticipantEntity` is created
5. **Host Notified** - `call.event.join_requested` consumed by Realtime Gateway; host sees join request in UI
6. **Approve/Reject** - Host approves or rejects via Gateway → Call Service; approval creates `MeetingParticipantEntity`
7. **Media State** - Each device state change (mute/unmute/screen) writes to DB and publishes `call.event.media_state_updated`
8. **End Meeting** - Host ends; outstanding recordings stopped, summary generated, `call.event.ended` published
9. **Members Notified** - Realtime Gateway broadcasts end event; all clients close the call UI

---

## Authentication & WebSocket Connection Flow

### Description
How a client authenticates with Keycloak, obtains a JWT, and establishes an authenticated WebSocket connection to receive real-time events.

### Flow Diagram

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant Keycloak
    participant Gateway as API Gateway
    participant RealtimeGW as Realtime Gateway
    participant Redis

    %% Phase 1: Obtain JWT
    Client->>Keycloak: POST /realms/nest-realm/protocol/openid-connect/token<br/>{username, password, client_id}
    Keycloak-->>Client: {access_token (JWT RS256), refresh_token, expires_in}

    %% Phase 2: (Optional) HTTP REST call
    Client->>Gateway: GET /users/me<br/>Authorization: Bearer {JWT}
    Gateway->>Keycloak: GET /realms/nest-realm/protocol/openid-connect/certs (JWKS)
    Keycloak-->>Gateway: JWKS (public keys, cached in Redis 1h)
    Gateway->>Gateway: Verify JWT signature + expiry
    Gateway-->>Client: 200 UserProfile

    %% Phase 3: Establish WebSocket
    Client->>RealtimeGW: WS connect wss://host/chat
    RealtimeGW-->>Client: connected (unauthenticated, 30s auth timeout)

    Client->>RealtimeGW: WS event: authenticate {token: JWT}
    RealtimeGW->>Keycloak: GET JWKS (cached in Redis)
    RealtimeGW->>RealtimeGW: Verify JWT + extract userId
    RealtimeGW->>Redis: SET online:{userId} + add socket to connection map

    %% Phase 4: Join personal room & friend rooms
    RealtimeGW->>RealtimeGW: Join room user:{userId}
    RealtimeGW->>RealtimeGW: Join room user:{friendId} for each friend
    RealtimeGW-->>Client: WS event: authenticated {userId}

    Note over Client: Client is now authenticated<br/>and receiving real-time events
```

---

## Edit Message Flow

### Description
Flow when a user edits a previously sent message. Chat Core enforces the 1-hour edit window and saves an audit trail.

### Flow Diagram

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant Gateway as API Gateway
    participant ChatCore as Chat Core
    participant MsgStore as Message Store
    participant ConvSvc as Conversation Service
    participant Kafka
    participant ChatDB as chat_db
    participant Recipients as Other Clients
    participant RealtimeGW as Realtime Gateway

    %% Phase 1: Client requests edit
    Client->>Gateway: POST /chat/messages/{messageId}/edit<br/>{content: "updated text"}
    Gateway->>ChatCore: TCP: EDIT_MESSAGE<br/>{messageId, senderId, content}

    %% Phase 2: Fetch current message for validation
    ChatCore->>MsgStore: TCP: GET_MESSAGE_BY_ID {messageId}
    MsgStore-->>ChatCore: {id, conversationId, senderId, createdAt, content}

    %% Phase 3: Validate edit rules
    ChatCore->>ChatCore: Check senderId == message.senderId
    ChatCore->>ChatCore: Check (now - createdAt) <= 60 minutes

    alt Edit window expired (> 1 hour)
        ChatCore-->>Gateway: RpcException: MESSAGE_EDIT_WINDOW_EXPIRED
        Gateway-->>Client: 403 Forbidden
    end

    alt Not message owner
        ChatCore-->>Gateway: RpcException: FORBIDDEN_ROLE_REQUIRED
        Gateway-->>Client: 403 Forbidden
    end

    %% Phase 4: Validate membership
    ChatCore->>ConvSvc: TCP: IS_MEMBER {conversationId, userId}
    ConvSvc-->>ChatCore: {isMember: true}

    %% Phase 5: Publish edit event
    ChatCore->>Kafka: Publish chat.event.message_edited<br/>{messageId, senderId, newContent, conversationId}
    ChatCore-->>Gateway: {messageId, status: "edited"}
    Gateway-->>Client: 200 {messageId}

    %% Phase 6: Message Store persists edit
    Kafka->>MsgStore: Consume chat.event.message_edited
    MsgStore->>ChatDB: BEGIN TRANSACTION
    MsgStore->>ChatDB: INSERT INTO message_edit_history<br/>(messageId, previousContent, editedBy, editedAt)
    MsgStore->>ChatDB: UPDATE messages SET<br/>content = newContent,<br/>isEdited = true, editedAt = NOW()
    MsgStore->>ChatDB: COMMIT

    %% Phase 7: Broadcast edit to conversation
    MsgStore->>Kafka: Publish chat.event.message_updated<br/>{messageId, conversationId, newContent, editedAt}
    Kafka->>RealtimeGW: Consume chat.event.message_updated
    RealtimeGW->>Recipients: Broadcast to conversation:{id}<br/>message:edited {messageId, newContent, editedAt}
```

### Key Rules

- **Edit window**: 1 hour from `createdAt` (enforced by Chat Core using `MESSAGE_LIMITS.EDIT_WINDOW_MS`)
- **Ownership**: Only the original sender can edit (no ADMIN override for edit)
- **Audit trail**: Previous content always saved to `message_edit_history` before updating
- **`isEdited` flag**: Message row shows edit indicator in UI

---

## Delete Message Flow

### Description
Soft-delete flow. Own messages within 24 h, ADMIN can delete any within 24 h (plus audit log).

### Flow Diagram

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant Gateway as API Gateway
    participant ChatCore as Chat Core
    participant MsgStore as Message Store
    participant ConvSvc as Conversation Service
    participant Kafka
    participant ChatDB as chat_db
    participant Recipients as Other Clients
    participant RealtimeGW as Realtime Gateway

    Client->>Gateway: DELETE /chat/messages/{messageId}
    Gateway->>ChatCore: TCP: DELETE_MESSAGE {messageId, deletedBy}

    ChatCore->>MsgStore: TCP: GET_MESSAGE_BY_ID {messageId}
    MsgStore-->>ChatCore: {id, conversationId, senderId, createdAt}

    ChatCore->>ConvSvc: TCP: GET_MEMBERS_WITH_ROLES {conversationId}
    ConvSvc-->>ChatCore: [{userId, role}]

    ChatCore->>ChatCore: Resolve actor role from membership list

    alt Own message AND within 24 h (MSG.DELETE_OWN)
        ChatCore->>ChatCore: OK - proceed
    else ADMIN/OWNER AND within 24 h (MSG.DELETE_ANY)
        ChatCore->>ChatCore: OK - audit log required
    else Violation
        ChatCore-->>Gateway: RpcException: FORBIDDEN_TIME_WINDOW or FORBIDDEN_ROLE_REQUIRED
        Gateway-->>Client: 403 Forbidden
    end

    ChatCore->>Kafka: Publish chat.event.deleted<br/>{messageId, conversationId, deletedBy, isAdminDelete}
    ChatCore-->>Gateway: {messageId, deleted: true}
    Gateway-->>Client: 200

    Kafka->>MsgStore: Consume chat.event.deleted
    MsgStore->>ChatDB: UPDATE messages<br/>SET isDeleted = true, deletedAt = NOW()
    MsgStore->>Kafka: Publish chat.event.message_updated (isDeleted: true)

    Kafka->>RealtimeGW: Consume chat.event.message_updated
    RealtimeGW->>Recipients: Broadcast conversation:{id}<br/>message:deleted {messageId}

    Note over Recipients: "This message was deleted"<br/>shown in UI; content hidden
```

### Key Rules

- **Soft delete only**: `isDeleted = true`, `deletedAt = NOW()` — row is never removed
- **Own delete**: `MSG.DELETE_OWN` — sender only, within 24 h
- **Admin delete**: `MSG.DELETE_ANY` — OWNER/ADMIN only, within 24 h, all actions are logged
- **Content hidden**: Deleted messages return `{isDeleted: true, content: null}` from API

---

## Pin / Unpin Message Flow

### Description
Pin/unpin messages in a conversation. Max 3 pinned messages per conversation, OWNER/ADMIN/MODERATOR only.

### Flow Diagram

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant Gateway as API Gateway
    participant ChatCore as Chat Core
    participant MsgStore as Message Store
    participant ConvSvc as Conversation Service
    participant Kafka
    participant ChatDB as chat_db
    participant Recipients as Other Clients
    participant RealtimeGW as Realtime Gateway

    Client->>Gateway: POST /chat/conversations/{conversationId}/pin<br/>{messageId}
    Gateway->>ChatCore: TCP: PIN_MESSAGE<br/>{conversationId, messageId, pinnedBy}

    %% Validate membership and role
    ChatCore->>ConvSvc: TCP: GET_MEMBERS_WITH_ROLES {conversationId}
    ConvSvc-->>ChatCore: [{userId, role}]
    ChatCore->>ChatCore: Verify pinnedBy role is OWNER/ADMIN/MODERATOR

    alt Insufficient role
        ChatCore-->>Gateway: RpcException: FORBIDDEN_ROLE_REQUIRED
        Gateway-->>Client: 403 Forbidden
    end

    %% Check max pins
    ChatCore->>MsgStore: TCP: GET_PINNED_MESSAGES {conversationId}
    MsgStore-->>ChatCore: [{messageId, ...}] (0-3 items)

    alt Already 3 pinned messages
        ChatCore-->>Gateway: RpcException with code PIN_LIMIT_EXCEEDED
        Gateway-->>Client: 422 Unprocessable Entity
    end

    %% Publish pin event
    ChatCore->>Kafka: Publish chat.event.message_pinned<br/>{conversationId, messageId, pinnedBy}
    ChatCore-->>Gateway: {messageId, pinned: true}
    Gateway-->>Client: 200

    Kafka->>MsgStore: Consume chat.event.message_pinned
    MsgStore->>ChatDB: INSERT INTO pinned_messages<br/>(conversationId, messageId, pinnedBy, pinnedAt)

    MsgStore->>Kafka: Publish chat.event.message_updated (pinned state)
    Kafka->>RealtimeGW: Consume
    RealtimeGW->>Recipients: Broadcast conversation:{id}<br/>message:pinned {messageId, pinnedBy}
```

### Unpin Flow

```mermaid
sequenceDiagram
    participant Client
    participant Gateway as API Gateway
    participant ChatCore as Chat Core
    participant Kafka
    participant MsgStore as Message Store
    participant ChatDB as chat_db
    participant RealtimeGW as Realtime Gateway
    participant Recipients as Other Clients

    Client->>Gateway: DELETE /chat/conversations/{conversationId}/pin/{messageId}
    Gateway->>ChatCore: TCP: UNPIN_MESSAGE {conversationId, messageId, unpinnedBy}
    ChatCore->>ChatCore: Validate role (OWNER/ADMIN/MODERATOR)
    ChatCore->>Kafka: Publish chat.event.message_unpinned
    ChatCore-->>Gateway: {messageId, pinned: false}
    Gateway-->>Client: 200

    Kafka->>MsgStore: Consume chat.event.message_unpinned
    MsgStore->>ChatDB: DELETE FROM pinned_messages WHERE messageId = ?
    MsgStore->>Kafka: Publish chat.event.message_updated
    Kafka->>RealtimeGW: Consume
    RealtimeGW->>Recipients: Broadcast message:unpinned {messageId}
```

---

## Media Upload Flow (2-Phase Pre-signed URL)

### Description
Two-phase upload: pre-check before upload, then finalize after direct MinIO upload. Prevents uploading media that will be rejected.

### Flow Diagram

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant Gateway as API Gateway
    participant ChatCore as Chat Core
    participant MediaSvc as Media Service
    participant MinIO
    participant MongoDB
    participant Kafka
    participant MediaWorker as Media Worker

    %% Phase 1: Pre-check (validate BEFORE uploading)
    Client->>Gateway: POST /chat/pre-check-media<br/>{conversationId, mimeType, fileSize}
    Gateway->>ChatCore: TCP: PRE_CHECK_MEDIA<br/>{conversationId, userId, mimeType, fileSize}
    ChatCore->>ChatCore: Validate MIME type against allowlist
    ChatCore->>ChatCore: Validate fileSize <= org.maxFileSize
    ChatCore->>ChatCore: Validate membership + MSG.SEND_MEDIA permission

    alt Not allowed
        ChatCore-->>Gateway: RpcException: MEDIA_TYPE_NOT_ALLOWED
        Gateway-->>Client: 400 Bad Request
    end

    ChatCore-->>Gateway: {approved: true, uploadToken}
    Gateway-->>Client: 200 {approved: true}

    %% Phase 2: Create upload session
    Client->>Gateway: POST /media/upload<br/>{conversationId, mimeType, fileName, fileSize}
    Gateway->>MediaSvc: HTTP POST /upload<br/>(JWT forwarded)
    MediaSvc->>MongoDB: INSERT media_objects (status=CREATED)
    MediaSvc->>MinIO: Generate pre-signed PUT URL (15 min expiry)
    MediaSvc-->>Gateway: {mediaId, uploadUrl, expiresAt}
    Gateway-->>Client: 200 {mediaId, uploadUrl}

    %% Phase 3: Direct upload to MinIO (no Gateway involved)
    Client->>MinIO: PUT {uploadUrl} (binary file, direct)
    MinIO-->>Client: 200 ETag

    %% Phase 4: Finalize upload
    Client->>Gateway: POST /media/finalize/{mediaId}
    Gateway->>MediaSvc: HTTP POST /finalize/{mediaId}
    MediaSvc->>MinIO: HEAD object (verify file exists + size)
    MediaSvc->>MongoDB: UPDATE media_objects SET status=UPLOADED
    MediaSvc->>Kafka: Publish media.uploaded {mediaId, ownerId, type, ...}
    MediaSvc-->>Gateway: {mediaId, status: "UPLOADED"}
    Gateway-->>Client: 200 {mediaId, status: "UPLOADED"}

    %% Phase 5: Background processing by Media Worker
    Kafka->>MediaWorker: Consume media.uploaded
    MediaWorker->>MinIO: Download original file
    MediaWorker->>MediaWorker: Generate thumbnail (Sharp) or transcode (ffmpeg)
    MediaWorker->>MinIO: Upload variants (thumbnail, compressed)
    MediaWorker->>MongoDB: UPDATE media_objects SET status=READY, variants=[...]
    MediaWorker->>Kafka: Publish media.ready {mediaId, variants}

    %% Phase 6: Attach media to message
    Note over Client: Client can now send message<br/>with mediaId (status: READY or UPLOADED)
    Client->>Gateway: POST /chat/messages<br/>{conversationId, mediaId, type: "image"}
    Note over Gateway: Normal SEND_MESSAGE flow<br/>Chat Core validates media status<br/>and classification
```

### Media States

```mermaid
stateDiagram-v2
    [*] --> CREATED: Create upload session
    CREATED --> UPLOADED: Client finalized (file in MinIO)
    UPLOADED --> PROCESSING: Media Worker picks up
    PROCESSING --> READY: Thumbnails generated, variants uploaded
    PROCESSING --> FAILED: Processing error (antivirus, corrupt file)
    FAILED --> UPLOADED: Client retries finalize
    READY --> [*]: Media used in message

    note right of CREATED
        Pre-signed URL generated
        15 min expiry
    end note

    note right of UPLOADED
        File in MinIO
        Can be attached to message
        as placeholder
    end note

    note right of READY
        All variants available
        Thumbnail, compressed
    end note
```

---

## Friend Request Flow (with Auto-create DIRECT Conversation)

### Description
Complete friendship lifecycle from friend request to auto-created DIRECT conversation, using transactional outbox and Kafka events.

### Flow Diagram

```mermaid
sequenceDiagram
    autonumber
    participant UserA
    participant Gateway as API Gateway
    participant FriendSvc as Friendship Service
    participant UsersSvc as Users Service
    participant UsersDB as users_db
    participant Kafka
    participant ConvSvc as Conversation Service
    participant ChatDB as chat_db
    participant RealtimeGW as Realtime Gateway
    participant UserB

    %% Phase 1: Send friend request
    UserA->>Gateway: POST /friends/request<br/>{toUserId: userB}
    Gateway->>FriendSvc: TCP: SEND_FRIEND_REQUEST<br/>{fromUserId: userA, toUserId: userB}

    FriendSvc->>UsersSvc: TCP: FIND_BY_ID {userId: userB}
    UsersSvc-->>FriendSvc: UserProfile (validate exists)

    FriendSvc->>UsersDB: BEGIN TRANSACTION
    FriendSvc->>UsersDB: INSERT INTO friend_requests<br/>(fromUserId, toUserId, status=PENDING)
    FriendSvc->>UsersDB: INSERT INTO outbox_events<br/>(type=FRIENDSHIP_REQUEST_SENT, payload)
    FriendSvc->>UsersDB: COMMIT

    FriendSvc-->>Gateway: {requestId, status: "PENDING"}
    Gateway-->>UserA: 201 {requestId}

    Note over FriendSvc: OutboxProcessor (~30s)
    FriendSvc->>Kafka: Publish friendship.request.sent<br/>{fromUserId, toUserId}
    Kafka->>RealtimeGW: Consume friendship.request.sent
    RealtimeGW->>UserB: WS broadcast to user:{userB}<br/>friend:request_received {fromUserId, fromUser}

    %% Phase 2: Accept friend request
    UserB->>Gateway: POST /friends/accept<br/>{fromUserId: userA}
    Gateway->>FriendSvc: TCP: ACCEPT_FRIEND_REQUEST<br/>{userId: userB, fromUserId: userA}

    FriendSvc->>UsersDB: BEGIN TRANSACTION
    FriendSvc->>UsersDB: UPDATE friend_requests SET status=ACCEPTED
    FriendSvc->>UsersDB: INSERT INTO friendships (userA, userB, FRIEND)
    FriendSvc->>UsersDB: INSERT INTO friendships (userB, userA, FRIEND)
    FriendSvc->>UsersDB: INSERT INTO outbox_events (type=FRIENDSHIP_ACCEPTED)
    FriendSvc->>UsersDB: COMMIT

    FriendSvc-->>Gateway: {status: "FRIEND"}
    Gateway-->>UserB: 200

    Note over FriendSvc: OutboxProcessor (~30s)
    FriendSvc->>Kafka: Publish friendship.request.accepted<br/>{userId: userB, friendId: userA}

    %% Phase 3: Auto-create DIRECT conversation
    Kafka->>ConvSvc: Consume friendship.request.accepted
    ConvSvc->>ChatDB: BEGIN TRANSACTION
    ConvSvc->>ChatDB: INSERT INTO conversations<br/>(type=DIRECT, memberCount=2)
    ConvSvc->>ChatDB: INSERT INTO conversation_members<br/>(conversationId, userA, role=MEMBER)
    ConvSvc->>ChatDB: INSERT INTO conversation_members<br/>(conversationId, userB, role=MEMBER)
    ConvSvc->>ChatDB: INSERT INTO outbox_events<br/>(type=CONVERSATION_CREATED)
    ConvSvc->>ChatDB: COMMIT

    Note over ConvSvc: OutboxProcessor (~30s)
    ConvSvc->>Kafka: Publish chat.event.conversation_created<br/>{conversationId, type: DIRECT, memberIds}

    Kafka->>RealtimeGW: Consume conversation_created
    RealtimeGW->>UserA: WS broadcast to user:{userA}<br/>conversation:new {conversationId, type: DIRECT}
    RealtimeGW->>UserB: WS broadcast to user:{userB}<br/>conversation:new {conversationId, type: DIRECT}

    Note over UserA,UserB: Both users now see<br/>the DIRECT conversation<br/>in their chat list
```

---

## Member Add / Remove Flow

### Description
Adding or removing a member from a GROUP or COMMUNITY conversation, with cache invalidation and real-time notifications.

### Flow Diagram

```mermaid
sequenceDiagram
    autonumber
    participant Admin
    participant Gateway as API Gateway
    participant ConvSvc as Conversation Service
    participant ChatDB as chat_db
    participant Redis
    participant Kafka
    participant RealtimeGW as Realtime Gateway
    participant NewMember

    %% Add member
    Admin->>Gateway: POST /conversations/{id}/members<br/>{userIds: [userId], role: "member"}
    Gateway->>ConvSvc: TCP: ADD_MEMBERS<br/>{conversationId, requesterId, userIds, role}

    ConvSvc->>ConvSvc: Validate requester is OWNER or ADMIN
    ConvSvc->>ChatDB: BEGIN TRANSACTION
    ConvSvc->>ChatDB: INSERT INTO conversation_members<br/>(conversationId, userId, role=MEMBER)
    ConvSvc->>ChatDB: UPDATE conversations SET memberCount = memberCount + 1
    ConvSvc->>ChatDB: INSERT INTO outbox_events (MEMBER_ADDED)
    ConvSvc->>ChatDB: COMMIT

    ConvSvc-->>Gateway: {success: true, memberCount}
    Gateway-->>Admin: 200

    Note over ConvSvc: OutboxProcessor (~30s)
    ConvSvc->>Kafka: Publish chat.event.member_added<br/>{conversationId, userId, role}

    %% Cache invalidation
    Kafka->>ConvSvc: Consume chat.event.member_added (cache-updater group)
    ConvSvc->>Redis: SADD membership:{conversationId} userId

    %% Realtime notification
    Kafka->>RealtimeGW: Consume chat.event.member_added
    RealtimeGW->>NewMember: WS broadcast to user:{userId}<br/>conversation:added {conversationId, role}
    RealtimeGW->>Admin: WS broadcast to conversation:{id}<br/>member:added {userId}

    Note over NewMember: New member joins<br/>conversation room automatically

    %% Remove member flow
    Admin->>Gateway: DELETE /conversations/{id}/members/{userId}
    Gateway->>ConvSvc: TCP: REMOVE_MEMBERS<br/>{conversationId, requesterId, userIds}

    ConvSvc->>ConvSvc: Validate requester is OWNER or ADMIN
    ConvSvc->>ChatDB: BEGIN TRANSACTION
    ConvSvc->>ChatDB: DELETE FROM conversation_members WHERE userId = ?
    ConvSvc->>ChatDB: UPDATE conversations SET memberCount = memberCount - 1
    ConvSvc->>ChatDB: INSERT INTO outbox_events (MEMBER_REMOVED)
    ConvSvc->>ChatDB: COMMIT

    Note over ConvSvc: OutboxProcessor (~30s)
    ConvSvc->>Kafka: Publish chat.event.member_removed<br/>{conversationId, userId}

    Kafka->>ConvSvc: Consume chat.event.member_removed (cache-updater group)
    ConvSvc->>Redis: SREM membership:{conversationId} userId

    Kafka->>RealtimeGW: Consume chat.event.member_removed
    RealtimeGW->>NewMember: WS broadcast to user:{userId}<br/>conversation:removed {conversationId, reason}
```

---

## Read Receipt / Mark as Read Flow

### Description
How the client marks a conversation as read, updating the cursor-based read tracking without a separate receipts table.

### Flow Diagram

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant RealtimeGW as Realtime Gateway
    participant MsgStore as Message Store
    participant ConvSvc as Conversation Service
    participant ChatDB as chat_db
    participant Kafka
    participant Sender as Message Sender

    %% User opens conversation
    Client->>RealtimeGW: WS: conversation:join {conversationId}
    RealtimeGW->>RealtimeGW: Join Socket.IO room conversation:{conversationId}
    RealtimeGW-->>Client: joined

    %% Fetch messages
    Client->>RealtimeGW: WS: message:fetch {conversationId, after: 0, limit: 50}
    RealtimeGW->>MsgStore: TCP: GET_MESSAGES {conversationId, after, limit}
    MsgStore-->>RealtimeGW: [{id, content, offset, isEdited, ...}]
    RealtimeGW-->>Client: message:list [{...messages}]

    %% Auto-mark as read (user sees messages)
    Note over Client: User scrolls to bottom, sees messages
    Client->>RealtimeGW: WS: message:mark_read {conversationId, upToOffset: 42}
    RealtimeGW->>MsgStore: TCP: UPDATE_LAST_SEEN_OFFSET<br/>{conversationId, userId, offset: 42}
    MsgStore->>ConvSvc: TCP: UPDATE_SEEN_CURSOR<br/>{conversationId, userId, offset: 42}
    ConvSvc->>ChatDB: UPDATE conversation_members<br/>SET last_seen_offset = 42<br/>WHERE conversation_id = ? AND user_id = ?<br/>AND last_seen_offset < 42

    ConvSvc-->>MsgStore: {updated: true}
    MsgStore-->>RealtimeGW: {success: true}
    RealtimeGW-->>Client: message:read_confirmed {upToOffset: 42}

    %% Publish read event for sender's UI
    RealtimeGW->>Kafka: Publish chat.event.read<br/>{conversationId, userId, upToOffset: 42}
    Kafka->>RealtimeGW: Consume chat.event.read
    RealtimeGW->>Sender: Broadcast to conversation:{id}<br/>message:read {userId, upToOffset: 42}

    Note over Sender: Shows double checkmark<br/>or "Read by X" indicator
```

---

## References

- [DATA_FLOW_PATTERNS.md](../integration/DATA_FLOW_PATTERNS.md) - Additional end-to-end flows
- [SERVICE_COMMUNICATION.md](../integration/SERVICE_COMMUNICATION.md) - Service-to-service communication patterns
- [system-architecture.md](./system-architecture.md) - Overall system architecture
- [kafka-topology.md](./kafka-topology.md) - Kafka topic and partition details
- [call-service.md](../services/call-service.md) - Call Service detailed documentation
- [database-relations.md](./database-relations.md) - Database schemas and entity relationships
