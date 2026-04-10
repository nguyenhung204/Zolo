
# API Reference — NestJS Chat System

> **Base URL HTTP**: `http://localhost:3000`
> **Base URL WebSocket**: `ws://localhost:3002`
> Tất cả API (trừ Public) yêu cầu header `Authorization: Bearer <TOKEN>`
> Response luôn được bọc trong envelope chuẩn (xem mục 1)

---

## Mục lục

1. [Conventions & Response Format](#1-conventions--response-format)
2. [Xác thực (Auth)](#2-xác-thực-auth)
   - [POST /auth/login — Đăng nhập](#post-authlogin--đăng-nhập)
   - [POST /auth/refresh — Làm mới token](#post-authrefresh--làm-mới-token)
   - [POST /auth/logout — Đăng xuất](#post-authlogout--đăng-xuất)
   - [POST /auth/register/init — Bước 1: Gửi OTP đăng ký](#post-authregisterinit--bước-1-gửi-otp-đăng-ký)
   - [POST /auth/register/verify-otp — Bước 2: Xác thực OTP](#post-authregisterverify-otp--bước-2-xác-thực-otp)
   - [POST /auth/register/complete — Bước 3: Hoàn tất đăng ký](#post-authregistercomplete--bước-3-hoàn-tất-đăng-ký)
   - [POST /auth/forgot-password — Quên mật khẩu (gửi OTP)](#post-authforgot-password--quên-mật-khẩu-gửi-otp)
   - [POST /auth/reset-password — Đặt lại mật khẩu bằng OTP](#post-authreset-password--đặt-lại-mật-khẩu-bằng-otp)
3. [Health & Root](#3-health--root)
4. [Users — Quản lý người dùng](#4-users--quản-lý-người-dùng)
   - [POST /users/me/change-password — Đổi mật khẩu (đã đăng nhập)](#post-usersmechange-password--đổi-mật-khẩu-đã-đăng-nhập)
5. [Conversations — Cuộc trò chuyện](#5-conversations--cuộc-trò-chuyện)
6. [Chat & Messages — Tin nhắn](#6-chat--messages--tin-nhắn)
7. [Friendships — Kết bạn](#7-friendships--kết-bạn)
8. [Media — Tải lên file / ảnh / video](#8-media--tải-lên-file--ảnh--video)
9. [Notifications — Thông báo & Thiết bị](#9-notifications--thông-báo--thiết-bị)
10. [Presence — Trạng thái trực tuyến](#10-presence--trạng-thái-trực-tuyến)
11. [Calls — Cuộc gọi video/voice](#11-calls--cuộc-gọi-videovoice)
12. [WebSocket — Realtime Gateway](#12-websocket--realtime-gateway)
13. [Luồng hoạt động chính](#13-luồng-hoạt-động-chính)

---

## 1. Conventions & Response Format

### Envelope chuẩn (tất cả HTTP response)

Mỗi response trả về từ Gateway đều được bọc trong một envelope chuẩn. FE/Mobile luôn đọc trường `data` để lấy kết quả.

```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": { ... }
}
```

Với danh sách có phân trang:

```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": [ ... ],
  "metadata": {
    "total": 100,
    "page": 1,
    "limit": 20
  }
}
```

### Message mặc định theo method

| HTTP Method | message |
|---|---|
| GET | "Data retrieved successfully" |
| POST | "Resource created successfully" |
| PUT / PATCH | "Resource updated successfully" |
| DELETE | "Resource deleted successfully" |

### Rate limit mặc định

Global: 120 request/60 giây mỗi IP. Một số endpoint call có giới hạn riêng (xem mục 11).

### Roles trong JWT (`realm_access.roles`)

Roles are assigned by Keycloak and embedded in the JWT. The system uses conversation-level roles (owner, admin, moderator, member, guest) rather than org-level roles.

### Mã lỗi nghiệp vụ phổ biến

| Code | Ý nghĩa |
|---|---|
| `FORBIDDEN_ACCOUNT_STATUS` | Tài khoản bị khóa hoặc đã offboard |
| `FORBIDDEN_NOT_MEMBER` | Không phải thành viên conversation |
| `FORBIDDEN_ROLE_REQUIRED` | Không đủ quyền để thực hiện hành động |
| `FORBIDDEN_TIME_WINDOW` | Quá thời gian cho phép (sửa/xóa tin nhắn) |
| `FORBIDDEN_MEDIA_NOT_READY` | File chưa xử lý xong |
| `FORBIDDEN_MEDIA_OWNERSHIP` | Không sở hữu file này |
| `FORBIDDEN_MEDIA_CLASSIFICATION` | File bị hạn chế, kênh không cho phép |

---

## 2. Xác thực (Auth)

Hệ thống dùng **Keycloak** làm Identity Provider. Token là JWT RS256, xác thực tại Gateway qua JWKS (cached Redis). Mỗi user có tối đa **1 phiên web + 1 phiên mobile** được quản lý bởi Redis Session Store.

> **Header bắt buộc cho các endpoint cần platform:**
> `X-Client-Platform: web` hoặc `X-Client-Platform: mobile` (mặc định `web` nếu thiếu)

---

### POST /auth/login — Đăng nhập

**Public — không cần token**

> Chỉ hỗ trợ đăng nhập bằng `email` + `password`.

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Client-Platform: web" \
  -d '{
    "email": "alice@example.com",
    "password": "Secret123!",
    "platform": "web",
    "deviceInfo": {
      "deviceName": "Chrome / Windows"
    }
  }'
```

**Body:**

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `email` | string | ✅ | Email tài khoản |
| `password` | string | ✅ | Mật khẩu |
| `platform` | `'web'\|'mobile'` | ✅ | Loại thiết bị |
| `deviceInfo.deviceName` | string | ❌ | Tên thiết bị hiển thị |
| `deviceInfo.userAgent` | string | ❌ | User-Agent (tự động lấy nếu không gửi) |

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Resource created successfully",
  "data": {
    "accessToken": "eyJhbGci...",
    "refreshToken": "eyJhbGci...",
    "expiresIn": 300
  }
}
```

> **Hành vi phiên**: Nếu đã có phiên `web` khác, phiên cũ bị thu hồi, WebSocket nhận event `session_revoked` và bị ngắt kết nối.

**Lỗi phổ biến:**

| HTTP | Trường hợp |
|------|------------|
| 401 | Sai email hoặc mật khẩu |
| 500 | Keycloak không phản hồi |

---

### POST /auth/refresh — Làm mới token

**Public — không cần token**

```bash
curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -H "X-Client-Platform: web" \
  -d '{
    "refreshToken": "<REFRESH_TOKEN>"
  }'
```

**Response 200:** cùng cấu trúc với `/auth/login`.

**Lỗi phổ biến:**

| HTTP | Trường hợp |
|------|------------|
| 401 | `refreshToken` hết hạn hoặc bị revoke |
| 401 `SESSION_REVOKED` | Phiên bị kick bởi đăng nhập ở thiết bị khác |

---

### POST /auth/logout — Đăng xuất

**Yêu cầu JWT**

```bash
curl -X POST http://localhost:3000/auth/logout \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "X-Client-Platform: web"
```

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Resource created successfully",
  "data": { "message": "Đăng xuất thành công." }
}
```

> Xóa phiên Redis, thu hồi session Keycloak, publish event ngắt WebSocket.

---

### POST /auth/register/init — Bước 1: Gửi OTP đăng ký

**Public — không cần token**

```bash
curl -X POST http://localhost:3000/auth/register/init \
  -H "Content-Type: application/json" \
  -d '{
    "email": "bob@example.com",
    "firstName": "Nguyễn",
    "lastName": "Hùng"
  }'
```

**Body:**

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `email` | string | ✅ | Email đăng ký (phải chưa tồn tại) |
| `firstName` | string | ✅ | Tên, 1–20 ký tự |
| `lastName` | string | ✅ | Họ, 1–20 ký tự |

> `username` hiển thị được hệ thống tự sinh từ `firstName + " " + lastName`, có thể trùng và có thể thay đổi sau này.

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Resource created successfully",
  "data": { "cooldownSeconds": 60 }
}
```

**Lỗi phổ biến:**

| HTTP | Trường hợp |
|------|------------|
| 409 | Email đã được đăng ký |
| 429 | Vượt rate limit (5 lần/15 phút/email) hoặc cooldown 60s |

---

### POST /auth/register/verify-otp — Bước 2: Xác thực OTP

**Public — không cần token**

```bash
curl -X POST http://localhost:3000/auth/register/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "bob@example.com",
    "otp": "482951"
  }'
```

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Resource created successfully",
  "data": {
    "registrationToken": "550e8400-e29b-41d4-a716-446655440000",
    "expiresIn": 600
  }
}
```

> `registrationToken` có hiệu lực **10 phút**, dùng một lần duy nhất cho bước 3.

**Lỗi phổ biến:**

| HTTP | Trường hợp |
|------|------------|
| 400 | OTP hết hạn, sai, đã dùng, hoặc quá 3 lần nhập sai |

---

### POST /auth/register/complete — Bước 3: Hoàn tất đăng ký

**Public — không cần token**

```bash
curl -X POST http://localhost:3000/auth/register/complete \
  -H "Content-Type: application/json" \
  -H "X-Client-Platform: web" \
  -d '{
    "registrationToken": "550e8400-e29b-41d4-a716-446655440000",
    "password": "MyPass@2026",
    "platform": "web",
    "deviceInfo": {
      "deviceName": "Chrome / Windows"
    }
  }'
```

**Body:**

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `registrationToken` | string (UUID) | ✅ | Token nhận từ bước 2 |
| `password` | string | ✅ | Mật khẩu mới, tối thiểu 8 ký tự |
| `platform` | `'web'\|'mobile'` | ✅ | Loại thiết bị |
| `deviceInfo.deviceName` | string | ❌ | Tên thiết bị |

**Response 201:**
```json
{
  "statusCode": 201,
  "message": "Resource created successfully",
  "data": {
    "accessToken": "eyJhbGci...",
    "refreshToken": "eyJhbGci...",
    "expiresIn": 300
  }
}
```

> Tạo user trong Keycloak + users-service. Nếu users-service lỗi → Keycloak user bị xóa (Saga-lite rollback). Tự động đăng nhập sau khi tạo thành công.

**Lỗi phổ biến:**

| HTTP | Trường hợp |
|------|------------|
| 400 | `registrationToken` hết hạn hoặc không hợp lệ |
| 409 | Email đã tồn tại (race condition) |
| 500 | Lỗi hệ thống (cả 2 vế đều được rollback) |

---

### POST /auth/forgot-password — Quên mật khẩu (gửi OTP)

**Public — không cần token**

Gửi yêu cầu đặt lại mật khẩu. Nếu email tồn tại trong hệ thống, một mã OTP 6 chữ số sẽ được gửi đến email đó (hiệu lực 10 phút).

> **Bảo mật**: Response luôn trả về HTTP 200 dù email có tồn tại hay không — tránh email enumeration attack.

```bash
curl -X POST http://localhost:3000/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@example.com"}'
```

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "message": "Nếu email tồn tại, bạn sẽ nhận được mã OTP trong vài phút."
  }
}
```

**Rate limit:**
- Tối đa **5 yêu cầu / 15 phút** mỗi email
- Cooldown **60 giây** giữa 2 lần yêu cầu liên tiếp
- Vượt quá → HTTP 429

**Lỗi phổ biến:**

| HTTP | Trường hợp |
|------|------------|
| 400 | Email không đúng định dạng |
| 429 | Vượt rate limit hoặc cooldown |

---

### POST /auth/reset-password — Đặt lại mật khẩu bằng OTP

**Không cần token (Public)**

Xác thực OTP nhận được qua email và đặt mật khẩu mới. Tất cả phiên đăng nhập hiện tại bị thu hồi sau khi đặt lại thành công.

```bash
curl -X POST http://localhost:3000/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "otp": "482951",
    "newPassword": "NewPass@2026"
  }'
```

**Body:**

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `email` | string | ✅ | Email tài khoản |
| `otp` | string | ✅ | Mã 6 chữ số nhận qua email |
| `newPassword` | string | ✅ | Mật khẩu mới — phải có chữ hoa, chữ thường, số, ký tự đặc biệt, tối thiểu 8 ký tự |

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "message": "Mật khẩu đã được đặt lại thành công. Vui lòng đăng nhập lại."
  }
}
```

**Lỗi phổ biến:**

| HTTP | Trường hợp |
|------|------------|
| 400 | OTP sai, đã hết hạn, đã dùng, hoặc quá 3 lần sai |
| 400 | `newPassword` không đáp ứng yêu cầu độ phức tạp |
| 500 | Lỗi phía Keycloak (thử lại sau) |

> **Sau khi reset thành công**: Tất cả `access_token` / `refresh_token` cũ đều bị vô hiệu hóa. Client cần đăng nhập lại để lấy token mới.

---

## 3. Health & Root

### GET / — Kiểm tra service còn sống

**Không cần token (Public)**

```bash
curl http://localhost:3000/
```

Dùng để ping. Trả về chuỗi text đơn giản.

---

### GET /health — Trạng thái gateway

**Không cần token (Public)**

```bash
curl http://localhost:3000/health
```

Response:

```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "status": "ok",
    "timestamp": "2026-03-28T10:00:00.000Z",
    "service": "gateway"
  }
}
```

---

### GET /health/circuit-breakers — Trạng thái circuit breaker

**Không cần token (Public)**

```bash
curl http://localhost:3000/health/circuit-breakers
```

Kiểm tra các circuit breaker của Gateway và ChatCore. Khi hệ thống chịu tải cao hoặc một service bị lỗi, circuit breaker sẽ mở để tránh lỗi dây chuyền. Endpoint này giúp DevOps và FE biết trạng thái hiện tại.

---

### GET /me — Thông tin user đang đăng nhập (lấy từ JWT)

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/me
```

Response:

```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "username": "alice",
    "email": "alice@example.com",
    "name": "Alice Nguyen",
    "roles": []
  }
}
```

Chỉ lấy từ payload JWT, không truy vấn DB. Dùng để lấy `id` nhanh. Để lấy đầy đủ profile (avatar, settings...) dùng `/users/me`.

---

## 4. Users — Quản lý người dùng

### GET /users — Danh sách tất cả user trong tổ chức

```bash
curl -H "Authorization: Bearer $TOKEN" \\
  "http://localhost:3000/users?page=1&limit=20"
```

---

### GET /users/me — Profile đầy đủ của user đang đăng nhập

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/users/me
```

Khác với `/me` ở root (chỉ lấy từ JWT), endpoint này lấy data đầy đủ từ Users Service bao gồm `avatarUrl`, `settings`, `isActive`, v.v.

---

### PUT /users/me — Cập nhật profile của bản thân

```bash
curl -X PUT http://localhost:3000/users/me \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "firstName": "Alice Updated",
    "lastName": "Nguyen",
    "phone": "+84987654321",
    "avatarUrl": "https://cdn.example.com/avatars/alice.jpg"
  }'
```

Chỉ được cập nhật `firstName`, `lastName`, `phone`, `cccdNumber`, `avatarMediaId`.

---

### GET /users/search — Tìm kiếm user

```bash
curl -H "Authorization: Bearer $TOKEN" \\
  "http://localhost:3000/users/search?q=alice&page=1&limit=10"
```

---

### GET /users/:id — Xem thông tin user cụ thể

```bash
curl -H "Authorization: Bearer $TOKEN" \\
  "http://localhost:3000/users/a1b2c3d4-e5f6-7890-abcd-ef1234567890"
```

---

### POST /users/me/change-password — Đổi mật khẩu (đã đăng nhập)

**Yêu cầu token (Authenticated)**

Đổi mật khẩu cho user đang đăng nhập. Hệ thống xác thực mật khẩu hiện tại trước, sau đó đặt mật khẩu mới và **thu hồi toàn bộ phiên đăng nhập** (buộc đăng nhập lại trên tất cả thiết bị).

```bash
curl -X POST http://localhost:3000/users/me/change-password \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "currentPassword": "OldPass@2025",
    "newPassword": "NewPass@2026"
  }'
```

**Body:**

| Field | Type | Bắt buộc | Mô tả |
|-------|------|----------|-------|
| `currentPassword` | string | ✅ | Mật khẩu hiện tại để xác minh danh tính |
| `newPassword` | string | ✅ | Mật khẩu mới — phải có chữ hoa, chữ thường, số, ký tự đặc biệt `!@#$%^&*`, tối thiểu 8 ký tự |

**Response 200:**
```json
{
  "statusCode": 200,
  "message": "Data retrieved successfully",
  "data": {
    "message": "Mật khẩu đã được đổi thành công. Vui lòng đăng nhập lại."
  }
}
```

**Lỗi phổ biến:**

| HTTP | Trường hợp |
|------|------------|
| 401 | Mật khẩu hiện tại không đúng |
| 400 | `newPassword` không đáp ứng yêu cầu độ phức tạp |
| 401 | Token hết hạn hoặc không hợp lệ |

> **Sau khi đổi mật khẩu thành công**: Tất cả phiên đăng nhập bị thu hồi. Client cần đăng nhập lại để lấy token mới.

---

## 5. Conversations — Cuộc trò chuyện

### GET /conversations/health/outbox — Kiểm tra outbox

**Không cần token (Public)**

```bash
curl http://localhost:3000/conversations/health/outbox
```

Xem trạng thái outbox (số event chưa xử lý). Dùng cho DevOps monitoring.

---

### GET /conversations — Danh sách cuộc trò chuyện của user

```bash
curl -H "Authorization: Bearer $TOKEN" \\
  "http://localhost:3000/conversations?page=1&limit=20"
```

Trả về các conversation mà user đang là thành viên, kèm thông tin offset đọc cuối và số tin chưa đọc.

---

### POST /conversations — Tạo cuộc trò chuyện mới

```bash
# Tạo chat đôi (DIRECT) với 1 người khác
curl -X POST http://localhost:3000/conversations \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "DIRECT",
    "memberIds": ["b2c3d4e5-f6a7-8901-bcde-f12345678901"]
  }'
```

```bash
# Tạo kênh nhóm GROUP với nhiều người
curl -X POST http://localhost:3000/conversations \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "GROUP",
    "memberIds": [
      "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "c3d4e5f6-a7b8-9012-cdef-123456789012"
    ],
    "name": "Project Alpha",
    "description": "Kênh dự án alpha"
  }'
```

Các loại conversation: `DIRECT` (chat đôi, không cần name), `GROUP` (danh sách thủ công), `COMMUNITY` (chỉ admin post được).

Lưu ý: Nếu đã tồn tại conversation `DIRECT` giữa 2 người, server trả về conversation cũ (không tạo mới).

---

### GET /conversations/:id — Chi tiết cuộc trò chuyện

```bash
curl -H "Authorization: Bearer $TOKEN" \\
  "http://localhost:3000/conversations/conv-uuid-here"
```

---

### PATCH /conversations/:id/info — Cập nhật thông tin nhóm

Chỉ OWNER hoặc ADMIN của conversation mới có quyền.

Trường `avatarMediaId` là UUID của media (đã upload qua Media Service). Gateway tự động xóa avatar cũ khỏi MinIO sau khi cập nhật thành công (soft-fail — lỗi xóa không làm fail toàn bộ request).

```bash
curl -X PATCH "http://localhost:3000/conversations/conv-uuid-here/info" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Project Alpha v2",
    "description": "Kênh dự án alpha phiên bản 2",
    "avatarMediaId": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

---

### POST /conversations/:id/members — Thêm thành viên

Chỉ OWNER hoặc ADMIN của conversation mới có quyền.

```bash
curl -X POST "http://localhost:3000/conversations/conv-uuid-here/members" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "userIds": [
      "d4e5f6a7-b8c9-0123-defa-234567890123",
      "e5f6a7b8-c9d0-1234-efab-345678901234"
    ]
  }'
```

---

### DELETE /conversations/:id/members — Xóa thành viên

Chỉ OWNER hoặc ADMIN của conversation mới có quyền.

```bash
curl -X DELETE "http://localhost:3000/conversations/conv-uuid-here/members" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "userIds": ["d4e5f6a7-b8c9-0123-defa-234567890123"] }'
```

---

### GET /conversations/:id/members — Danh sách thành viên và role

```bash
curl -H "Authorization: Bearer $TOKEN" \\
  "http://localhost:3000/conversations/conv-uuid-here/members"
```

Response mẫu:

```json
{
  "data": {
    "members": [
      { "userId": "a1b2c3d4-uuid", "role": "OWNER" },
      { "userId": "b2c3d4e5-uuid", "role": "MEMBER" }
    ]
  }
}
```

Các role hợp lệ: `OWNER`, `ADMIN`, `MODERATOR`, `MEMBER`, `GUEST`, `READONLY`.

---

### PATCH /conversations/:id/members/:userId/role — Thay đổi role thành viên

Chỉ OWNER mới có quyền đổi role. OWNER phải giữ ít nhất 1 OWNER trong nhóm.

```bash
curl -X PATCH "http://localhost:3000/conversations/conv-uuid-here/members/b2c3d4e5-uuid/role" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "role": "MODERATOR" }'
```

---

### GET /conversations/:id/unread — Số tin nhắn chưa đọc

```bash
curl -H "Authorization: Bearer $TOKEN" \\
  "http://localhost:3000/conversations/conv-uuid-here/unread"
```

Response: `{ "data": { "unreadCount": 5 } }`

---

### PATCH /conversations/:id/offset — Cập nhật vị trí đọc (read cursor)

```bash
curl -X PATCH "http://localhost:3000/conversations/conv-uuid-here/offset" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "offset": 42 }'
```

Gọi khi user đã đọc đến tin nhắn có offset = 42. Server tính lại `unreadCount`. Nên gọi sau khi user xem tin (on scroll hoặc khi màn hình conversation visible).

---

### GET /conversations/:id/pinned — Tin nhắn được ghim

```bash
curl -H "Authorization: Bearer $TOKEN" \\
  "http://localhost:3000/conversations/conv-uuid-here/pinned"
```

Trả về tối đa 3 tin nhắn đang được ghim trong conversation.

---

## 6. Chat & Messages — Tin nhắn

### GET /conversations/:id/messages — Lấy tin nhắn (phân trang offset)

Endpoint này nằm trong nhóm `/conversations` (trước đây là `/chat/conversations/:id/messages` — đã di chuyển). Yêu cầu membership hợp lệ.

```bash
# Lấy 30 tin nhắn mới nhất
curl -H "Authorization: Bearer $TOKEN" \\
  "http://localhost:3000/conversations/conv-uuid-here/messages?limit=30"

# Load more — lấy tin cũ hơn offset 50
curl -H "Authorization: Bearer $TOKEN" \\
  "http://localhost:3000/conversations/conv-uuid-here/messages?before=50&limit=30"

# Lấy tin mới hơn offset 80 (sau khi reconnect / re-open app)
curl -H "Authorization: Bearer $TOKEN" \\
  "http://localhost:3000/conversations/conv-uuid-here/messages?after=80&limit=30"
```

Response:

```json
{
  "statusCode": 200,
  "data": {
    "data": [
      {
        "id": "msg-uuid-001",
        "conversationId": "conv-uuid-here",
        "senderId": "a1b2c3d4-uuid",
        "content": "Xin chào mọi người",
        "type": "text",
        "offset": 42,
        "createdAt": "2026-03-28T09:00:00.000Z",
        "isDeleted": false,
        "mediaId": null,
        "metadata": null
      }
    ],
    "meta": {
      "hasMore": true,
      "oldestOffset": 13,
      "newestOffset": 42
    }
  }
}
```

`hasMore: true` nghĩa là còn tin cũ hơn để load thêm. Dùng `meta.oldestOffset` làm giá trị `before` cho request tiếp theo.

---

### POST /chat/messages — Gửi tin nhắn

```bash
# Gửi tin nhắn text thuần
curl -X POST http://localhost:3000/chat/messages \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "conversationId": "conv-uuid-here",
    "content": "Xin chào mọi người trong nhóm!",
    "type": "text",
    "clientMessageId": "client-gen-uuid-v4-001"
  }'
```

```bash
# Gửi tin nhắn kèm file đã upload
curl -X POST http://localhost:3000/chat/messages \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "conversationId": "conv-uuid-here",
    "content": "Đây là file báo cáo tháng 3",
    "type": "file",
    "mediaId": "media-uuid-abc123",
    "clientMessageId": "client-gen-uuid-v4-002"
  }'
```

`clientMessageId` là UUID do client tự tạo, dùng để dedup — nếu mạng timeout nhưng server đã lưu, gửi lại với cùng `clientMessageId` sẽ không tạo tin trùng.

Luồng backend: Gateway → ChatCore (validate quyền) → Kafka `chat.event.message_accepted` → MessageStore (lưu vào DB) → Kafka `chat.event.message_saved` → RealtimeGW (broadcast WebSocket).

---

### POST /chat/pre-check-media — Kiểm tra quyền gửi file trước khi upload

```bash
curl -X POST http://localhost:3000/chat/pre-check-media \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "conversationId": "conv-uuid-here",
    "mimeType": "application/pdf",
    "fileSize": 2097152
  }'
```

Gọi trước khi bắt đầu upload file để kiểm tra: loại file có được phép không, kích thước có vượt giới hạn không, user có đủ quyền không. Tránh upload xong mới bị từ chối, lãng phí thời gian và bandwidth.

Response: `{ "data": { "approved": true } }` hoặc `{ "data": { "approved": false, "reason": "FORBIDDEN_MEDIA_CLASSIFICATION" } }`

---

### PATCH /messages/:id — Chỉnh sửa tin nhắn

```bash
curl -X PATCH "http://localhost:3000/messages/msg-uuid-001" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "content": "Nội dung đã được chỉnh sửa"
  }'
```

Chỉ có thể chỉnh sửa trong **10 phút** kể từ khi gửi. Nếu quá hạn, trả về lỗi `FORBIDDEN_TIME_WINDOW`. Lịch sử chỉnh sửa được lưu đầy đủ để audit.

---

### DELETE /messages/:id — Xóa tin nhắn

```bash
curl -X DELETE "http://localhost:3000/messages/msg-uuid-001" \\
  -H "Authorization: Bearer $TOKEN"
```

Thành viên chỉ có thể xóa tin của mình trong **24 giờ**. ADMIN có thể xóa tin của bất kỳ ai trong 24 giờ (kèm audit log).

---

### POST /messages/:id/pin — Ghim tin nhắn

Chỉ ADMIN hoặc MODERATOR mới có quyền ghim.

```bash
curl -X POST "http://localhost:3000/messages/msg-uuid-001/pin" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "conversationId": "conv-uuid-here" }'
```

Mỗi conversation ghim tối đa 3 tin nhắn.

---

### DELETE /messages/:id/pin — Bỏ ghim tin nhắn

```bash
curl -X DELETE "http://localhost:3000/messages/msg-uuid-001/pin" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "conversationId": "conv-uuid-here" }'
```

---

## 7. Friendships — Kết bạn

### POST /friendships/requests/:targetUserId — Gửi lời mời kết bạn

```bash
curl -X POST "http://localhost:3000/friendships/requests/b2c3d4e5-f6a7-8901-uuid" \\
  -H "Authorization: Bearer $TOKEN"
```

Target user nhận push notification `friend_request`. Không thể gửi lời mời nếu đã bị block.

---

### POST /friendships/requests/:fromUserId/accept — Chấp nhận lời mời

```bash
curl -X POST "http://localhost:3000/friendships/requests/a1b2c3d4-uuid/accept" \\
  -H "Authorization: Bearer $TOKEN"
```

Khi chấp nhận: hệ thống tự động tạo conversation `DIRECT` giữa 2 người nếu chưa có (thông qua Kafka). Cả hai nhận WebSocket event `conversation:member-added`.

---

### POST /friendships/requests/:fromUserId/reject — Từ chối lời mời

```bash
curl -X POST "http://localhost:3000/friendships/requests/a1b2c3d4-uuid/reject" \\
  -H "Authorization: Bearer $TOKEN"
```

---

### GET /friendships/requests — Danh sách lời mời đang chờ

```bash
curl -H "Authorization: Bearer $TOKEN" \\
  http://localhost:3000/friendships/requests
```

Trả về cả lời mời đã gửi (`PENDING_SENT`) và lời mời đã nhận (`PENDING_RECEIVED`).

---

### GET /friendships — Danh sách bạn bè

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/friendships
```

---

### GET /friendships/:targetUserId/status — Trạng thái quan hệ với user

```bash
curl -H "Authorization: Bearer $TOKEN" \\
  "http://localhost:3000/friendships/b2c3d4e5-f6a7-uuid/status"
```

Response các trạng thái: `NONE`, `PENDING_SENT`, `PENDING_RECEIVED`, `FRIENDS`, `BLOCKED`.

---

### DELETE /friendships/:targetUserId — Hủy kết bạn

```bash
curl -X DELETE "http://localhost:3000/friendships/b2c3d4e5-f6a7-uuid" \\
  -H "Authorization: Bearer $TOKEN"
```

---

### POST /friendships/blocks/:targetUserId — Chặn user

```bash
curl -X POST "http://localhost:3000/friendships/blocks/b2c3d4e5-f6a7-uuid" \\
  -H "Authorization: Bearer $TOKEN"
```

Người bị chặn sẽ không gửi được tin nhắn, không gửi được lời mời kết bạn đến bạn.

---

### DELETE /friendships/blocks/:targetUserId — Bỏ chặn user

```bash
curl -X DELETE "http://localhost:3000/friendships/blocks/b2c3d4e5-f6a7-uuid" \\
  -H "Authorization: Bearer $TOKEN"
```

---

## 8. Media — Tải lên file / ảnh / video

Luồng upload 3 bước: **Tạo upload URL → Upload trực tiếp lên MinIO → Báo hoàn tất**.

Client upload thẳng lên MinIO bằng pre-signed URL, không qua Gateway làm proxy file, tiết kiệm bandwidth.

### Bước 1 — POST /media/upload — Khởi tạo upload, lấy pre-signed URL

```bash
# Upload ảnh
curl -X POST http://localhost:3000/media/upload \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "image",
    "mimeType": "image/jpeg",
    "size": 1048576,
    "filename": "avatar.jpg"
  }'
```

```bash
# Upload PDF
curl -X POST http://localhost:3000/media/upload \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "file",
    "mimeType": "application/pdf",
    "size": 2097152,
    "filename": "bao-cao-q1.pdf"
  }'
```

```bash
# Upload video
curl -X POST http://localhost:3000/media/upload \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "video",
    "mimeType": "video/mp4",
    "size": 52428800,
    "filename": "demo.mp4"
  }'
```

Các giá trị `type` hợp lệ: `image`, `video`, `file`. Kích thước tối đa: 2GB (2147483648 bytes).

Response:

```json
{
  "statusCode": 201,
  "data": {
    "mediaId": "media-uuid-abc123",
    "uploadUrl": "http://minio:9000/chat-bucket/media-uuid?X-Amz-Signature=...",
    "expiresAt": "2026-03-28T10:30:00.000Z"
  }
}
```

---

### Bước 2 — Upload file trực tiếp lên MinIO (không qua Gateway)

```bash
curl -X PUT "<uploadUrl từ bước 1>" \\
  -H "Content-Type: image/jpeg" \\
  --data-binary @avatar.jpg
```

Dùng `uploadUrl` nhận được ở bước 1. URL này có chữ ký và hết hạn sau ~30 phút. Không truyền `Authorization` khi upload lên MinIO.

---

### Bước 3 — POST /media/upload/complete — Báo hoàn tất upload

```bash
curl -X POST http://localhost:3000/media/upload/complete \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "mediaId": "media-uuid-abc123",
    "checksum": "sha256:abc123def456...",
    "checksumAlgorithm": "sha256"
  }'
```

Sau bước này, Media Worker bắt đầu scan virus, tạo thumbnail (ảnh), transcode (video). Trạng thái file chuyển từ `UPLOADED` → `PROCESSING` → `READY` (hoặc `FAILED`). Lắng nghe WebSocket event để biết khi file sẵn sàng.

---

### GET /media/:mediaId/url — Lấy URL truy cập file

```bash
# Lấy URL file gốc
curl -H "Authorization: Bearer $TOKEN" \\
  "http://localhost:3000/media/media-uuid-abc123/url?prefer=ORIGINAL"

# Lấy URL đã tối ưu (thumbnail / transcoded)
curl -H "Authorization: Bearer $TOKEN" \\
  "http://localhost:3000/media/media-uuid-abc123/url?prefer=OPTIMIZED&conversationId=conv-uuid"
```

URL trả về là signed URL có thời hạn (thường 1 giờ). Client nên cache URL và chỉ gọi lại khi hết hạn (HTTP 403).

---

### GET /media — Danh sách media của user

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/media
```

---

### DELETE /media/:mediaId — Xóa file

```bash
curl -X DELETE "http://localhost:3000/media/media-uuid-abc123" \\
  -H "Authorization: Bearer $TOKEN"
```

Chỉ chủ sở hữu mới có quyền xóa. File đã gắn vào tin nhắn sẽ không thể xóa (bảo vệ tính toàn vẹn).

---

### POST /media/:mediaId/cross-share — Chia sẻ file sang conversation khác

```bash
curl -X POST "http://localhost:3000/media/media-uuid-abc123/cross-share" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "sourceConversationId": "conv-uuid-source",
    "targetConversationId": "conv-uuid-target"
  }'
```

Chỉ ADMIN mới có quyền cross-share giữa các conversation. File gốc không bị nhân đôi, chỉ tạo reference mới, giữ nguyên phân quyền truy cập.

---

## 9. Notifications — Thông báo & Thiết bị

### GET /notifications/vapid-public-key — Lấy VAPID public key (Web Push)

**Không cần token (Public)**

```bash
curl http://localhost:3000/notifications/vapid-public-key
```

Dùng cho Web Push Notification trên trình duyệt. VAPID key dùng để subscribe push notification từ Service Worker. Gọi 1 lần khi khởi động app.

---

### POST /notifications/devices — Đăng ký thiết bị nhận push notification

```bash
# Thiết bị Android (FCM)
curl -X POST http://localhost:3000/notifications/devices \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "token": "fcm-device-token-from-firebase-sdk",
    "platform": "FCM",
    "deviceId": "android-device-unique-id"
  }'
```

```bash
# Thiết bị iOS (APNS)
curl -X POST http://localhost:3000/notifications/devices \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "token": "apns-device-token-hex-string",
    "platform": "APNS",
    "deviceId": "ios-device-unique-id"
  }'
```

```bash
# Trình duyệt (Web Push)
curl -X POST http://localhost:3000/notifications/devices \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "token": "{\\"endpoint\\":\\"https://fcm.googleapis.com/fcm/send/...\\",\\"keys\\":{\\"p256dh\\":\\"BNcRdreALRFXTkOOUHK1EtK2wtTNMF9EZ...\\",\\"auth\\":\\"tBHItJI5svbpez7KI4CCXg\\"}}",
    "platform": "WEB",
    "deviceId": "browser-subscription-id"
  }'
```

Các platform hợp lệ: `FCM` (Android), `APNS` (iOS), `WEB` (browser). Gọi lại mỗi khi token push thay đổi (token FCM có thể thay đổi sau khi cập nhật app).

---

### DELETE /notifications/devices/:deviceId — Hủy đăng ký thiết bị

```bash
curl -X DELETE "http://localhost:3000/notifications/devices/android-device-unique-id" \\
  -H "Authorization: Bearer $TOKEN"
```

Gọi khi user logout hoặc thu hồi quyền notification để server không gửi push đến thiết bị này nữa.

---

### PUT /notifications/preferences — Cập nhật tùy chọn thông báo

```bash
# Tắt thông báo toàn bộ trong 8 giờ (global, conversationId = null)
curl -X PUT http://localhost:3000/notifications/preferences \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "conversationId": null,
    "muteUntil": "2026-03-28T18:00:00.000Z",
    "notifyOnMessage": false,
    "notifyOnMention": true
  }'
```

```bash
# Tắt thông báo cho một kênh cụ thể
curl -X PUT http://localhost:3000/notifications/preferences \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "conversationId": "conv-uuid-here",
    "muteUntil": "2026-03-30T08:00:00.000Z"
  }'
```

```bash
# Bật giờ yên lặng (quiet hours) — không nhận thông báo ban đêm
curl -X PUT http://localhost:3000/notifications/preferences \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "conversationId": null,
    "quietHoursEnabled": true,
    "quietHoursStart": "22:00",
    "quietHoursEnd": "08:00",
    "timezone": "Asia/Ho_Chi_Minh"
  }'
```

`conversationId: null` = cài đặt toàn cục. Quiet hours không áp dụng cho cuộc gọi đến (priority `high`) và mention quan trọng.

---

### GET /notifications/preferences — Lấy tùy chọn thông báo

```bash
# Lấy cài đặt toàn cục
curl -H "Authorization: Bearer $TOKEN" \\
  http://localhost:3000/notifications/preferences

# Lấy cài đặt cho kênh cụ thể
curl -H "Authorization: Bearer $TOKEN" \\
  "http://localhost:3000/notifications/preferences?conversationId=conv-uuid-here"
```

---

## 10. Presence — Trạng thái trực tuyến

Trạng thái được cập nhật tự động bởi RealtimeGW khi kết nối / ngắt WebSocket. REST API dưới đây chỉ để đọc trạng thái.

### GET /presence/status — Trạng thái của bản thân

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/presence/status
```

Response:

```json
{
  "statusCode": 200,
  "data": {
    "userId": "a1b2c3d4-uuid",
    "status": "online",
    "lastSeen": "2026-03-28T09:55:00.000Z"
  }
}
```

`lastSeen` là thời điểm cuối cùng online, được lưu trong Redis 30 ngày.

---

### GET /presence/friends — Trạng thái của tất cả bạn bè

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/presence/friends
```

Trả về mảng `UserPresence[]` với `userId`, `status` (`online`/`offline`), `lastSeen`. Gọi 1 lần khi mở app, sau đó lắng nghe WebSocket events `user:online` / `user:offline` trong namespace `/chat` để cập nhật realtime.

---

## 11. Calls — Cuộc gọi video/voice

Hệ thống dùng **LiveKit** làm WebRTC media server. Luồng cơ bản: khởi tạo cuộc gọi qua REST → nhận LiveKit token → kết nối LiveKit SDK → nhận sự kiện realtime qua WebSocket `/call`.

Rate limit mỗi endpoint được ghi chú riêng. Endpoint join/leave có giá trị cao (1500/phút) để hỗ trợ reconnect linh hoạt.

### GET /calls/health — Kiểm tra call service

**Không cần token, không giới hạn rate**

```bash
curl http://localhost:3000/calls/health
```

---

### POST /calls/start — Bắt đầu cuộc gọi

**Rate limit: 120 request/phút**

```bash
curl -X POST http://localhost:3000/calls/start \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "conversationId": "conv-uuid-here",
    "allowWaitingRoom": true
  }'
```

Response trả về `meetingId`. Hệ thống gửi Kafka event `call.event.started` → RealtimeGW thông báo các thành viên qua `meeting:started`.

---

### GET /calls/active/:conversationId — Cuộc gọi đang diễn ra trong conversation

**Rate limit: 60 request/phút**

```bash
curl -H "Authorization: Bearer $TOKEN" \\
  "http://localhost:3000/calls/active/conv-uuid-here"
```

---

### GET /calls/me/active — Cuộc gọi đang diễn ra của bản thân

**Rate limit: 120 request/phút**

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/calls/me/active
```

---

### POST /calls/:meetingId/join — Tham gia cuộc gọi

**Rate limit: 1500 request/phút (hỗ trợ reconnect)**

```bash
curl -X POST "http://localhost:3000/calls/meeting-uuid-here/join" \\
  -H "Authorization: Bearer $TOKEN"
```

Nếu host bật `allowWaitingRoom`, user vào phòng chờ và host nhận sự kiện `meeting:join_requested`. Nếu không có waiting room, tham gia ngay.

---

### POST /calls/:meetingId/token — Lấy LiveKit token để kết nối media

**Rate limit: 20 request/phút**

```bash
curl -X POST "http://localhost:3000/calls/meeting-uuid-here/token" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "participantName": "Alice Nguyen",
    "canPublish": true,
    "canSubscribe": true
  }'
```

Gọi sau khi join thành công. Token này dùng với LiveKit Client SDK để publish/subscribe audio và video. Token có thời hạn ngắn, khởi tạo lại khi hết hạn.

---

### POST /calls/:meetingId/waiting/:userId/approve — Duyệt người chờ vào phòng

**Rate limit: 30 request/phút**

```bash
curl -X POST "http://localhost:3000/calls/meeting-uuid-here/waiting/b2c3d4e5-uuid/approve" \\
  -H "Authorization: Bearer $TOKEN"
```

---

### POST /calls/:meetingId/waiting/:userId/reject — Từ chối người chờ

**Rate limit: 30 request/phút**

```bash
curl -X POST "http://localhost:3000/calls/meeting-uuid-here/waiting/b2c3d4e5-uuid/reject" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "reason": "Cuộc họp nội bộ" }'
```

---

### PATCH /calls/:meetingId/media-state — Cập nhật trạng thái mic/camera

**Rate limit: 60 request/phút**

```bash
curl -X PATCH "http://localhost:3000/calls/meeting-uuid-here/media-state" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "micOn": false,
    "cameraOn": true,
    "screenSharing": false
  }'
```

---

### POST /calls/:meetingId/leave — Rời cuộc gọi

**Rate limit: 1500 request/phút (hỗ trợ reconnect)**

```bash
curl -X POST "http://localhost:3000/calls/meeting-uuid-here/leave" \\
  -H "Authorization: Bearer $TOKEN"
```

---

### POST /calls/:meetingId/end — Kết thúc cuộc gọi (host)

**Rate limit: 120 request/phút**

```bash
curl -X POST "http://localhost:3000/calls/meeting-uuid-here/end" \\
  -H "Authorization: Bearer $TOKEN"
```

Kết thúc cuộc gọi cho tất cả mọi người. Chỉ host / OWNER mới có quyền.

---

### POST /calls/:meetingId/participants/:userId/moderate — Kiểm soát người tham gia

**Rate limit: 30 request/phút**

```bash
# Tắt mic của người khác
curl -X POST "http://localhost:3000/calls/meeting-uuid-here/participants/b2c3d4e5-uuid/moderate" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "action": "MUTE_AUDIO",
    "reason": "Nhiễu nền"
  }'
```

```bash
# Kick người tham gia
curl -X POST "http://localhost:3000/calls/meeting-uuid-here/participants/b2c3d4e5-uuid/moderate" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "action": "KICK",
    "reason": "Vi phạm nội quy cuộc họp"
  }'
```

Các action hợp lệ: `MUTE_AUDIO`, `MUTE_VIDEO`, `DISABLE_SCREEN`, `KICK`.

---

### POST /calls/:meetingId/recording/start — Bắt đầu ghi âm/hình

**Rate limit: 20 request/phút**

```bash
curl -X POST "http://localhost:3000/calls/meeting-uuid-here/recording/start" \\
  -H "Authorization: Bearer $TOKEN"
```

---

### POST /calls/:meetingId/recording/pause — Tạm dừng ghi

**Rate limit: 30 request/phút**

```bash
curl -X POST "http://localhost:3000/calls/meeting-uuid-here/recording/pause" \\
  -H "Authorization: Bearer $TOKEN"
```

---

### POST /calls/:meetingId/recording/resume — Tiếp tục ghi

**Rate limit: 30 request/phút**

```bash
curl -X POST "http://localhost:3000/calls/meeting-uuid-here/recording/resume" \\
  -H "Authorization: Bearer $TOKEN"
```

---

### POST /calls/:meetingId/recording/stop — Dừng ghi

**Rate limit: 20 request/phút**

```bash
curl -X POST "http://localhost:3000/calls/meeting-uuid-here/recording/stop" \\
  -H "Authorization: Bearer $TOKEN"
```

---

### GET /calls/:meetingId/recordings — Danh sách bản ghi

**Rate limit: 30 request/phút**

```bash
curl -H "Authorization: Bearer $TOKEN" \\
  "http://localhost:3000/calls/meeting-uuid-here/recordings"
```

---

### GET /calls/history/:conversationId — Lịch sử cuộc gọi

**Rate limit: 30 request/phút**

```bash
curl -H "Authorization: Bearer $TOKEN" \\
  "http://localhost:3000/calls/history/conv-uuid-here?page=1&limit=20"
```

---

### GET /calls/:meetingId/summary — Tóm tắt cuộc gọi

**Rate limit: 30 request/phút**

```bash
curl -H "Authorization: Bearer $TOKEN" \\
  "http://localhost:3000/calls/meeting-uuid-here/summary"
```

---

### GET /calls/:meetingId/snapshot — Snapshot trực tiếp (danh sách người trong phòng)

**Rate limit: 60 request/phút**

```bash
curl -H "Authorization: Bearer $TOKEN" \\
  "http://localhost:3000/calls/meeting-uuid-here/snapshot"
```

---

## 12. WebSocket — Realtime Gateway

**Server**: `ws://localhost:3002`
**Transport**: Socket.IO (hỗ trợ reconnect tự động)
**Namespaces**: `/chat` và `/call` (2 namespace độc lập)
**Authentication**: 2-phase (kết nối → authenticate)

---

### Kết nối và xác thực

Bước 1: Kết nối Socket.IO

```javascript
// Kết nối namespace /chat
const chatSocket = io('ws://localhost:3002/chat', {
  // Truyền token ngay trong auth object (ưu tiên nhất)
  auth: { token: 'Bearer <JWT>' },
  // Hoặc truyền qua query param
  // query: { token: '<JWT>' }
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
});

// Kết nối namespace /call
const callSocket = io('ws://localhost:3002/call', {
  auth: { token: 'Bearer <JWT>' }
});
```

Bước 2: Xác thực (bắt buộc trong 30 giây sau khi kết nối)

```javascript
chatSocket.emit('authenticate', {
  token: '<JWT_TOKEN>',
  deviceId: 'device-unique-id',
  deviceType: 'web'  // 'web' | 'mobile' | 'desktop'
});

chatSocket.on('authenticated', (data) => {
  console.log('Authenticated:', data.userId, data.socketId);
  // Sau bước này: presence = ONLINE, đã join room user:{userId}
});
```

Nếu không xác thực trong 30 giây, server tự động ngắt kết nối.

---

### Namespace `/chat` — Sự kiện từ client gửi lên server

| Event | Payload | Mô tả |
|---|---|---|
| `authenticate` | `{ token, deviceId?, deviceType? }` | Xác thực socket, bắt buộc trước mọi event khác |
| `conversation:join` | `{ conversationId }` | Vào phòng nhận tin realtime |
| `conversation:leave` | `{ conversationId }` | Rời phòng conversation |
| `message:send` | `{ conversationId, content, type?, replyToMessageId?, metadata?, clientMessageId? }` | Gửi tin nhắn qua WebSocket |
| `typing:start` | `{ conversationId }` | Bắt đầu gõ phím (broadcast cho members) |
| `typing:stop` | `{ conversationId }` | Dừng gõ phím |
| `conversation:update_seen_cursor` | `{ conversationId, upToOffset }` | Cập nhật con trỏ đã đọc |
| `conversation:update_delivered_cursor` | `{ conversationId, upToOffset }` | Cập nhật con trỏ đã nhận |
| `message:get_status` | `{ messageId }` | Hỏi trạng thái tin nhắn |
| `heartbeat` | _(không có payload)_ | Giữ kết nối sống, cập nhật presence (gọi mỗi 30s) |

---

### Namespace `/chat` — Sự kiện server broadcast xuống client

| Event | Nguồn | Payload mẫu | Mô tả |
|---|---|---|---|
| `message:new` | Tin nhắn mới | `{ messageId, conversationId, senderId, offset }` | Broadcast cho tất cả người đang join phòng conversation đó |
| `message:saved` | Tin đã lưu (chỉ sender) | `{ messageId, conversationId, offset }` | Xác nhận tin nhắn đã lưu, dùng để map clientMessageId → messageId và lấy offset |
| `message:notify` | Tin nhắn mới (batch 80ms) | `{ conversationId, latestOffset }` | Thông báo cho member không đang active trong phòng — dùng để cập nhật badge unread |
| `message:edited` | Tin bị sửa nội dung | `{ messageId, conversationId, content, editedAt }` | Cập nhật nội dung tin nhắn trong UI |
| `message:deleted` | Tin bị xóa | `{ messageId, conversationId }` | Đánh dấu tin nhắn là đã xóa trong UI |
| `message:updated` | Attachment đổi trạng thái | `{ messageId, conversationId, mediaStatus }` | File xử lý xong — cập nhật trạng thái file trong tin nhắn |
| `message:queued` | Xác nhận nhận sự kiện | `{ clientMessageId, messageId }` | Server nhận được message:send, đã xếp vào hàng xử lý |
| `message:rejected` | ChatCore từ chối | `{ clientMessageId, code, reason }` | Lỗi nghiệp vụ — hiển thị lỗi, xóa optimistic UI |
| `message:error` | Lỗi hệ thống | `{ clientMessageId, error }` | Lỗi kỹ thuật |
| `typing:started` | Ai đó đang gõ | `{ conversationId, userId }` | Broadcast cho cả phòng — hiển thị "đang nhập..." |
| `typing:stopped` | Dừng gõ | `{ conversationId, userId }` | Ẩn chỉ báo "đang nhập..." |
| `user:online` | Bạn bè vừa online | `{ userId }` | Cập nhật trạng thái online trong danh sách bạn bè |
| `user:offline` | Bạn bè vừa offline | `{ userId, lastSeen }` | Cập nhật trạng thái offline và thời điểm cuối hoạt động |
| `conversation:member-added` | Thành viên mới | `{ conversationId, userId, addedBy }` | Cập nhật danh sách thành viên |
| `conversation:member-removed` | Thành viên bị xóa | `{ conversationId, userId, removedBy }` | Xóa khỏi phòng, cập nhật UI |
| `conversation:removed` | Bị xóa khỏi nhóm | `{ conversationId }` | Server force-leave socket — xóa conversation khỏi danh sách |
| `conversation:updated` | Thông tin kênh thay đổi | `{ conversationId, changes, updatedBy?, timestamp? }` | Tên, mô tả, hoặc avatar bị thay đổi — client gọi `GET /conversations/:id` để lấy `avatarUrl` mới (presigned URL không có trong payload) |
| `cursor:seen_updated` | Xác nhận | `{ conversationId, upToOffset }` | Cập nhật seen cursor thành công |
| `cursor:delivered_updated` | Xác nhận | `{ conversationId, upToOffset }` | Cập nhật delivered cursor thành công |
| `heartbeat:ack` | Phản hồi heartbeat | `{ timestamp }` | Xác nhận kết nối vẫn sống |

---

### Namespace `/call` — Sự kiện từ client gửi lên server

| Event | Payload | Rate limit (mỗi socket) | Mô tả |
|---|---|---|---|
| `authenticate` | `{ token }` | — | Xác thực (giống /chat) |
| `meeting:start` | `{ conversationId, allowWaitingRoom? }` | 20 event/10s | Bắt đầu cuộc gọi qua WebSocket |
| `meeting:get_active` | `{ conversationId }` | 20 event/10s | Hỏi cuộc gọi đang diễn ra trong conversation |
| `meeting:join` | `{ conversationId }` | 20 event/10s | Yêu cầu tham gia cuộc gọi |
| `meeting:approve_waiting` | `{ meetingId, userId }` | 20 event/10s | Duyệt người đang chờ vào phòng |
| `meeting:reject_waiting` | `{ meetingId, userId, reason? }` | 20 event/10s | Từ chối người đang chờ |
| `meeting:leave` | `{ meetingId }` | 20 event/10s | Rời cuộc gọi |
| `meeting:end` | `{ meetingId }` | 20 event/10s | Kết thúc cuộc gọi |
| `meeting:media_state` | `{ meetingId, micOn, cameraOn, screenSharing }` | 40 event/10s | Cập nhật trạng thái mic/camera |
| `meeting:snapshot` | `{ meetingId }` | 60 event/10s | Lấy danh sách người đang trong phòng qua WebSocket |
| `meeting:hand_raise` | `{ meetingId, raised }` | 20 event/10s | Giơ tay / hạ tay |
| `meeting:invite` | `{ meetingId, userIds[] }` | 20 event/10s | Mời thêm người |
| `meeting:moderate` | `{ meetingId, targetUserId, action, reason? }` | 20 event/10s | Kiểm soát người tham gia |
| `webrtc:offer` | `{ meetingId, targetUserId, sdp }` | 60 event/10s | WebRTC SDP offer |
| `webrtc:answer` | `{ meetingId, targetUserId, sdp }` | 60 event/10s | WebRTC SDP answer |
| `webrtc:ice_candidate` | `{ meetingId, targetUserId, candidate }` | 300 event/10s | ICE candidate |
| `webrtc:leave` | `{ meetingId, targetUserId }` | 60 event/10s | Thông báo peer rời khỏi kết nối WebRTC |

Khi vượt rate limit: nhận sự kiện `meeting:throttled` (chat) hoặc `webrtc:rejected` (WebRTC).

---

### Namespace `/call` — Sự kiện server broadcast xuống client

| Event | Target | Kafka topic | Mô tả |
|---|---|---|---|
| `meeting:started` | Mỗi member | `call.event.started` | Có cuộc gọi mới trong conversation |
| `meeting:join_requested` | Host | `call.event.join_requested` | Có người xếp hàng chờ vào |
| `meeting:participant_joined` | Phòng meeting | `call.event.participant_joined` | Thành viên mới tham gia |
| `meeting:participant_left` | Phòng meeting | `call.event.participant_left` | Thành viên rời đi |
| `meeting:approved` | User được duyệt | `call.event.waiting_approved` | Được cho vào từ waiting room |
| `meeting:rejected` | User bị từ chối | `call.event.waiting_rejected` | Bị host từ chối |
| `meeting:ended` | Phòng meeting | `call.event.ended` | Cuộc gọi kết thúc |
| `meeting:media_state` | Phòng meeting | `call.event.media_state_updated` | Mic/camera của ai đó thay đổi |
| `meeting:recording_state` | Phòng meeting | `call.event.recording_state_updated` | Trạng thái ghi âm thay đổi |
| `meeting:participant_moderated` | Phòng meeting | `call.event.participant_moderated` | Ai đó bị can thiệp (tắt mic, kick) |
| `meeting:kicked` | User bị kick | `call.event.participant_moderated` | Thông báo riêng cho người bị kick |

---

## 13. Luồng hoạt động chính

### Luồng 1 — Đăng nhập và khởi tạo ứng dụng

```
1. Keycloak login → lấy JWT token + refresh_token
2. Lưu token vào secure storage (Keychain iOS, Keystore Android, sessionStorage Web)
3. GET /me                  → lấy userId, roles từ JWT (nhanh, không query DB)
4. GET /users/me            → lấy profile đầy đủ (settings, avatarUrl)
5. GET /conversations       → hiển thị danh sách cuộc trò chuyện
6. Kết nối WebSocket /chat  → emit 'authenticate' với token
7. Sau 'authenticated':
   - Server tự động set presence = ONLINE
   - Server tự động join room user:{userId}
8. GET /presence/friends    → lấy trạng thái online của bạn bè
9. POST /notifications/devices  → đăng ký thiết bị để nhận push notification
```

---

### Luồng 2 — Mở conversation và đọc tin nhắn

```
1. User click vào conversation (từ danh sách)
2. GET /conversations/:id                     → lấy thông tin kênh
3. socket.emit('conversation:join', ...)       → join phòng nhận tin realtime
4. GET /conversations/:id/messages?limit=30  → load 30 tin mới nhất
5. Hiển thị tin nhắn
6. socket.emit('conversation:update_seen_cursor', { conversationId, upToOffset: newestOffset })
7. Lắng nghe 'message:new' để append tin mới vào cuối list
8. Lắng nghe 'message:notify' để cập nhật badge unread ở conversation khác
9. Lắng nghe 'conversation:updated' — khi nhận, gọi `GET /conversations/:id` để lấy
   thông tin mới (đặc biệt là `avatarUrl` mới nếu avatar vừa đổi)
```

Load more (scroll lên): `GET /conversations/:id/messages?before=<oldestOffset>&limit=30`.

Khi reconnect / re-open app:
```
GET /conversations/:id/messages?after=<lastKnownOffset>&limit=50  → lấy lại tin bị miss
```

---

### Luồng 3 — Gửi tin nhắn text (WebSocket — khuyến nghị)

```
1. Tạo clientMessageId = uuid_v4()
2. Hiển thị tin nhắn ngay lập tức (optimistic UI) với trạng thái "đang gửi"
3. socket.emit('message:send', { conversationId, content, clientMessageId })
4. Server trả về 'message:queued' { clientMessageId, messageId }
   → Cập nhật: "đang gửi" → "đã xếp hàng"
5. Kafka: ChatCore → MessageStore → Kafka event → RealtimeGW
6. Nhận 'message:saved' { messageId, offset }
   → Cập nhật: hiển thị offset, trạng thái "đã gửi"
7. Nếu nhận 'message:rejected' { code, reason }
   → Hiển thị lỗi tương ứng, xóa optimistic UI
```

Fallback (khi WebSocket mất kết nối):
```
POST /chat/messages { conversationId, content, clientMessageId }
Server vẫn broadcast qua Kafka → WebSocket đến tất cả
```

---

### Luồng 4 — Gửi tin nhắn kèm file / ảnh / video

```
1. POST /chat/pre-check-media { conversationId, mimeType, fileSize }
   → Kiểm tra trước (tiết kiệm thời gian nếu bị từ chối)

2. POST /media/upload { type, mimeType, size, filename }
   → Nhận { mediaId, uploadUrl }

3. PUT <uploadUrl> --data-binary @file
   → Upload thẳng lên MinIO (không qua Gateway)

4. POST /media/upload/complete { mediaId }
   → Media Worker bắt đầu scan / xử lý file

5. Hiển thị placeholder "Đang xử lý file..."

6. POST /chat/messages { conversationId, content, mediaId, clientMessageId }
   → Gửi tin nhắn (có thể gửi ngay cả khi file còn PROCESSING)

7. Lắng nghe 'message:updated' khi field mediaStatus = READY
   → Tự động cập nhật UI hiển thị file thực sự
```

---

### Luồng 5 — Nhận tin nhắn realtime

```
Tier 1 — Khi đang mở conversation đó:
  Nhận 'message:new' { messageId, conversationId, senderId, offset }
  → Append tin nhắn vào cuối chat list
  → emit 'conversation:update_seen_cursor' { conversationId, upToOffset: offset }

Tier 2 — Khi đang ở màn hình khác hoặc app background:
  Nhận 'message:notify' { conversationId, latestOffset }
  → Cập nhật badge unread count trên list
  → Tùy ý: fetch snippet tin để hiển thị preview
```

---

### Luồng 6 — Nhận push notification (app nền / tắt app)

```
Notification Service lắng nghe Kafka MESSAGE_SAVED:
1. Lấy danh sách member từ Redis
2. Bỏ qua sender
3. Bỏ qua user đang ONLINE (kiểm tra Redis presence)
4. Kiểm tra quiet hours / mute preferences
5. Dedup 30s (tránh gửi trùng)
6. Gửi push qua FCM / APNS / Web Push

Payload push notification:
{
  "title": "Nguyễn Văn A",
  "body": "Xin chào mọi người...",
  "data": {
    "type": "new_message",
    "conversationId": "conv-uuid",
    "messageId": "msg-uuid"
  }
}

FE/Mobile xử lý:
- Tap vào notification → mở app → navigate đến conversation tương ứng
- Dùng conversationId để deep link chính xác
```

---

### Luồng 7 — Kết bạn và tạo chat trực tiếp

```
1. POST /friendships/requests/:targetUserId  → gửi lời mời
2. targetUser nhận push notification 'type: friend_request'
3. targetUser: POST /friendships/requests/:fromUserId/accept
   → Hệ thống tự tạo conversation DIRECT qua Kafka
4. Cả hai nhận WebSocket event 'conversation:member-added'
5. GET /conversations → refresh list, thấy conversation DIRECT mới
6. Mở conversation, bắt đầu nhắn tin
```

---

### Luồng 8 — Cuộc gọi video/voice

```
1. Host: POST /calls/start { conversationId, allowWaitingRoom: true }
   → Nhận { meetingId }

2. Members nhận WebSocket 'meeting:started' { meetingId, conversationId, hostId }
   → Hiển thị popup "Cuộc gọi đang đến từ [tên nhóm]"

3. Member muốn tham gia:
   POST /calls/:meetingId/join
   → Nếu waiting room: nhận { status: 'waiting' }
   → Nếu không: nhận { status: 'joined' }

4. Nếu waiting room:
   - Host nhận socket 'meeting:join_requested' { userId, meetingId }
   - Host approve: POST /calls/:meetingId/waiting/:userId/approve
   - Member nhận socket 'meeting:approved'

5. Lấy LiveKit token:
   POST /calls/:meetingId/token { canPublish: true, canSubscribe: true }
   → Nhận { livekitToken, livekitUrl }
   → Khởi tạo LiveKit Room SDK: new Room().connect(livekitUrl, livekitToken)

6. Trong cuộc gọi:
   - PATCH /calls/:meetingId/media-state khi bật/tắt mic/camera
   - Members nhận 'meeting:media_state' cập nhật trạng thái

7. Kết thúc:
   - Member: POST /calls/:meetingId/leave
   - Host: POST /calls/:meetingId/end (kết thúc cho tất cả)
   - Tất cả nhận 'meeting:ended'
```

---

### Luồng 9 — Xử lý mất kết nối WebSocket

```
Khi socket disconnect:
1. Server giữ grace period 10s cho presence
2. Nếu reconnect trong 10s: presence vẫn ONLINE
3. Nếu không reconnect: presence → OFFLINE

Khi client reconnect (Socket.IO tự động retry):
1. Socket.IO re-connect tự động (exponential backoff)
2. emit 'authenticate' lại với token (refresh nếu cần)
3. Sau 'authenticated':
   - Re-join các conversation đang mở: emit 'conversation:join' mỗi conversationId
   - Fetch tin nhắn bị miss: GET /conversations/:id/messages?after=<lastOffset>&limit=50
   - emit 'conversation:update_delivered_cursor' với offset mới nhất
4. Tiếp tục như bình thường
```

Lưu ý quan trọng: Socket.IO có cơ chế reconnect tự động. Chỉ cần xử lý sự kiện `connect` (lần đầu) và `reconnect` (sau khi mất kết nối) để re-authenticate và re-join các phòng.

---

### Luồng 10 — Quên mật khẩu và đặt lại qua OTP email

```
1. User không đăng nhập được, nhấn "Quên mật khẩu"

2. Client: POST /auth/forgot-password { email }
   → Server luôn trả 200 (không tiết lộ email có tồn tại hay không)
   → Nếu email tồn tại: gửi email có OTP 6 số (hiệu lực 10 phút)

3. User mở email, lấy mã OTP (ví dụ: 482951)

4. Client: POST /auth/reset-password { email, otp, newPassword }
   → OTP đúng + chưa hết hạn + chưa dùng: đặt lại mật khẩu thành công
   → Tất cả phiên đăng nhập cũ bị thu hồi ngay lập tức

5. Client: Keycloak login với mật khẩu mới → lấy token mới
```

Sơ đồ lỗi:
```
Email không đúng định dạng        → 400 Bad Request
Gửi quá 5 lần / 15 phút          → 429 Too Many Requests
Gửi lại trước 60 giây            → 429 Too Many Requests
OTP sai lần 1, 2, 3              → 400 (generic - không tiết lộ lý do)
OTP sai lần 4 (quá 3 lần)        → 400 + XÓA OTP (phải yêu cầu OTP mới)
OTP đúng nhưng đã dùng rồi       → 400 (race condition protection)
newPassword yếu                  → 400 Bad Request
```

---

### Luồng 11 — Đổi mật khẩu (đang đăng nhập)

```
1. User muốn đổi mật khẩu (trong Settings)

2. Client: POST /users/me/change-password
   {
     "currentPassword": "OldPass@2025",
     "newPassword": "NewPass@2026"
   }
   Header: Authorization: Bearer <token>

3. Server xác minh currentPassword với Keycloak (ROPC grant)
   → Sai: 401 Unauthorized, dừng

4. Server đặt newPassword qua Keycloak Admin API
5. Server thu hồi TẤT CẢ phiên đăng nhập (logout toàn bộ thiết bị)
6. Client nhận 200: "Mật khẩu đã được đổi thành công. Vui lòng đăng nhập lại."

7. Client xóa token cũ → redirect đến màn hình đăng nhập
```

> **Lưu ý UX**: Sau bước 6, token hiện tại cũng bị vô hiệu hóa. Client phải redirect đến trang đăng nhập.

---

### Bảng tổng hợp toàn bộ endpoint

| Module | Method | Path | Auth | Mô tả |
|---|---|---|---|---|
| Health | GET | `/` | Public | Ping |
| Health | GET | `/health` | Public | Trạng thái gateway |
| Health | GET | `/health/circuit-breakers` | Public | Circuit breaker status |
| Auth | GET | `/me` | JWT | Thông tin user từ JWT |
| Auth | GET | `/admin` | JWT + admin | Kiểm tra quyền admin |
| Auth | POST | `/auth/forgot-password` | Public | Gửi OTP đặt lại mật khẩu |
| Auth | POST | `/auth/reset-password` | Public | Đặt lại mật khẩu bằng OTP |
| Users | GET | `/users` | JWT | Danh sách user |
| Users | GET | `/users/me` | JWT | Profile bản thân |
| Users | PUT | `/users/me` | JWT | Cập nhật profile |
| Users | GET | `/users/search` | JWT | Tìm kiếm user |
| Users | GET | `/users/:id` | JWT | Xem user |
| Users | POST | `/users/me/change-password` | JWT | Đổi mật khẩu (có xác minh hiện tại) |
| Conversations | GET | `/conversations/health/outbox` | Public | Outbox health |
| Conversations | GET | `/conversations` | JWT | Danh sách conversation |
| Conversations | POST | `/conversations` | JWT | Tạo conversation |
| Conversations | GET | `/conversations/:id` | JWT | Chi tiết conversation |
| Conversations | PATCH | `/conversations/:id/info` | JWT | Cập nhật thông tin |
| Conversations | POST | `/conversations/:id/members` | JWT | Thêm thành viên |
| Conversations | DELETE | `/conversations/:id/members` | JWT | Xóa thành viên |
| Conversations | GET | `/conversations/:id/members` | JWT | Danh sách thành viên |
| Conversations | PATCH | `/conversations/:id/members/:userId/role` | JWT | Đổi role thành viên |
| Conversations | GET | `/conversations/:id/unread` | JWT | Số tin chưa đọc |
| Conversations | PATCH | `/conversations/:id/offset` | JWT | Cập nhật read cursor |
| Conversations | GET | `/conversations/:id/pinned` | JWT | Tin nhắn được ghim |
| Conversations | GET | `/conversations/:id/messages` | JWT | Lấy tin nhắn |
| Chat | POST | `/chat/messages` | JWT | Gửi tin nhắn |
| Chat | POST | `/chat/pre-check-media` | JWT | Kiểm tra trước khi upload |
| Messages | PATCH | `/messages/:id` | JWT | Sửa tin nhắn |
| Messages | DELETE | `/messages/:id` | JWT | Xóa tin nhắn |
| Messages | POST | `/messages/:id/pin` | JWT | Ghim tin nhắn |
| Messages | DELETE | `/messages/:id/pin` | JWT | Bỏ ghim tin nhắn |
| Friendships | POST | `/friendships/requests/:targetUserId` | JWT | Gửi lời mời |
| Friendships | POST | `/friendships/requests/:fromUserId/accept` | JWT | Chấp nhận |
| Friendships | POST | `/friendships/requests/:fromUserId/reject` | JWT | Từ chối |
| Friendships | GET | `/friendships/requests` | JWT | Danh sách lời mời |
| Friendships | GET | `/friendships` | JWT | Danh sách bạn bè |
| Friendships | GET | `/friendships/:targetUserId/status` | JWT | Trạng thái quan hệ |
| Friendships | DELETE | `/friendships/:targetUserId` | JWT | Hủy kết bạn |
| Friendships | POST | `/friendships/blocks/:targetUserId` | JWT | Chặn user |
| Friendships | DELETE | `/friendships/blocks/:targetUserId` | JWT | Bỏ chặn user |
| Media | POST | `/media/upload` | JWT | Khởi tạo upload |
| Media | POST | `/media/upload/complete` | JWT | Báo hoàn tất upload |
| Media | GET | `/media` | JWT | Danh sách media |
| Media | GET | `/media/:mediaId/url` | JWT | Lấy URL truy cập |
| Media | DELETE | `/media/:mediaId` | JWT | Xóa file |
| Media | POST | `/media/:mediaId/cross-share` | JWT | Chia sẻ file |
| Notifications | GET | `/notifications/vapid-public-key` | Public | VAPID key |
| Notifications | POST | `/notifications/devices` | JWT | Đăng ký thiết bị |
| Notifications | DELETE | `/notifications/devices/:deviceId` | JWT | Hủy đăng ký thiết bị |
| Notifications | PUT | `/notifications/preferences` | JWT | Cập nhật tùy chọn |
| Notifications | GET | `/notifications/preferences` | JWT | Lấy tùy chọn |
| Presence | GET | `/presence/status` | JWT | Trạng thái bản thân |
| Presence | GET | `/presence/friends` | JWT | Trạng thái bạn bè |
| Calls | GET | `/calls/health` | Public | Health check |
| Calls | POST | `/calls/start` | JWT | Bắt đầu cuộc gọi |
| Calls | GET | `/calls/active/:conversationId` | JWT | Cuộc gọi đang diễn ra |
| Calls | GET | `/calls/me/active` | JWT | Cuộc gọi của bản thân |
| Calls | POST | `/calls/:meetingId/join` | JWT | Tham gia cuộc gọi |
| Calls | POST | `/calls/:meetingId/token` | JWT | Lấy LiveKit token |
| Calls | POST | `/calls/:meetingId/waiting/:userId/approve` | JWT | Duyệt người chờ |
| Calls | POST | `/calls/:meetingId/waiting/:userId/reject` | JWT | Từ chối người chờ |
| Calls | PATCH | `/calls/:meetingId/media-state` | JWT | Cập nhật media state |
| Calls | POST | `/calls/:meetingId/leave` | JWT | Rời cuộc gọi |
| Calls | POST | `/calls/:meetingId/end` | JWT | Kết thúc cuộc gọi |
| Calls | POST | `/calls/:meetingId/participants/:userId/moderate` | JWT | Kiểm soát người tham gia |
| Calls | POST | `/calls/:meetingId/recording/start` | JWT | Bắt đầu ghi |
| Calls | POST | `/calls/:meetingId/recording/pause` | JWT | Tạm dừng ghi |
| Calls | POST | `/calls/:meetingId/recording/resume` | JWT | Tiếp tục ghi |
| Calls | POST | `/calls/:meetingId/recording/stop` | JWT | Dừng ghi |
| Calls | GET | `/calls/:meetingId/recordings` | JWT | Danh sách bản ghi |
| Calls | GET | `/calls/history/:conversationId` | JWT | Lịch sử cuộc gọi |
| Calls | GET | `/calls/:meetingId/summary` | JWT | Tóm tắt cuộc gọi |
| Calls | GET | `/calls/:meetingId/snapshot` | JWT | Snapshot phòng họp |
