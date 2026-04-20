# Auth API Reference

> **Base URL**: `https://api.bcn.id.vn` (hoặc `http://localhost:3000` khi dev local)
>
> Tất cả request/response đều là `Content-Type: application/json`.
> Đặt `X-Client-Platform: web` hoặc `X-Client-Platform: mobile` cho tất cả các request.

---

## Mục lục

1. [Đăng ký (3 bước)](#1-đăng-ký-3-bước)
2. [Đăng nhập](#2-đăng-nhập)
3. [Refresh Token](#3-refresh-token)
4. [Đăng xuất](#4-đăng-xuất)
5. [Quên mật khẩu (3 bước)](#5-quên-mật-khẩu)
6. [Luồng FE](#6-luồng-fe)
7. [WebSocket Session Revocation](#7-websocket-session-revocation)
8. [Xử lý lỗi chuẩn](#8-xử-lý-lỗi-chuẩn)
9. [Kiến trúc Session Guard](#9-kiến-trúc-session-guard)

---

## Ràng buộc chung (Email)

> **Tất cả endpoint nhận email** đều áp dụng thêm ràng buộc sau (bên cạnh format hợp lệ):
>
> - Chỉ chấp nhận địa chỉ **Gmail** (kết thúc bằng `@gmail.com`, case-insensitive).
> - Giá trị được **normalize** tự động: trim + lowercase trước khi validate và lưu trữ.
> - Ví dụ hợp lệ: `nguyen.van.a@gmail.com`, `User@GMAIL.COM` → lưu thành `user@gmail.com`
> - Ví dụ không hợp lệ: `user@yahoo.com`, `user@outlook.com` → `400 VALIDATION_FAILED`

---

## 1. Đăng ký (3 bước)

### Step 1 — Khởi tạo đăng ký

```
POST /auth/register/init
```

**Request:**
```bash
curl -X POST https://api.bcn.id.vn/auth/register/init \
  -H "Content-Type: application/json" \
  -H "X-Client-Platform: web" \
  -d '{
    "email": "nguyen.van.a@gmail.com",
    "firstName": "Nguyễn",
    "lastName": "Hùng"
  }'
```

**Validation:**
| Field | Rule |
|-------|------|
| `email` | Valid email, **phải là Gmail** (`@gmail.com`), unique (kiểm tra Keycloak) |
| `firstName` | 1–20 ký tự, cho phép tên tiếng Việt có dấu |
| `lastName` | 1–20 ký tự, cho phép tên tiếng Việt có dấu |

> `username` hiển thị sẽ được hệ thống tự sinh từ `firstName + " " + lastName`.

**Response `200`:**
```json
{
  "cooldownSeconds": 60
}
```

**Errors:**
| HTTP | Code | Khi nào |
|------|------|---------|
| `400` | `VALIDATION_FAILED` | Email không phải Gmail, firstName/lastName invalid |
| `409` | `RESOURCE_ALREADY_EXISTS` | Email đã được đăng ký |
| `429` | `RATE_LIMIT_EXCEEDED` | Rate limit: 5 lần / 15 phút / email |

---

### Step 2 — Xác minh OTP đăng ký

```
POST /auth/register/verify-otp
```

**Request:**
```bash
curl -X POST https://api.bcn.id.vn/auth/register/verify-otp \
  -H "Content-Type: application/json" \
  -H "X-Client-Platform: web" \
  -d '{
    "email": "nguyen.van.a@gmail.com",
    "otp": "847193"
  }'
```

**Validation:**
| Field | Rule |
|-------|------|
| `email` | **Phải là Gmail**, khớp email ở Step 1 |
| `otp` | Đúng 6 chữ số |

**OTP details:**
- 6 chữ số ngẫu nhiên, ký bằng HMAC.
- TTL: **10 phút** kể từ lúc gửi. One-time use. **Max 3 lần sai** → OTP bị xóa.

**Response `200`:**
```json
{
  "registrationToken": "550e8400-e29b-41d4-a716-446655440000",
  "expiresIn": 600
}
```

> `registrationToken` là UUID v4, TTL **10 phút**. Hết hạn → phải làm lại từ Step 1.

**Errors:**
| HTTP | Code | Khi nào |
|------|------|---------|
| `400` | `VALIDATION_FAILED` | Email không phải Gmail |
| `400` | `OTP_INVALID` | OTP sai (kèm còn N lần thử) |
| `400` | `OTP_EXPIRED` | OTP đã hết hạn |
| `400` | `OTP_ALREADY_USED` | OTP đã được sử dụng |
| `400` | `OTP_MAX_ATTEMPTS` | Quá 3 lần sai → phải restart từ Step 1 |

---

### Step 3 — Hoàn tất đăng ký

```
POST /auth/register/complete
```

**Request:**
```bash
curl -X POST https://api.bcn.id.vn/auth/register/complete \
  -H "Content-Type: application/json" \
  -H "X-Client-Platform: web" \
  -d '{
    "registrationToken": "550e8400-e29b-41d4-a716-446655440000",
    "password": "MySecure@123",
    "platform": "web",
    "deviceInfo": {
      "deviceName": "Chrome on Windows"
    }
  }'
```

**Validation:**
| Field | Rule |
|-------|------|
| `registrationToken` | UUID v4 từ Step 2, còn hạn |
| `password` | Min 8 ký tự, bao gồm chữ hoa, chữ thường, số và ký tự đặc biệt (`!@#$%^&*`) |
| `platform` | `"web"` hoặc `"mobile"` |
| `deviceInfo` | Optional |

**Response `200`:**
```json
{
  "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 300
}
```

> Tài khoản tạo trong Keycloak + users-service. Nếu users-service lỗi → Keycloak user tự động bị xoá (Saga-lite rollback) và trả về `500`.

**Errors:**
| HTTP | Code | Khi nào |
|------|------|---------|
| `400` | `VALIDATION_FAILED` | `registrationToken` hết hạn hoặc không hợp lệ |
| `409` | `RESOURCE_ALREADY_EXISTS` | Email đã tồn tại trong Keycloak (race condition) |
| `500` | `INTERNAL_SERVER_ERROR` | users-service lỗi (sau rollback Keycloak) |

---

## 2. Đăng nhập

```
POST /auth/login
```

> Chỉ hỗ trợ đăng nhập bằng `email` + `password`. **Chỉ chấp nhận Gmail**.

**Request:**
```bash
curl -X POST https://api.bcn.id.vn/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Client-Platform: web" \
  -d '{
    "email": "nguyen.van.a@gmail.com",
    "password": "MySecure@123",
    "platform": "web",
    "deviceInfo": {
      "deviceName": "Chrome on Windows"
    }
  }'
```

**Validation:**
| Field | Rule |
|-------|------|
| `email` | Valid email, **phải là Gmail** (`@gmail.com`) |
| `password` | String, non-empty |
| `platform` | `"web"` hoặc `"mobile"` |
| `deviceInfo` | Optional |

**Response `200`:**
```json
{
  "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 300
}
```

**Session 1-per-platform — quy trình kick session cũ (theo thứ tự):**
1. `deleteSession(Redis)` → thiết bị cũ bị `SessionGuard` từ chối ngay lập tức.
2. `SessionCacheService.invalidate(userId, platform)` → in-memory cache không còn phục vụ SID cũ.
3. `publishRevocation(channel)` → `realtime-gateway` disconnect WebSocket thiết bị cũ.
4. `revokeKeycloakSession()` (non-fatal: nếu đã hết hạn thì bỏ qua).
5. Tạo session mới cho thiết bị hiện tại.

**Errors:**
| HTTP | Code | Khi nào |
|------|------|---------|
| `400` | `VALIDATION_FAILED` | Email không phải Gmail |
| `401` | `AUTH_INVALID_CREDENTIALS` | Sai email/mật khẩu |
| `429` | `RATE_LIMIT_EXCEEDED` | Rate limit |

---

## 3. Refresh Token

```
POST /auth/refresh
```

**Request:**
```bash
curl -X POST https://api.bcn.id.vn/auth/refresh \
  -H "Content-Type: application/json" \
  -H "X-Client-Platform: web" \
  -d '{
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }'
```

**Response `200`:**
```json
{
  "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...<new>",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...<new>",
  "expiresIn": 300
}
```

**SID Validation — bảo vệ chống session cũ tái chiếm slot:**

`session_state` / `sid` trong JWT Keycloak là ID của SSO session và **không thay đổi** giữa các lần refresh trong cùng một phiên. Khi refresh:
- **SID khớp Redis** → `resetTTL`, trả về tokens mới.
- **SID không khớp** → `401 SESSION_REVOKED` ngay lập tức (refresh token thuộc về phiên đã bị thu hồi).

**Errors:**
| HTTP | Code | Khi nào |
|------|------|---------|
| `401` | `AUTH_INVALID_TOKEN` | `refreshToken` hết hạn hoặc không hợp lệ |
| `401` | `SESSION_REVOKED` | SID mismatch — thiết bị B đã đăng nhập, session này đã bị thu hồi |
| `401` | `SESSION_NOT_FOUND` | Session không còn trong Redis |

---

## 4. Đăng xuất

```
POST /auth/logout
```

**Request:**
```bash
curl -X POST https://api.bcn.id.vn/auth/logout \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "X-Client-Platform: web"
```

**Response `200`:**
```json
{
  "message": "Logged out successfully."
}
```

**Quy trình logout:**
1. `deleteSession(Redis)`.
2. `SessionCacheService.invalidate(userId, platform)`.
3. `publishRevocation(channel)` → `realtime-gateway` disconnect WebSocket.
4. `revokeKeycloakSession()`.

---

## 5. Quên mật khẩu

Luồng **3 bước**: gửi OTP → xác minh OTP → đặt mật khẩu mới.

### Step 1 — Gửi OTP reset

```
POST /auth/forgot-password
```

**Request:**
```bash
curl -X POST https://api.bcn.id.vn/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{ "email": "nguyen.van.a@gmail.com" }'
```

**Validation:**
| Field | Rule |
|-------|------|
| `email` | Valid email, **phải là Gmail** (`@gmail.com`) |

**Response `200`:**
```json
{
  "message": "OTP code has been sent to your email. Please check your inbox."
}
```

> OTP **6 chữ số**, TTL **10 phút**, gửi qua email (fire-and-forget).

**Errors:**
| HTTP | Code | Khi nào |
|------|------|---------|
| `400` | `VALIDATION_FAILED` | Email không phải Gmail / không hợp lệ |
| `404` | `USER_NOT_FOUND` | Email chưa đăng ký |
| `429` | `RATE_LIMIT_EXCEEDED` | Rate limit: 5 lần / 15 phút / email |
| `429` | `OTP_COOLDOWN` | Cooldown: phải đợi 60 giây giữa các lần yêu cầu |

---

### Step 2 — Xác minh OTP reset

```
POST /auth/verify-otp
```

**Request:**
```bash
curl -X POST https://api.bcn.id.vn/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "nguyen.van.a@gmail.com",
    "otp": "193847"
  }'
```

**Validation:**
| Field | Rule |
|-------|------|
| `email` | **Phải là Gmail**, khớp email ở Step 1 |
| `otp` | Đúng 6 chữ số |

**Response `200`:**
```json
{
  "resetToken": "550e8400-e29b-41d4-a716-446655440000",
  "expiresIn": 600
}
```

> `resetToken` là UUID v4, TTL **10 phút**. One-time use.

**Errors:**
| HTTP | Code | Khi nào |
|------|------|---------|
| `400` | `VALIDATION_FAILED` | Email không phải Gmail |
| `400` | `OTP_INVALID` | OTP sai hoặc đã hết hạn |
| `400` | `OTP_ALREADY_USED` | OTP đã được sử dụng |
| `400` | `OTP_MAX_ATTEMPTS` | Quá 3 lần sai → phải yêu cầu mã mới |

---

### Step 3 — Đặt mật khẩu mới

```
POST /auth/reset-password
```

**Request:**
```bash
curl -X POST https://api.bcn.id.vn/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "resetToken": "550e8400-e29b-41d4-a716-446655440000",
    "newPassword": "NewSecure@456"
  }'
```

**Validation:**
| Field | Rule |
|-------|------|
| `resetToken` | UUID v4, còn hạn (max 10 phút), chỉ dùng một lần |
| `newPassword` | Min 8 ký tự, bao gồm chữ hoa, chữ thường, số và ký tự đặc biệt (`!@#$%^&*`) |

**Response `200`:**
```json
{
  "message": "Mật khẩu đã được đặt lại thành công. Vui lòng đăng nhập lại."
}
```

> Toàn bộ Keycloak session bị thu hồi sau khi đặt lại. FE cần xóa tokens và redirect về login.

**Errors:**
| HTTP | Code | Khi nào |
|------|------|---------|
| `400` | `VALIDATION_FAILED` | `resetToken` không hợp lệ / hết hạn / đã dùng |
| `400` | `PASSWORD_POLICY_VIOLATION` | `newPassword` không đúng chính sách |
| `500` | `INTERNAL_SERVER_ERROR` | Lỗi khi cập nhật Keycloak |

---

## 6. Luồng FE

### 6.1 Luồng Đăng ký

```
FE                              API (Gateway)               External
 |                                   |                          |
 |-- POST /auth/register/init ------>|                          |
 |   { email(@gmail.com),            |-- check Keycloak ------->|
 |     firstName, lastName }         |<-- 200 unique ------------|
 |                                   |-- store Redis (init+OTP) |
 |                                   |-- TCP -> notification --> email OTP
 |<-- { cooldownSeconds: 60 } -------|                          |
 |                                   |                          |
 |  [User nhập OTP từ email]          |                          |
 |                                   |                          |
 |-- POST /auth/register/verify-otp->|                          |
 |   { email, otp }                  |-- HMAC compare           |
 |                                   |-- incrementAttempts      |
 |                                   |-- one-time lock          |
 |<-- { registrationToken, 600s } ---|                          |
 |                                   |                          |
 |  [User nhập mật khẩu]             |                          |
 |                                   |                          |
 |-- POST /auth/register/complete -->|                          |
 |   { registrationToken, password,  |-- createUser Keycloak -->|
 |     platform, deviceInfo? }       |-- TCP CREATE_USER ------> users-service
 |                                   |   [fail → deleteUser Keycloak (rollback)]
 |                                   |-- login auto (Keycloak)  |
 |                                   |-- store Redis session    |
 |<-- { accessToken, refreshToken } -|                          |
```

**FE cần làm:**
1. **Lưu** `registrationToken` ở `sessionStorage` (không localStorage).
2. **Bước 2**: hiện "Resend OTP" sau 60s (dùng `cooldownSeconds`).
3. **Bước 3**: Nếu `409` → redirect về login. Nếu `400 registrationToken` hết hạn → restart từ đầu.

---

### 6.2 Luồng Đăng nhập

```
FE                              Gateway                     Redis / Keycloak
 |                                  |                             |
 |-- POST /auth/login -------------->|                             |
 |   { email(@gmail.com), password,  |-- POST /token (passwd) ---->|
 |     platform: "web" }             |<-- { access_token, ... } ---|
 |                                  |-- decode JWT (userId, sid)   |
 |                                  |-- getSession(userId, "web")  |
 |                                  |                              |
 |                                  |  [session cũ tồn tại]        |
 |                                  |   1. deleteSession(Redis)   |
 |                                  |   2. invalidate SessionCache|
 |                                  |   3. publishRevocation(WS)  |
 |                                  |   4. revokeKeycloak(non-fatal)
 |                                  |                              |
 |                                  |-- createSession(userId,      |
 |                                  |     "web", newSid)          |
 |<-- { accessToken, refreshToken }--|                             |
```

---

### 6.3 Luồng Refresh Token (Token Rotation)

```
FE                              Gateway                    Redis
 |                                 |                         |
 | [accessToken sắp hết hạn]       |                         |
 |-- POST /auth/refresh ----------->|                         |
 |   Header: X-Client-Platform: web |                         |
 |   { refreshToken }               |-- POST /token refresh ->Keycloak
 |                                  |<-- new tokens           |
 |                                  |-- decode newSid         |
 |                                  |-- getSession(userId, p) |
 |                                  |   SID khớp → resetTTL  |
 |                                  |   SID lệch → 401 SESSION_REVOKED
 |<-- { accessToken, refreshToken } |                         |
```

**FE cần làm:**
1. **Interceptor**: `401 AUTH_TOKEN_EXPIRED` → gọi `/auth/refresh` → retry.
2. `/auth/refresh` trả `401 SESSION_REVOKED` hoặc `SESSION_NOT_FOUND` → xoá tokens, redirect login.
3. **Refresh lock pattern**: tránh nhiều request đồng thời gọi refresh.

---

### 6.4 Luồng Đăng xuất

```
FE                              Gateway                    Redis
 |                                 |                         |
 |-- POST /auth/logout ------------>|                         |
 |   Authorization: Bearer ...      |                         |
 |   X-Client-Platform: web         |                         |
 |                                 |-- deleteSession(Redis)  |
 |                                 |-- invalidate SessionCache
 |                                 |-- publishRevocation     |
 |                                 |-- revokeKeycloak        |
 |<-- { message: "Đăng xuất..." }--|                         |
 | [Xoá tokens, disconnect WS]     |                         |
```

---

### 6.5 Luồng Session Bị Thu Hồi

```
Device A (đang dùng)      Gateway           Device B (đăng nhập mới)
      |                      |                        |
      |  [đang online]        |                        |
      |                      |<-- POST /auth/login ----|
      |                      |    { platform: "web" }  |
      |                      | 1. deleteSession(Redis) |
      |                      | 2. invalidate SessionCache
      |                      | 3. publishRevocation    |
      |                      | 4. revokeKeycloak       |
      |                      | 5. createSession(B)     |
      |                      |<-- 200 tokens ----------|
      |                      |                        |
realtime-gateway: nhận Redis channel
      |<-- WS event: session_revoked --
      |  { reason: "logged_in_elsewhere" }
      |
  [Xoá tokens, redirect /login]
```

> **Quan trọng**: Ngay sau bước 1, mọi request của Device A bị `SessionGuard` từ chối `401 SESSION_REVOKED`.

---

### 6.6 Luồng Quên Mật Khẩu

```
FE                              Gateway                   Redis / Keycloak / Email
 |                                  |                              |
 |-- POST /auth/forgot-password ---->|                              |
 |   { email(@gmail.com) }          |-- lookup Keycloak user ----->|
 |                                  |<-- userId found --------------|
 |                                  |-- checkRateLimit (5/15min)   |
 |                                  |-- checkCooldown (60s)        |
 |                                  |-- storeOtp(Redis, TTL 10min) |
 |                                  |-- TCP -> notification ------> email OTP
 |<-- { message } ------------------|                              |
 |                                  |                              |
 |-- POST /auth/verify-otp --------->|                              |
 |   { email, otp }                 |-- getOtp(Redis)              |
 |                                  |-- incrementAttempts (max 3)  |
 |                                  |-- verifyHMAC                 |
 |                                  |-- one-time lock              |
 |                                  |-- storeResetToken(UUID, 10m) |
 |                                  |-- deleteOtp                  |
 |<-- { resetToken, expiresIn:600 }--|                              |
 |                                  |                              |
 |-- POST /auth/reset-password ------>|                              |
 |   { resetToken, newPassword }    |-- getAndDeleteResetToken     |
 |                                  |-- setUserPassword(Keycloak)->|
 |                                  |-- revokeAllSessions -------->|
 |<-- { message } ------------------|                              |
 | [Xoá tokens, redirect /login]    |                              |
```

**FE cần làm:**
1. Lưu `resetToken` ở `sessionStorage`.
2. Sau 3 lần sai OTP → gọi lại Step 1. Hiện "Gửi lại OTP" sau 60 giây.
3. `400 resetToken hết hạn` → redirect Step 1. Thành công → xóa tokens, redirect `/login`.

---

## 7. WebSocket Session Revocation

```javascript
const socket = io('wss://api.bcn.id.vn', {
  path: '/socket.io',
  transports: ['websocket'],
});

socket.on('connect', () => {
  socket.emit('authenticate', {
    token: accessToken,
    platform: 'web', // hoặc 'mobile'
  });
});

socket.on('session_revoked', (data) => {
  // data = { reason: 'logged_in_elsewhere' | 'manual_logout' }
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  socket.disconnect();
  showNotification('Tài khoản đã đăng nhập từ thiết bị khác.');
  router.push('/login');
});

socket.on('disconnect', (reason) => {
  if (reason === 'io server side') {
    // Server chủ động disconnect
  }
});
```

---

## 8. Xử lý lỗi chuẩn

```json
{
  "statusCode": 401,
  "message": "Mô tả lỗi",
  "code": "AUTH_TOKEN_EXPIRED"
}
```

**Error codes quan trọng:**

| `code` | HTTP | Ý nghĩa | FE xử lý |
|--------|------|---------|----------|
| `AUTH_NO_TOKEN` | 401 | Thiếu Authorization header | Redirect login |
| `AUTH_TOKEN_EXPIRED` | 401 | accessToken hết hạn | Gọi `/auth/refresh` |
| `AUTH_INVALID_TOKEN` | 401 | Token không hợp lệ | Xoá tokens, redirect login |
| `AUTH_INVALID_CREDENTIALS` | 401 | Sai email/mật khẩu | Hiện lỗi form |
| `SESSION_REVOKED` | 401 | Session bị thu hồi (kick, SID mismatch, logout) | Xoá tokens, redirect login |
| `SESSION_NOT_FOUND` | 401 | Session không tồn tại trong Redis | Xoá tokens, redirect login |
| `RESOURCE_ALREADY_EXISTS` | 409 | Email đã đăng ký | Gợi ý đăng nhập |
| `VALIDATION_FAILED` | 400 | Input không hợp lệ (kể cả email không phải Gmail) | Highlight field lỗi |

**Axios interceptor mẫu:**

```typescript
let isRefreshing = false;
let failedQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = [];

axiosInstance.interceptors.response.use(
  (res) => res,
  async (error: AxiosError<{ code?: string }>) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    if (
      error.response?.status === 401 &&
      error.response.data?.code === 'AUTH_TOKEN_EXPIRED' &&
      !originalRequest._retry
    ) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers!['Authorization'] = `Bearer ${token}`;
          return axiosInstance(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { data } = await axiosInstance.post<{ accessToken: string; refreshToken: string }>(
          '/auth/refresh',
          { refreshToken: localStorage.getItem('refreshToken') },
          { headers: { 'X-Client-Platform': localStorage.getItem('platform') ?? 'web' } },
        );
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        axiosInstance.defaults.headers.common['Authorization'] = `Bearer ${data.accessToken}`;
        failedQueue.forEach(({ resolve }) => resolve(data.accessToken));
        failedQueue = [];
        originalRequest.headers!['Authorization'] = `Bearer ${data.accessToken}`;
        return axiosInstance(originalRequest);
      } catch (refreshError) {
        failedQueue.forEach(({ reject }) => reject(refreshError));
        failedQueue = [];
        localStorage.clear();
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    if (
      error.response?.status === 401 &&
      (error.response.data?.code === 'SESSION_REVOKED' ||
       error.response.data?.code === 'SESSION_NOT_FOUND')
    ) {
      localStorage.clear();
      window.location.href = '/login';
    }

    return Promise.reject(error);
  },
);
```

---

## 9. Kiến trúc Session Guard

Mỗi request có `Authorization` đi qua pipeline:

```
Request
  │
  ▼
KeycloakGuard
  │  Validate JWT signature (JWKS), extract userId + sid
  │  TokenValidationService: in-memory cache theo JWT signature
  │    Cache TTL = min(token.exp, now+5min), cleanup mỗi 60s
  │    → Cache hit: 0 RSA verify (~3ms saved)
  ▼
SessionGuard
  │
  ├─ Fast path: SessionCacheService.get(userId, platform)
  │     Hit + expiresAt > now → SID match check → ✓ (0 Redis calls)
  │     Miss/expired          → slow path
  │
  └─ Slow path: Redis GET session:{userId}:{platform}
        Found   → SessionCacheService.set(TTL=30s) → SID match → ✓
        Missing → 401 SESSION_NOT_FOUND
        Mismatch → 401 SESSION_REVOKED
```

**SessionCacheService** (in-process, per-Pod):

| Thuộc tính | Giá trị |
|-----------|---------|
| Storage | `Map<"userId:platform", { keycloakSid, expiresAt }>` |
| TTL entry | 30 giây |
| Cleanup interval | 60 giây |
| Invalidated khi | login (kick cũ), logout, kick từ thiết bị mới |

> **Multi-Pod**: Cache là per-Pod. Sau invalidate, các Pod khác còn phục vụ cache cũ tối đa 30s. Trade-off chấp nhận được: session đã bị xóa khỏi Redis nên Pod hết TTL sẽ từ chối.
