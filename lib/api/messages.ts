import { apiClient } from "@/lib/api/client";
import type { MessageType, MediaStatus } from "@/lib/socket/events";
import { useAuthStore } from "@/stores/authStore";

export type MessageDeliveryStatus = "sending" | "sent" | "delivered" | "read" | "failed";

// ─── System message action types ─────────────────────────────────────────────

export type SystemMessageAction =
  | "MEMBER_ADDED"
  | "MEMBER_LEFT"
  | "MEMBER_REMOVED"
  | "MEMBER_KICKED"
  | "ROLE_CHANGED"
  | "GROUP_INFO_UPDATED";

// ─── Reaction types ───────────────────────────────────────────────────────────

/** Per-emoji reaction detail — mirrors the shape sent by WS `message:reaction_updated`. */
export interface ReactionDetail {
  count: number;
  reactors: string[];   // User IDs who reacted
  myReaction: boolean;  // Whether the current user has this reaction
}

export type ReactionMap = Record<string, ReactionDetail>;

// ─── Raw API shapes ───────────────────────────────────────────────────────────

export interface AttachmentRef {
  mediaId: string;
  type?: "image" | "video" | "audio" | "file";
  kind?: "image" | "video" | "audio" | "file";
  status?: string;
  prefer?: "ORIGINAL" | "OPTIMIZED";
  variantsReady?: boolean;
  filename?: string;
  thumbMediaId?: string; // per-attachment thumbnail for videos in media groups
  width?: number;
  height?: number;
}

export interface LocalAttachmentPreview {
  previewUrl?: string;       // blob URL (image) or video blob URL
  thumbPreviewUrl?: string;  // captured first-frame blob URL (videos)
  mediaType: "image" | "video" | "audio" | "file";
  filename?: string;
  width?: number;
  height?: number;
}

// Raw shape returned by the REST endpoint (field names differ from our internal type)
interface RawMessage {
  id: string;
  messageId?: string;
  conversationId: string;
  senderId?: string | null;
  content?: string | null;
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
    thumbMediaId?: string;
    width?: number;
    height?: number;
    fileSize?: number;
    filename?: string;
    // system message fields (present when type === "system")
    action?: SystemMessageAction;
    actorId?: string;
    actorName?: string;
    targetIds?: string[];
    targetNames?: string[];
    joinSource?: "manual" | "invite_link" | "join_request";
    newRole?: string;
    changes?: { name?: string; avatarChanged?: boolean };
    ownershipTransferredTo?: string;
    visibility?: "all" | "admins";
    contactUserId?: string;
    cardType?: "friend_contact";
    contactUsername?: string;
    contactEmail?: string;
    contactAvatarId?: string;
  };
  createdAt: string;
  updatedAt?: string;
  editedAt?: string;
  deletedAt?: string;
  isDeleted?: boolean;
  isRevoked?: boolean;
  isEdited?: boolean;
  reactions?: unknown;
  status?: string;
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
    mentionAll?: boolean;
    tags?: string[];
    attachmentUrls?: string[];
    url?: string;
    waveform?: number[];
    durationMs?: number;
    thumbMediaId?: string;
    width?: number;
    height?: number;
    fileSize?: number;
    filename?: string;
    // call_summary fields
    callId?: string;
    status?: string;
    // system message fields
    actorId?: string;
    actorName?: string;       // pre-populated by message-store, no lookup needed
    targetIds?: string[];
    targetNames?: string[];   // parallel array — same order as targetIds
    joinSource?: "manual" | "invite_link" | "join_request";
    newRole?: string;
    changes?: { name?: string; avatarChanged?: boolean };
    ownershipTransferredTo?: string;
    visibility?: "all" | "admins";
    contactUserId?: string;
    cardType?: "friend_contact";
    contactUsername?: string;
    contactEmail?: string;
    contactAvatarId?: string;
    // system_call fields (present when type === "system" && systemType === "system_call")
    systemType?: "system_call";
    callerId?: string;
    callerName?: string;
    isMissed?: boolean;
    reason?: string;
    action?: SystemMessageAction | "CALL_MISSED" | "CALL_MISSED_BUSY" | "CALL_REJECTED" | "CALL_ENDED";
  };
  createdAt: string;
  updatedAt: string;
  editedAt?: string;
  deletedAt?: string;
  isRevoked?: boolean;
  reactions?: ReactionMap;
  deliveryStatus?: MessageDeliveryStatus;
  // local-only optimistic fields
  _pending?: boolean;
  _failed?: boolean;
  _localPreviewUrl?: string;
  _uploadProgress?: number;
  _localAttachments?: LocalAttachmentPreview[]; // for media group optimistic preview
  _mine?: boolean;
}

export interface MessagePage {
  data: Message[];
  meta: {
    hasMore: boolean;
    oldestOffset: number;
    newestOffset: number;
  };
  memberCursors?: Record<string, { seen: number; delivered: number }>;
}

export interface SendMessagePayload {
  clientMessageId: string;
  conversationId: string;
  content?: string;
  type?: MessageType;
  replyToMessageId?: string;
  mediaId?: string;
  attachments?: AttachmentRef[];
  /** Explicit user-ID mentions (max 50, group/announcement only) */
  mentions?: string[];
  metadata?: {
    mentions?: string[];
    mentionAll?: boolean;
    tags?: string[];
    attachmentUrls?: string[];
    url?: string;
    waveform?: number[];
    durationMs?: number;
    thumbMediaId?: string;
    width?: number;
    height?: number;
    fileSize?: number;
    filename?: string;
    contactUserId?: string;
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

function normalizeDeliveryStatus(status: string | undefined): MessageDeliveryStatus | undefined {
  if (!status) return undefined;
  const s = status.toLowerCase();
  if (s === "sending" || s === "sent" || s === "delivered" || s === "read" || s === "failed") {
    return s;
  }
  if (s === "accepted" || s === "saved") return "sent";
  return undefined;
}

export function normalizeReactionMap(reactions: unknown, viewerUserId?: string): ReactionMap | undefined {
  if (!reactions || typeof reactions !== "object") return undefined;

  const normalized: ReactionMap = {};
  for (const [emoji, value] of Object.entries(reactions as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      const reactors = value.filter((reactor): reactor is string => typeof reactor === "string");
      if (reactors.length === 0) continue;
      normalized[emoji] = {
        count: reactors.length,
        reactors,
        myReaction: viewerUserId ? reactors.includes(viewerUserId) : false,
      };
      continue;
    }

    if (!value || typeof value !== "object") continue;
    const rawDetail = value as { count?: number; reactors?: unknown; myReaction?: boolean };
    const reactors = Array.isArray(rawDetail.reactors)
      ? rawDetail.reactors.filter((reactor): reactor is string => typeof reactor === "string")
      : [];
    const count = typeof rawDetail.count === "number" && Number.isFinite(rawDetail.count)
      ? rawDetail.count
      : reactors.length;
    const myReaction = typeof rawDetail.myReaction === "boolean"
      ? rawDetail.myReaction
      : viewerUserId
        ? reactors.includes(viewerUserId)
        : false;

    if (count <= 0 && reactors.length === 0) continue;
    normalized[emoji] = { count, reactors, myReaction };
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeRawMessage(m: RawMessage): Message {
  const viewerUserId = useAuthStore.getState().user?.id;
  const normalizedType = (m.type ?? "text").toLowerCase() as MessageType;
  const attachments = m.attachments?.map((attachment) => ({
    mediaId: attachment.mediaId,
    type: attachment.type ?? attachment.kind,
    kind: attachment.kind,
    status: attachment.status,
    prefer: attachment.prefer,
    variantsReady: attachment.variantsReady,
    filename: attachment.filename,
    thumbMediaId: attachment.thumbMediaId,
    width: attachment.width,
    height: attachment.height,
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
  const reactions = normalizeReactionMap(
    m.reactions ?? (m.metadata as { reactions?: unknown } | undefined)?.reactions,
    viewerUserId
  );

  return {
    ...m,
    messageId: m.messageId ?? m.id,
    senderId: normalizedType === "system" ? "SYSTEM" : m.senderId ?? "",
    type: normalizedType,
    content: typeof m.content === "string" ? m.content : "",
    offset: Number(m.offset ?? 0),
    mediaId: derivedMediaId,
    mediaStatus: derivedMediaStatus,
    updatedAt: m.updatedAt ?? m.createdAt,
    deletedAt: m.deletedAt ?? (m.isDeleted ? m.createdAt : undefined),
    isRevoked: m.isRevoked ?? false,
    editedAt: m.editedAt ?? (m.isEdited ? (m.updatedAt ?? m.createdAt) : undefined),
    // Both API and WS use replyToMessageId; keep replyToId as fallback for legacy data
    replyToMessageId: m.replyToMessageId ?? m.replyToId,
    attachments,
    reactions,
    deliveryStatus: normalizeDeliveryStatus(m.status),
  };
}

function normalizeMemberCursors(value: unknown): Record<string, { seen: number; delivered: number }> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const entries = Object.entries(value as Record<string, { seen?: unknown; delivered?: unknown }>)
    .map(([userId, cursor]) => [
      userId,
      {
        seen: Number(cursor?.seen ?? 0),
        delivered: Number(cursor?.delivered ?? 0),
      },
    ] as const);

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

// ─── GET messages ─────────────────────────────────────────────────────────────

export async function getMessages(params: {
  conversationId: string;
  before?: number;
  after?: number;
  limit?: number;
}): Promise<MessagePage> {
  const { conversationId, before, after, limit = 20 } = params;
  const query = new URLSearchParams({ limit: String(limit) });
  if (before !== undefined) query.set("before", String(before));
  if (after !== undefined) query.set("after", String(after));

  const res = await apiClient.get(
    `/conversations/${conversationId}/messages?${query}`
  );
  // API returns either a flat payload or a nested payload:
  // { data: Message[], metadata: { ..., memberCursors } } or
  // { data: { data: Message[], meta, memberCursors } }.
  const response = res.data ?? {};
  const payload = response.data ?? {};
  const rawMessages: RawMessage[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.data)
      ? payload.data
    : [];
  // Support both "metadata" (actual API) and "meta" (legacy/future shape)
  const meta: {
    hasMore?: boolean;
    oldestOffset?: number | string;
    newestOffset?: number | string;
    memberCursors?: unknown;
  } =
    payload.metadata ?? payload.meta ?? response.metadata ?? response.meta ?? {};
  const memberCursors = normalizeMemberCursors(
    (!Array.isArray(payload) ? payload.memberCursors : undefined) ?? meta.memberCursors
  );
  return {
    data: rawMessages.map(normalizeRawMessage),
    meta: {
      hasMore: meta.hasMore ?? false,
      oldestOffset: Number(meta.oldestOffset ?? 0),
      newestOffset: Number(meta.newestOffset ?? 0),
    },
    memberCursors,
  };
}

// ─── POST /chat/messages ──────────────────────────────────────────────────────

export async function sendMessage(payload: SendMessagePayload): Promise<Message | null> {
  const { replyToMessageId, mediaId, content, type, mentions, ...rest } = payload;
  // Build a clean body — omit undefined/empty fields
  const body: Record<string, unknown> = { ...rest, type };
  // Top-level mentions array (explicit user-ID mentions)
  if (mentions && mentions.length > 0) body.mentions = mentions;
  if (replyToMessageId) body.replyToMessageId = replyToMessageId;
  // Audio, sticker and contact cards are allowed to send an empty string; other message types omit empty content.
  if (content !== undefined && (content.length > 0 || type === "audio" || type === "sticker" || type === "contact_card")) {
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
  if (raw) {
    // The 201 response only contains { messageId, clientMessageId, conversationId, status }.
    // Fill in type / content / metadata from the payload so normalizeRawMessage does not
    // default type to "text" and wipe out optimistic messages of other types (image, file…).
    return normalizeRawMessage({
      ...raw,
      conversationId: raw.conversationId ?? payload.conversationId,
      type: raw.type ?? payload.type ?? "text",
      content: typeof raw.content === "string" ? raw.content : (payload.content ?? ""),
      metadata: raw.metadata ?? (payload.metadata as RawMessage["metadata"]),
      attachments: (raw.attachments ?? payload.attachments) as RawMessage["attachments"],
    });
  }
  // Some endpoints (e.g. sticker) return { success: true, messageId: "..." } without a full
  // message object. Return a partial message containing only the id so markAcked can dedup.
  const shortId: string | undefined = res.data?.messageId ?? res.data?.id;
  if (shortId) return { messageId: shortId } as Message;
  return null;
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

export async function addReaction(
  messageId: string,
  conversationId: string,
  emoji: string,
  action: "add" | "remove"
): Promise<void> {
  await apiClient.post(`/messages/${messageId}/reactions`, { conversationId, emoji, action });
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
