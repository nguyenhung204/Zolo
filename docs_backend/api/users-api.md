# Users API — Implementation Guide

> **Base URL**: `http://localhost:3000/users`  
> **Auth**: Tất cả endpoint yêu cầu header `Authorization: Bearer <access_token>` (Keycloak JWT).

---

## Mục lục

1. [Lấy profile cá nhân](#1-lấy-profile-cá-nhân)
2. [Cập nhật profile cá nhân](#2-cập-nhật-profile-cá-nhân)
3. [Cập nhật settings cá nhân](#3-cập-nhật-settings-cá-nhân)
4. [Quản lý sessions](#4-quản-lý-sessions)
5. [Tra cứu user](#5-tra-cứu-user)
6. [Upload & cập nhật avatar](#6-upload--cập-nhật-avatar)
7. [Avatar variant: thumb vs original](#7-avatar-variant-thumb-vs-original)
8. [Cấu trúc Response User](#8-cấu-trúc-response-user)

---

## 1. Lấy profile cá nhân

```http
GET /users/me
Authorization: Bearer <token>
```

**Query params**

| Param | Kiểu | Mặc định | Mô tả |
|-------|------|----------|-------|
| `avatarVariant` | `thumb` \| `original` | `thumb` | Chọn URL ảnh trả về: thumbnail nhỏ hoặc ảnh gốc |

**Response 200**

```json
{
  "id": "kcid-uuid",
  "username": "john.doe",
  "email": "john.doe@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "phone": "+84901234567",
  "avatarMediaId": "media-uuid",
  "avatarUrl": "https://minio.example.com/presigned-url...",
  "cccdNumber": null,
  "isActive": true,
  "settings": {
    "statusMessage": "Đang họp",
    "theme": "DARK",
    "messageDensity": "COMFORTABLE",
    "enterToSend": true,
    "notifications": {
      "desktopEnabled": true,
      "mobileEnabled": true,
      "notifyFor": "ALL",
      "muteUntil": null
    }
  }
}
```

> `avatarUrl` là presigned URL có TTL (~5 phút), không cache phía client quá 5 phút.

---

## 2. Cập nhật profile cá nhân

```http
PUT /users/me
Authorization: Bearer <token>
Content-Type: application/json
```

**Query params**

| Param | Kiểu | Mặc định | Mô tả |
|-------|------|----------|-------|
| `avatarVariant` | `thumb` \| `original` | `thumb` | Variant của `avatarUrl` trong response |

**Request body** (tất cả field là optional)

```json
{
  "username": "Nguyễn Hùng",
  "phone": "+84901234567",
  "cccdNumber": "012345678901",
  "avatarMediaId": "media-uuid"
}
```

| Field | Kiểu | Giới hạn | Mô tả |
|-------|------|----------|-------|
| `username` | string | max 50 | Tên hiển thị, cho phép dấu và khoảng trắng |
| `phone` | string | max 20 | |
| `cccdNumber` | string | 9 hoặc 12 chữ số | Số CCCD |
| `avatarMediaId` | string (UUID) | — | ID media đã upload qua Media Service. Ảnh cũ sẽ bị xoá tự động. |

**Response 200**: cùng cấu trúc với `GET /users/me`, có `avatarUrl` được resolve theo `avatarVariant`.

**Lưu ý**:
- `firstName`, `lastName`, `email` **không thể thay đổi** qua API này.
- `phone` và `cccdNumber` chỉ được thiết lập khi còn trống. Nếu đã có giá trị thì không thể đổi sang giá trị khác.
- `username` là tên hiển thị, **được phép thay đổi** và có thể trùng với user khác.
- Khi cập nhật `avatarMediaId`, ảnh cũ sẽ bị soft-delete trên Media Service.

---

## 3. Cập nhật settings cá nhân

```http
PATCH /users/me/settings
Authorization: Bearer <token>
Content-Type: application/json
```

**Request body** (partial update — chỉ field nào gửi mới bị ghi đè, field còn lại giữ nguyên)

```json
{
  "statusMessage": "Đang làm việc",
  "theme": "DARK",
  "messageDensity": "COMPACT",
  "enterToSend": false,
  "notifications": {
    "desktopEnabled": true,
    "mobileEnabled": true,
    "notifyFor": "MENTIONS_ONLY",
    "muteUntil": "2026-04-04T08:00:00.000Z"
  }
}
```

| Field | Kiểu | Giá trị hợp lệ | Mô tả |
|-------|------|----------------|-------|
| `statusMessage` | string | max 100 ký tự | Trạng thái hiển thị với đồng nghiệp |
| `theme` | enum | `LIGHT` \| `DARK` \| `SYSTEM` | Giao diện sáng/tối/theo hệ thống |
| `messageDensity` | enum | `COMFORTABLE` \| `COMPACT` | Mật độ hiển thị danh sách tin nhắn |
| `enterToSend` | boolean | — | `true` = Enter gửi tin (default); `false` = Ctrl+Enter gửi |
| `notifications.desktopEnabled` | boolean | — | Bật/tắt push trên desktop/browser |
| `notifications.mobileEnabled` | boolean | — | Bật/tắt push trên mobile |
| `notifications.notifyFor` | enum | `ALL` \| `MENTIONS_ONLY` \| `NOTHING` | Lọc loại thông báo push |
| `notifications.muteUntil` | string (ISO 8601) \| `null` | — | Tắt tất cả push đến thời điểm này; `null` để xoá mute |

**Lưu ý về merge**:
- Mỗi field là độc lập — chỉ field được gửi mới bị ghi đè, các field còn lại **không bị xoá**.
- `notifications` được merge riêng: gửi `{ "notifications": { "notifyFor": "NOTHING" } }` **không** ảnh hưởng `desktopEnabled`, `mobileEnabled` đang lưu.
- Để xoá `muteUntil`, gửi `{ "notifications": { "muteUntil": null } }`.
- Các field không thuộc schema (ví dụ `language`, `timezone`) sẽ bị **từ chối 400** bởi validation pipe.

**Response 200**: object user đã cập nhật (cùng cấu trúc `GET /users/me`).

---

## 4. Quản lý sessions

### Lấy danh sách sessions đang active

```http
GET /users/me/sessions
Authorization: Bearer <token>
```

**Response 200**

```json
[
  {
    "id": "session-uuid",
    "ipAddress": "192.168.1.1",
    "started": "2026-04-03T08:00:00.000Z",
    "lastAccess": "2026-04-03T10:30:00.000Z",
    "clients": ["nest-api"]
  }
]
```

### Huỷ tất cả session khác (giữ session hiện tại)

```http
DELETE /users/me/sessions
Authorization: Bearer <token>
```

**Response 200**

```json
{ "revoked": true }
```

### Huỷ 1 session cụ thể

```http
DELETE /users/me/sessions/:sessionId
Authorization: Bearer <token>
```

**Response 200**

```json
{ "revoked": true }
```

---

## 5. Tra cứu user

> Mọi user đã đăng nhập đều có thể tra cứu user khác.

### Lấy danh sách users

```http
GET /users
Authorization: Bearer <token>
```

**Query params**

| Param | Kiểu | Mặc định |
|-------|------|----------|
| `page` | number | 1 |
| `limit` | number | 10 |

### Tìm kiếm users

```http
GET /users/search?q=john&page=1&limit=10
Authorization: Bearer <token>
```

### Lấy user theo ID

```http
GET /users/:id
Authorization: Bearer <token>
```

---

## 6. Upload & cập nhật avatar

Quy trình cập nhật avatar gồm **2 bước**:

### Bước 1 — Upload file lên Media Service

```http
POST /media/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data

file=<binary>
type=IMAGE
```

**Response**

```json
{
  "mediaId": "media-uuid",
  "status": "UPLOADED"
}
```

> File được xử lý bởi `media-worker` (sinh thumbnail). Status chuyển thành `READY` sau vài giây.

### Bước 2 — Gắn mediaId vào profile

```http
PUT /users/me?avatarVariant=thumb
Authorization: Bearer <token>
Content-Type: application/json

{
  "avatarMediaId": "media-uuid"
}
```

**Response 200** — profile với `avatarUrl` đã được resolve:

```json
{
  "id": "kcid-uuid",
  "avatarMediaId": "media-uuid",
  "avatarUrl": "https://minio.../thumb.webp?X-Amz-Signature=..."
}
```

> Ảnh avatar cũ sẽ bị **xoá tự động** khỏi MinIO sau khi cập nhật thành công.

---

## 7. Avatar variant: thumb vs original

Khi gọi các API trả về `avatarUrl`, FE có thể chọn nhận URL của thumbnail hoặc ảnh gốc qua query param `avatarVariant`:

| `avatarVariant` | URL trả về | Dùng khi |
|-----------------|-----------|---------|
| `thumb` (mặc định) | Thumbnail WebP (nhỏ, nhanh) | Avatar trong danh sách, message bubble |
| `original` | File gốc đã upload | Xem ảnh full size, lightbox |

```http
GET /users/me?avatarVariant=original
PUT /users/me?avatarVariant=original
```

**Lưu ý**:
- Nếu media-worker chưa xử lý xong thumbnail (status `PROCESSING`), `thumb` sẽ tự động fallback về ảnh gốc.
- `avatarUrl` là presigned URL, có TTL. Không nên lưu vào localStorage lâu hơn 4 phút.
- `avatarMediaId` là giá trị **bền vững** (persistent) — dùng để request URL mới khi hết hạn.

---

## 8. Cấu trúc Response User

```typescript
interface UserResponse {
  id: string;                  // Keycloak UUID
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  cccdNumber?: string;           // Số CCCD (9 hoặc 12 chữ số)
  isActive: boolean;             // true = active, false = banned
  avatarMediaId?: string;      // ID bền vững để re-fetch URL
  avatarUrl?: string;          // Presigned URL (thumb hoặc original, tuỳ avatarVariant)
  settings?: {
    statusMessage?: string;        // max 100 ký tự
    theme?: 'LIGHT' | 'DARK' | 'SYSTEM';
    messageDensity?: 'COMFORTABLE' | 'COMPACT';
    enterToSend?: boolean;         // default: true
    notifications?: {
      desktopEnabled?: boolean;
      mobileEnabled?: boolean;
      notifyFor?: 'ALL' | 'MENTIONS_ONLY' | 'NOTHING';
      muteUntil?: string | null;   // ISO 8601; null = không mute
    };
  };
}
```

---

## Error Codes

| HTTP | Code | Mô tả |
|------|------|-------|
| 401 | `UNAUTHORIZED` | Token không hợp lệ hoặc hết hạn |
| 403 | `FORBIDDEN` | Không đủ quyền (thiếu org role) |
| 404 | `NOT_FOUND` | User không tồn tại |
| 409 | `CONFLICT` | Trùng dữ liệu unique (thường là email ở luồng tạo user) |
| 422 | `UNPROCESSABLE_ENTITY` | Dữ liệu không hợp lệ (validation error) |
