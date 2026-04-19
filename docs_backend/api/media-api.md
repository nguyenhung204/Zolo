# Media API

> **Base URL**: `http://localhost:3000`
> Tất cả endpoint yêu cầu header `Authorization: Bearer <ACCESS_TOKEN>`.
> Response bọc trong envelope chuẩn `{ statusCode, message, data }`.

---

## Mục lục

1. [Upload file nhỏ (< 10 MB) — 3 bước](#1-upload-file-nhỏ--10-mb--3-bước)
   - [POST /media/upload — Khởi tạo, lấy pre-signed URL](#bước-1--post-mediaupload--khởi-tạo-upload)
   - [PUT \<uploadUrl\> — Upload lên MinIO](#bước-2--put-uploadurl--upload-lên-minio)
   - [POST /media/upload/complete — Báo hoàn tất](#bước-3--post-mediauploadcomplete--báo-hoàn-tất)
2. [Upload file lớn (Multipart, ≥ 10 MB)](#2-upload-file-lớn-multipart--10-mb)
   - [POST /media/multipart/init — Khởi tạo phiên](#bước-1--post-mediamultipartinit--khởi-tạo-phiên)
   - [POST /media/multipart/presign-parts — Lấy URL cho từng phần](#bước-2--post-mediamultipartpresign-parts--lấy-url-cho-từng-phần)
   - [PUT \<partUrl\> — Upload từng phần](#bước-3--put-parturl--upload-từng-phần)
   - [POST /media/multipart/complete — Hoàn tất ghép phần](#bước-4--post-mediamultipartcomplete--hoàn-tất-ghép-phần)
   - [DELETE /media/multipart/:mediaId — Hủy upload](#delete-mediamultipartmediaid--hủy-upload)
3. [Quản lý file](#3-quản-lý-file)
   - [GET /media — Danh sách media](#get-media--danh-sách-media)
   - [GET /media/:mediaId/url — Lấy URL truy cập](#get-mediamediaidurl--lấy-url-truy-cập)
   - [DELETE /media/:mediaId — Xóa file](#delete-mediamediaid--xóa-file)
   - [POST /media/:mediaId/cross-share — Chia sẻ file](#post-mediamediaidcross-share--chia-sẻ-file)
4. [Trạng thái xử lý file](#4-trạng-thái-xử-lý-file)
5. [Giới hạn và quy tắc](#5-giới-hạn-và-quy-tắc)

---

## 1. Upload file nhỏ (< 10 MB) — 3 bước

Client upload thẳng lên MinIO bằng pre-signed URL, không qua Gateway. Tiết kiệm bandwidth server.

### Bước 1 — POST /media/upload — Khởi tạo upload

```bash
# Upload ảnh
curl -X POST http://localhost:3000/media/upload \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "image",
    "mimeType": "image/jpeg",
    "size": 1048576,
    "filename": "avatar.jpg"
  }'

# Upload PDF
curl -X POST http://localhost:3000/media/upload \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "file",
    "mimeType": "application/pdf",
    "size": 2097152,
    "filename": "bao-cao-q1.pdf"
  }'

# Upload video (khuyến nghị dùng multipart nếu file lớn)
curl -X POST http://localhost:3000/media/upload \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "video",
    "mimeType": "video/mp4",
    "size": 5242880,
    "filename": "clip.mp4"
  }'
```

**Body:**

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `type` | `'image'` \| `'video'` \| `'file'` | ✓ | Loại file (chữ **thường**) |
| `mimeType` | string | ✓ | MIME type (ví dụ `image/jpeg`, `video/mp4`, `application/pdf`) |
| `size` | number | ✓ | Kích thước file tính bằng bytes |
| `filename` | string | ✓ | Tên file gốc (dùng để lưu metadata) |

**Response 201:**
```json
{
  "statusCode": 201,
  "message": "Resource created successfully",
  "data": {
    "mediaId": "550e8400-e29b-41d4-a716-446655440000",
    "uploadUrl": "http://minio:9010/media/owner-id/media-id/original.jpg?X-Amz-Signature=...",
    "expiresAt": "2026-04-16T10:30:00.000Z"
  }
}
```

> `uploadUrl` có hiệu lực **15 phút**. Không truyền `Authorization` khi upload lên MinIO.

---

### Bước 2 — PUT \<uploadUrl\> — Upload lên MinIO

```bash
curl -X PUT "<uploadUrl từ bước 1>" \
  -H "Content-Type: image/jpeg" \
  --data-binary @avatar.jpg
```

> Truyền đúng `Content-Type` khớp với `mimeType` đã khai báo ở bước 1.

---

### Bước 3 — POST /media/upload/complete — Báo hoàn tất

```bash
curl -X POST http://localhost:3000/media/upload/complete \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mediaId": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

**Body:**

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `mediaId` | string (UUID) | ✓ | ID media nhận từ bước 1 |
| `checksum` | string | ✗ | Checksum file để xác minh toàn vẹn |
| `checksumAlgorithm` | `'sha256'` \| `'md5'` | ✗ | Thuật toán checksum |

**Response 200:**
```json
{
  "statusCode": 200,
  "data": {
    "mediaId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "UPLOADED"
  }
}
```

> Sau bước này, **Media Worker** tự động: scan virus → tạo thumbnail (ảnh) / transcode (video) → đổi trạng thái sang `PROCESSING` → `READY` (hoặc `FAILED`).
> Lắng nghe WebSocket event `message:updated` để biết khi nào file sẵn sàng.

---

## 2. Upload file lớn (Multipart, ≥ 10 MB)

Dùng cho file lớn (video, file nén...). Chia file thành nhiều phần, upload song song, sau đó server ghép lại.

**Giới hạn kích thước:**
- `IMAGE`: tối đa **15 MB** (khuyến nghị dùng upload thông thường)
- `VIDEO` / `FILE`: tối đa **1 GB**

### Bước 1 — POST /media/multipart/init — Khởi tạo phiên

```bash
curl -X POST http://localhost:3000/media/multipart/init \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "demo-video.mp4",
    "mimeType": "video/mp4",
    "type": "VIDEO",
    "totalSize": 52428800
  }'
```

**Body:**

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `filename` | string | ✓ | Tên file gốc |
| `mimeType` | string | ✓ | MIME type của file |
| `type` | `'IMAGE'` \| `'VIDEO'` \| `'FILE'` | ✓ | Loại file (chữ **HOA** cho multipart) |
| `totalSize` | number | ✓ | Tổng kích thước file tính bằng bytes |

> **Lưu ý**: Trường `type` cho multipart dùng chữ **HOA** (`'VIDEO'`, `'IMAGE'`, `'FILE'`), ngược lại với upload thông thường dùng chữ thường.

**Response 201:**
```json
{
  "statusCode": 201,
  "message": "Resource created successfully",
  "data": {
    "mediaId": "550e8400-e29b-41d4-a716-446655440000",
    "uploadId": "VXBsb2FkSWQ=",
    "objectKey": "owner-id/550e8400-uuid/original.mp4"
  }
}
```

| Field | Mô tả |
|-------|-------|
| `mediaId` | UUID định danh media — dùng cho tất cả bước sau |
| `uploadId` | ID phiên multipart của MinIO/S3 |
| `objectKey` | Đường dẫn object trong MinIO |

---

### Bước 2 — POST /media/multipart/presign-parts — Lấy URL cho từng phần

```bash
curl -X POST http://localhost:3000/media/multipart/presign-parts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mediaId": "550e8400-e29b-41d4-a716-446655440000",
    "partNumbers": [1, 2, 3, 4, 5]
  }'
```

**Body:**

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `mediaId` | string (UUID) | ✓ | ID từ bước 1 |
| `partNumbers` | number[] | ✓ | Danh sách số phần (bắt đầu từ 1, tối đa 10000) |
| `expiresIn` | number | ✗ | Thời hạn URL (giây), mặc định 900s |

**Response 200:**
```json
{
  "statusCode": 200,
  "data": [
    { "partNumber": 1, "uploadUrl": "http://minio:9010/media/...?partNumber=1&uploadId=..." },
    { "partNumber": 2, "uploadUrl": "http://minio:9010/media/...?partNumber=2&uploadId=..." },
    { "partNumber": 3, "uploadUrl": "http://minio:9010/media/...?partNumber=3&uploadId=..." },
    { "partNumber": 4, "uploadUrl": "http://minio:9010/media/...?partNumber=4&uploadId=..." },
    { "partNumber": 5, "uploadUrl": "http://minio:9010/media/...?partNumber=5&uploadId=..." }
  ]
}
```

> Có thể gọi nhiều lần để lấy URL theo batch. Tổng số phần tối đa: 10000.

---

### Bước 3 — PUT \<partUrl\> — Upload từng phần

```bash
# Chia file thành các phần 10MB và upload song song
# Phần 1
curl -X PUT "<uploadUrl[1]>" \
  -H "Content-Type: video/mp4" \
  --data-binary @<(dd if=demo-video.mp4 bs=10M skip=0 count=1)

# Phần 2
curl -X PUT "<uploadUrl[2]>" \
  -H "Content-Type: video/mp4" \
  --data-binary @<(dd if=demo-video.mp4 bs=10M skip=1 count=1)
```

> Ghi lại **ETag** từ header response của mỗi request PUT — cần dùng ở bước 4.
>
> ```
> ETag: "d41d8cd98f00b204e9800998ecf8427e"
> ```

---

### Bước 4 — POST /media/multipart/complete — Hoàn tất ghép phần

```bash
curl -X POST http://localhost:3000/media/multipart/complete \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mediaId": "550e8400-e29b-41d4-a716-446655440000",
    "parts": [
      { "partNumber": 1, "eTag": "d41d8cd98f00b204e9800998ecf8427e" },
      { "partNumber": 2, "eTag": "a87ff679a2f3e71d9181a67b7542122c" },
      { "partNumber": 3, "eTag": "e4da3b7fbbce2345d7772b0674a318d5" }
    ]
  }'
```

**Body:**

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `mediaId` | string (UUID) | ✓ | ID từ bước 1 |
| `parts` | `PartRef[]` | ✓ | Danh sách các phần đã upload |
| `parts[].partNumber` | number | ✓ | Số phần (1-indexed) |
| `parts[].eTag` | string | ✓ | ETag nhận được sau khi PUT phần đó |

**Response 200:**
```json
{
  "statusCode": 200,
  "data": {
    "mediaId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "UPLOADED"
  }
}
```

> Tương tự bước 3 của upload thông thường — sau bước này Media Worker bắt đầu xử lý file.

---

### DELETE /media/multipart/:mediaId — Hủy upload

Hủy một phiên multipart đang upload dở, giải phóng tất cả phần đã upload.

```bash
curl -X DELETE "http://localhost:3000/media/multipart/550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer $TOKEN"
```

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Resource deleted successfully",
  "data": { "mediaId": "550e8400-e29b-41d4-a716-446655440000" }
}
```

> Gọi khi user hủy upload giữa chừng để tránh rò rỉ storage (orphaned parts).

---

## 3. Quản lý file

### GET /media — Danh sách media

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/media?page=1&limit=20"
```

Trả về danh sách file đã upload của user hiện tại, theo thứ tự mới nhất trước.

---

### GET /media/:mediaId/url — Lấy URL truy cập

```bash
# Lấy URL file gốc
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/media/550e8400-e29b-41d4-a716-446655440000/url?prefer=ORIGINAL"

# Lấy URL đã tối ưu (thumbnail / transcoded video)
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/media/550e8400-e29b-41d4-a716-446655440000/url?prefer=OPTIMIZED&conversationId=conv-uuid"
```

**Query params:**

| Param | Type | Mô tả |
|-------|------|-------|
| `prefer` | `'ORIGINAL'` \| `'OPTIMIZED'` | Loại URL muốn lấy. `OPTIMIZED` = thumbnail/video đã xử lý |
| `conversationId` | string (UUID) | (tùy chọn) Kiểm tra quyền truy cập trong context conversation |

**Response 200:**
```json
{
  "statusCode": 200,
  "data": {
    "url": "http://minio:9010/media/...?X-Amz-Signature=...&X-Amz-Expires=3600",
    "expiresAt": "2026-04-16T11:00:00.000Z",
    "mediaId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "READY"
  }
}
```

> URL là **signed URL** có thời hạn (thường 1 giờ). Client nên cache URL và chỉ gọi lại khi nhận HTTP 403 (URL hết hạn).
>
> Nếu `status != 'READY'`, trả về 403 `FORBIDDEN_MEDIA_NOT_READY`.

---

### DELETE /media/:mediaId — Xóa file

```bash
curl -X DELETE "http://localhost:3000/media/550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer $TOKEN"
```

**Ràng buộc:**
- Chỉ **chủ sở hữu** file mới có quyền xóa.
- File đã được đính kèm vào tin nhắn **không thể xóa** (bảo vệ tính toàn vẹn lịch sử chat).

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Resource deleted successfully",
  "data": { "mediaId": "550e8400-e29b-41d4-a716-446655440000" }
}
```

---

### POST /media/:mediaId/cross-share — Chia sẻ file

Chia sẻ quyền truy cập file sang conversation khác mà không nhân đôi file.

```bash
curl -X POST "http://localhost:3000/media/550e8400-e29b-41d4-a716-446655440000/cross-share" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceConversationId": "conv-uuid-source",
    "targetConversationId": "conv-uuid-target"
  }'
```

> Chỉ ADMIN mới có quyền cross-share. File gốc không bị nhân đôi, chỉ tạo binding mới.

---

## 4. Trạng thái xử lý file

Sau khi upload hoàn tất, file trải qua vòng đời trạng thái:

```
CREATED → UPLOADED → PROCESSING → READY
                              ↘ FAILED
```

| Trạng thái | Mô tả |
|-----------|-------|
| `CREATED` | Pre-signed URL đã được tạo, chờ client upload |
| `UPLOADED` | File đã lên MinIO, đang chờ Media Worker xử lý |
| `PROCESSING` | Media Worker đang scan virus / tạo thumbnail / transcode |
| `READY` | Hoàn tất, file sẵn sàng sử dụng trong tin nhắn |
| `FAILED` | Xử lý thất bại (virus phát hiện, file lỗi, v.v.) — cần upload lại |
| `DELETION_PENDING` | Đang trong quá trình xóa khỏi storage |
| `DELETED` | Đã xóa hoàn toàn |

**Cách theo dõi trạng thái:**
1. Lắng nghe WebSocket event `message:updated` trên namespace `/chat`:
   ```json
   { "messageId": "...", "conversationId": "...", "mediaStatus": "READY" }
   ```
2. Hoặc polling `GET /media/:mediaId/url` — nếu `status = 'READY'` thì dùng được.

---

## 5. Giới hạn và quy tắc

### Kích thước tối đa

| Loại | Upload thông thường | Multipart |
|------|---------------------|-----------|
| `image` | 15 MB | 15 MB |
| `video` | 2 GB (khuyến nghị multipart ≥ 10 MB) | 1 GB |
| `file` | 2 GB (khuyến nghị multipart ≥ 10 MB) | 1 GB |

### MIME type được hỗ trợ

| Loại | MIME types |
|------|-----------|
| `image` | `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/heic` |
| `video` | `video/mp4`, `video/quicktime`, `video/webm`, `video/x-msvideo` |
| `file` | `application/pdf`, `application/zip`, `application/msword`, `application/vnd.openxmlformats-officedocument.*`, `text/plain`, và các loại khác |

### Khi nào dùng multipart?

| File size | Khuyến nghị |
|-----------|------------|
| < 10 MB | Upload thông thường (3 bước) |
| 10 MB – 1 GB | Multipart upload (4 bước) |
| > 1 GB | Không được phép |

### Pre-signed URL hết hạn

| Loại URL | Thời hạn mặc định |
|----------|------------------|
| Upload URL (bước 1) | 15 phút |
| Multipart part URL (bước 2) | 15 phút |
| Access URL (`/url`) | 60 phút |
