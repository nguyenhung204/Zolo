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
| `email` | Valid email, unique (kiểm tra Keycloak) |
| `firstName` | 1–20 ký tự, cho phép tên tiếng Việt có dấu |
| `lastName` | 1–20 ký tự, cho phép tên tiếng Việt có dấu |

> `username` hiển thị sẽ được hệ thống tự sinh từ `firstName + " " + lastName`, có thể trùng và có thể đổi sau này trong profile.

**Response `200`:**
```json
{
  "cooldownSeconds": 60
}
```

**Errors:**
| HTTP | Khi nào |
|------|---------|
| `400` | Email/firstName/lastName invalid |
| `409` | Email đã được đăng ký |
| `429` | Rate limit: 5 lần / 15 phút / email |

---

### Step 2 — Xác minh OTP

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
| `email` | Phải khớp email ở step 1 |
| `otp` | Đúng 6 chữ số |

**Response `200`:**
```json
{
  "registrationToken": "550e8400-e29b-41d4-a716-446655440000",
  "expiresIn": 600
}
```

> `registrationToken` có TTL **10 phút**. Hết hạn → phải làm lại từ Step 1.

**Errors:**
| HTTP | Khi nào |
|------|---------|
| `400` | OTP sai (kèm `còn N lần thử`) |
| `400` | OTP đã hết hạn / đã dùng |
| `400` | Quá 3 lần sai → phải restart từ Step 1 |

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
| `registrationToken` | UUID từ Step 2, còn hạn |
| `password` | Tối thiểu 8 ký tự |
| `platform` | `"web"` hoặc `"mobile"` |
| `deviceInfo` | Optional |

**Response `201`:**
```json
{
  "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 300
}
```

> Tài khoản được tạo trong Keycloak + users-service. Nếu users-service lỗi → Keycloak user tự động bị xoá (Saga-lite rollback) và trả về `500`.

**Errors:**
| HTTP | Khi nào |
|------|---------|
| `400` | `registrationToken` hết hạn hoặc không hợp lệ |
| `409` | Email đã tồn tại trong Keycloak (race condition) |
| `500` | users-service lỗi (sau rollback) |

---

## 2. Đăng nhập

```
POST /auth/login
```

> Chỉ hỗ trợ đăng nhập bằng `email` + `password` (không hỗ trợ đăng nhập bằng `username`).

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

**Response `200`:**
```json
{
  "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 300
}
```

> **Session 1-per-platform**: Nếu đã có session `web` khác → session cũ bị thu hồi, WebSocket của session cũ nhận event `session_revoked` và bị disconnect ngay lập tức.

**Errors:**
| HTTP | Khi nào |
|------|---------|
| `401` | Sai email/mật khẩu |
| `429` | Rate limit |

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

**Errors:**
| HTTP | Khi nào |
|------|---------|
| `401` | refreshToken hết hạn hoặc không hợp lệ |
| `401` | Session đã bị revoke (bị đăng nhập từ thiết bị khác) |

---

## 4. Đăng xuất

```
POST /auth/logout
```

**Request:**
```bash
curl -X POST https://api.bcn.id.vn/auth/logout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "X-Client-Platform: web"
```

**Response `200`:**
```json
{
  "message": "Đăng xuất thành công."
}
```

> Xoá Redis session, revoke Keycloak session, WebSocket tự đóng. Không cần body.

---

## 5. Quên mật khẩu

Luồng gồm **3 bước**: gửi OTP → xác minh OTP → đặt mật khẩu mới.

---

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
| `email` | Valid email |

**Response `200`:**
```json
{
  "message": "Mã OTP đã được gửi đến email của bạn. Vui lòng kiểm tra hộp thư."
}
```

> OTP có **6 chữ số**, TTL **10 phút**, được gửi qua email (fire-and-forget — không chặn response nếu email bị lỗi).

**Errors:**
| HTTP | Khi nào |
|------|---------|
| `400` | Email không hợp lệ |
| `404` | Email chưa đăng ký trong hệ thống |
| `429` | Rate limit: 5 lần / 15 phút / email |
| `429` | Cooldown: phải đợi 60 giây giữa các lần yêu cầu |

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
| `email` | Phải khớp email ở Step 1 |
| `otp` | Đúng 6 chữ số |

**Response `200`:**
```json
{
  "resetToken": "550e8400-e29b-41d4-a716-446655440000",
  "expiresIn": 600
}
```

> `resetToken` là **UUID v4**, TTL **10 phút**. Hết hạn hoặc đã dùng → phải bắt đầu lại từ Step 1.

**Errors:**
| HTTP | Khi nào |
|------|---------|
| `400` | OTP sai hoặc đã hết hạn |
| `400` | OTP đã được sử dụng (one-time-use) |
| `400` | Quá 3 lần sai → OTP bị xóa, phải yêu cầu mã mới |

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
| `resetToken` | UUID v4, còn hạn (max 10 phút sau Step 2), chỉ dùng được một lần |
| `newPassword` | Tối thiểu 8 ký tự, bao gồm chữ hoa, chữ thường, chữ số và ký tự đặc biệt (`!@#$%^&*`) |

**Response `200`:**
```json
{
  "message": "Mật khẩu đã được đặt lại thành công. Vui lòng đăng nhập lại."
}
```

> Sau khi đặt lại thành công, **toàn bộ Keycloak session** của user bị thu hồi (bao gồm cả các thiết bị đang đăng nhập). FE cần xóa tokens và redirect về login.

**Errors:**
| HTTP | Khi nào |
|------|---------|
| `400` | `resetToken` không hợp lệ, đã hết hạn, hoặc đã dùng |
| `400` | `newPassword` không đúng chính sách mật khẩu |
| `500` | Lỗi khi cập nhật mật khẩu Keycloak |

---

## 6. Luồng FE

### 6.1 Luồng Đăng ký

```
FE                              API (Gateway)               External
 |                                   |                          |
 |-- POST /auth/register/init ------>|                          |
 |   { email, firstName, lastName }  |-- check Keycloak ------->|
 |                                   |<-- 200 unique ------------|
 |                                   |-- store Redis (init+OTP) |
 |                                   |-- TCP -> notification --> email OTP
 |<-- { cooldownSeconds: 60 } -------|                          |
 |                                   |                          |
 |  [User nhập OTP từ email]          |                          |
 |                                   |                          |
 |-- POST /auth/register/verify-otp->|                          |
 |   { email, otp }                  |-- HMAC compare + Redis   |
 |<-- { registrationToken, 600s } ---|                          |
 |                                   |                          |
 |  [User nhập mật khẩu]             |                          |
 |                                   |                          |
 |-- POST /auth/register/complete -->|                          |
 |   { registrationToken, password,  |-- createUser Keycloak -->|
 |     platform, deviceInfo? }       |-- TCP CREATE_USER ------> users-service
 |                                   |   [nếu fail → deleteUser Keycloak]
 |                                   |-- login auto (Keycloak)  |
 |                                   |-- store Redis session    |
 |<-- { accessToken, refreshToken } -|                          |
```

**FE cần làm:**
1. **Lưu** `registrationToken` ở `sessionStorage` (không localStorage — không muốn persist qua tab mới).
2. **Bước 2** có thể hiện "Resend OTP" sau 60s (dùng `cooldownSeconds` từ step 1).
3. **Bước 3**: Nếu response `409` → email tồn tại, redirect về login. Nếu `400` về `registrationToken` → token hết hạn, restart từ đầu.

---

### 6.2 Luồng Đăng nhập

```
FE                              Gateway                     Redis / Keycloak
 |                                  |                             |
 |-- POST /auth/login -------------->|                             |
 |   { email, password,              |-- POST /token (passwd) ---->|
 |     platform: "web" }             |<-- { access_token, ... } ---|
 |                                  |-- decode JWT (sid)           |
 |                                  |-- getSession(userId, "web")  |
 |                                  |  [nếu có session cũ]         |
 |                                  |   publishRevocation(channel)|
 |                                  |   revokeKeycloakSession()   |
 |                                  |-- createSession(userId,      |
 |                                  |     "web", keycloakSid)     |
 |<-- { accessToken, refreshToken }--|                             |
 |                                  |                             |
 | [Lưu tokens → kết nối WebSocket] |                             |
```

**FE cần làm:**
1. Lưu `accessToken` và `refreshToken` vào `localStorage` (web) hoặc SecureStorage (mobile).
2. Gắn `Authorization: Bearer <accessToken>` cho **tất cả** request sau này.
3. Gắn `X-Client-Platform: web` hoặc `X-Client-Platform: mobile` cho **tất cả** request.
4. Kết nối WebSocket sau khi có `accessToken` (xem mục 7).

---

### 6.3 Luồng Refresh Token (Token Rotation)

```
FE                              Gateway
 |                                 |
 | [accessToken sắp hết hạn]       |
 |-- POST /auth/refresh ----------->|
 |   Header: X-Client-Platform: web |
 |   { refreshToken }               |
 |<-- { accessToken (mới),          |
 |      refreshToken (mới) } -------|
 |                                 |
 | [Cập nhật tokens trong storage] |
```

**FE cần làm:**
1. **Interceptor HTTP**: Nếu nhận `401` với `code: "AUTH_TOKEN_EXPIRED"` → tự động gọi `/auth/refresh` → retry request gốc.
2. Nếu `/auth/refresh` trả về `401` (session revoked hoặc refreshToken hết hạn) → xoá tokens, redirect về login.
3. Tránh **multiple concurrent refresh**: dùng single in-flight promise (refresh lock pattern):

```typescript
// Pseudo-code interceptor
let refreshPromise: Promise<Tokens> | null = null;

async function refreshIfNeeded(): Promise<Tokens> {
  if (!refreshPromise) {
    refreshPromise = callRefreshAPI().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}
```

---

### 6.4 Luồng Đăng xuất

```
FE                              Gateway
 |                                 |
 |-- POST /auth/logout ------------>|
 |   Header: Authorization: Bearer  |
 |   Header: X-Client-Platform: web |
 |                                 |-- deleteSession(Redis)
 |                                 |-- publishRevocation (WS disconnect)
 |                                 |-- revokeKeycloakSession
 |<-- { message: "Đăng xuất..." }--|
 |                                 |
 | [Xoá tokens khỏi storage]       |
 | [Disconnect WebSocket (nếu có)] |
 | [Redirect về /login]            |
```

---

### 6.5 Luồng Session Bị Thu Hồi (Đăng nhập từ thiết bị khác)

```
Device A (đang dùng)      Gateway           Device B (đăng nhập mới)
      |                      |                        |
      |  [đang online]        |                        |
      |                      |<-- POST /auth/login ----|
      |                      |    { platform: "web" }  |
      |                      |-- revoke Device A      |
      |                      |-- publish Redis channel |
      |                      |-- create session B      |
      |                      |<-- 200 tokens ----------|
      |                      |                        |
realtime-gateway subscribes Redis channel             |
      |<-- WS event: "session_revoked" -------------- |
      |  { reason: "logged_in_elsewhere" }            |
      |                      |                        |
  [FE nhận sự kiện]          |                        |
  [Xoá tokens]               |                        |
  [Hiện thông báo]           |                        |
  [Redirect /login]          |                        |
```

---

### 6.6 Luồng Quên Mật Khẩu

```
FE                              Gateway                   Redis / Keycloak / Email
 |                                  |                              |
 |-- POST /auth/forgot-password ---->|                              |
 |   { email }                      |-- lookup Keycloak user ----->|
 |                                  |<-- userId found --------------|
 |                                  |-- checkRateLimit (5/15min)   |
 |                                  |-- checkCooldown (60s)        |
 |                                  |-- storeOtp(Redis, TTL 10min) |
 |                                  |-- TCP -> notification ------> email OTP
 |<-- { message } ------------------|                              |
 |                                  |                              |
 |  [User nhập OTP từ email]         |                              |
 |                                  |                              |
 |-- POST /auth/verify-otp ---------->|                              |
 |   { email, otp }                 |-- getOtp (Redis)             |
 |                                  |-- incrementAttempts (max 3)  |
 |                                  |-- verifyHMAC                 |
 |                                  |-- markUsed (one-time lock)   |
 |                                  |-- storeResetToken(UUID, 10m) |
 |                                  |-- deleteOtp                  |
 |<-- { resetToken (UUID), 600s } ---|                              |
 |                                  |                              |
 |  [User nhập mật khẩu mới]         |                              |
 |                                  |                              |
 |-- POST /auth/reset-password ------>|                              |
 |   { resetToken, newPassword }    |-- getAndDeleteResetToken     |
 |                                  |-- setUserPassword (Keycloak)->|
 |                                  |-- revokeAllSessions -------->|
 |<-- { message } ------------------|                              |
 |                                  |                              |
 | [Xoá tokens khỏi storage]        |                              |
 | [Redirect về /login]             |                              |
```

**FE cần làm:**
1. **Lưu** `resetToken` ở `sessionStorage` (không localStorage) trong suốt luồng 3 bước.
2. **Step 2**: Sau 3 lần sai OTP → OTP bị xóa, phải gọi lại Step 1. Hiện nút "Gửi lại OTP" sau 60 giây (cooldown).
3. **Step 3**: Nếu `400` về `resetToken` hết hạn → redirect về Step 1. Sau khi đặt lại thành công → xóa tokens cũ (nếu có), redirect về `/login`.

---

## 7. WebSocket Session Revocation

Sau khi đăng nhập, kết nối WebSocket tại `wss://api.bcn.id.vn/chat`:

```javascript
const socket = io('wss://api.bcn.id.vn', {
  path: '/socket.io',
  transports: ['websocket'],
});

// 1. Xác thực sau khi connect
socket.on('connect', () => {
  socket.emit('authenticate', {
    token: accessToken,
    platform: 'web', // hoặc 'mobile'
  });
});

// 2. Lắng nghe session bị thu hồi
socket.on('session_revoked', (data) => {
  console.warn('Session revoked:', data);
  // data = { reason: 'logged_in_elsewhere' | 'manual_logout' }

  // Xoá tokens
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');

  // Disconnect socket
  socket.disconnect();

  // Thông báo user và redirect
  showNotification('Tài khoản đã đăng nhập từ thiết bị khác.');
  router.push('/login');
});

// 3. Xử lý disconnect bất ngờ
socket.on('disconnect', (reason) => {
  if (reason === 'io server side') {
    // Server chủ động disconnect (session revoked)
    // Kiểm tra xem có nhận được 'session_revoked' chưa
  }
});
```

---

## 8. Xử lý lỗi chuẩn

Tất cả lỗi trả về format:

```json
{
  "statusCode": 401,
  "message": "Mô tả lỗi",
  "code": "AUTH_TOKEN_EXPIRED"
}
```

**Error codes quan trọng với auth:**

| `code` | HTTP | Ý nghĩa | FE xử lý |
|--------|------|---------|----------|
| `AUTH_NO_TOKEN` | 401 | Thiếu Authorization header | Redirect login |
| `AUTH_TOKEN_EXPIRED` | 401 | accessToken hết hạn | Gọi `/auth/refresh` |
| `AUTH_INVALID_TOKEN` | 401 | Token không hợp lệ | Xoá tokens, redirect login |
| `AUTH_INVALID_CREDENTIALS` | 401 | Sai email/mật khẩu | Hiện lỗi form |
| `SESSION_REVOKED` | 401 | Session bị thu hồi bởi đăng nhập khác | Xoá tokens, redirect login |
| `RESOURCE_ALREADY_EXISTS` | 409 | Email đã đăng ký | Gợi ý đăng nhập |
| `VALIDATION_FAILED` | 400 | Input không hợp lệ | Highlight field lỗi |

**Interceptor axios mẫu:**

```typescript
// axios interceptor
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

    // SESSION_REVOKED: bị đá ra bởi WebSocket event hoặc trực tiếp từ API
    if (
      error.response?.status === 401 &&
      error.response.data?.code === 'SESSION_REVOKED'
    ) {
      localStorage.clear();
      window.location.href = '/login';
    }

    return Promise.reject(error);
  },
);
```
