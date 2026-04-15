# Sticker API — Implementation Guide

> **Base URL**: `http://localhost:3000/stickers`  
> **Auth**: Tất cả endpoint yêu cầu header `Authorization: Bearer <access_token>` (Keycloak JWT).

---

## Mục lục

1. [Lấy danh sách bộ nhãn dán (Packages)](#1-lấy-danh-sách-bộ-nhãn-dán-packages)
2. [Lấy danh sách sticker trong một Package](#2-lấy-danh-sách-sticker-trong-một-package)
3. [Gửi tin nhắn sticker](#3-gửi-tin-nhắn-sticker)
4. [Cấu trúc message:new với sticker](#4-cấu-trúc-messagenew-với-sticker)

---

## 1. Lấy danh sách bộ nhãn dán (Packages)

Gọi khi user mở sticker keyboard. Trả về danh sách tất cả bộ nhãn dán kèm icon đại diện (`thumbnailUrl`) để render thanh tab bên dưới.

```http
GET /stickers/packages
Authorization: Bearer <token>
```

**Không có query params.**

**Response 200**

```json
[
  {
    "id": "pck_sprite",
    "name": "Zolo Sprites",
    "thumbnailUrl": "https://storage.bcn.id.vn/zolo-stickers/sprite_45212.webp",
    "isFree": true,
    "createdAt": "2026-04-12T00:00:00.000Z"
  },
  {
    "id": "pck_sticker",
    "name": "Zolo Stickers",
    "thumbnailUrl": "https://storage.bcn.id.vn/zolo-stickers/sticker_20060.webp",
    "isFree": true,
    "createdAt": "2026-04-12T00:00:00.000Z"
  },
  {
    "id": "pck_webpc",
    "name": "Zolo WebPC",
    "thumbnailUrl": "https://storage.bcn.id.vn/zolo-stickers/webpc_22150.webp",
    "isFree": true,
    "createdAt": "2026-04-12T00:00:00.000Z"
  }
]
```

**Lưu ý**: Response này được cache phía server (Redis TTL 1 giờ). Frontend nên cache lại trong RAM/session storage để tránh gọi lại mỗi lần mở keyboard.

---

## 2. Lấy danh sách sticker trong một Package

Gọi sau khi lấy packages để tải sticker của từng bộ. **Kết quả nên cache ở client** vì dữ liệu thay đổi rất hiếm.

```http
GET /stickers/packages/:packageId/stickers
Authorization: Bearer <token>
```

**Path params**

| Param | Kiểu | Mô tả |
|-------|------|-------|
| `packageId` | `string` | ID của package (`pck_sprite`, `pck_sticker`, `pck_webpc`) |

**Query params**

| Param | Kiểu | Mặc định | Mô tả |
|-------|------|----------|-------|
| `limit` | `number` | `50` | Số sticker tối đa mỗi trang (max 50) |
| `offset` | `number` | `0` | Vị trí bắt đầu (offset-based pagination) |

**Response 200**

```json
[
  {
    "id": "sprite_45212",
    "url": "https://storage.bcn.id.vn/zolo-stickers/sprite_45212.webp"
  },
  {
    "id": "sprite_45213",
    "url": "https://storage.bcn.id.vn/zolo-stickers/sprite_45213.webp"
  }
]
```

**Response 404** — Package không tồn tại

```json
{
  "statusCode": 404,
  "message": "Sticker package not found",
  "error": "NOT_FOUND"
}
```

---

## 3. Gửi tin nhắn sticker

Gửi một sticker vào conversation. Sử dụng endpoint `POST /chat/messages` thông thường — **không có endpoint riêng**.

```http
POST /chat/messages
Authorization: Bearer <token>
Content-Type: application/json
```

**Request body**

```json
{
  "clientMessageId": "550e8400-e29b-41d4-a716-446655440000",
  "conversationId": "conv-uuid",
  "type": "sticker",
  "content": "",
  "metadata": {
    "url": "https://storage.bcn.id.vn/zolo-stickers/sprite_45212.webp"
  }
}
```

| Field | Kiểu | Bắt buộc | Ghi chú |
|-------|------|----------|---------|
| `clientMessageId` | UUID v4 | Có | Dùng để idempotency — tự sinh ở client |
| `conversationId` | string | Có | ID của conversation |
| `type` | `"sticker"` | Có | Phân biệt với `"text"`, `"image"`, v.v. |
| `content` | string | Không | **Bắt buộc là `""`** (chuỗi rỗng) với sticker |
| `metadata.url` | string | Có | URL đầy đủ lấy từ response của API số 2 |

**Response 200**

```json
{
  "success": true,
  "messageId": "msg-uuid-generated-by-server"
}
```

**Backend không validate URL sticker** khi gửi — URL đã được trust vì client chỉ có thể lấy URL từ `GET /stickers/packages/:id/stickers`. Điều này giúp gửi sticker nhanh tương đương gửi tin nhắn text.

---

## 4. Cấu trúc `message:new` với sticker

Khi Client B nhận WebSocket event `message:new`:

```json
{
  "messageId": "msg-uuid",
  "conversationId": "conv-uuid",
  "senderId": "user-uuid",
  "type": "sticker",
  "content": "",
  "metadata": {
    "url": "https://storage.bcn.id.vn/zolo-stickers/sprite_45212.webp"
  },
  "offset": 42,
  "createdAt": "2026-04-12T08:30:00.000Z"
}
```

**Cách Frontend render**:

```javascript
if (message.type === 'sticker') {
  return `<img src="${message.metadata.url}" class="sticker-message" />`;
}
```

Trình duyệt/app tự tải ảnh trực tiếp từ storage CDN — backend không xử lý bất kỳ file ảnh nào trong luồng chat.

---

## Luồng Pre-fetch đầy đủ (Frontend Checklist)

```
App khởi động
  └─► GET /stickers/packages                        → cache packages[]
        └─► for each package:
              GET /stickers/packages/:id/stickers    → cache stickers[]

User mở sticker keyboard
  └─► Render từ cache (không gọi API lại)

User chọn sticker
  └─► POST /chat/messages { type: "sticker", metadata: { url } }
```
