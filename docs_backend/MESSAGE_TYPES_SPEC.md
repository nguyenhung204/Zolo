# Message Types & Validation Specification

> **Last Updated:** April 22, 2026  
> **Status:** ✅ Implemented

## Overview

Spec chi tiết về các loại message, validation rules, và payload structure khi gửi message qua Gateway hoặc REST API.

---

## 1. Message Type Enum

**Backend:** `conversation.enum.ts`  
**Frontend:** `lib/socket/events.ts`

```typescript
export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  FILE = 'file',
  STICKER = 'sticker',
  MEDIA = 'media',          // Multiple attachments
  SYSTEM = 'system',
  CALL_SUMMARY = 'call_summary'
}
```

---

## 2. Validation Rules

**Backend:** `message-send.orchestrator.ts`

### Bảng tổng hợp

| Message Type | `content` | `attachments` hoặc `mediaId` | Ghi chú |
|-------------|-----------|------------------------------|---------|
| **text** | ✅ **Bắt buộc** | ❌ Không cần | - |
| **sticker** | ⚪ Optional | ❌ Không cần | URL sticker trong `metadata.stickerId`, `metadata.packageId` |
| **media** | ⚪ Optional | ✅ **Bắt buộc** | `attachments` array (1-30 items) |
| **image/video/audio/file** | ⚪ Optional | ✅ **Bắt buộc** | `metadata.mediaId` **HOẶC** `attachments` |

### Error Codes

```typescript
// Backend error codes
MESSAGE_CONTENT_REQUIRED    // Thiếu content cho type 'text'
ATTACHMENTS_REQUIRED        // Thiếu attachments cho type 'media'
MEDIA_DATA_REQUIRED         // Thiếu mediaId/attachments cho type 'image'/'video'/'audio'/'file'
TOO_MANY_ATTACHMENTS        // Vượt quá 30 attachments (chỉ cho type 'media')
```

---

## 3. Frontend Usage

### 3.1. Gửi Text Message

```typescript
// ✅ ĐÚNG
{
  conversationId: "5398046d-...",
  clientMessageId: uuid(),
  type: "text",
  content: "Hello world"
}

// ❌ SAI - Thiếu content
{
  conversationId: "5398046d-...",
  clientMessageId: uuid(),
  type: "text"
  // Error: MESSAGE_CONTENT_REQUIRED
}
```

### 3.2. Gửi Single Image

```typescript
// ✅ ĐÚNG - Dùng attachments array
{
  conversationId: "5398046d-...",
  clientMessageId: uuid(),
  type: "image",
  content: "Check this photo!",  // optional
  attachments: [{
    mediaId: "ad71780d-f06c-4658-a61e-a48516e6b7c9",
    type: "image"
  }],
  metadata: {
    fileSize: 194730,
    filename: "photo.jpg"
  }
}

// ❌ SAI - Thiếu mediaId/attachments
{
  conversationId: "5398046d-...",
  clientMessageId: uuid(),
  type: "image",
  metadata: {
    fileSize: 194730,
    filename: "photo.jpg"
  }
  // Error: MEDIA_DATA_REQUIRED
}
```

### 3.3. Gửi File

```typescript
// ⚠️ FLOW ĐÚNG:
// 1. Upload file → POST /media/upload
// 2. Nhận mediaId từ response
// 3. Gửi message với attachments

// ✅ ĐÚNG - Sau khi upload
{
  conversationId: "5398046d-...",
  clientMessageId: uuid(),
  type: "file",
  content: "Tài liệu kèm theo",  // optional
  attachments: [{
    mediaId: "ad71780d-f06c-4658-a61e-a48516e6b7c9",
    type: "file"
  }],
  metadata: {
    fileSize: 409905,
    filename: "document.pdf"
  }
}

// ❌ SAI - Gửi trước khi upload
{
  conversationId: "5398046d-...",
  clientMessageId: uuid(),
  type: "file",
  metadata: {
    fileSize: 409905,
    filename: "document.pdf"
  }
  // Error: MEDIA_DATA_REQUIRED
}
```

### 3.4. Gửi Multiple Media (Album)

```typescript
// ✅ ĐÚNG - type: 'media' với nhiều attachments
{
  conversationId: "5398046d-...",
  clientMessageId: uuid(),
  type: "media",
  content: "Album ảnh du lịch",  // optional
  attachments: [
    { mediaId: "media-1", type: "image" },
    { mediaId: "media-2", type: "image" },
    { mediaId: "media-3", type: "video" }
  ]
}

// ❌ SAI - Thiếu attachments
{
  conversationId: "5398046d-...",
  clientMessageId: uuid(),
  type: "media",
  content: "Album ảnh du lịch"
  // Error: ATTACHMENTS_REQUIRED
}

// ❌ SAI - Quá nhiều attachments
{
  conversationId: "5398046d-...",
  clientMessageId: uuid(),
  type: "media",
  attachments: [ /* 31 items */ ]
  // Error: TOO_MANY_ATTACHMENTS (max 30)
}
```

### 3.5. Gửi Sticker

```typescript
// ✅ ĐÚNG
{
  conversationId: "5398046d-...",
  clientMessageId: uuid(),
  type: "sticker",
  content: "",  // optional, có thể để trống
  metadata: {
    stickerId: "sticker-123",
    packageId: "package-456"
  }
}
```

### 3.6. Gửi Voice Message

```typescript
// ✅ ĐÚNG
{
  conversationId: "5398046d-...",
  clientMessageId: uuid(),
  type: "audio",
  content: "",  // optional, có thể để trống
  attachments: [{
    mediaId: "audio-recording-id",
    type: "audio"
  }],
  metadata: {
    durationMs: 15000,
    waveform: [0.2, 0.5, 0.8, ...],
    fileSize: 120000
  }
}
```

---

## 4. Backend Implementation Notes

### 4.1. Gateway DTO (`send-message.dto.ts`)

```typescript
import { MessageType } from '@app/common/enums/conversation.enum';

export class SendMessageDto {
  @IsNotEmpty()
  @IsString()
  conversationId: string;

  @IsNotEmpty()
  @IsString()
  clientMessageId: string;

  @IsOptional()
  @IsString()
  @ValidateIf((o) => o.type === 'text')
  @IsNotEmpty({ message: 'Content is required for text messages' })
  content?: string;

  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType;

  @IsOptional()
  @IsString()
  replyToMessageId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
```

### 4.2. Orchestrator Logic

```typescript
// message-send.orchestrator.ts

private validateMessageContent(
  type: MessageType,
  content: string | undefined,
  attachments: AttachmentDto[] | undefined,
  metadata: Record<string, any> | undefined
): void {
  // Rule 1: Text messages must have content
  if (type === MessageType.TEXT && !content?.trim()) {
    throw new WsException({
      code: 'MESSAGE_CONTENT_REQUIRED',
      message: 'Content is required for text messages',
    });
  }

  // Rule 2: Media messages must have attachments array (1-30 items)
  if (type === MessageType.MEDIA) {
    if (!attachments || attachments.length === 0) {
      throw new WsException({
        code: 'ATTACHMENTS_REQUIRED',
        message: 'Attachments are required for media messages',
      });
    }
    if (attachments.length > 30) {
      throw new WsException({
        code: 'TOO_MANY_ATTACHMENTS',
        message: 'Maximum 30 attachments allowed',
      });
    }
  }

  // Rule 3: Image/video/audio/file must have mediaId or attachments
  if ([MessageType.IMAGE, MessageType.VIDEO, MessageType.AUDIO, MessageType.FILE].includes(type)) {
    const hasMediaId = metadata?.mediaId;
    const hasAttachments = attachments && attachments.length > 0;
    
    if (!hasMediaId && !hasAttachments) {
      throw new WsException({
        code: 'MEDIA_DATA_REQUIRED',
        message: `${type} messages require mediaId or attachments`,
      });
    }
  }

  // Rule 4: Sticker needs stickerId in metadata (no attachments needed)
  if (type === MessageType.STICKER && !metadata?.stickerId) {
    throw new WsException({
      code: 'STICKER_ID_REQUIRED',
      message: 'stickerId is required in metadata for sticker messages',
    });
  }
}
```

---

## 5. Migration Checklist

### Backend
- [x] Update `MessageType` enum với `STICKER` và `MEDIA`
- [x] Update `message-send.orchestrator.ts` validation logic
- [x] Update `send-message.dto.ts` - import MessageType từ `@app/common`
- [x] Add error codes: `MESSAGE_CONTENT_REQUIRED`, `ATTACHMENTS_REQUIRED`, `MEDIA_DATA_REQUIRED`, `TOO_MANY_ATTACHMENTS`

### Frontend
- [x] `MessageType` đã có đủ types trong `lib/socket/events.ts`
- [x] `SendMessagePayload` đã support optional content + attachments trong `lib/api/messages.ts`
- [x] Upload flow đã đúng: upload → get mediaId → send message

---

## 6. Common Mistakes

### ❌ Mistake 1: Gửi file trước khi upload
```typescript
// SAI - chưa có mediaId
{
  type: "file",
  metadata: { filename: "doc.pdf", fileSize: 123456 }
}
```

**Fix:** Upload file trước, rồi gửi message với `attachments: [{ mediaId }]`

### ❌ Mistake 2: Dùng top-level mediaId cho image/video/audio
```typescript
// SAI (legacy pattern, không còn support)
{
  type: "image",
  mediaId: "abc-123"
}
```

**Fix:** Dùng `attachments` array
```typescript
{
  type: "image",
  attachments: [{ mediaId: "abc-123", type: "image" }]
}
```

### ❌ Mistake 3: Quên content cho text message
```typescript
// SAI
{
  type: "text"
}
```

**Fix:** Text message phải có content
```typescript
{
  type: "text",
  content: "Hello"
}
```

---

## 7. Testing Examples

```bash
# Test 1: Send text (should succeed)
{
  "conversationId": "conv-1",
  "clientMessageId": "msg-1",
  "type": "text",
  "content": "Hello"
}
# Expected: Success

# Test 2: Send text without content (should fail)
{
  "conversationId": "conv-1",
  "clientMessageId": "msg-2",
  "type": "text"
}
# Expected: MESSAGE_CONTENT_REQUIRED

# Test 3: Send media without attachments (should fail)
{
  "conversationId": "conv-1",
  "clientMessageId": "msg-3",
  "type": "media"
}
# Expected: ATTACHMENTS_REQUIRED

# Test 4: Send image with attachments (should succeed)
{
  "conversationId": "conv-1",
  "clientMessageId": "msg-4",
  "type": "image",
  "attachments": [{ "mediaId": "media-1", "type": "image" }]
}
# Expected: Success

# Test 5: Send file without mediaId (should fail)
{
  "conversationId": "conv-1",
  "clientMessageId": "msg-5",
  "type": "file",
  "metadata": { "filename": "doc.pdf" }
}
# Expected: MEDIA_DATA_REQUIRED
```

---

## References

- [API Reference - Send Message](./API_REFERENCE.md#send-message)
- [Chat Core Service](./services/chat-core.md)
- [Realtime Gateway](./services/realtime-gateway.md)
- Frontend: `lib/api/messages.ts`, `lib/socket/events.ts`
