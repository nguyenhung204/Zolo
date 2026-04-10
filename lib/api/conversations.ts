import { apiClient } from "@/lib/api/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConversationKind = "DIRECT" | "GROUP" | "COMMUNITY";
export type MemberRole = "owner" | "admin" | "moderator" | "member" | "guest";

/** @deprecated Use ConversationKind */
export type ConversationType = ConversationKind;

export interface Conversation {
  id: string;
  kind: ConversationKind;
  name: string | null;
  description: string | null;
  avatarMediaId: string | null;
  avatarUrl: string | null;
  memberCount: number;
  maxOffset: number | string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  metadata?: {
    seeded?: boolean;
    [key: string]: unknown;
  };
  participants?: Array<{ userId: string; role: string; username?: string; displayName?: string; avatarUrl?: string | null }>;
  otherUser?: { id: string; username: string; displayName: string; avatarUrl?: string | null } | null;
  // Joined fields (from member record)
  lastSeenOffset?: number;
  lastDeliveredOffset?: number;
  // Last message preview (enriched by API)
  lastMessage?: {
    content: string;
    senderId: string;
    type: string;
    createdAt: string;
  };
}

export interface ConversationMember {
  id: string;
  conversationId: string;
  userId: string;
  role: MemberRole;
  lastSeenOffset: number;
  lastDeliveredOffset: number;
  joinedAt: string;
  leftAt: string | null;
}

export interface CreateConversationPayload {
  kind: ConversationKind;
  memberIds: string[];
  name?: string;
  description?: string;
  avatarMediaId?: string;
}

export interface UpdateConversationInfoPayload {
  name?: string;
  description?: string;
  avatarMediaId?: string;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function getConversations(): Promise<Conversation[]> {
  const res = await apiClient.get("/conversations");
  const d = res.data?.data?.conversations ?? res.data?.data;
  return Array.isArray(d) ? d : [];
}

export async function getConversation(id: string): Promise<Conversation> {
  const res = await apiClient.get(`/conversations/${id}`);
  return res.data.data;
}

export async function getConversationMembers(id: string): Promise<ConversationMember[]> {
  const res = await apiClient.get(`/conversations/${id}/members`);
  const d = res.data?.data;
  return Array.isArray(d) ? d : [];
}

export async function getUnreadCount(id: string): Promise<number> {
  const res = await apiClient.get(`/conversations/${id}/unread`);
  return res.data?.data?.unreadCount ?? 0;
}

export async function createConversation(
  payload: CreateConversationPayload
): Promise<Conversation> {
  const res = await apiClient.post("/conversations", {
    ...payload,
  });
  return res.data.data;
}

export async function updateSeenOffset(
  conversationId: string,
  offset: number
): Promise<void> {
  await apiClient.patch(`/conversations/${conversationId}/offset`, { offset });
}

export async function updateConversationInfo(
  id: string,
  payload: UpdateConversationInfoPayload
): Promise<Conversation> {
  const res = await apiClient.patch(`/conversations/${id}/info`, payload);
  return res.data.data;
}

export async function addConversationMembers(
  id: string,
  userIds: string[]
): Promise<void> {
  await apiClient.post(`/conversations/${id}/members`, { userIds });
}

export async function removeConversationMember(
  id: string,
  userId: string
): Promise<void> {
  await apiClient.delete(`/conversations/${id}/members/${userId}`);
}

export async function setConversationMemberRole(
  conversationId: string,
  userId: string,
  role: MemberRole
): Promise<void> {
  await apiClient.patch(
    `/conversations/${conversationId}/members/${userId}`,
    { role }
  );
}
