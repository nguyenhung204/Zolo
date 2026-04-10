# Media Service Documentation

## Overview

The **Media Service** manages multimedia content (images, videos, files) for the chat system. It handles pre-signed upload URL generation, checksum verification, metadata tracking, media binding, and lifecycle management. Actual file storage is delegated to MinIO; actual processing (thumbnail, transcode) is delegated to the Media Worker via Kafka.

**Transport**: Media Service is a **TCP microservice** (port 3009). All client access goes through the Gateway HTTP API, which proxies to the Media Service via NestJS TCP `ClientProxy`.

## Architecture

### Technology Stack
- **Communication**: TCP Microservice (port 3009) — accessed by Gateway, Chat Core, and Conversation Service via `ClientProxy`
- **Storage**: MinIO (S3-compatible object storage)
- **Database**: MongoDB (metadata only, not file content)
- **Event Bus**: Kafka (MEDIA_UPLOADED produced; MEDIA_READY/FAILED consumed)
- **Authentication**: JWT extracted by Gateway before TCP call; `ownerId` passed in payload
- **Pattern**: Repository pattern with interface abstraction (`IMediaRepository`, `IUploadSessionRepository`, `IMediaBindingRepository`)

### Key Design Principles
-  **TCP Architecture**: Internal microservice transport — clients never call Media Service directly
-  **State Machine**: CREATED → UPLOADED → PROCESSING → READY → DELETED/FAILED
-  **Fail-safe deletion**: MinIO delete failure sets status to `DELETION_PENDING` for cron retry
-  **Integrity Verification**: Checksum (MD5/SHA256) **always verified when client provides it**, regardless of strict mode. Strict mode (`MEDIA_CHECKSUM_STRICT=true`) makes checksum **required** — request without checksum returns 400.
-  **Upload Finalization**: POST /media/upload/complete verifies file uploaded before processing
-  **Separation of Concerns**: Files stored in object storage, metadata in MongoDB
-  **Pre-signed URLs**: Client uploads directly to MinIO (no gateway bottleneck)
-  **Async Processing**: Upload → Finalize → Process → Generate thumbnails
-  **Secure Access**: Short-lived pre-signed URLs (PUT: 15min, GET: 5min TTL)
-  **Event-Driven Cleanup**: Auto-delete on message/user deletion
-  **Repository Pattern**: Data access through interfaces (`IMediaRepository`, `IUploadSessionRepository`)
-  **Integration**: ChatCore validates media ownership before accepting messages

---

## State Machine

### Status Flow
```
CREATED > UPLOADED > PROCESSING > READY > DELETED
                                         
   > FAILED <
```

### State Definitions

| Status | Description | Next States | Triggers |
|--------|-------------|-------------|----------|
| **CREATED** | Initial state after `POST /media/upload`, awaiting file upload | UPLOADED, FAILED | User uploads to MinIO |
| **UPLOADED** | File verified in MinIO, checksum validated | PROCESSING, FAILED | `POST /media/upload/complete` success |
| **PROCESSING** | Extracting metadata, generating thumbnails | READY, FAILED | Background processing |
| **READY** | Media ready for use in messages | DELETED, DELETION_PENDING | User action or system deletion |
| **DELETION_PENDING** | MinIO delete failed; queued for retry by RecoveryService (5 min back-off) | DELETED | RecoveryService cron |
| **DELETED** | Soft deleted — metadata removed, MinIO object deleted | (terminal) | User deletion, RecoveryService retry, or cleanup |
| **FAILED** | Upload/processing error | (terminal) | Checksum mismatch, processing error |

### State Validations
- **`sendMessage()`**: Only accepts media with status=READY
- **`getMediaUrl()`**: Only returns URLs for status=READY media
- **`processMedia()`**: Only processes media with status=UPLOADED
- **`finalizeUpload()`**: Only transitions CREATED → UPLOADED

---

## Responsibilities

###  Core Features
1. **Upload Management**
   - Generate pre-signed PUT URLs for client uploads (15 min TTL)
   - Validate file size and mime types
   - Create media record with status=CREATED
   - Support chunked uploads for large files (future)

2. **Upload Finalization** (NEW)
   - Verify file exists in MinIO before processing
   - Validate MD5/SHA256 checksum for integrity
   - Transition CREATED → UPLOADED status
   - Trigger background processing

3. **Media Processing**
   - Extract image metadata (dimensions, format, EXIF)
   - Generate thumbnails (configurable size: 320x240)
   - Validate uploaded files
   - Update status to READY when complete

4. **Access Control**
   - Generate pre-signed GET URLs with short TTL (5 min)
   - Verify ownership before access via KeycloakGuard
   - Support thumbnail URLs

5. **Lifecycle Management**
   - Delete media when messages are deleted (Kafka event)
   - Delete all user media on account deletion (Kafka event)
   - Cleanup expired upload sessions

###  Not Responsible For
- Business logic validation (handled by Chat Core)
- Real-time broadcasting (handled by Realtime Gateway)
- Storing file content in databases

---

## Gateway HTTP Endpoints (Client-facing)

All client-facing endpoints are exposed by the **Gateway** (`http://localhost:3000`). The Gateway authenticates the JWT, extracts `userId`, and forwards to Media Service via **TCP**.

### 1. Create Upload
**POST** `/media/upload`

**Headers**:
```
Authorization: Bearer {jwt_token}
```

**Request Body**:
```json
{
  "type": "image",
  "mimeType": "image/jpeg",
  "size": 2048576,
  "filename": "photo.jpg"
}
```

**Response** (200 OK):
```json
{
  "mediaId": "550e8400-e29b-41d4-a716-446655440000",
  "uploadUrl": "https://minio:9000/media/.../upload?X-Amz-Signature=...",
  "expiresAt": "2026-01-04T12:15:00Z"
}
```

**Flow**:
1. Client calls `POST /media/upload` → Gateway (HTTP) → Media Service (TCP: `CREATE_UPLOAD`)
2. Media Service creates DB record with **status=CREATED** (not PROCESSING)
3. Returns pre-signed PUT URL (15 min TTL)
4. Client uploads file directly to MinIO using PUT URL

---

### 2. Finalize Upload
**POST** `/media/upload/complete`

**Headers**:
```
Authorization: Bearer {jwt_token}
```

**Request Body**:
```json
{
  "mediaId": "550e8400-e29b-41d4-a716-446655440000",
  "checksum": "5d41402abc4b2a76b9719d911017c592",
  "checksumAlgorithm": "md5"
}
```

> `checksum` is **optional by default** (`MEDIA_CHECKSUM_STRICT=false`). When omitted, file existence is still verified in MinIO but content integrity is skipped.
> When `MEDIA_CHECKSUM_STRICT=true`, checksum is **required** — omitting it returns `400`.
> When provided (regardless of strict mode), checksum is **always verified** via streaming hash — no silent skips.

| Field | Required | Description |
|-------|----------|-------------|
| `mediaId` | Yes | UUID returned from `POST /media/upload` |
| `checksum` | Optional* | Client-computed hash of the uploaded file |
| `checksumAlgorithm` | No | `md5` (default) or `sha256` |

**Response** (200 OK):
```json
{
  "success": true,
  "status": "UPLOADED"
}
```

**Flow**:
1. Verifies file exists in MinIO (`HEAD` request)
2. If `MEDIA_CHECKSUM_STRICT=true` and no checksum → **400** immediately
3. If checksum provided → stream file from MinIO, compute hash, compare with client value
4. Hash mismatch → status set to `FAILED`, **400 Checksum mismatch**
5. Hash match (or no checksum provided) → status transitions `CREATED → UPLOADED`
6. Publishes `media.uploaded` Kafka event → Media Worker picks up for processing

**Errors**:
- `400 Bad Request`: Checksum mismatch, checksum missing in strict mode, file not found in MinIO
- `404 Not Found`: Invalid mediaId
- `409 Conflict`: Already finalized (status ≠ CREATED)

---

### 3. Get Media URL
**GET** `/media/:mediaId`

**Headers**:
```
Authorization: Bearer {jwt_token}
```

**Response** (200 OK):
```json
{
  "url": "https://minio:9000/media/.../photo.jpg?X-Amz-Signature=...",
  "thumbnailUrl": "https://minio:9000/media/.../photo_thumb.jpg?...",
  "expiresAt": "2026-01-04T12:05:00Z"
}
```

**Flow**:
1. Verifies media status = READY (other statuses return 404)
2. Verifies ownership (ownerId must match JWT sub)
3. Generates pre-signed GET URLs (5 min TTL)

---

### 4. Validate Media
**GET** `/media/validate/:mediaId?ownerId={userId}`

**Headers**:
```
Authorization: Bearer {jwt_token}
```

**Query Parameters**:
- `ownerId` (optional): Verify media ownership

**Response** (200 OK):
```json
{
  "valid": true,
  "url": "https://...",
  "thumbnailUrl": "https://...",
  "type": "image",
  "size": 2048576,
  "meta": { "width": 1920, "height": 1080 }
}
```

**Usage**: ChatCore calls this to validate media before accepting messages.

**Validation Rules**:
- Status must be READY
- If `ownerId` provided, must match media.ownerId
- Returns `{ valid: false }` for any failure

---

### 5. Delete Media
**DELETE** `/media/:mediaId`

**Headers**:
```
Authorization: Bearer {jwt_token}
```

**Response** (200 OK):
```json
{
  "success": true
}
```

**Flow**:
1. Verifies ownership (ownerId must match JWT sub)
2. Soft deletes: Updates status to DELETED (files remain in MinIO)
3. Background cleanup job removes files later

---

## TCP Patterns (Gateway Communication)

The Gateway communicates with Media Service via **TCP** using `ClientProxy` (NestJS microservices). The `MediaGatewayService` extends `BaseGatewayService` and wraps all patterns as facade methods.

| Pattern | Cmd | Description |
|---------|-----|-------------|
| `LIST_MEDIA` | `list_media` | List media owned by user |
| `CREATE_UPLOAD` | `create_upload` | Create upload session (presigned PUT URL) |
| `FINALIZE_UPLOAD` | `finalize_upload` | Verify checksum and transition CREATED → UPLOADED |
| `VALIDATE_MEDIA` | `validate_media` | Validate media for access |
| `GET_MEDIA_URL` | `get_media_url` | Get presigned GET URL for a media item |
| `DELETE_MEDIA` | `delete_media` | Soft delete owned media |
| `VALIDATE_FOR_SEND` | `validate_for_send` | Pre-check before message send |
| `BIND_TO_MESSAGE` | `bind_to_message` | Bind media to a message (ownership transfer) |
| `GET_ACCESS_URL` | `get_access_url` | Get access URL with optional thumbnail |
| `CROSS_SHARE` | `cross_share` | Share media across projects (ADMIN only) |
| `GET_AVATARS_BATCH` | `get_avatars_batch` | Batch presigned URL resolution for avatars |
| `DELETE_AVATAR_SYSTEM` | `delete_avatar_system` | System-level avatar deletion (no owner check) |

### GET_AVATARS_BATCH

Called by `ConversationGatewayService` to resolve presigned avatar URLs for a batch of `mediaId` values in a single round-trip.

**Request**: `{ mediaIds: string[]; variant?: 'thumb' | 'original' }`

**Response**: `{ urls: Record<string, { url: string; expiresAt: number }> }`
- `expiresAt` is Unix milliseconds when the presigned URL expires
- Missing, DELETED, or DELETION_PENDING media entries are silently omitted
- Auth model: ownership check skipped for avatar batch resolution (public assets)

**Gateway caching**: Results are stored in Redis with TTL = `expiresAt - now - 5 min buffer`. Key: `media:avatar_url:{mediaId}`.

### DELETE_AVATAR_SYSTEM

Called by `ConversationManagementGatewayService` when a conversation replaces its avatar.

**Request**: `{ mediaId: string }`

**Response**: `boolean` (true = deleted, false = not found)

**Behavior**:
- Bypasses owner check — caller is trusted (internal system call)
- Idempotent: DELETED or DELETION_PENDING returns true immediately
- MinIO failure marks media as `DELETION_PENDING` for retry by RecoveryService (cron, 5 min back-off)

---

## Gateway Integration

The Gateway uses `MediaGatewayService` (extends `BaseGatewayService`) to proxy all media operations via TCP `ClientProxy`.

**File**: `apps/gateway/src/modules/media/media.gateway.ts`

```typescript
@Injectable()
export class MediaGatewayService extends BaseGatewayService {
  constructor(
    @Inject(SERVICES.MEDIA) client: ClientProxy,
    cbService: CircuitBreakerService,
  ) {
    super(client, cbService, 'media-service');
  }

  createUpload(dto: CreateMediaUploadDto & { ownerId: string }) {
    return this.proxy.send(MEDIA_PATTERNS.CREATE_UPLOAD, dto);
  }

  validateForSend(params: { mediaId: string; conversationId: string; senderId: string }) {
    return this.proxy.send(MEDIA_PATTERNS.VALIDATE_FOR_SEND, params);
  }
  // ... other methods
}
```

**Key Points**:
- Uses `ClientProxy` (TCP), NOT HttpService
- JWT is validated by Gateway; `ownerId` extracted and passed in the TCP payload
- The Media Service does NOT receive raw JWT tokens — only structured payloads

---

## ChatCore Integration

Chat Core validates media attachments using the `IMediaService` interface resolved from `ServiceRegistry` (Dependency Inversion). The underlying adapter (`MediaServiceAdapter`) calls the Media Service via **TCP**.

**File**: `apps/chat-core/src/validators/media-validator.service.ts`

```typescript
@Injectable()
export class MediaValidatorService {
  constructor(private readonly registry: ServiceRegistry) {}

  async validateMedia(context: MediaValidationContext): Promise<MediaValidationResult> {
    const mediaService = this.registry.resolve<IMediaService>(SERVICE_NAMES.MEDIA);
    // IMediaService.validateForSend() → TCP: VALIDATE_FOR_SEND → Media Service
    const media = await mediaService.validateForSend({
      mediaId: context.mediaId,
      senderId: context.senderId,
      conversationId: context.conversationId,
    });
    // ... classification, status, ownership checks
  }
}
```

**Flow**:
1. User uploads media → gets `mediaId`
2. User sends message with `metadata: { mediaId }`
3. ChatCore calls `MediaValidatorService.validateMedia()` → TCP `VALIDATE_FOR_SEND`
4. Media Service confirms status=READY, ownership match, classification allowed
5. If valid → publish `MESSAGE_ACCEPTED`
6. If invalid → throw `RpcException` with specific error code (e.g. `FORBIDDEN_MEDIA_NOT_READY`)

---

## Kafka Event Consumers

### Consumer Group
Uses `CONSUMER_GROUPS.MEDIA` constant from `@app/kafka`

**File**: `libs/kafka/src/constants/kafka-topics.constants.ts`
```typescript
export const CONSUMER_GROUPS = {
  MEDIA: 'nest-chat.media',
  // ... other groups
}
```

### 1. `chat.event.message_deleted`
**Topic**: `KAFKA_TOPICS.EVENTS.MESSAGE_DELETED`

**Payload**:
```json
{
  "messageId": "msg-123",
  "senderId": "user-456",
  "metadata": {
    "mediaId": "550e8400-..."
  }
}
```

**Action**: Delete media object from MinIO + update DB status to DELETED

**Status**:  Waiting for Message Store to publish deletion events

---

### 2. `user.deleted`
**Topic**: `KAFKA_TOPICS.USER.DELETED`

**Payload**:
```json
{
  "userId": "user-123"
}
```

**Action**: Delete ALL media owned by user (MongoDB + MinIO)

**Status**:  Waiting for Users Service to publish deletion events

---

## Database Schema (MongoDB)

### Collection: `media_objects`
Managed by `IMediaRepository` interface

```typescript
{
  id: "550e8400-...",              // UUID
  ownerId: "user-123",             // User ID from JWT
  type: "image" | "video" | "file",
  mimeType: "image/jpeg",
  size: 2048576,                   // bytes
  url: "user-123/550e8400.jpg",    // MinIO object key
  thumbnailUrl: "user-123/550e8400_thumb.jpg",
  status: "CREATED" | "UPLOADED" | "PROCESSING" | "READY" | "FAILED" | "DELETED",
  checksum: "5d41402abc4b2a76b9719d911017c592",  // MD5 or SHA256 hash
  checksumAlgorithm: "md5" | "sha256",
  meta: {
    width: 1920,
    height: 1080,
    format: "jpeg",
    hasAlpha: false
  },
  createdAt: ISODate,
  updatedAt: ISODate
}
```

**Indexes**:
- `{ id: 1 }` (unique) - Primary key
- `{ ownerId: 1 }` - Find all media for user
- `{ status: 1 }` - Cleanup queries
- `{ createdAt: -1 }` - Chronological queries

**Repository Methods**:
- `create()` - Create media record with status=CREATED
- `findById()` - Get single media by ID
- `findByOwner()` - Get all media for user
- `updateStatus()` - Update status and updatedAt
- `updateMetadata()` - Update after processing
- `delete()` - Soft delete (status=DELETED)
- `hardDelete()` - Remove from DB (after cleanup)

---

### Collection: `upload_sessions` (Chunked Uploads)
Managed by `IUploadSessionRepository` interface

```typescript
{
  ownerId: "user-123",
  filename: "large-video.mp4",
  totalSize: 524288000,            // 500MB
  mimeType: "video/mp4",
  totalChunks: 50,
  uploadedChunks: [1, 2, 3, ...],  // Track progress
  status: "pending" | "completed" | "failed",
  mediaId: "550e8400-...",         // Set when completed
  expiresAt: ISODate,              // 24 hours
  createdAt: ISODate
}
```

**Repository Methods**:
- `create()` - Initialize upload session
- `findById()` - Get session details
- `update()` - Update chunks progress
- `delete()` - Remove session
- `deleteExpired()` - Cleanup expired sessions
- `getMissingChunks()` - Resume interrupted uploads

**Indexes**:
- `{ mediaId: 1 }` (sparse)
- `{ ownerId: 1 }`
- `{ status: 1 }`
- `{ expiresAt: 1 }` (sparse) - TTL cleanup

---

## Environment Variables

```env
# MinIO (Object Storage)
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET_NAME=media

# MongoDB
MEDIA_MONGODB_URI=mongodb://mediauser:mediapassword@media-mongodb:27017/media_db?authSource=admin

# Keycloak (Authentication)
KEYCLOAK_URL_INTERNAL=http://keycloak:8080
KEYCLOAK_REALM=nest-realm
KEYCLOAK_CLIENT_ID=nest-client

# Media Upload Configuration
MEDIA_MAX_FILE_SIZE=2147483648         # 2 GB (bytes)
MEDIA_PRESIGNED_PUT_URL_EXPIRY=900    # seconds (15 min)
MEDIA_PRESIGNED_GET_URL_EXPIRY=300    # seconds (5 min)
MEDIA_CHECKSUM_ALGORITHM=md5          # md5 | sha256
MEDIA_CHECKSUM_STRICT=false           # true = checksum required on /upload/complete

# Service
MEDIA_SERVICE_HOST=media-service
MEDIA_SERVICE_PORT=3009
KAFKA_BROKERS=kafka-1:29092
```

---

## Upload Flow Sequence (Updated)

```
                        
 Client        Gateway        Media Service       MinIO        Chat Core 
                        
                                                                         
     1. POST /media/upload                                               
    >                                                     
                     HTTP POST                                           
                    >                                   
                                       Create record (status=CREATED)    
                                                                         
                                       Generate pre-signed URL (15min)   
                                      >                 
                     { mediaId, uploadUrl }                               
                    <                                   
     { mediaId, uploadUrl, expiresAt }                                   
    <                                                     
                                                                          
     2. PUT uploadUrl (binary data)                                       
    >                 
                                                                           
     200 OK                                                                
    <                 
                                                                            
     3. Calculate checksum (MD5/SHA256)                                    
                                                                            
     4. POST /media/upload/complete { mediaId, checksum }                  
    >                                                      
                     HTTP POST                                            
                    >                                   
                                       Verify file exists in MinIO      
                                      >                
                                       200 OK                            
                                      <                
                                                                         
                                       Calculate server checksum        
                                       Compare with client checksum     
                                                                         
                                       Update status: CREATED→UPLOADED  
                     { success: true, status: "UPLOADED" }                
                    <                                   
     { success: true }                                                     
    <                                                     
                                                                          
                                        5. Background Processing          
                                        - Update status: UPLOADED→PROCESSING
                                        - Extract metadata               
                                        - Generate thumbnail             
                                        - Update status: PROCESSING→READY
                                                                           
     6. Send message with { mediaId }                                     
    >                                                     
                     send-message                                        
                    >
                                                                          
                                      HTTP GET /validate (timeout: 3s)   
                    <
                                      { valid: true, status=READY }      
                    >
                                                                          
                     Publish MESSAGE_ACCEPTED (if valid)                 
                    <
```

**Key Points**:
1. Initial status is CREATED (not PROCESSING)
2. Client must call `POST /media/upload/complete` with optional checksum after direct MinIO upload
3. State transitions: CREATED → UPLOADED → PROCESSING → READY (async via Media Worker)
4. All Gateway → Media Service communication is **TCP** (not HTTP)
5. Chat Core validates via `VALIDATE_FOR_SEND` TCP pattern (not HTTP)

---

## Integration with Chat System

### 1. Message Attachments (ChatCore Validation)
When a user sends a message with media attachment:

**Flow**:
1. Client uploads media → gets `mediaId` (status=CREATED)
2. Client uploads file to MinIO → calls `POST /media/upload/complete` → status=UPLOADED
3. Media Worker processes asynchronously → status=READY (via Kafka `MEDIA_READY` event)
4. Client sends message with `metadata: { mediaId }`
5. ChatCore calls `VALIDATE_FOR_SEND` TCP pattern → Media Service checks status, ownership, classification
6. Media Service returns validation result
7. If valid → ChatCore publishes `MESSAGE_ACCEPTED`
8. If invalid → ChatCore throws `RpcException` with error code (e.g. `FORBIDDEN_MEDIA_NOT_READY`)

**Security**:
-  Ownership verified (`ownerId` from payload must match `media.ownerId`)
-  Status checked (only READY media accepted)
-  Classification check (RESTRICTED files only in allowed channels)
-  Checksum validated (file integrity guaranteed at FINALIZE_UPLOAD stage)

### 2. User Profile Avatar
**User Entity** has `avatarUrl` field (nullable string)

**Usage**:
1. Upload avatar: `POST /media/upload` → `PUT to MinIO` → `POST /upload/complete` → get `mediaId`
2. Get permanent URL: `GET /media/:mediaId` → get `url`
3. Update profile: `PATCH /users/profile` with `{ avatarUrl: url }`

### 3. Group/Conversation Avatar
**Conversation Entity** has `avatarMediaId` field (VARCHAR 36, nullable UUID)

The Conversation Service stores only the `mediaId` reference; presigned URLs are **never** stored in the DB. The Gateway resolves them on demand.

**Upload flow**:
1. Upload avatar: `POST /media/upload` → `PUT to MinIO` → `POST /upload/complete` → get `mediaId`
2. Update conversation: `PATCH /conversations/:id/info` with `{ avatarMediaId: mediaId }`
3. Gateway calls `GET_AVATARS_BATCH` via TCP to Media Service when serving conversation list/detail

**Batch URL resolution** (`GET_AVATARS_BATCH` TCP pattern):
- Auth model: ownership check skipped for avatar batch resolution (public assets)
- Returns `{ urls: { [mediaId]: { url: string; expiresAt: number } } }` — missing/DELETED entries silently omitted
- Gateway caches results in Redis with smart TTL = `expiresAt - now - 5 min buffer`
- On avatar replacement, Gateway calls `DELETE_AVATAR_SYSTEM` to remove the old file:
  - Bypasses owner check — caller is trusted (internal system call)
  - MinIO failure marks media as `DELETION_PENDING` for retry by RecoveryService

---

## Image Processing Features

### 1. Metadata Extraction
- **Dimensions**: Width x Height
- **Format**: JPEG, PNG, GIF, WebP
- **Orientation**: EXIF orientation tag
- **Color Space**: Has alpha channel?

### 2. Thumbnail Generation
- **Resize**: Fit inside 320x240 (configurable)
- **Quality**: JPEG 80%
- **Naming**: `{filename}_thumb.{ext}`
- **Upload**: Separate object in MinIO

### 3. Validation
- **File Type**: Check magic bytes (not just extension)
- **Size Limits**: Configurable max size (100MB default)
- **Mime Type**: Whitelist per media type
- **Checksum**: MD5/SHA256 verification on finalization

---

## Security Considerations

### 1. Authentication & Authorization
- **KeycloakGuard**: All endpoints require valid JWT
- **Ownership Verification**: Always verify `ownerId` matches JWT `sub`
- **Token Forwarding**: Gateway forwards JWT to Media Service

### 2. Upload Security
- **Pre-signed URLs**: Short TTL (PUT: 15min, GET: 5min) prevents long-term access
- **Checksum Verification**: Client calculates hash, server validates (prevents corruption)
- **File Type Validation**: Check magic bytes, not just extension
- **Size Limits**: Prevent DoS via large uploads (100MB default)
- **State Machine**: Only READY media can be used in messages

### 3. HTTP Security
- **Timeout**: 3000ms prevents cascading failures
- **No Redirects**: `maxRedirects: 0` prevents SSRF attacks
- **CORS**: Configured in main.ts for browser clients

### 4. Optional Enhancements
- **Malware Scanning**: ClamAV integration (detect malicious files)
- **Content Moderation**: NSFW image classification
- **Rate Limiting**: Per-user upload limits

---

## Error Handling

### Common Errors

| HTTP Code | Error | Description |
|-----------|-------|-------------|
| 400 | Bad Request | Invalid file type, size, or checksum mismatch |
| 401 | Unauthorized | Missing or invalid JWT token |
| 403 | Forbidden | Not owner of media |
| 404 | Not Found | Media not found, deleted, or not READY |
| 409 | Conflict | Already finalized (status != CREATED) |
| 413 | Payload Too Large | File exceeds max size |
| 500 | Internal Server Error | MinIO connection failure, processing error |

### Retry Strategy
- **MinIO Connection**: Exponential backoff (3 retries)
- **MongoDB Connection**: Auto-reconnect via Mongoose
- **Kafka**: Consumer auto-reconnect with backoff
- **HTTP Timeouts**: No retries (fail fast with 3s timeout)

### Circuit Breaker Pattern
```typescript
// Gateway & ChatCore HTTP module config
HttpModule.register({
  timeout: 3000,        // Fail after 3 seconds
  maxRedirects: 0,      // No redirects
})
```

**Benefits**:
- Prevents slow Media Service from hanging ChatCore
- Fails fast instead of cascading timeouts
- User gets immediate error instead of 30s+ delay

---

## Testing

### Manual Test Flow
```bash
# 1. Get auth token
TOKEN=$(curl -X POST http://localhost:8080/realms/nest-realm/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=nest-client" \
  -d "username=testuser" \
  -d "password=password" | jq -r '.access_token')

# 2. Create upload
RESPONSE=$(curl -X POST http://localhost:3000/media/upload \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "image",
    "mimeType": "image/jpeg",
    "size": 1024000,
    "filename": "test.jpg"
  }')

MEDIA_ID=$(echo $RESPONSE | jq -r '.mediaId')
UPLOAD_URL=$(echo $RESPONSE | jq -r '.uploadUrl')

# 3. Upload file to MinIO (direct upload)
curl -X PUT "$UPLOAD_URL" \
  --upload-file test.jpg

# 4. Calculate checksum
CHECKSUM=$(md5sum test.jpg | awk '{print $1}')

# 5. Finalize upload
curl -X POST http://localhost:3000/media/upload/complete \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"mediaId\": \"$MEDIA_ID\",
    \"checksum\": \"$CHECKSUM\",
    \"checksumAlgorithm\": \"md5\"
  }"

# 6. Wait for processing (status: CREATED → UPLOADED → PROCESSING → READY)
sleep 2

# 7. Get media URL
curl -X GET "http://localhost:3000/media/$MEDIA_ID" \
  -H "Authorization: Bearer $TOKEN"

# 8. Send message with media attachment (WebSocket or HTTP)
# WebSocket: emit('send-message', { conversationId, content, metadata: { mediaId } })
```

### Integration Test Scenarios

** Valid Media Upload with Checksum**:
1. POST /media/upload → 200 OK with mediaId (status=CREATED)
2. PUT to MinIO → 200 OK
3. Calculate MD5 checksum of uploaded file
4. POST /upload/complete → 200 OK (status=UPLOADED → PROCESSING → READY)
5. Send message with mediaId → ChatCore validates → Message saved

** Checksum Mismatch**:
1. POST /media/upload → mediaId
2. PUT to MinIO → upload file
3. POST /upload/complete with WRONG checksum → 400 Bad Request
4. Status changed to FAILED

** Invalid Media Ownership**:
1. User A uploads media → gets mediaId_A
2. User B sends message with mediaId_A → 400 Bad Request (ownership check fails)

** Non-existent Media**:
1. Send message with fake mediaId → 400 Bad Request

** Media Not Ready**:
1. Upload media (status=UPLOADED, not yet READY)
2. Send message immediately → 400 Bad Request (status must be READY)

---

## Monitoring

### Key Metrics
- `media_uploads_total` - Total uploads initiated
- `media_uploads_completed` - Successful completions
- `media_uploads_failed` - Failed uploads (checksum, processing)
- `media_processing_duration_seconds` - Processing time
- `media_storage_bytes` - Total storage used
- `media_thumbnail_generation_total` - Thumbnails created
- `media_checksum_validations_total` - Checksum verifications
- `media_http_request_duration_seconds` - API latency

### Health Check
**GET** `/health`

```json
{
  "status": "ok",
  "service": "media-service",
  "checks": {
    "mongodb": "healthy",
    "minio": "healthy",
    "kafka": "healthy"
  },
  "timestamp": "2026-01-04T12:00:00Z"
}
```

---

## Deployment

### Docker Compose
```yaml
media-service:
  build:
    context: .
    dockerfile: apps/media-service/Dockerfile
  # No external port - HTTP service accessed only by gateway via internal network
  expose:
    - "3009"
  environment:
    - NODE_ENV=production
    - MEDIA_PORT=3009
    - MEDIA_MONGODB_URI=mongodb://mediauser:mediapassword@media-mongodb:27017/media_db?authSource=admin
    - MINIO_ENDPOINT=minio
    - MINIO_PORT=9000
    - MINIO_ACCESS_KEY=minioadmin
    - MINIO_SECRET_KEY=minioadmin
    - KAFKA_BROKERS=kafka-1:29092
    - KEYCLOAK_URL_INTERNAL=http://keycloak:8080
    - KEYCLOAK_REALM=nest-realm
    - KEYCLOAK_CLIENT_ID=nest-client
  depends_on:
    - media-mongodb
    - minio
    - kafka-1
    - keycloak
  networks:
    - nest-network

media-mongodb:
  image: mongo:7
  environment:
    MONGO_INITDB_ROOT_USERNAME: root
    MONGO_INITDB_ROOT_PASSWORD: rootpassword
    MONGO_INITDB_DATABASE: media_db
  volumes:
    - media-mongodb-data:/data/db
  networks:
    - nest-network
```

### Build & Run
```bash
# Development
pnpm start:media-service:dev

# Production build
pnpm build:media-service

# Docker
docker compose up -d media-service
```

---

## Future Enhancements

### 1. Video Processing (ffmpeg)
**Status**:  Documented, not implemented

```typescript
// Extract metadata
const metadata = await ffmpeg.probe(buffer);
// duration, codec, bitrate, resolution

// Generate thumbnail (first frame at 1 second)
await ffmpeg()
  .input(inputPath)
  .screenshots({
    timestamps: ['00:00:01'],
    size: '320x240',
    filename: 'thumb.jpg'
  });
```

**Libraries**: `fluent-ffmpeg`, `@ffmpeg-installer/ffmpeg`

### 2. Malware Scanning
**Status**: ⏸ Deferred (not critical for MVP)

Options:
- **ClamAV** (self-hosted, free): Docker container, ~200-500ms overhead
- **VirusTotal API** (cloud-based): Free tier 4 req/min, async scanning

```typescript
// ClamAV integration example
const scanResult = await clamav.scanBuffer(buffer);
if (scanResult.isInfected) {
  await mediaRepository.updateStatus(mediaId, MediaStatus.FAILED);
  throw new BadRequestException('Malware detected');
}
```

### 3. CDN Integration
- CloudFront/CloudFlare for faster delivery
- Geo-distributed caching
- Automatic format conversion (WebP, AVIF for modern browsers)
- Reduced latency for global users

### 4. Multiple Attachments
- Support array of `mediaIds` instead of single `mediaId`
- Validate all attachments before message acceptance
- Batch processing for efficiency

### 5. Event Publishers (Pending)
**Message Deletion**: Message Store needs to publish `MESSAGE_DELETED` event  
**User Deletion**: Users Service needs to publish `USER_DELETED` event  
**Status**: Media Service consumer is ready, publishers not implemented

---

## Summary

The Media Service provides a complete, production-ready solution for managing multimedia content in the chat system with strong security guarantees.

###  Implemented Features
- **HTTP REST Architecture**: Service exposes HTTP API on port 3009 (not TCP microservice)
- **Circuit Breaker Pattern**: 3-second timeout, no redirects prevents cascading failures
- **State Machine**: CREATED → UPLOADED → PROCESSING → READY → DELETED/FAILED
- **Upload Finalization**: POST /upload/complete with checksum verification
- **Integrity Verification**: MD5/SHA256 hash validation prevents corrupted uploads
- **MinIO Object Storage**: Pre-signed URLs (PUT 15min, GET 5min) for direct client uploads
- **MongoDB Metadata**: Repository pattern with IMediaRepository interface
- **Sharp Image Processing**: Thumbnails (320x240), metadata extraction (dimensions, format)
- **Kafka Event Consumers**: MESSAGE_DELETED, USER_DELETED cleanup (awaiting publishers)
- **KeycloakGuard Authentication**: JWT validation on all endpoints
- **ChatCore Integration**: HTTP validation call with ownership + status checks
- **Secure Access Control**: Ownership verification, short-lived URLs
- **Gateway HTTP Client**: Forwards JWT tokens, handles timeouts

###  Pending Integration
- **Message Store**: Publish `MESSAGE_DELETED` event on message deletion
- **Users Service**: Publish `USER_DELETED` event on account deletion
- **User Profile**: Avatar upload/update endpoint
- **Conversation**: Group avatar upload/update endpoint

###  Future Enhancements
- **Video Processing**: ffmpeg integration for video thumbnails, metadata
- **Malware Scanning**: ClamAV or VirusTotal for security
- **CDN Integration**: CloudFront/CloudFlare for faster global delivery
- **Multiple Attachments**: Support array of mediaIds per message
- **Content Moderation**: NSFW detection, automated filtering

###  Key Architectural Decisions
1. **HTTP REST (not TCP)**: Client-facing service requires JWT authentication, HTTP is natural fit
2. **Pre-signed URLs**: Direct MinIO upload bypasses gateway bottleneck, enables horizontal scaling
3. **State Machine**: Clear status flow prevents race conditions (CREATED → UPLOADED → PROCESSING → READY)
4. **Upload Finalization**: Explicit checksum verification step ensures file integrity before processing
5. **Circuit Breaker**: 3-second HTTP timeout prevents slow Media Service from hanging ChatCore
6. **Separation of Storage**: Files in MinIO (object storage), metadata in MongoDB (queryable)

The pre-signed URL pattern with integrity verification ensures clients upload directly to storage with corruption detection, enabling horizontal scaling for high-throughput scenarios while maintaining data integrity.
