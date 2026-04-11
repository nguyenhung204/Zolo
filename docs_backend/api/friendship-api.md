# Friendship API — End-to-End Guide For FE

> **Base URL**: `http://localhost:3000/friendships`  
> **Auth**: Tất cả endpoint yêu cầu header `Authorization: Bearer <access_token>` (Keycloak JWT).

---

## Mục lục

1. [Tổng quan state cho FE](#1-tổng-quan-state-cho-fe)
2. [Luồng FE end-to-end](#2-luồng-fe-end-to-end)
3. [Lấy trạng thái với một user](#3-lấy-trạng-thái-với-một-user)
4. [Gửi lời mời kết bạn](#4-gửi-lời-mời-kết-bạn)
5. [Chấp nhận lời mời](#5-chấp-nhận-lời-mời)
6. [Từ chối lời mời hoặc hủy lời mời đã gửi](#6-từ-chối-lời-mời-hoặc-hủy-lời-mời-đã-gửi)
7. [Lấy danh sách lời mời](#7-lấy-danh-sách-lời-mời)
8. [Lấy danh sách bạn bè](#8-lấy-danh-sách-bạn-bè)
9. [Hủy kết bạn](#9-hủy-kết-bạn)
10. [Chặn user](#10-chặn-user)
11. [Bỏ chặn user](#11-bỏ-chặn-user)
12. [State machine cho nút Friendship](#12-state-machine-cho-nút-friendship)
13. [Mẫu response và lỗi thường gặp](#13-mẫu-response-và-lỗi-thường-gặp)
14. [Gợi ý implement FE](#14-gợi-ý-implement-fe)

---

## 1. Tổng quan state cho FE

FE chỉ cần map quan hệ giữa current user và target user về 5 trạng thái chính:

| Backend status | Ý nghĩa FE | Nút / UI gợi ý |
|----------------|-----------|----------------|
| `NONE` | Chưa có quan hệ | `Kết bạn` |
| `PENDING_OUT` | Tôi đã gửi lời mời cho user này | `Đã gửi lời mời` + cho phép `Hủy lời mời` |
| `PENDING_IN` | User này đã gửi lời mời cho tôi | `Chấp nhận` + `Từ chối` |
| `FRIEND` | Đã là bạn bè | `Bạn bè` + menu `Hủy kết bạn` |
| `BLOCKED` | Tôi đang block user này | `Đã chặn` + `Bỏ chặn` |

**Lưu ý**:
- `BLOCKED` ở API status hiện tại phản ánh trường hợp **current user block target user**.
- Nếu cần biết block hai chiều, backend còn có TCP pattern `GET_BLOCK_STATUS`, nhưng gateway HTTP hiện tại chưa expose endpoint riêng cho FE.

---

## 2. Luồng FE end-to-end

### Luồng chuẩn cho trang profile / user card

1. FE mở profile hoặc render card của một user khác.
2. FE gọi `GET /friendships/:targetUserId/status`.
3. FE map `status` sang UI state.
4. Khi người dùng bấm action:
   - gọi mutation API tương ứng
   - nếu thành công, gọi lại `GET /friendships/:targetUserId/status`
   - đồng thời cập nhật các list liên quan nếu có (`/friendships/requests`, `/friendships`)

### Tại sao nên luôn refetch status sau mutation?

Vì backend có một số nhánh nghiệp vụ không nên để FE tự đoán:
- Gửi lời mời chéo có thể **auto-accept** ngay.
- Reject API hiện cũng xử lý cả **cancel outgoing request**.
- Block sẽ xóa friendship và pending request hiện có.

---

## 3. Lấy trạng thái với một user

```http
GET /friendships/:targetUserId/status
Authorization: Bearer <token>
```

**Response 200**

```json
{
  "userId": "current-user-uuid",
  "targetUserId": "target-user-uuid",
  "status": "PENDING_OUT"
}
```

**Giải thích status**

| Status | Ý nghĩa |
|--------|---------|
| `NONE` | Không có friendship, request, block theo chiều hiện tại |
| `PENDING_OUT` | Current user đã gửi request tới target |
| `PENDING_IN` | Target đã gửi request tới current user |
| `FRIEND` | Hai bên đã là bạn |
| `BLOCKED` | Current user đang block target |

**Use case FE**
- Đây là endpoint chính để render nút `Kết bạn`, `Đã gửi lời mời`, `Chấp nhận`, `Bạn bè`, `Đã chặn`.

---

## 4. Gửi lời mời kết bạn

```http
POST /friendships/requests/:targetUserId
Authorization: Bearer <token>
```

**Response 200**

```json
{
  "success": true,
  "message": "Friend request sent"
}
```

**Response 200 khi request đã gửi trước đó**

```json
{
  "success": true,
  "message": "Friend request already sent"
}
```

**Response 200 khi hai bên gửi chéo và backend auto-accept**

```json
{
  "success": true,
  "message": "Auto-accepted (mutual request)",
  "autoAccepted": true
}
```

**Lưu ý FE**
- Sau khi gửi thành công, không nên tự assume luôn là `PENDING_OUT`.
- Hãy refetch `GET /friendships/:targetUserId/status` vì có thể backend trả `autoAccepted` và trạng thái cuối là `FRIEND`.

---

## 5. Chấp nhận lời mời

```http
POST /friendships/requests/:fromUserId/accept
Authorization: Bearer <token>
```

**Response 200**

```json
{
  "success": true,
  "message": "Friend request accepted"
}
```

**Sau khi thành công**
- FE nên refetch:
  - `GET /friendships/:fromUserId/status`
  - `GET /friendships/requests`
  - nếu đang có màn danh sách bạn bè: `GET /friendships`

**Kỳ vọng UI sau cùng**
- `status` sẽ trở thành `FRIEND`.

---

## 6. Từ chối lời mời hoặc hủy lời mời đã gửi

```http
POST /friendships/requests/:fromUserId/reject
Authorization: Bearer <token>
```

API này có 2 cách hoạt động tùy theo trạng thái hiện tại.

### Trường hợp A: current user đang có `PENDING_IN`
- Action FE: `Từ chối lời mời`
- Backend sẽ xóa pending request giữa hai bên

**Response 200**

```json
{
  "success": true,
  "message": "Friend request rejected"
}
```

### Trường hợp B: current user đang có `PENDING_OUT`
- Action FE: `Hủy lời mời`
- Backend sẽ hủy outgoing request đã gửi

**Response 200**

```json
{
  "success": true,
  "message": "Friend request canceled"
}
```

**Lưu ý FE**
- Cùng một endpoint, nhưng label trên UI nên khác nhau:
  - `PENDING_IN` -> `Từ chối`
  - `PENDING_OUT` -> `Hủy lời mời`
- Sau khi thành công, refetch status. Trạng thái sau cùng thường là `NONE`.

---

## 7. Lấy danh sách lời mời

```http
GET /friendships/requests
Authorization: Bearer <token>
```

**Response 200**

```json
{
  "incoming": [
    "user-a-uuid",
    "user-b-uuid"
  ],
  "outgoing": [
    "user-c-uuid",
    "user-d-uuid"
  ]
}
```

**Ý nghĩa**
- `incoming`: các user đã gửi lời mời cho tôi
- `outgoing`: các user tôi đã gửi lời mời

**Use case FE**
- Tab `Lời mời nhận được`: render từ `incoming`
- Tab `Đã gửi`: render từ `outgoing`

**Lưu ý**
- API này chỉ trả danh sách `userId`.
- FE cần join với user profile API nếu muốn hiện avatar, tên hiển thị, username.

---

## 8. Lấy danh sách bạn bè

```http
GET /friendships
Authorization: Bearer <token>
```

**Response 200**

```json
{
  "friends": [
    "friend-1-uuid",
    "friend-2-uuid"
  ],
  "fromCache": false
}
```

**Ý nghĩa field**

| Field | Ý nghĩa |
|-------|---------|
| `friends` | Mảng `userId` của bạn bè |
| `fromCache` | Backend trả từ Redis cache hay từ DB |

**Use case FE**
- Màn danh sách bạn bè
- Kiểm tra nhanh xem một user có đang là bạn không nếu đã có friend list trong store local

---

## 9. Hủy kết bạn

```http
DELETE /friendships/:targetUserId
Authorization: Bearer <token>
```

**Response 200**

```json
{
  "success": true,
  "message": "Friendship removed"
}
```

**Sau khi thành công**
- FE nên refetch:
  - `GET /friendships/:targetUserId/status`
  - `GET /friendships`

**Kỳ vọng UI sau cùng**
- `status` trở về `NONE`.

---

## 10. Chặn user

```http
POST /friendships/blocks/:targetUserId
Authorization: Bearer <token>
```

**Response 200**

```json
{
  "success": true,
  "message": "User blocked"
}
```

**Hiệu ứng nghiệp vụ phía backend**
- Xóa friendship hiện có nếu đang là bạn
- Xóa pending request nếu đang chờ
- Tạo block theo chiều current user -> target user

**Kỳ vọng UI sau cùng**
- `status` trở thành `BLOCKED`

**Khuyến nghị FE**
- Sau block, đóng hoặc ẩn toàn bộ action friendship khác ngoài `Bỏ chặn`.

---

## 11. Bỏ chặn user

```http
DELETE /friendships/blocks/:targetUserId
Authorization: Bearer <token>
```

**Response 200**

```json
{
  "success": true,
  "message": "User unblocked"
}
```

**Kỳ vọng UI sau cùng**
- Thường sẽ quay về `NONE`.
- FE nên refetch `GET /friendships/:targetUserId/status` ngay sau mutation.

---

## 12. State machine cho nút Friendship

### Bảng map state -> action

| Current status | Primary action | Secondary action | Status sau khi thành công |
|----------------|----------------|------------------|----------------------------|
| `NONE` | Gửi lời mời | Chặn | `PENDING_OUT` hoặc `FRIEND` |
| `PENDING_OUT` | Hủy lời mời | Chặn | `NONE` hoặc `BLOCKED` |
| `PENDING_IN` | Chấp nhận | Từ chối / Chặn | `FRIEND`, `NONE`, hoặc `BLOCKED` |
| `FRIEND` | Hủy kết bạn | Chặn | `NONE` hoặc `BLOCKED` |
| `BLOCKED` | Bỏ chặn | — | `NONE` |

### Recommendation cho FE

Không nên hard-code trạng thái sau mutation theo suy đoán. Quy trình ổn định nhất là:

1. Disable button đang bấm
2. Gọi mutation API
3. Nếu success, refetch `GET /friendships/:targetUserId/status`
4. Cập nhật state UI theo dữ liệu trả về

---

## 13. Mẫu response và lỗi thường gặp

### Mẫu lỗi validation / business

```json
{
  "statusCode": 400,
  "message": "Already friends",
  "errorCode": "RESOURCE_CONFLICT"
}
```

### Các lỗi thường gặp

| Tình huống | HTTP / business error khả năng cao | Gợi ý FE |
|-----------|------------------------------------|----------|
| Gửi lời mời cho chính mình | `400` | Chặn action từ UI |
| Đã là bạn rồi | `400` + `RESOURCE_CONFLICT` | Refetch status và cập nhật UI |
| Tôi đã block người kia | `400` + `RESOURCE_CONFLICT` | Đổi UI sang `Bỏ chặn` nếu cần |
| Tôi bị người kia block | `400` + `RESOURCE_CONFLICT` | Hiện message không thể gửi lời mời |
| Accept/reject request không tồn tại | `404` | Refetch status + pending list |
| Friendship service disabled/unavailable | `503` | Hiện toast lỗi tạm thời |

---

## 14. Gợi ý implement FE

### TypeScript types

```ts
export type FriendshipStatus =
  | 'NONE'
  | 'PENDING_OUT'
  | 'PENDING_IN'
  | 'FRIEND'
  | 'BLOCKED';

export interface FriendshipStatusResponse {
  userId: string;
  targetUserId: string;
  status: FriendshipStatus;
}

export interface PendingRequestsResponse {
  incoming: string[];
  outgoing: string[];
}

export interface FriendsResponse {
  friends: string[];
  fromCache: boolean;
}

export interface FriendshipMutationResponse {
  success: boolean;
  message: string;
  autoAccepted?: boolean;
}
```

### Mapping sang UI state

```ts
export type FriendshipUiState =
  | 'none'
  | 'pending_out'
  | 'pending_in'
  | 'friend'
  | 'blocked';

export function mapFriendshipStatus(status: FriendshipStatus): FriendshipUiState {
  switch (status) {
    case 'PENDING_OUT':
      return 'pending_out';
    case 'PENDING_IN':
      return 'pending_in';
    case 'FRIEND':
      return 'friend';
    case 'BLOCKED':
      return 'blocked';
    default:
      return 'none';
  }
}
```

### Pseudo flow cho user profile

```ts
async function loadFriendshipStatus(targetUserId: string) {
  return api.get<FriendshipStatusResponse>(`/friendships/${targetUserId}/status`);
}

async function onSendFriendRequest(targetUserId: string) {
  await api.post(`/friendships/requests/${targetUserId}`);
  return loadFriendshipStatus(targetUserId);
}

async function onAcceptFriendRequest(fromUserId: string) {
  await api.post(`/friendships/requests/${fromUserId}/accept`);
  return Promise.all([
    loadFriendshipStatus(fromUserId),
    api.get<PendingRequestsResponse>('/friendships/requests'),
  ]);
}

async function onRejectOrCancel(targetUserId: string) {
  await api.post(`/friendships/requests/${targetUserId}/reject`);
  return Promise.all([
    loadFriendshipStatus(targetUserId),
    api.get<PendingRequestsResponse>('/friendships/requests'),
  ]);
}
```

### Checklist implement FE

1. Luôn có query `friendshipStatus(targetUserId)` cho profile/user card.
2. Sau mọi mutation, refetch status thay vì tự suy diễn.
3. Với màn danh sách request, dùng `GET /friendships/requests`.
4. Với màn danh sách bạn bè, dùng `GET /friendships` rồi hydrate user info từ users API.
5. Disable button khi mutation đang chạy để tránh double click.
6. Với lỗi `404` hoặc `400 conflict`, refetch lại status để tự hồi phục UI.

---

## TL;DR cho FE

- Muốn biết tôi đã gửi lời mời tới người này chưa: gọi `GET /friendships/:targetUserId/status`, nếu `status = PENDING_OUT` thì đúng.
- Muốn render màn request: gọi `GET /friendships/requests`.
- Muốn render màn friend list: gọi `GET /friendships`.
- Sau mọi action friendship: refetch `status` của cặp user đó.