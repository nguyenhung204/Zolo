# Media Service

## Overview

Media Service is a TCP microservice that manages media metadata, upload orchestration, access URL generation, Smart Play selection, media bindings, avatar URL batch resolution, and multipart upload sessions.

It stores metadata in MongoDB, objects in MinIO, and hands off heavy processing to Media Worker through Kafka.

---

## Responsibilities

### Upload lifecycle

- Create simple upload sessions with pre-signed PUT URLs
- Finalize uploads by verifying MinIO object existence
- Optionally verify checksum using streamed hashing
- Publish `media.uploaded` after successful finalize

### Access and sharing

- Return access URLs for original or optimized objects
- Provide Smart Play endpoint logic for audio, video, image, and file
- Bind media to messages for later access authorization
- Cross-share media across conversations with role checks
- Resolve avatar URLs in batches

### Multipart uploads

- Create multipart sessions in MinIO/S3
- Persist upload session metadata in MongoDB
- Pre-sign URLs for requested part numbers
- Complete or abort multipart uploads

### Lifecycle management

- Delete single media objects or all user media
- Use `DELETION_PENDING` when MinIO deletion fails
- Support trusted system deletion for replaced avatars

---

## State Machine

Statuses used in `media_objects`:

- `CREATED`
- `UPLOADED`
- `PROCESSING`
- `READY`
- `FAILED`
- `DELETION_PENDING`
- `DELETED`

Typical flows:

- Simple upload: `CREATED -> UPLOADED -> PROCESSING -> READY`
- Multipart upload: `CREATED -> UPLOADED -> PROCESSING -> READY`
- Audio/file worker shortcut: `CREATED -> UPLOADED -> READY`
- Delete failure: `READY -> DELETION_PENDING -> DELETED` after recovery retry

---

## TCP Patterns

| Pattern | Behavior |
|---------|----------|
| `LIST_MEDIA` | List owned media with pre-signed URLs for `READY` rows |
| `CREATE_UPLOAD` | Create simple upload session |
| `FINALIZE_UPLOAD` | Verify object, checksum, mark `UPLOADED`, publish `media.uploaded` |
| `VALIDATE_MEDIA` | Legacy validation helper |
| `DELETE_MEDIA` | Delete owned media |
| `VALIDATE_FOR_SEND` | Validate ownership and allowed statuses before message send |
| `BIND_TO_MESSAGE` | Upsert message binding for access authorization |
| `GET_ACCESS_URL` | Return original or optimized access URL |
| `GET_PLAY_INFO` | Smart Play selection |
| `CROSS_SHARE` | Bind media into another conversation if caller is admin/owner in both |
| `GET_AVATARS_BATCH` | Batch-resolve presigned avatar URLs |
| `DELETE_AVATAR_SYSTEM` | Trusted system delete with no owner check |
| `INIT_MULTIPART_UPLOAD` | Create multipart upload session |
| `PRESIGN_UPLOAD_PARTS` | Return `{ partNumber, url }[]` |
| `COMPLETE_MULTIPART_UPLOAD` | Complete multipart upload and publish `media.uploaded` |
| `ABORT_MULTIPART_UPLOAD` | Abort multipart upload and mark media `DELETED` |

---

## Upload Flows

### Simple upload

1. `CREATE_UPLOAD`
2. Client uploads directly to MinIO using the returned PUT URL
3. `FINALIZE_UPLOAD`
4. Service verifies object existence
5. If checksum is present, service streams the object and verifies it
6. Status becomes `UPLOADED`
7. Publish `media.uploaded`

Key details from code:

- Simple upload `type` values are lowercase: `image | video | audio | file`
- Max size default is `2147483648` bytes unless configured differently
- PUT URL expiry defaults to 15 minutes
- On finalize failure, status is set to `FAILED`

### Multipart upload

1. `INIT_MULTIPART_UPLOAD`
2. Service creates MinIO multipart session and MongoDB `upload_sessions` row
3. Client requests batches of part URLs with `PRESIGN_UPLOAD_PARTS`
4. Client uploads parts directly to MinIO and collects ETags
5. `COMPLETE_MULTIPART_UPLOAD`
6. Service sorts parts, normalizes ETag quotes, completes upload, marks media `UPLOADED`, then publishes `media.uploaded`

Actual limits in code:

- `IMAGE`: 15 MB
- `VIDEO`, `AUDIO`, `FILE`: 1 GB
- Part size assumption for chunk count: 10 MB
- Upload session expiry: 24 hours

---

## Smart Play Logic

`GET_PLAY_INFO` is a distinct code path from `GET_ACCESS_URL`.

Selection rules:

- Audio: always original object, `quality = original`
- Video:
  - if `READY` and variants exist, prefer `MP4_720`, then `MP4_480`, then `MP4_360`
  - otherwise fall back to original
- Image:
  - if `READY` and variants exist, use the first optimized variant
  - otherwise original
- File: original

Response shape:

```json
{
  "url": "https://...",
  "quality": "720p",
  "expiresIn": 300,
  "thumbUrl": "https://..."
}
```

---

## Access URL Logic

`GET_ACCESS_URL` returns either original or optimized media depending on `prefer`.

Authorization from code:

- Owner is always allowed
- If requester is not owner, any existing media binding makes the request allowed
- If no binding exists and `conversationId` is provided, Media Service falls back to `ConversationService.IS_MEMBER`
- Deleted media returns not found

Response shape:

```json
{
  "url": "https://...",
  "type": "ORIGINAL",
  "expiresIn": 300,
  "thumbUrl": "https://..."
}
```

---

## Media Bindings

Bindings are stored in MongoDB and upserted by `(mediaId, messageId)`.

Current uses:

- Message Store binds attachments and optional thumbnail media IDs when a message is accepted
- Access URL authorization trusts existing bindings
- Cross-share adds a binding for the target conversation with an empty `messageId`

Cross-share rules enforced by code:

- Media must already be bound to the source conversation
- Caller must be `OWNER` or `ADMIN` in source conversation
- Caller must be `OWNER` or `ADMIN` in target conversation

---

## Avatar Batch Resolution

`GET_AVATARS_BATCH` accepts:

```json
{ "mediaIds": ["..."], "variant": "thumb" }
```

Behavior:

- Deduplicates IDs
- Skips missing, `DELETED`, and `DELETION_PENDING` rows
- `variant=thumb` prefers `thumbKey`, then original
- `variant=original` always uses original object
- Returns `expiresAt` in Unix milliseconds so Gateway can compute Redis TTL intelligently

Response shape:

```json
{
  "urls": {
    "media-id": {
      "url": "https://...",
      "expiresAt": 1770000000000
    }
  }
}
```

---

## Deletion Semantics

### `DELETE_MEDIA`

- Owner-only
- Deletes MinIO objects first
- On success: mark `DELETED`
- On storage failure: mark `DELETION_PENDING` and fail the request

### `DELETE_AVATAR_SYSTEM`

- Trusted internal delete
- No owner check
- Idempotent for `DELETED` and `DELETION_PENDING`
- Same MinIO-first semantics

### `deleteUserMedia()`

- Bulk delete all objects for an owner
- If bulk MinIO delete fails, every row is marked `DELETION_PENDING`

---

## MongoDB Collections

### `media_objects`

Important fields from code:

- `id`
- `ownerId`
- `type`
- `mimeType`
- `size`
- `url`
- `objectKeyOriginal`
- `variants`
- `thumbKey`
- `checksum`
- `checksumAlgorithm`
- `meta`
- `status`
- timestamps

Indexes:

- `{ ownerId: 1, createdAt: -1 }`
- `{ status: 1 }`
- `{ expiresAt: 1 }` sparse

### `upload_sessions`

Important fields:

- `_id` = `mediaId`
- `ownerId`
- `filename`
- `totalSize`
- `mimeType`
- `totalChunks`
- `objectKey`
- `uploadId`
- `uploadedChunks`
- `partETags`
- `status`
- `expiresAt`
- `completedAt`

Indexes:

- `{ ownerId: 1, createdAt: -1 }`
- `{ status: 1 }`
- `{ expiresAt: 1 }`

### `media_bindings`

Used to authorize non-owner access after media is attached to a message or shared into a conversation.

---

## Kafka Integration

Media Service publishes:

- `media.uploaded`

Media Service does not consume Kafka in the audited code path.

Media Worker later publishes:

- `media.ready`
- `media.failed`

Those events are consumed by Message Store, not by Media Service.
