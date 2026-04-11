import { apiClient } from "@/lib/api/client";
import type { MessageType, MediaStatus } from "@/lib/socket/events";

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
  replyToMessageId?: string;
  clientMessageId?: string;
  metadata?: { mentions?: string[]; tags?: string[]; attachmentUrls?: string[] };
  createdAt: string;
  updatedAt?: string;
  editedAt?: string;
  deletedAt?: string;
  isDeleted?: boolean;
}

export interface Message {
  messageId: string;
  conversationId: string;
  senderId: string;
  content: string;
  type: MessageType;
  offset: number;
  mediaId?: string;
  mediaStatus?: MediaStatus;
  replyToMessageId?: string;
  clientMessageId?: string;
  metadata?: {
    mentions?: string[];
    tags?: string[];
    attachmentUrls?: string[];
  };
  createdAt: string;
  updatedAt: string;
  editedAt?: string;
  deletedAt?: string;
  // local-only optimistic fields
  _pending?: boolean;
  _failed?: boolean;
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
  content: string;
  type?: MessageType;
  replyToMessageId?: string;
  mediaId?: string;
  metadata?: {
    mentions?: string[];
    tags?: string[];
    attachmentUrls?: string[];
  };
}

function normalizeRawMessage(m: RawMessage): Message {
  return {
    ...m,
    messageId: m.messageId ?? m.id,
    type: (m.type ?? "text").toLowerCase() as MessageType,
    updatedAt: m.updatedAt ?? m.createdAt,
    deletedAt: m.deletedAt ?? (m.isDeleted ? m.createdAt : undefined),
  };
}

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
  const rawMessages: RawMessage[] = res.data.data;
  const metadata: { hasMore: boolean; oldestOffset: string | number; newestOffset: string | number } =
    res.data.metadata ?? {};
  return {
    data: rawMessages.map(normalizeRawMessage),
    meta: {
      hasMore: metadata.hasMore ?? false,
      oldestOffset: Number(metadata.oldestOffset ?? 0),
      newestOffset: Number(metadata.newestOffset ?? 0),
    },
  };
}

export async function sendMessage(payload: SendMessagePayload): Promise<Message | null> {
  const res = await apiClient.post("/chat/messages", payload);
  const raw = (res.data?.data ?? null) as RawMessage | null;
  if (!raw) return null;
  return normalizeRawMessage(raw);
}
