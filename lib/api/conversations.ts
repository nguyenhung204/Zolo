import { apiClient } from "@/lib/api/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConversationKind = "direct" | "group" | "community";
export type MemberRole = "owner" | "admin" | "member";

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
  // Group management settings (only present for group conversations)
  isPublic?: boolean;
  joinApprovalRequired?: boolean;
  allowMemberMessage?: boolean;
  linkVersion?: number;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeConversation(raw: any): Conversation {
  return { ...raw, kind: raw.kind ?? raw.type };
}

export async function getConversations(): Promise<Conversation[]> {
  const res = await apiClient.get("/conversations");
  const d = res.data?.data?.conversations ?? res.data?.data;
  return Array.isArray(d) ? d.map(normalizeConversation) : [];
}

export async function getConversation(id: string): Promise<Conversation> {
  const res = await apiClient.get(`/conversations/${id}`);
  return normalizeConversation(res.data.data);
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
  const { kind, ...rest } = payload;
  const res = await apiClient.post("/conversations", {
    ...rest,
    type: kind,
  });
  return normalizeConversation(res.data.data);
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

/** Bulk-remove members. Body: `{ userIds }` — DELETE /conversations/:id/members */
export async function removeConversationMembers(
  id: string,
  userIds: string[]
): Promise<void> {
  await apiClient.delete(`/conversations/${id}/members`, { data: { userIds } });
}

export async function setConversationMemberRole(
  conversationId: string,
  userId: string,
  role: MemberRole
): Promise<void> {
  await apiClient.patch(
    `/conversations/${conversationId}/members/${userId}/role`,
    { role }
  );
}

/** GET /conversations/health/outbox — outbox queue health (public) */
export async function getOutboxHealth(): Promise<{ status: string; pendingCount?: number }> {
  const res = await apiClient.get("/conversations/health/outbox");
  return res.data?.data ?? res.data;
}
