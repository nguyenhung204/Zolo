# Database Relations

## Overview

This document describes the database architecture, ownership model, and table relationships for the NestJS chat system. The system uses **2 PostgreSQL containers** (`users-db` host port 5434 and `chat-db` host port 5433) plus Keycloak's own PostgreSQL container. Services share containers but own separate logical schemas.

## Database Ownership Model

### Core Principle: No Cross-Service Database Access

```mermaid
graph TB
    subgraph "Service Layer"
        Users[Users Service]
        Friendship[Friendship Service]
        Conversation[Conversation Service]
        MsgStore[Message Store]
        ChatCore[Chat Core]
    end

    subgraph "Database Layer"
        UsersDB[(users-db<br/>host: 5434<br/>users + friendship tables)]
        ChatDB[(chat-db<br/>host: 5433<br/>conversations + messages<br/>+ policy_rules)]
    end

    Users -->|OWNS| UsersDB
    Friendship -->|OWNS| UsersDB
    Conversation -->|OWNS| ChatDB
    MsgStore -->|OWNS| ChatDB
    ChatCore -->|READ-ONLY| ChatDB

    classDef service fill:#4CAF50,stroke:#2E7D32,color:#fff
    classDef database fill:#2196F3,stroke:#1565C0,color:#fff

    class Users,Friendship,Conversation,MsgStore,ChatCore service
    class UsersDB,ChatDB database
| **chat-db** | Conversation Service + Message Store + Chat Core (read) | 5433 (host) | Conversation lifecycle, messages, ACL rules | conversations, conversation_members, messages, message_edit_history, pinned_messages, outbox_events, policy_rules |

**Note**: Users Service and Friendship Service share the `users-db` container (host port 5434). Conversation Service and Message Store share the `chat-db` container (host port 5433). Chat Core reads `policy_rules` from `chat-db` but does not write to it. In production, each service should have its own dedicated PostgreSQL instance.

---

## Database Schemas

### 1. users-db (Users Service + Friendship Service)

Host port: **5434** → container 5432

#### Entity-Relationship Diagram

```mermaid
erDiagram
    users {
        VARCHAR id PK "Keycloak ID from JWT sub"
        VARCHAR email UK "User email"
        VARCHAR username UK "Display name"
        VARCHAR firstName
        VARCHAR lastName
        VARCHAR avatarUrl
        VARCHAR orgId "Organization ID"
        VARCHAR title "Job title"
        VARCHAR departmentId "Department reference"
        VARCHAR accountStatus "ACTIVE|SUSPENDED|OFFBOARDED"
        BOOLEAN isActive
        TIMESTAMP createdAt
        TIMESTAMP updatedAt
    }
    
    user_settings {
        UUID id PK
        VARCHAR userId FK "Keycloak ID"
        JSONB preferences "UI preferences"
        VARCHAR language "en, es, fr, etc."
        VARCHAR timezone
        BOOLEAN notificationsEnabled
        TIMESTAMP createdAt
        TIMESTAMP updatedAt
    }
    
    users ||--o| user_settings : "has"
```

#### Table Details

**users**
- **Purpose**: User profile information synchronized from Keycloak
- **Primary Key**: `id` (VARCHAR 255, Keycloak ID from JWT sub)
- **Unique Constraints**: `email`, `username`
- **Indexes**:
  - `idx_users_email` on `email`
  - `idx_users_username` on `username` (for search)
  - `idx_users_org_id` on `orgId`
  - `idx_users_account_status` on `accountStatus`

**user_settings**
- **Purpose**: User preferences and configuration
- **Primary Key**: `id` (UUID)
- **Foreign Key**: `userId` → `users(id)` ON DELETE CASCADE
- **Unique Constraint**: `userId` (one setting record per user)

#### No Cross-Database Joins

**Wrong** :
```sql
-- Users Service trying to query friendships directly
SELECT u.*, f.status
FROM users u
JOIN friendships f ON u.id = f.user_id;
-- Wrong: friendship tables are in users-db but owned by Friendship Service; always call it via TCP
```

**Correct** :
```typescript
// Users Service calls Friendship Service via TCP
const friends = await this.friendshipClient.send(
  FRIENDSHIP_PATTERNS.GET_FRIENDS,
  { userId }
).toPromise();

// Combine data in application layer
const users = await this.usersRepository.findByIds(friends.map(f => f.friendId));
```

---

### 2. friendship tables (in users-db)

#### Entity-Relationship Diagram

```mermaid
erDiagram
    friendships {
        UUID id PK
        UUID userId FK "First user"
        UUID friendId FK "Second user"
        ENUM status "FRIEND, BLOCKED"
        TIMESTAMP createdAt
        TIMESTAMP updatedAt
    }
    
    friend_requests {
        UUID id PK
        UUID fromUserId FK "Requester"
        UUID toUserId FK "Target user"
        ENUM status "PENDING, ACCEPTED, REJECTED"
        TIMESTAMP createdAt
        TIMESTAMP respondedAt
    }
    
    blocks {
        UUID id PK
        UUID blockerId FK "User who blocked"
        UUID blockedId FK "User who was blocked"
        TIMESTAMP createdAt
    }
    
    friendships ||--o{ friend_requests : "created from"
    friendships }o--|| blocks : "prevents"
```

#### Table Details

**friendships**
- **Purpose**: Bidirectional friendship relationships
- **Primary Key**: `id` (UUID)
- **Unique Constraint**: `(userId, friendId)` - prevents duplicate friendships
- **Indexes**:
  - `idx_friendships_user_id` on `userId` (get all friends for user)
  - `idx_friendships_friend_id` on `friendId` (reverse lookup)
  - `idx_friendships_status` on `status` (filter by status)

**friend_requests**
- **Purpose**: Pending friend requests
- **Primary Key**: `id` (UUID)
- **Unique Constraint**: `(fromUserId, toUserId)` where `status = PENDING`
- **Indexes**:
  - `idx_friend_requests_to_user_id` on `toUserId` where `status = PENDING` (get incoming requests)
  - `idx_friend_requests_from_user_id` on `fromUserId` (get outgoing requests)

**blocks**
- **Purpose**: User blocking (prevents messaging, friend requests)
- **Primary Key**: `id` (UUID)
- **Unique Constraint**: `(blockerId, blockedId)`
- **Indexes**:
  - `idx_blocks_blocker_id` on `blockerId` (check if user blocked someone)
  - `idx_blocks_blocked_id` on `blockedId` (check if user is blocked)

#### Friendship Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Pending: Send request
    Pending --> Friends: Accept
    Pending --> [*]: Reject
    Friends --> [*]: Unfriend
    [*] --> Blocked: Block user
    Blocked --> [*]: Unblock
    
    note right of Pending
        Record in friend_requests
        status = PENDING
    end note
    
    note right of Friends
        2 records in friendships
        (bidirectional)
    end note
    
    note right of Blocked
        Record in blocks
        Prevents all interactions
    end note
```

#### Data Consistency

**Accepting Friend Request**:
```typescript
// Transaction ensures atomicity
await this.dataSource.transaction(async (manager) => {
  // 1. Delete friend request
  await manager.delete(FriendRequest, { id: requestId });
  
  // 2. Create bidirectional friendship
  await manager.insert(Friendship, [
    { userId: userA, friendId: userB, status: FriendshipStatus.FRIEND },
    { userId: userB, friendId: userA, status: FriendshipStatus.FRIEND }
  ]);
});
```

**Why Bidirectional?**
- Fast lookup: "Get all friends of User A" → single query on `userId`
- No complex joins needed
- Trade-off: 2x storage for 10x query performance

---

### 3. chat-db (Conversation Service + Message Store + Chat Core)

Host port: **5433** → container 5432

#### Entity-Relationship Diagram

```mermaid
erDiagram
    conversations {
        UUID id PK
        ENUM type "DIRECT, DEPARTMENT, PROJECT, ANNOUNCEMENT"
        VARCHAR name "NULL for DIRECT"
        TEXT description
        INT memberCount "denormalized"
        BIGINT maxOffset "monotonic counter"
        VARCHAR createdBy
        VARCHAR orgId "tenant boundary"
        JSONB metadata "kind, departmentId?, projectId?"
        TIMESTAMP createdAt
        TIMESTAMP updatedAt
    }        TEXT description
        INTEGER memberCount "Denormalized for performance"
        BIGINT maxOffset "Latest message offset"
        UUID createdBy FK "Creator user ID"
        TIMESTAMP createdAt
        TIMESTAMP updatedAt
    }
    
    conversation_members {
        UUID id PK
        UUID conversationId FK
        UUID userId FK "Member user ID"
        BIGINT lastSeenOffset "Last message seen"
        TIMESTAMP joinedAt
        TIMESTAMP leftAt "NULL if still member"
    }
    
    conversations ||--|{ conversation_members : "has"
```

#### Table Details

**conversations**
- **Purpose**: Conversation metadata and state
- **Primary Key**: `id` (UUID)
- **Indexes**:
  - `idx_conversations_type` on `type` (filter by conversation type)
  - `idx_conversations_created_by` on `createdBy` (find user's created conversations)

**Fields Explained**:
- `type`: DIRECT (2 members), DEPARTMENT (auto-sync membership), PROJECT (manual membership), ANNOUNCEMENT (read-only)
- `memberCount`: Denormalized counter for performance (no COUNT query)
- `maxOffset`: Atomic counter for message ordering (incremented per message)

**conversation_members**
- **Purpose**: Membership roster and read status
- **Primary Key**: `id` (UUID)
- **Foreign Key**: `conversationId` → `conversations(id)` ON DELETE CASCADE
- **Unique Constraint**: `(conversationId, userId)` - user can't join twice
- **Indexes**:
  - `idx_conversation_members_user_id` on `userId` where `leftAt IS NULL` (get active conversations)
  - `idx_conversation_members_conversation_id` on `conversationId` (get all members)

**Fields Explained**:
- `lastSeenOffset`: Highest message offset user has seen (for unread count)
- `joinedAt`: When user joined conversation
- `leftAt`: NULL if active member, timestamp if left

#### Offset-Based Message Ordering

**Why Offsets Instead of Timestamps?**

```
 Timestamp-based (problematic):
Message A: 2025-01-01 12:00:00.123
Message B: 2025-01-01 12:00:00.123  ← Same millisecond!
Message C: 2025-01-01 12:00:00.124

 Offset-based (guaranteed order):
Message A: offset 1
Message B: offset 2
Message C: offset 3
```

**Atomic Increment**:
```typescript
// Conversation Service
async incrementMaxOffset(conversationId: string): Promise<number> {
  const result = await this.repository.query(
    `UPDATE conversations 
     SET maxOffset = maxOffset + 1 
     WHERE id = $1 
     RETURNING maxOffset`,
    [conversationId]
  );
  
  return result[0].maxOffset;
}
```

**Unread Count Calculation**:
```typescript
// Conversation Service
async getUnreadCount(conversationId: string, userId: string): Promise<number> {
  const member = await this.membersRepository.findOne({
    where: { conversationId, userId }
  });
  
  const conversation = await this.repository.findOne({
    where: { id: conversationId }
  });
  
  // Unread = maxOffset - lastSeenOffset
  return conversation.maxOffset - member.lastSeenOffset;
}
```

#### Conversation Type Transitions

```mermaid
stateDiagram-v2
    [*] --> DIRECT: Create 1-on-1
    [*] --> DEPARTMENT: Create department channel
    [*] --> PROJECT: Create project channel
    [*] --> ANNOUNCEMENT: Create announcement channel
    DIRECT --> [*]: Delete
    DEPARTMENT --> [*]: Archive or delete
    PROJECT --> [*]: Archive or delete
    ANNOUNCEMENT --> [*]: Archive or delete

    note right of DIRECT
        memberCount = 2
        Cannot add more members
    end note

    note right of DEPARTMENT
        Membership auto-synced from department
        Manual GUEST invites allowed
    end note

    note right of PROJECT
        Manual membership management
        OWNER/ADMIN can add/remove
    end note

    note right of ANNOUNCEMENT
        Read-only for MEMBER/GUEST/READONLY
        Only OWNER/ADMIN/MODERATOR can post
### 4. message tables (in chat-db)

#### Entity-Relationship Diagram

```mermaid
erDiagram
    messages {
        UUID id PK
        UUID conversationId FK
        UUID senderId FK "User who sent"
        TEXT content
        ENUM type "TEXT, IMAGE, FILE, SYSTEM"
        JSONB metadata "File URLs, dimensions, etc."
        BIGINT offset "Sequential per conversation"
        TIMESTAMP createdAt
        TIMESTAMP updatedAt
        TIMESTAMP deletedAt "Soft delete"
    }
    
    message_receipts {
        UUID id PK
        UUID messageId FK
        UUID userId FK "Recipient"
        ENUM status "DELIVERED, READ"
        TIMESTAMP deliveredAt
        TIMESTAMP readAt
    }
    
    messages ||--|{ message_receipts : "has"
```

#### Table Details

**messages**
- **Purpose**: Store all chat messages
- **Primary Key**: `id` (UUID)
- **Foreign Key**: None (conversationId references conversation_db, but no FK constraint)
- **Unique Constraint**: `(conversationId, offset)` - ensures sequential ordering
- **Indexes**:
  - `idx_messages_conversation_id_offset` on `(conversationId, offset)` (fetch conversation history)
  - `idx_messages_sender_id` on `senderId` (find messages by user)
  - `idx_messages_created_at` on `createdAt` (time-based queries)

**Fields Explained**:
- `offset`: Sequential number per conversation (1, 2, 3, ...)
- `type`: TEXT (plain text), IMAGE (image URL), FILE (document), SYSTEM (join/leave notifications)
- `metadata`: JSON for rich content (image dimensions, file size, thumbnails)
- `deletedAt`: Soft delete (message hidden, but not removed)

**message_receipts**
- **Purpose**: Track delivery and read status per recipient
- **Primary Key**: `id` (UUID)
- **Foreign Key**: `messageId` → `messages(id)` ON DELETE CASCADE
- **Unique Constraint**: `(messageId, userId)` - one receipt per message per user
- **Indexes**:
  - `idx_message_receipts_message_id` on `messageId` (get all receipts for message)
  - `idx_message_receipts_user_id` on `userId` (get all receipts for user)
  - `idx_message_receipts_status` on `status` (filter by status)

**Receipt Lifecycle**:
```
1. Message sent → No receipts yet
2. Message persisted → Create receipts with status = DELIVERED for all members
3. User reads message → Update receipt status = READ, set readAt
```

#### Optimized Queries

**Fetch Conversation Messages with Pagination**:
```sql
-- Get 50 messages after offset 100
SELECT m.*, 
       (SELECT status FROM message_receipts 
        WHERE messageId = m.id AND userId = $2 LIMIT 1) as myStatus
FROM messages m
WHERE m.conversationId = $1
  AND m.offset > 100
  AND m.deletedAt IS NULL
ORDER BY m.offset ASC
LIMIT 50;
```

**Get Unread Message Count**:
```sql
-- Count messages after user's lastSeenOffset
-- Both messages and conversation_members are in chat-db (same container)
SELECT COUNT(*)
FROM messages m
WHERE m.conversationId = $1
  AND m.offset > (
    SELECT lastSeenOffset
    FROM conversation_members
  AND m.deletedAt IS NULL;
```

**Batch Update Read Receipts**:
```sql
-- Mark all messages up to offset 42 as read
UPDATE message_receipts
SET status = 'READ', readAt = NOW()
WHERE messageId IN (
  SELECT id FROM messages
  WHERE conversationId = $1
    AND offset <= 42
    AND senderId != $3  -- Don't update sender's own receipts
)
  AND userId = $2
  AND status != 'READ';  -- Only update unread receipts
```

#### Partitioning Strategy (Future)

**Problem**: `messages` table grows unbounded (billions of rows)

**Solution**: Partition by `createdAt` (monthly partitions)

```sql
-- Create partitioned table
CREATE TABLE messages (
  id UUID,
  conversationId UUID,
  content TEXT,
  offset BIGINT,
  createdAt TIMESTAMP,
  PRIMARY KEY (id, createdAt)
) PARTITION BY RANGE (createdAt);

-- Create monthly partitions
CREATE TABLE messages_2025_01 PARTITION OF messages
FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE messages_2025_02 PARTITION OF messages
FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
```

**Benefits**:
- Drop old partitions (GDPR compliance: delete data after 7 years)
- Query performance (only scan relevant partitions)
- Easier maintenance (vacuum per partition)

---

## No Cross-Database Joins Rule

### Why No Joins?

1. **Service Autonomy**: Each service owns its data and can evolve independently
2. **Scalability**: Services can use different database instances, regions, or even technologies
3. **Fault Isolation**: If friendship_db is down, users_db remains accessible
4. **Clear Boundaries**: Enforces microservices principles

### Alternative Patterns

#### Pattern 1: Service-to-Service Communication (TCP)

```typescript
//  BAD: Direct database query across services
const query = `
  SELECT u.username, m.content
  FROM users_db.users u
  JOIN chat_db.messages m ON u.id = m.senderId
  WHERE m.conversationId = $1
`;

//  GOOD: Service calls
// Message Store fetches messages
const messages = await this.messageRepository.find({ conversationId });

// Message Store calls Users Service to get sender details
const senderIds = messages.map(m => m.senderId);
const users = await this.usersClient.send(
  USERS_PATTERNS.FIND_BY_IDS,
  { ids: senderIds }
).toPromise();

// Combine in application layer
const messagesWithUsers = messages.map(msg => ({
  ...msg,
  sender: users.find(u => u.id === msg.senderId)
}));
```

#### Pattern 2: Event-Driven Denormalization

```typescript
// Friendship Service publishes event
await this.kafkaProducer.send({
  topic: 'friendship.request.accepted',
  value: {
    userId: userA,
    friendId: userB,
    timestamp: new Date()
  }
});

// Conversation Service consumes event
@EventPattern('friendship.request.accepted')
async onFriendshipAccepted(event: FriendshipAcceptedEvent) {
  // Auto-create DIRECT conversation
  await this.conversationRepository.create({
    type: ConversationType.DIRECT,
    memberIds: [event.userId, event.friendId],
    memberCount: 2
  });
}
```

#### Pattern 3: Data Replication (Read-Heavy Scenarios)

```typescript
// Users Service caches friend lists in Redis
// Friendship Service updates cache on friendship changes
await this.cacheService.set(
  `friends:${userId}`,
  JSON.stringify(friendIds),
  3600 // 1 hour TTL
);

// Friendship Service invalidates cache on change
@EventPattern('friendship.removed')
async onFriendshipRemoved(event: FriendshipRemovedEvent) {
  await this.cacheService.delete(`friends:${event.userId}`);
  await this.cacheService.delete(`friends:${event.friendId}`);
}
```

---

## Database Performance Considerations

### Connection Pooling

**Configuration** (per service):
```typescript
TypeOrmModule.forRoot({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: 5432,
  database: 'users_db',
  entities: [User, UserSettings],
  
  // Connection pool settings
  poolSize: 20,           // Max connections
  extra: {
    max: 20,             // Pool size
    min: 5,              // Min idle connections
    idleTimeoutMillis: 30000,  // Close idle after 30s
    connectionTimeoutMillis: 2000,  // Wait 2s for connection
  }
});
```

**Why Pool?**
- Reuse connections (avoid TCP handshake overhead)
- Limit concurrent queries (prevent database overload)
- Faster query execution (~5ms with pool vs ~50ms without)

### Indexing Strategy

**Primary Indexes** (created automatically):
- Primary keys: Clustered index
- Unique constraints: Unique index
- Foreign keys: Index on child table

**Secondary Indexes** (create manually):
```sql
-- Users: Lookup by Keycloak ID (most common)
-- Removed: idx_users_keycloak_id (keycloakId is now primary key)

-- Friendships: Get all friends for user
CREATE INDEX idx_friendships_user_id ON friendships(userId) WHERE status = 'FRIEND';

-- Messages: Fetch conversation history
CREATE INDEX idx_messages_conversation_offset ON messages(conversationId, offset);

-- Conversation Members: Active conversations for user
CREATE INDEX idx_members_user_active ON conversation_members(userId) 
WHERE leftAt IS NULL;
```

### Query Performance Monitoring

**Slow Query Log** (PostgreSQL):
```sql
-- Enable slow query log (queries > 100ms)
ALTER DATABASE users_db SET log_min_duration_statement = 100;

-- View slow queries
SELECT query, calls, total_time, mean_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;
```

---

## Backup & Recovery Strategy

### Backup Strategy

**PostgreSQL Continuous Archiving (WAL)**:
```bash
# Base backup (once per day)
pg_basebackup -h localhost -U postgres -D /backup/base

# WAL archiving (continuous)
archive_command = 'cp %p /backup/wal/%f'
```

**Per-Database Logical Backup**:
```bash
# Backup users_db
pg_dump -h localhost -U postgres users_db > users_db_backup.sql

# Backup with compression
pg_dump -h localhost -U postgres -Fc users_db > users_db_backup.dump
```

**Automated Schedule**:
- Full backup: Daily at 2 AM
- WAL archiving: Continuous
- Retention: 30 days

### Recovery Scenarios

**Scenario 1: Accidental DELETE**

```sql
-- User accidentally deletes messages
DELETE FROM messages WHERE conversationId = 'conv-123';

-- Recovery from backup (5 minutes ago)
pg_restore -h localhost -U postgres -d chat_db \
  --table=messages chat_db_backup.dump

-- Only lost 5 minutes of data
```

**Scenario 2: Database Corruption**

```bash
# Stop PostgreSQL
systemctl stop postgresql

# Restore from base backup
rm -rf /var/lib/postgresql/data
cp -r /backup/base /var/lib/postgresql/data

# Replay WAL logs
recovery_target_time = '2025-01-01 12:00:00'
restore_command = 'cp /backup/wal/%f %p'

# Start PostgreSQL (applies WAL)
systemctl start postgresql
```

---

## Migration Strategy

### TypeORM Migrations

**Generate Migration**:
```bash
# Make schema changes in entities
# Generate migration
npm run migration:generate -- -n AddUserAvatar

# Creates migration file:
# src/migrations/1672531200000-AddUserAvatar.ts
```

**Migration File**:
```typescript
export class AddUserAvatar1672531200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn('users', new TableColumn({
      name: 'avatarUrl',
      type: 'varchar',
      isNullable: true
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('users', 'avatarUrl');
  }
}
```

**Run Migration**:
```bash
# Apply pending migrations
npm run migration:run

# Revert last migration
npm run migration:revert
```

### Zero-Downtime Migrations

**Example**: Add required column

** Bad** (causes downtime):
```sql
-- Application breaks during migration
ALTER TABLE users ADD COLUMN phoneNumber VARCHAR NOT NULL;
```

** Good** (zero downtime):
```sql
-- Step 1: Add nullable column
ALTER TABLE users ADD COLUMN phoneNumber VARCHAR;

-- Step 2: Deploy code that populates phoneNumber
-- (Application handles NULL values)

-- Step 3: Backfill existing rows
UPDATE users SET phoneNumber = '+1234567890' WHERE phoneNumber IS NULL;

-- Step 4: Add NOT NULL constraint
ALTER TABLE users ALTER COLUMN phoneNumber SET NOT NULL;
```

---

## References

- [system-architecture.md](./system-architecture.md) - Overall system architecture
- [SERVICE_COMMUNICATION.md](../integration/SERVICE_COMMUNICATION.md) - How services communicate instead of database joins
- [TypeORM Documentation](https://typeorm.io/) - Entity management and migrations
- [PostgreSQL Documentation](https://www.postgresql.org/docs/) - Database best practices
