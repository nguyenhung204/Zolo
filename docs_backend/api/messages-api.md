# Messages API

> **Base URL**: `http://localhost:3000`
> Tất cả endpoint yêu cầu header `Authorization: Bearer <ACCESS_TOKEN>`.
> Response bọc trong envelope chuẩn `{ statusCode, message, data }`.

---

## Mục lục

1. [Gửi tin nhắn — POST /chat/messages](#1-gửi-tin-nhắn--post-chatmessages)
2. [Lấy tin nhắn — GET /conversations/:id/messages](#2-lấy-tin-nhắn--get-conversationsidmessages)
3. [Sửa tin nhắn — PATCH /messages/:id](#3-sửa-tin-nhắn--patch-messagesid)
4. [Xóa tin nhắn — DELETE /messages/:id](#4-xóa-tin-nhắn--delete-messagesid)
5. [Thu hồi tin nhắn — POST /messages/:id/revoke](#5-thu-hồi-tin-nhắn--post-messagesidrevoke)
6. [Xóa tin nhắn phía tôi — DELETE /messages/:id/for-me](#6-xóa-tin-nhắn-phía-tôi--delete-messagesidfor-me)
7. [Chuyển tiếp tin nhắn — POST /messages/forward](#7-chuyển-tiếp-tin-nhắn--post-messagesforward)
8. [Ghim tin nhắn — POST /messages/:id/pin](#8-ghim-tin-nhắn--post-messagesidpin)
9. [Bỏ ghim tin nhắn — DELETE /messages/:id/pin](#9-bỏ-ghim-tin-nhắn--delete-messagesidpin)
10. [Danh sách tin nhắn đã ghim — GET /conversations/:id/pinned](#10-danh-sách-tin-nhắn-đã-ghim--get-conversationsidpinned)
11. [Kiểm tra trước khi upload — POST /chat/pre-check-media](#11-kiểm-tra-trước-khi-upload--post-chatpre-check-media)
12. [Mã lỗi nghiệp vụ](#12-mã-lỗi-nghiệp-vụ)
13. [Luồng gửi tin nhắn đầy đủ](#13-luồng-gửi-tin-nhắn-đầy-đủ)

---

## 1. Gửi tin nhắn — POST /chat/messages

Gửi tin nhắn vào một conversation. Hỗ trợ nhiều loại tin nhắn.

### Gửi tin nhắn text

```bash
curl -X POST http://localhost:3000/chat/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
    "content": "Xin chào mọi người!",
    "type": "text",
    "clientMessageId": "550e8400-e29b-41d4-a716-446655440001"
  }'
```

### Gửi tin nhắn sticker

```bash
curl -X POST http://localhost:3000/chat/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
    "type": "sticker",
    "mediaId": "sticker-pack-uuid:sticker-001",
    "clientMessageId": "550e8400-e29b-41d4-a716-446655440002"
  }'
```

> Khi `type` = `sticker`, trường `content` là tùy chọn (có thể bỏ qua).

### Gửi tin nhắn kèm nhiều tệp đính kèm (`type: 'media'`)

```bash
curl -X POST http://localhost:3000/chat/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
    "content": "Album ảnh chuyến đi",
    "type": "media",
    "clientMessageId": "550e8400-e29b-41d4-a716-446655440003",
    "attachments": [
      { "mediaId": "media-uuid-001", "type": "image" },
      { "mediaId": "media-uuid-002", "type": "image" },
      { "mediaId": "media-uuid-003", "type": "video" }
    ]
  }'
```

> Khi `type` = `media`, trường `content` là tùy chọn. Tối đa **30 attachments** mỗi tin nhắn.

### Gửi tin nhắn trả lời (reply)

```bash
curl -X POST http://localhost:3000/chat/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
    "content": "Đúng rồi!",
    "type": "text",
    "replyToId": "msg-uuid-replied-to",
    "clientMessageId": "550e8400-e29b-41d4-a716-446655440004"
  }'
```

### Body

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `conversationId` | string (UUID) | ✓ | ID của conversation |
| `type` | `'text'` \| `'sticker'` \| `'media'` \| `'image'` \| `'video'` \| `'audio'` \| `'file'` | ✓ | Loại tin nhắn |
| `content` | string | Bắt buộc trừ khi `type` = `sticker` hoặc `media` | Nội dung text |
| `clientMessageId` | string (UUID v4) | ✓ | UUID do client tự sinh — dùng để **dedup** (gửi lại không tạo tin trùng) |
| `mediaId` | string | ✗ | ID media đính kèm (dùng cho `type: 'image'/'video'/'audio'/'file'/'sticker'`) |
| `attachments` | `AttachmentRef[]` | ✗ | Danh sách tệp đính kèm (dùng cho `type: 'media'`) |
| `attachments[].mediaId` | string (UUID v4) | ✓ (trong mảng) | ID media đã upload |
| `attachments[].type` | `'image'` \| `'video'` \| `'audio'` \| `'file'` | ✗ | Loại attachment |
| `replyToId` | string (UUID) | ✗ | ID tin nhắn đang trả lời |
| `mentions` | string[] | ✗ | Danh sách userId được mention |
| `metadata` | object | ✗ | Dữ liệu mở rộng tùy chỉnh |

### Response 201

```json
{
  "statusCode": 201,
  "message": "Resource created successfully",
  "data": {
    "messageId": "186c65d5-a82d-4763-ada3-7a9b2e1e1f61",
    "clientMessageId": "550e8400-e29b-41d4-a716-446655440001",
    "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
    "status": "created"
  }
}
```

> **`messageId`** là ID thực trong DB (được gán bởi server). **`clientMessageId`** là ID client đã gửi lên.
> Tin nhắn được ghi vào DB **bất đồng bộ** qua Kafka. Dùng WebSocket event `message:saved` để biết khi nào tin nhắn thực sự được lưu và lấy `offset`.

### Lỗi phổ biến

| HTTP | Code | Mô tả |
|------|------|-------|
| 403 | `FORBIDDEN_NOT_MEMBER` | Không phải thành viên của conversation |
| 400 | `VALIDATION_ERROR` | Body không hợp lệ (thiếu trường bắt buộc, sai kiểu dữ liệu) |
| 503 | — | Chat Core hoặc Message Store không khả dụng |

---

## 2. Lấy tin nhắn — GET /conversations/:id/messages

Lấy danh sách tin nhắn trong một conversation theo phân trang offset.

```bash
# Lấy 30 tin nhắn mới nhất
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/conversations/95782059-71f1-4489-97ec-d3a7b1e25553/messages?limit=30"

# Load more (scroll lên) — lấy tin cũ hơn offset 50
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/conversations/95782059-71f1-4489-97ec-d3a7b1e25553/messages?before=50&limit=30"

# Catch-up (khi reconnect) — lấy tin mới hơn offset 80
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/conversations/95782059-71f1-4489-97ec-d3a7b1e25553/messages?after=80&limit=50"
```

### Query params

| Param | Type | Mặc định | Mô tả |
|-------|------|---------|-------|
| `limit` | number | 30 | Số tin nhắn tối đa (1–100) |
| `before` | number | — | Lấy tin có `offset` < giá trị này (load more, scroll lên) |
| `after` | number | — | Lấy tin có `offset` > giá trị này (catch-up sau reconnect) |

### Response 200

```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "data": [
      {
        "id": "5a6a514a-8fd9-45da-a802-2a78bab50c4b",
        "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
        "senderId": "e8394128-9259-4374-bbd6-28f0e37dac1c",
        "content": "Xin chào!",
        "type": "text",
        "offset": 1,
        "isDeleted": false,
        "isRevoked": false,
        "isEdited": false,
        "metadata": null,
        "mediaId": null,
        "attachments": null,
        "replyToId": null,
        "createdAt": "2026-04-16T10:00:00.000Z",
        "updatedAt": "2026-04-16T10:00:00.000Z"
      }
    ],
    "meta": {
      "hasMore": false,
      "oldestOffset": 1,
      "newestOffset": 10
    }
  }
}
```

> `hasMore: true` → còn tin cũ hơn, dùng `meta.oldestOffset` làm `before` cho request tiếp theo.

---

## 3. Sửa tin nhắn — PATCH /messages/:id

Chỉnh sửa nội dung tin nhắn của chính mình. Chỉ áp dụng cho `type: 'text'`.

```bash
curl -X PATCH "http://localhost:3000/messages/5a6a514a-8fd9-45da-a802-2a78bab50c4b" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Nội dung đã được chỉnh sửa"
  }'
```

### Body

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `content` | string | ✓ | Nội dung mới |

### Response 200

```json
{
  "statusCode": 200,
  "message": "Resource updated successfully",
  "data": {
    "messageId": "5a6a514a-8fd9-45da-a802-2a78bab50c4b",
    "content": "Nội dung đã được chỉnh sửa",
    "editedAt": "2026-04-16T10:05:00.000Z"
  }
}
```

### Ràng buộc

- Chỉ **chủ sở hữu** tin nhắn mới được sửa.
- Chỉ được sửa trong vòng **10 phút** kể từ khi gửi.
- Lịch sử sửa đổi được lưu đầy đủ (có thể xem qua `GET /messages/:id/history`).

### Lỗi phổ biến

| HTTP | Code | Mô tả |
|------|------|-------|
| 403 | `FORBIDDEN_NOT_OWNER` | Tin nhắn không thuộc về bạn |
| 403 | `FORBIDDEN_TIME_WINDOW` | Quá 10 phút kể từ khi gửi |
| 404 | `MESSAGE_NOT_FOUND` | Tin nhắn không tồn tại hoặc đã bị xóa |

---

## 4. Xóa tin nhắn — DELETE /messages/:id

Xóa cứng một tin nhắn (xóa cho tất cả mọi người trong conversation).

```bash
curl -X DELETE "http://localhost:3000/messages/5a6a514a-8fd9-45da-a802-2a78bab50c4b" \
  -H "Authorization: Bearer $TOKEN"
```

### Response 200

```json
{
  "statusCode": 200,
  "message": "Resource deleted successfully",
  "data": { "messageId": "5a6a514a-8fd9-45da-a802-2a78bab50c4b" }
}
```

### Ràng buộc

- **Thành viên thường**: chỉ xóa tin của mình, trong vòng **24 giờ**.
- **ADMIN**: có thể xóa tin của bất kỳ ai trong conversation, trong vòng 24 giờ (có audit log).
- Tin đã xóa vẫn còn record trong DB với `is_deleted = true` (soft delete). WebSocket broadcast `message:deleted` cho tất cả thành viên.

### Lỗi phổ biến

| HTTP | Code | Mô tả |
|------|------|-------|
| 403 | `FORBIDDEN_NOT_OWNER` | Không phải chủ sở hữu và không có quyền ADMIN |
| 403 | `FORBIDDEN_TIME_WINDOW` | Quá 24 giờ kể từ khi gửi |
| 404 | `MESSAGE_NOT_FOUND` | Tin nhắn không tồn tại |

---

## 5. Thu hồi tin nhắn — POST /messages/:id/revoke

Thu hồi tin nhắn — ẩn nội dung khỏi tất cả mọi người (hiển thị thành "Tin nhắn đã thu hồi").

```bash
curl -X POST "http://localhost:3000/messages/5a6a514a-8fd9-45da-a802-2a78bab50c4b/revoke" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553"
  }'
```

### Body

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `conversationId` | string (UUID) | ✓ | ID của conversation chứa tin nhắn |

### Response 200

```json
{
  "statusCode": 200,
  "message": "Resource updated successfully",
  "data": {
    "messageId": "5a6a514a-8fd9-45da-a802-2a78bab50c4b",
    "revokedAt": "2026-04-16T10:10:00.000Z"
  }
}
```

### Sự khác biệt giữa **Thu hồi** và **Xóa**

| | Thu hồi (`/revoke`) | Xóa (`DELETE /:id`) |
|---|---|---|
| Hiển thị với người khác | "Tin nhắn đã thu hồi" | Biến mất hoàn toàn |
| Ai thực hiện được | Chỉ chủ sở hữu | Chủ sở hữu hoặc ADMIN |
| Giới hạn thời gian | ~2 phút (cửa sổ thu hồi) | 24 giờ |
| Lưu trong DB | Có (`is_revoked = true`) | Có (`is_deleted = true`) |

### Lỗi phổ biến

| HTTP | Code | Mô tả |
|------|------|-------|
| 403 | `FORBIDDEN_NOT_OWNER` | Tin nhắn không thuộc về bạn |
| 403 | `FORBIDDEN_REVOKE_WINDOW_EXPIRED` | Quá cửa sổ thời gian thu hồi (~2 phút) |
| 404 | `MESSAGE_NOT_FOUND` | Tin nhắn không tồn tại hoặc đã bị thu hồi trước đó |

---

## 6. Xóa tin nhắn phía tôi — DELETE /messages/:id/for-me

Xóa một tin nhắn chỉ phía mình (ẩn khỏi lịch sử chat của bạn, người khác vẫn thấy bình thường).

```bash
curl -X DELETE "http://localhost:3000/messages/5a6a514a-8fd9-45da-a802-2a78bab50c4b/for-me?conversationId=95782059-71f1-4489-97ec-d3a7b1e25553" \
  -H "Authorization: Bearer $TOKEN"
```

> **Lưu ý**: `conversationId` truyền qua **query param** (không phải request body) vì HTTP DELETE thường không có body.

### Query params

| Param | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `conversationId` | string (UUID) | ✓ | ID của conversation chứa tin nhắn |

### Response 200

```json
{
  "statusCode": 200,
  "message": "Resource deleted successfully",
  "data": {
    "messageId": "5a6a514a-8fd9-45da-a802-2a78bab50c4b"
  }
}
```

### Sự khác biệt với Xóa và Thu hồi

| | Xóa phía tôi (`for-me`) | Thu hồi (`revoke`) | Xóa (`DELETE`) |
|---|---|---|---|
| Ai thấy thay đổi | Chỉ bạn | Tất cả mọi người | Tất cả mọi người |
| Người khác có thấy không | Vẫn thấy bình thường | Thấy "Đã thu hồi" | Không thấy |
| Giới hạn thời gian | Không có | ~2 phút | 24 giờ |

---

## 7. Chuyển tiếp tin nhắn — POST /messages/forward

Chuyển tiếp một tin nhắn sang một hoặc nhiều conversation khác.

```bash
curl -X POST http://localhost:3000/messages/forward \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceMessageId": "5a6a514a-8fd9-45da-a802-2a78bab50c4b",
    "sourceConversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
    "targetConversationIds": [
      "conv-uuid-target-1",
      "conv-uuid-target-2"
    ]
  }'
```

### Body

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `sourceMessageId` | string (UUID) | ✓ | ID tin nhắn cần chuyển tiếp |
| `sourceConversationId` | string (UUID) | ✓ | ID conversation chứa tin nhắn gốc |
| `targetConversationIds` | string[] | ✓ | Danh sách ID conversation đích (tối đa 10) |

### Response 201

```json
{
  "statusCode": 201,
  "message": "Resource created successfully",
  "data": {
    "forwardedMessageIds": [
      "b9c80423-8cce-4ae3-8f9e-95200e21db24",
      "c7d91534-9ddf-4bf4-a0f0-a6311f32ec35"
    ]
  }
}
```

> `forwardedMessageIds` là danh sách ID của các tin nhắn **mới** được tạo trong các conversation đích. Mỗi conversation nhận một bản sao độc lập.

### Ràng buộc

- Phải là thành viên của cả conversation nguồn lẫn conversation đích.
- Tin nhắn gốc không được `is_deleted = true` hoặc `is_revoked = true`.
- Nội dung và file đính kèm được sao chép nguyên vẹn (forward snapshot).

### Lỗi phổ biến

| HTTP | Code | Mô tả |
|------|------|-------|
| 403 | `FORBIDDEN_NOT_MEMBER` | Không phải thành viên conversation nguồn hoặc đích |
| 404 | `SOURCE_MESSAGE_NOT_FOUND` | Tin nhắn gốc không tồn tại hoặc đã bị xóa/thu hồi |
| 400 | `VALIDATION_ERROR` | `targetConversationIds` rỗng hoặc vượt quá 10 |

---

## 8. Ghim tin nhắn — POST /messages/:id/pin

Ghim một tin nhắn trong conversation để mọi người dễ tìm lại.

```bash
curl -X POST "http://localhost:3000/messages/5a6a514a-8fd9-45da-a802-2a78bab50c4b/pin" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553"
  }'
```

### Body

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `conversationId` | string (UUID) | ✓ | ID của conversation chứa tin nhắn |

### Response 201

```json
{
  "statusCode": 201,
  "message": "Resource created successfully",
  "data": {
    "messageId": "5a6a514a-8fd9-45da-a802-2a78bab50c4b",
    "pinnedAt": "2026-04-16T10:15:00.000Z",
    "pinnedBy": "e8394128-9259-4374-bbd6-28f0e37dac1c"
  }
}
```

### Ràng buộc

- Chỉ **ADMIN** hoặc **MODERATOR** mới có quyền ghim tin nhắn.
- Mỗi conversation tối đa **3 tin nhắn** được ghim cùng lúc. Nếu đã đủ 3, phải bỏ ghim trước.

---

## 9. Bỏ ghim tin nhắn — DELETE /messages/:id/pin

Bỏ ghim một tin nhắn đã được ghim.

```bash
curl -X DELETE "http://localhost:3000/messages/5a6a514a-8fd9-45da-a802-2a78bab50c4b/pin?conversationId=95782059-71f1-4489-97ec-d3a7b1e25553" \
  -H "Authorization: Bearer $TOKEN"
```

> **Lưu ý**: `conversationId` truyền qua **query param** (không phải request body).

### Query params

| Param | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `conversationId` | string (UUID) | ✓ | ID của conversation chứa tin nhắn |

### Response 200

```json
{
  "statusCode": 200,
  "message": "Resource deleted successfully",
  "data": {
    "messageId": "5a6a514a-8fd9-45da-a802-2a78bab50c4b"
  }
}
```

---

## 10. Danh sách tin nhắn đã ghim — GET /conversations/:id/pinned

Lấy danh sách tối đa 3 tin nhắn đang được ghim trong một conversation.

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/conversations/95782059-71f1-4489-97ec-d3a7b1e25553/pinned"
```

### Response 200

```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": [
    {
      "id": "5a6a514a-8fd9-45da-a802-2a78bab50c4b",
      "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
      "senderId": "e8394128-9259-4374-bbd6-28f0e37dac1c",
      "content": "Nội dung quan trọng cần ghim",
      "type": "text",
      "metadata": {
        "isPinned": true,
        "pinnedBy": "e8394128-9259-4374-bbd6-28f0e37dac1c",
        "pinnedAt": "2026-04-16T10:15:00.000Z"
      },
      "createdAt": "2026-04-16T10:00:00.000Z"
    }
  ]
}
```

---

## 11. Kiểm tra trước khi upload — POST /chat/pre-check-media

Kiểm tra xem file có được phép gửi trong conversation này không, trước khi bắt đầu upload lên MinIO.

```bash
curl -X POST http://localhost:3000/chat/pre-check-media \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "95782059-71f1-4489-97ec-d3a7b1e25553",
    "mimeType": "application/pdf",
    "fileSize": 2097152
  }'
```

### Body

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `conversationId` | string (UUID) | ✓ | ID conversation sẽ gửi vào |
| `mimeType` | string | ✓ | MIME type của file (ví dụ `image/jpeg`, `video/mp4`) |
| `fileSize` | number | ✓ | Kích thước file tính bằng bytes |

### Response 200 — Được phép

```json
{
  "statusCode": 200,
  "data": { "approved": true }
}
```

### Response 200 — Bị từ chối

```json
{
  "statusCode": 200,
  "data": {
    "approved": false,
    "reason": "FORBIDDEN_MEDIA_CLASSIFICATION"
  }
}
```

> Endpoint luôn trả về HTTP 200 (kể cả khi không được phép) để phân biệt lỗi nghiệp vụ và lỗi kỹ thuật. Đọc `data.approved` để biết kết quả.

---

## 12. Mã lỗi nghiệp vụ

| Code | HTTP | Mô tả |
|------|------|-------|
| `MESSAGE_NOT_FOUND` | 404 | Tin nhắn không tồn tại hoặc đã bị xóa |
| `SOURCE_MESSAGE_NOT_FOUND` | 404 | Tin nhắn gốc không tồn tại (khi forward) |
| `FORBIDDEN_NOT_MEMBER` | 403 | Không phải thành viên của conversation |
| `FORBIDDEN_NOT_OWNER` | 403 | Tin nhắn không thuộc về bạn |
| `FORBIDDEN_TIME_WINDOW` | 403 | Quá cửa sổ thời gian cho phép (sửa: 10 phút, xóa: 24 giờ) |
| `FORBIDDEN_REVOKE_WINDOW_EXPIRED` | 403 | Quá cửa sổ thu hồi (~2 phút) |
| `FORBIDDEN_ROLE_REQUIRED` | 403 | Cần role ADMIN hoặc MODERATOR để thực hiện (ghim) |
| `FORBIDDEN_MEDIA_NOT_READY` | 403 | File chưa xử lý xong (vẫn đang PROCESSING) |
| `FORBIDDEN_MEDIA_OWNERSHIP` | 403 | File không thuộc về bạn |
| `FORBIDDEN_MEDIA_CLASSIFICATION` | 403 | Loại file không được phép trong conversation này |

---


### Luồng B — Gửi file/ảnh/video kèm tin nhắn

```
1. POST /chat/pre-check-media { conversationId, mimeType, fileSize }
   → Kiểm tra trước để tránh upload thất bại

2a. File nhỏ (< 10 MB):
    POST /media/upload { type, mimeType, size, filename }
    → Nhận { mediaId, uploadUrl }
    PUT <uploadUrl> (upload thẳng lên MinIO, không qua Gateway)
    POST /media/upload/complete { mediaId }

2b. File lớn (≥ 10 MB):
    POST /media/multipart/init { type, mimeType, totalSize, filename }
    → Nhận { mediaId, uploadId, objectKey }
    POST /media/multipart/presign-parts { mediaId, partNumbers: [1,2,3,...] }
    → Nhận danh sách { partNumber, uploadUrl } cho từng phần
    PUT <uploadUrl[i]> (upload từng phần song song)
    POST /media/multipart/complete { mediaId, parts: [{partNumber, eTag}] }

3. Khi file xử lý xong (Media Worker):
   Lắng nghe WebSocket 'message:updated' { mediaStatus: 'READY' }
   → Cập nhật UI hiển thị file thực sự

4. POST /chat/messages {
     conversationId,
     content: "Xem ảnh đây!",          -- tùy chọn khi type: 'media'
     type: "media",
     clientMessageId: uuid_v4(),
     attachments: [{ mediaId, type: 'image' }]
   }
```

### Luồng C — Forward tin nhắn

```
1. POST /messages/forward {
     sourceMessageId,
     sourceConversationId,
     targetConversationIds: [id1, id2]
   }
2. Server tạo tin nhắn mới trong từng conversation đích
   (có trường forward_snapshot lưu metadata tin gốc)
3. WebSocket broadcast 'message:new' đến các thành viên của conversation đích
```
