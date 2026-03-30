# Media Service Documentation

## Overview

The **Media Service** manages multimedia content (images, videos, files) for the chat system. It handles file uploads with integrity verification, storage in MinIO (S3-compatible object storage), metadata extraction, thumbnail generation, and lifecycle management.

**CRITICAL**: Media Service is an **HTTP REST service** (not TCP microservice) because it handles client-facing file upload operations with authentication.

## Architecture

### Technology Stack
- **Communication**: HTTP REST API on port 3009 (NOT TCP microservice)
- **Storage**: MinIO (S3-compatible object storage)
- **Database**: MongoDB (metadata only, not file content)
- **Image Processing**: Sharp (resize, thumbnails, EXIF extraction)
- **Event Bus**: Kafka (for cleanup events)
- **HTTP Client**: @nestjs/axios + axios (timeout: 3000ms, maxRedirects: 0)
- **Authentication**: KeycloakGuard on all endpoints
- **Pattern**: Repository pattern with interface abstraction

### Key Design Principles
-  **HTTP Architecture**: REST service with JWT authentication (not TCP)
-  **Circuit Breaker**: HTTP timeout 3000ms, maxRedirects: 0 prevents cascading failures
-  **State Machine**: CREATED → UPLOADED → PROCESSING → READY → DELETED/FAILED
-  **Integrity Verification**: MD5/SHA256 checksum validation on upload finalization
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
| **READY** | Media ready for use in messages | DELETED | User action |
| **DELETED** | Soft deleted (files remain in MinIO temporarily) | (terminal) | User deletion or cleanup |
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

## API Endpoints (HTTP REST)

### Authentication
All endpoints require `Authorization: Bearer {jwt_token}` header. KeycloakGuard validates JWT signature, expiration, and issuer.

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
1. Client calls `POST /media/upload` → Gateway → Media Service (HTTP)
2. Media Service creates DB record with **status=CREATED** (not PROCESSING)
3. Returns pre-signed PUT URL (15 min TTL)
4. Client uploads file directly to MinIO using PUT URL

---

### 2. Finalize Upload (NEW)
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

**Response** (200 OK):
```json
{
  "success": true,
  "status": "UPLOADED"
}
```

**Flow**:
1. Verifies file exists in MinIO (HEAD request)
2. Compares client checksum with server-calculated checksum
3. If match: Updates status CREATED → UPLOADED
4. If mismatch: Updates status to FAILED, throws BadRequestException
5. Triggers background processing (metadata extraction, thumbnail generation)

**Errors**:
- `400 Bad Request`: Checksum mismatch, file not found in MinIO
- `404 Not Found`: Invalid mediaId
- `409 Conflict`: Already finalized (status != CREATED)

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

## HTTP Client Configuration

### Gateway Module
**File**: `apps/gateway/src/modules/media/media.module.ts`

```typescript
@Module({
  imports: [
    HttpModule.register({
      timeout: 3000,        // 3 second timeout
      maxRedirects: 0,      // No redirects (prevent SSRF)
    }),
  ],
  providers: [MediaGatewayService],
  controllers: [MediaController],
})
```

### Gateway Service
**File**: `apps/gateway/src/modules/media/media.gateway.ts`

```typescript
@Injectable()
export class MediaGatewayService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    const host = configService.get('MEDIA_SERVICE_HOST', 'media-service');
    const port = configService.get('MEDIA_SERVICE_PORT', '3009');
    this.mediaServiceUrl = `http://${host}:${port}/media`;
  }

  async createUpload(dto: CreateUploadDto, token: string) {
    const response = await firstValueFrom(
      this.httpService.post(`${this.mediaServiceUrl}/upload`, dto, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    return response.data;
  }

  async validateMedia(mediaId: string, ownerId?: string, token?: string) {
    const response = await firstValueFrom(
      this.httpService.get(
        `${this.mediaServiceUrl}/validate/${mediaId}`,
        {
          params: { ownerId },
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      ),
    );
    return response.data;
  }
}
```

**Key Points**:
- Uses `HttpService` from `@nestjs/axios`, NOT `ClientProxy` (TCP)
- Forwards JWT token in Authorization header
- Constructs HTTP URL: `http://media-service:3009/media`
- Timeout 3000ms prevents hanging on slow responses

---

## ChatCore Integration

### Message Validation
**File**: `apps/chat-core/src/chat-core.service.ts`

```typescript
async sendMessage(data: SendMessageDto) {
  // ... user/conversation/membership validation
  
  // Validate media attachment if present
  if (data.metadata?.mediaId) {
    await this.validateMediaAttachment(data.metadata.mediaId, data.senderId);
    //  Verifies media exists and status=READY
    //  Verifies owner matches sender
    //  Throws BadRequestException if invalid
  }
  
  // Publish MESSAGE_ACCEPTED event
}

private async validateMediaAttachment(mediaId: string, senderId: string) {
  try {
    const response = await firstValueFrom(
      this.httpService.get(
        `${this.mediaServiceUrl}/validate/${mediaId}`,
        { params: { ownerId: senderId } },
      ),
    );

    if (!response.data.valid) {
      throw new BadRequestException('Invalid media attachment');
    }
  } catch (error) {
    this.logger.error(`Media validation failed: ${error.message}`);
    throw new BadRequestException('Media validation failed');
  }
}
```

**ChatCore Module HTTP Config**:
**File**: `apps/chat-core/src/chat-core.module.ts`

```typescript
@Module({
  imports: [
    HttpModule.register({
      timeout: 3000,
      maxRedirects: 0,
    }),
  ],
})
```

**Flow**:
1. User uploads media → gets `mediaId`
2. User sends message with `metadata: { mediaId }`
3. ChatCore makes HTTP GET to Media Service `/validate/{mediaId}?ownerId={senderId}`
4. If valid (status=READY, ownership match) → publish `MESSAGE_ACCEPTED`
5. If invalid → reject message with 400 error

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

# Media Processing
MAX_FILE_SIZE=104857600                          # 100MB
ALLOWED_IMAGE_TYPES=image/jpeg,image/png,image/gif,image/webp
ALLOWED_VIDEO_TYPES=video/mp4,video/webm,video/quicktime
ALLOWED_FILE_TYPES=application/pdf,application/zip
GENERATE_THUMBNAILS=true
THUMBNAIL_WIDTH=320
THUMBNAIL_HEIGHT=240

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

**Key Changes**:
1. Initial status is CREATED (not PROCESSING)
2. New step: `POST /media/upload/complete` with checksum
3. State transitions: CREATED → UPLOADED → PROCESSING → READY
4. HTTP communication throughout (not TCP)
5. Timeout protection: 3 seconds for validation call

---

## Integration with Chat System

### 1. Message Attachments (ChatCore Validation)
When a user sends a message with media attachment:

**Flow**:
1. Client uploads media → gets `mediaId` (status=CREATED)
2. Client uploads file to MinIO → calls `/upload/complete` → status=UPLOADED
3. Media Service processes in background → status=READY
4. Client sends message with `metadata: { mediaId }`
5. ChatCore makes HTTP GET `/validate/{mediaId}?ownerId={senderId}` (timeout: 3s)
6. Media Service returns `{ valid: true }` only if status=READY and owner matches
7. If valid → ChatCore publishes `MESSAGE_ACCEPTED`
8. If invalid → ChatCore rejects with 400 error

**Security**:
-  Ownership verified (JWT sub must match media.ownerId)
-  Status checked (only READY media accepted)
-  Timeout protection (3s prevents hanging)
-  Checksum validated (file integrity guaranteed)

### 2. User Profile Avatar
**User Entity** has `avatarUrl` field (nullable string)

**Usage**:
1. Upload avatar: `POST /media/upload` → `PUT to MinIO` → `POST /upload/complete` → get `mediaId`
2. Get permanent URL: `GET /media/:mediaId` → get `url`
3. Update profile: `PATCH /users/profile` with `{ avatarUrl: url }`

### 3. Group/Conversation Avatar
**Conversation Entity** has `avatarUrl` field (nullable string)

**Usage**: Same as user avatar flow

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
