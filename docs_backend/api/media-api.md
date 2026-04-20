# Media API

> Base URL: `http://localhost:3000`
> All endpoints require `Authorization: Bearer <ACCESS_TOKEN>`.
> Gateway responses are wrapped by the standard envelope `{ statusCode, message, data }`.

---

## Overview

The Gateway exposes Media Service over HTTP. Files are uploaded directly to MinIO using pre-signed URLs; the Gateway never proxies file bytes.

There are two upload paths:

- Simple upload: one pre-signed PUT URL, then `POST /media/upload/complete`
- Multipart upload: initiate session, pre-sign part URLs, upload parts, then complete

`GET /media/:mediaId/url` and `GET /media/:mediaId/play-info` are different:

- `GET /media/:mediaId/url` returns either the original object or the best optimized variant based on `prefer=ORIGINAL|OPTIMIZED`
- `GET /media/:mediaId/play-info` is the Smart Play endpoint that auto-picks the best playable asset for audio, video, image, or file

---

## Endpoints

### `GET /media`

List media owned by the current user.

Response payload items include:

```json
{
  "id": "uuid",
  "type": "image",
  "mimeType": "image/jpeg",
  "size": 1048576,
  "status": "READY",
  "url": "https://...",
  "thumbnailUrl": "https://...",
  "meta": {
    "width": 1920,
    "height": 1080,
    "format": "jpeg"
  },
  "createdAt": "2026-04-19T10:00:00.000Z"
}
```

Notes:

- URLs are generated only for `READY` media
- `url` and `thumbnailUrl` are pre-signed GET URLs with short TTL

### `POST /media/upload`

Create a simple upload session and receive a pre-signed PUT URL.

Request body:

```json
{
  "type": "image",
  "mimeType": "image/jpeg",
  "size": 1048576,
  "filename": "avatar.jpg"
}
```

Rules:

- `type` must be lowercase: `image | video | audio | file`
- `size` is validated against the service limit (default max `2147483648` bytes)
- MIME type must match the allowed list for the selected media type

Success payload:

```json
{
  "mediaId": "uuid",
  "uploadUrl": "https://...",
  "expiresAt": "2026-04-19T10:15:00.000Z"
}
```

The returned `uploadUrl` is a pre-signed MinIO PUT URL. Upload the file directly with `PUT` and the correct `Content-Type`.

### `POST /media/upload/complete`

Finalize a simple upload.

Request body:

```json
{
  "mediaId": "uuid",
  "checksum": "optional-hex-digest",
  "checksumAlgorithm": "md5"
}
```

Success payload:

```json
{
  "success": true
}
```

Actual behavior:

- Verifies the object exists in MinIO
- If `MEDIA_CHECKSUM_STRICT=true`, checksum is required
- If checksum is provided, the service streams the object from MinIO and verifies it
- On success: media status becomes `UPLOADED` and `media.uploaded` is published to Kafka
- On failure: media status becomes `FAILED`

### `GET /media/:mediaId/url`

Get an access URL for a media object.

Query params:

- `prefer`: `ORIGINAL` or `OPTIMIZED`
- `conversationId`: optional fallback context for authorization checks when the requester is not the owner

Success payload:

```json
{
  "url": "https://...",
  "type": "OPTIMIZED",
  "expiresIn": 300,
  "thumbUrl": "https://..."
}
```

Selection logic:

- If `prefer=OPTIMIZED`, media is `READY`, and variants exist: return the best variant
- Video prefers `MP4_720` first, then the first available variant
- Otherwise fallback to the original object

Authorization logic:

- Owner is always allowed
- Non-owner is allowed if the media is already bound to at least one conversation
- If no binding exists and `conversationId` is provided, Media Service falls back to `ConversationService.IS_MEMBER`

### `GET /media/:mediaId/play-info`

Smart Play endpoint. The backend auto-selects the best playable object based on media type and readiness.

Optional query params:

- `conversationId`

Success payload:

```json
{
  "url": "https://...",
  "quality": "720p",
  "expiresIn": 300,
  "thumbUrl": "https://..."
}
```

Selection logic from code:

- Audio: always original, no worker processing
- Video: if `READY` and variants exist, prefer `MP4_720`, then `MP4_480`, then `MP4_360`, else original
- Image: first optimized variant if available, else original
- File: original

### `DELETE /media/:mediaId`

Delete owned media.

Success payload:

```json
true
```

Actual behavior:

- Deletes MinIO objects first
- If storage deletion succeeds, media status becomes `DELETED`
- If storage deletion fails, media status becomes `DELETION_PENDING` and the request fails

### `POST /media/:mediaId/cross-share`

Bind an already-shared media object to another conversation.

Request body:

```json
{
  "sourceConversationId": "uuid",
  "targetConversationId": "uuid"
}
```

Success payload:

```json
{
  "success": true,
  "message": "Media cross-shared successfully"
}
```

Rules:

- Media must already be bound to the source conversation
- Caller must be `OWNER` or `ADMIN` in the source conversation
- Caller must also be `OWNER` or `ADMIN` in the target conversation
- If the target binding already exists, the endpoint returns success with an "already shared" message

### `POST /media/multipart/init`

Initiate a multipart upload session.

Request body:

```json
{
  "filename": "demo.mp4",
  "mimeType": "video/mp4",
  "type": "VIDEO",
  "totalSize": 52428800
}
```

Rules from code:

- `type` is accepted as uppercase on the HTTP endpoint: `IMAGE | VIDEO | AUDIO | FILE`
- `IMAGE` max size: `15 MB`
- `VIDEO`, `AUDIO`, `FILE` max size: `1 GB`
- Upload session is persisted in MongoDB with `expiresAt = now + 24h`
- Media record is created immediately with status `CREATED`

Success payload:

```json
{
  "mediaId": "uuid",
  "uploadId": "s3-upload-id",
  "objectKey": "ownerId/mediaId/original.mp4"
}
```

The service computes `totalChunks` assuming `10 MB` per part.

### `POST /media/multipart/presign-parts`

Get pre-signed URLs for specific part numbers.

Request body:

```json
{
  "mediaId": "uuid",
  "partNumbers": [1, 2, 3],
  "expiresIn": 3600
}
```

Success payload:

```json
[
  { "partNumber": 1, "url": "https://..." },
  { "partNumber": 2, "url": "https://..." }
]
```

The caller must capture each part's ETag from the PUT response headers and send it in the complete step.

### `POST /media/multipart/complete`

Assemble uploaded parts and trigger processing.

Request body:

```json
{
  "mediaId": "uuid",
  "parts": [
    { "partNumber": 1, "eTag": "\"etag-1\"" },
    { "partNumber": 2, "eTag": "etag-2" }
  ]
}
```

Success payload:

```json
{
  "mediaId": "uuid",
  "status": "UPLOADED"
}
```

Actual behavior:

- Media Service sorts parts by `partNumber`
- ETags are normalized with quotes if needed before `CompleteMultipartUpload`
- Media status becomes `UPLOADED`
- `media.uploaded` is published to Kafka for worker processing

### `DELETE /media/multipart/:mediaId`

Abort an in-progress multipart upload.

Success payload:

```json
{
  "success": true
}
```

Actual behavior:

- Aborts the S3/MinIO multipart upload
- Marks the media record as `DELETED`

---

## Processing Status

The code uses these statuses in `media_objects`:

- `CREATED`
- `UPLOADED`
- `PROCESSING`
- `READY`
- `FAILED`
- `DELETION_PENDING`
- `DELETED`

Important behavior:

- Image and video uploads go through Media Worker after `media.uploaded`
- Audio and file uploads are marked `READY` by Media Worker without variant generation
- Audio does not emit `media.ready` for attachment refresh because there is no derived asset to sync

---

## Related Real-Time Behavior

When an uploaded image or video finishes processing:

- Media Worker publishes `media.ready` or `media.failed`
- Message Store updates the attachment inside the related message
- Message Store publishes `chat.event.message_updated`
- Realtime Gateway emits `message:media_ready`

That is why clients should use:

- `GET /media/:mediaId/url?prefer=OPTIMIZED` for attachment access
- `GET /media/:mediaId/play-info` for Smart Play behavior
