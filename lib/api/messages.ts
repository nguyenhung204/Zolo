import { apiClient } from "@/lib/api/client";
import type { MessageType, MediaStatus } from "@/lib/socket/events";

// ─── Raw API shapes ───────────────────────────────────────────────────────────

export interface AttachmentRef {
  mediaId: string;
  type?: "image" | "video" | "audio" | "file";
  kind?: "image" | "video" | "audio" | "file";
  status?: string;
  prefer?: "ORIGINAL" | "OPTIMIZED";
  variantsReady?: boolean;
  filename?: string;
}

// Raw shape returned by the REST endpoint (field names differ from our internal type)
interface RawMessage {
  id: string;
  messageId?: string;
  conversationId: string;
  senderId: string;
  content: string;
  type: string;
  offset: number;
  mediaId?: string;
  mediaStatus?: MediaStatus;
  replyToId?: string;
  replyToMessageId?: string;
  clientMessageId?: string;
  attachments?: AttachmentRef[] | null;
  metadata?: {
    mentions?: string[];
    tags?: string[];
    attachmentUrls?: string[];
    url?: string;
    waveform?: number[];
    durationMs?: number;
  };
  createdAt: string;
  updatedAt?: string;
  editedAt?: string;
  deletedAt?: string;
  isDeleted?: boolean;
  isRevoked?: boolean;
  isEdited?: boolean;
}

// ─── Public Message type ──────────────────────────────────────────────────────

export interface Message {
  messageId: string;
  conversationId: string;
  senderId: string;
  content: string;
  type: MessageType;
  offset: number;
  mediaId?: string;
  mediaStatus?: MediaStatus;
  attachments?: AttachmentRef[] | null;
  replyToMessageId?: string;
  clientMessageId?: string;
  metadata?: {
    mentions?: string[];
    tags?: string[];
    attachmentUrls?: string[];
    url?: string;
    waveform?: number[];
    durationMs?: number;
    thumbMediaId?: string;
    fileSize?: number;
  };
  createdAt: string;
  updatedAt: string;
  editedAt?: string;
  deletedAt?: string;
  isRevoked?: boolean;
  reactions?: Record<string, number>;
  // local-only optimistic fields
  _pending?: boolean;
  _failed?: boolean;
  _localPreviewUrl?: string;
  _uploadProgress?: number;
}

export interface MessagePage {
  data: Message[];
  meta: {
    hasMore: boolean;
    oldestOffset: number;
    newestOffset: number;
  };
}

export interface SendMessagePayload {
  clientMessageId: string;
  conversationId: string;
  content?: string;
  type?: MessageType;
  replyToMessageId?: string;
  mediaId?: string;
  attachments?: AttachmentRef[];
  metadata?: {
    mentions?: string[];
    tags?: string[];
    attachmentUrls?: string[];
    url?: string;
    waveform?: number[];
    durationMs?: number;
    thumbMediaId?: string;
    fileSize?: number;
  };
}

// ─── Normalizer ───────────────────────────────────────────────────────────────

function isMediaMessageType(type: string | undefined): type is MessageType {
  return type === "image" || type === "video" || type === "audio" || type === "file" || type === "media";
}

function normalizeMediaStatus(status: string | undefined): MediaStatus | undefined {
  if (!status) return undefined;
  const s = status.toLowerCase();
  if (s === "created" || s === "uploaded" || s === "processing" || s === "ready" || s === "failed") {
    return s;
  }
  return undefined;
}

function normalizeRawMessage(m: RawMessage): Message {
  const normalizedType = (m.type ?? "text").toLowerCase() as MessageType;
  const attachments = m.attachments?.map((attachment) => ({
    mediaId: attachment.mediaId,
    type: attachment.type ?? attachment.kind,
    kind: attachment.kind,
    status: attachment.status,
    prefer: attachment.prefer,
    variantsReady: attachment.variantsReady,
    filename: attachment.filename,
  })) ?? null;
  const firstAttachment = attachments?.[0];
  const derivedMediaId = m.mediaId ?? firstAttachment?.mediaId;
  const topLevelStatus = normalizeMediaStatus(m.mediaStatus as string | undefined);
  const attachmentStatus = normalizeMediaStatus(firstAttachment?.status);
  // If server returns no explicit status but there's a mediaId and the message has a positive
  // offset (it's a real, confirmed message), assume the media is accessible (READY).
  // "processing" should only be used for brand-new optimistic messages (offset <= 0).
  const derivedMediaStatus = topLevelStatus ?? attachmentStatus ?? (isMediaMessageType(normalizedType) && derivedMediaId
    ? (Number(m.offset ?? 0) > 0 ? "ready" : "processing")
    : undefined);

  return {
    ...m,
    messageId: m.messageId ?? m.id,
    type: normalizedType,
    content: typeof m.content === "string" ? m.content : "",
    offset: Number(m.offset ?? 0),
    mediaId: derivedMediaId,
    mediaStatus: derivedMediaStatus,
    updatedAt: m.updatedAt ?? m.createdAt,
    deletedAt: m.deletedAt ?? (m.isDeleted ? m.createdAt : undefined),
    isRevoked: m.isRevoked ?? false,
    editedAt: m.editedAt ?? (m.isEdited ? (m.updatedAt ?? m.createdAt) : undefined),
    // API uses replyToId; WS uses replyToMessageId — normalise to replyToMessageId
    replyToMessageId: m.replyToMessageId ?? m.replyToId,
    attachments,
  };
}

// ─── GET messages ─────────────────────────────────────────────────────────────

export async function getMessages(params: {
  conversationId: string;
  before?: number;
  after?: number;
  limit?: number;
}): Promise<MessagePage> {
  const { conversationId, before, after, limit = 50 } = params;
  const query = new URLSearchParams({ limit: String(limit) });
  if (before !== undefined) query.set("before", String(before));
  if (after !== undefined) query.set("after", String(after));

  const res = await apiClient.get(
    `/conversations/${conversationId}/messages?${query}`
  );
  // API returns { statusCode, data: { data: Message[], meta: {...} } }
  const payload = res.data?.data ?? {};
  const rawMessages: RawMessage[] = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload)
      ? payload
      : [];
  const meta: { hasMore?: boolean; oldestOffset?: number | string; newestOffset?: number | string } =
    payload.meta ?? {};
  return {
    data: rawMessages.map(normalizeRawMessage),
    meta: {
      hasMore: meta.hasMore ?? false,
      oldestOffset: Number(meta.oldestOffset ?? 0),
      newestOffset: Number(meta.newestOffset ?? 0),
    },
  };
}

// ─── POST /chat/messages ──────────────────────────────────────────────────────

export async function sendMessage(payload: SendMessagePayload): Promise<Message | null> {
  const { replyToMessageId, mediaId, content, type, ...rest } = payload;
  // Build a clean body — omit undefined/empty fields
  const body: Record<string, unknown> = { ...rest, type };
  // API field name is replyToId
  if (replyToMessageId) body.replyToId = replyToMessageId;
  // Audio messages are allowed to send an empty string; other message types omit empty content.
  if (content !== undefined && (content.length > 0 || type === "audio")) {
    body.content = content;
  }
  // API rejects top-level mediaId for image/video/audio/file — use attachments array
  if (mediaId) {
    if (type === "sticker") {
      body.mediaId = mediaId;
    } else {
      const existingAttachments = payload.attachments ?? [];
      body.attachments = existingAttachments.length > 0
        ? existingAttachments
        : [{ mediaId, type }];
    }
  }
  // Strip client-only 'filename' field — backend rejects unknown attachment properties
  if (body.attachments && Array.isArray(body.attachments)) {
    body.attachments = (body.attachments as AttachmentRef[]).map(
      ({ mediaId, type }) => ({ mediaId, ...(type ? { type } : {}) })
    );
  }

  const res = await apiClient.post("/chat/messages", body);
  const raw = (res.data?.data ?? null) as RawMessage | null;
  if (!raw) return null;
  return normalizeRawMessage(raw);
}

// ─── PATCH /messages/:id ──────────────────────────────────────────────────────

export async function editMessage(messageId: string, content: string): Promise<void> {
  await apiClient.patch(`/messages/${messageId}`, { content });
}

// ─── DELETE /messages/:id ─────────────────────────────────────────────────────

export async function deleteMessage(messageId: string): Promise<void> {
  await apiClient.delete(`/messages/${messageId}`);
}

// ─── POST /messages/:id/revoke ────────────────────────────────────────────────

export async function revokeMessage(
  messageId: string,
  conversationId: string
): Promise<void> {
  await apiClient.post(`/messages/${messageId}/revoke`, { conversationId });
}

// ─── DELETE /messages/:id/for-me ─────────────────────────────────────────────

export async function deleteMessageForMe(
  messageId: string,
  conversationId: string
): Promise<void> {
  await apiClient.delete(`/messages/${messageId}/for-me`, {
    params: { conversationId },
  });
}

// ─── POST /messages/forward ───────────────────────────────────────────────────

export async function forwardMessage(params: {
  sourceMessageId: string;
  sourceConversationId: string;
  targetConversationIds: string[];
}): Promise<string[]> {
  const res = await apiClient.post("/messages/forward", params);
  return res.data?.data?.forwardedMessageIds ?? [];
}

// ─── POST /messages/:id/pin ───────────────────────────────────────────────────

export async function pinMessage(
  messageId: string,
  conversationId: string
): Promise<void> {
  await apiClient.post(`/messages/${messageId}/pin`, { conversationId });
}

// ─── POST /messages/:id/reactions ────────────────────────────────────────────

export async function addReaction(messageId: string, emoji: string): Promise<void> {
  await apiClient.post(`/messages/${messageId}/reactions`, { emoji });
}

// ─── DELETE /messages/:id/pin ─────────────────────────────────────────────────

export async function unpinMessage(
  messageId: string,
  conversationId: string
): Promise<void> {
  await apiClient.delete(`/messages/${messageId}/pin`, {
    params: { conversationId },
  });
}

// ─── GET /conversations/:id/pinned ────────────────────────────────────────────

export async function getPinnedMessages(conversationId: string): Promise<Message[]> {
  const res = await apiClient.get(`/conversations/${conversationId}/pinned`);
  const raw: RawMessage[] = Array.isArray(res.data?.data) ? res.data.data : [];
  return raw.map(normalizeRawMessage);
}
