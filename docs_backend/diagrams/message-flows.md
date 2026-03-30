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

## Read Receipt Flow

### Description
Flow when a user opens a conversation and marks messages as read, updating read receipts and notifying the sender.

### Flow Diagram

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant RealtimeGW as Realtime Gateway
    participant MsgStore as Message Store
    participant ConvSvc as Conversation Service
    participant Kafka
    participant ChatDB as Chat DB
    participant ConvDB as Conversation DB
    participant Sender as Sender's Client

    %% User opens conversation
    Client->>RealtimeGW: WS: conversation:join<br/>{conversationId}
    RealtimeGW->>RealtimeGW: Join Socket.IO room<br/>"conversation:{id}"
    
    %% Fetch messages
    Client->>RealtimeGW: WS: message:fetch<br/>{conversationId, after: 0, limit: 50}
    RealtimeGW->>MsgStore: TCP: GET_MESSAGES<br/>{conversationId, after, limit}
    MsgStore->>ChatDB: SELECT messages<br/>WHERE conversationId = ?<br/>AND offset > ?<br/>LIMIT 50
    ChatDB-->>MsgStore: Message list + receipts
    MsgStore-->>RealtimeGW: Messages with read status
    RealtimeGW-->>Client: message:list<br/>[{...messages}]
    
    %% User scrolls to bottom (reads messages)
    Note over Client: User sees messages<br/>Auto-mark as read
    
    Client->>RealtimeGW: WS: message:mark_read<br/>{conversationId, upToOffset: 42}
    RealtimeGW->>MsgStore: TCP: MARK_AS_READ<br/>{conversationId, userId, upToOffset}
    
    %% Update receipts
    MsgStore->>ChatDB: BEGIN TRANSACTION
    MsgStore->>ChatDB: UPDATE message_receipts<br/>SET status = 'read',<br/>    readAt = NOW()<br/>WHERE messageId IN (<br/>  SELECT id FROM messages<br/>  WHERE conversationId = ?<br/>  AND offset <= 42<br/>  AND senderId != ?<br/>)<br/>AND userId = ?<br/>AND status != 'read'
    
    %% Update conversation's lastSeenOffset
    MsgStore->>ConvSvc: TCP: UPDATE_LAST_SEEN_OFFSET<br/>{conversationId, userId, offset: 42}
    ConvSvc->>ConvDB: UPDATE conversation_members<br/>SET lastSeenOffset = 42<br/>WHERE conversationId = ?<br/>AND userId = ?
    ConvDB-->>ConvSvc: Success
    ConvSvc-->>MsgStore: Success
    
    MsgStore->>ChatDB: COMMIT TRANSACTION
    
    %% Publish read event
    MsgStore->>Kafka: Publish: MESSAGE_READ<br/>{conversationId, userId,<br/>upToOffset: 42, readAt}
    
    MsgStore-->>RealtimeGW: Success
    RealtimeGW-->>Client: message:read_confirmed
    
    %% Notify sender
    Kafka->>RealtimeGW: Consume: MESSAGE_READ
    RealtimeGW->>RealtimeGW: Get affected senders<br/>(messages offset <= 42)
    RealtimeGW->>Sender: Broadcast to conversation:{id}<br/>message:read<br/>{userId, upToOffset: 42}
    
    Note over Sender: Shows "Read" status<br/>with user avatar
```

### Key Steps Explained

1. **Join Conversation** - Client emits `conversation:join`, joins Socket.IO room
2. **Fetch Messages** - Client requests messages with pagination
3. **Query Database** - Message Store fetches messages with current receipt status
4. **Return Messages** - Client displays messages with read/delivered indicators
5. **Mark as Read** - User scrolls to bottom, client emits `message:mark_read`
6. **Update Receipts** - Batch update all receipts up to specified offset
7. **Update LastSeenOffset** - Update user's conversation membership record
8. **Commit Transaction** - Ensure atomicity of receipt and offset updates
9. **Publish Event** - Kafka receives MESSAGE_READ event
10. **Confirm to User** - Client receives confirmation
11. **Consume Event** - Realtime Gateway picks up MESSAGE_READ
12. **Notify Sender** - Broadcast to conversation room so sender sees "Read" status

### Receipt Status Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Sent: Message created
    Sent --> Delivered: Message persisted
    Delivered --> Read: Recipient marks as read
    Read --> [*]
    
    note right of Sent
        Status set by Chat Core
        when MESSAGE_ACCEPTED
    end note
    
    note right of Delivered
        Status set by Message Store
        when MESSAGE_SAVED
    end note
    
    note right of Read
        Status set by recipient
        when message:mark_read
    end note
```

### Batch Read Optimization

**Problem**: Updating receipts for 50 messages = 50 UPDATE queries

**Solution**: Single batch UPDATE query
```sql
UPDATE message_receipts
SET status = 'read', readAt = NOW()
WHERE messageId IN (
  SELECT id FROM messages
  WHERE conversationId = 'conv-123'
  AND offset <= 42
  AND senderId != 'current-user'
)
AND userId = 'current-user'
AND status != 'read';
```

**Result**: O(1) query regardless of message count

---

## Typing Indicator Flow

### Description
Real-time typing indicators for DIRECT, DEPARTMENT, and PROJECT conversations. Not supported for ANNOUNCEMENT channels (members cannot post, so typing is irrelevant).

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
    ConvSvc-->>RealtimeGW: {kind: PROJECT, memberCount: 8}

    alt kind = ANNOUNCEMENT
        RealtimeGW-->>UserA: error: Not supported for ANNOUNCEMENT
    else kind = DIRECT, DEPARTMENT or PROJECT
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
3. **Check Kind** - Verify conversation kind is DIRECT, DEPARTMENT, or PROJECT (not ANNOUNCEMENT)
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

**Why Not ANNOUNCEMENT?**
- ANNOUNCEMENT channels are read-only for members
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

**DIRECT or PROJECT Conversation (10 members)**:
- 1 typing event -> 9 broadcasts (exclude sender)
- Kafka throughput: ~10,000 messages/sec
- Redis ops: ~100,000 ops/sec
- **Result**: No bottleneck

**Large PROJECT (100 members)**:
- 1 typing event -> 99 broadcasts
- Still within capacity

**ANNOUNCEMENT Channel (many members)**:
- Typing not supported; members are read-only
- **Result**: Disabled for ANNOUNCEMENT kind

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
    Gateway->>CallSvc: TCP: START_MEETING<br/>{conversationId, orgId, hostId}
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

## References

- [DATA_FLOW_PATTERNS.md](../integration/DATA_FLOW_PATTERNS.md) - Complete end-to-end flows with detailed explanations
- [SERVICE_COMMUNICATION.md](../integration/SERVICE_COMMUNICATION.md) - Service-to-service communication patterns
- [system-architecture.md](./system-architecture.md) - Overall system architecture
- [kafka-topology.md](./kafka-topology.md) - Kafka topic and partition details
- [call-service.md](../services/call-service.md) - Call Service detailed documentation
