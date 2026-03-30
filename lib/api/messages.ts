import { apiClient } from "@/lib/api/client";
import type { MessageType, MediaStatus } from "@/lib/socket/events";

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
  return res.data;
}
