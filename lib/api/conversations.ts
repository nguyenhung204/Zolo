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
  myOffset?: number;
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
    id?: string;
    content: string | null;
    type: string;
    offset?: number;
    senderId: string;
    sender?: { id: string; username: string; displayName: string; avatarUrl: string | null } | null;
    isDeleted?: boolean;
    isRevoked?: boolean;
    attachments?: Array<{ mediaId: string; type: string; url: string | null }> | null;
    createdAt: string;
    metadata?: {
      systemType?: "system_call";
      [key: string]: unknown;
    };
  } | null;
  // Group management settings (only present for group conversations)

  joinApprovalRequired?: boolean;
  allowMemberMessage?: boolean;
  linkVersion?: number;
}

export interface ConversationSearchResult {
  conversations: Conversation[];
  total: number;
  page: number;
  limit: number;
}

export interface ConversationMember {
  id: string;
  conversationId: string;
  userId: string;
  role: MemberRole;
  displayName?: string;
  email?: string;
  username?: string;
  avatarUrl?: string | null;
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
function normalizeLastMessage(raw: any): NonNullable<Conversation["lastMessage"]> {
  return {
    id: raw.id,
    content: raw.content ?? null,
    type: String(raw.type ?? "text"),
    offset: raw.offset != null ? Number(raw.offset) : undefined,
    senderId: String(raw.senderId ?? ""),
    sender: raw.sender ?? null,
    isDeleted: Boolean(raw.isDeleted ?? false),
    isRevoked: Boolean(raw.isRevoked ?? false),
    attachments: Array.isArray(raw.attachments) ? raw.attachments : (raw.attachments ?? null),
    createdAt: raw.createdAt ?? new Date(0).toISOString(),
    ...(raw.metadata ? { metadata: raw.metadata } : {}),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeConversation(raw: any): Conversation {
  const rawKind = raw.kind ?? raw.type;
  const kind = rawKind === "announcement" ? "community" : rawKind;
  const createdAt = raw.createdAt ?? new Date(0).toISOString();
  return {
    ...raw,
    kind,
    name: raw.name ?? null,
    description: raw.description ?? null,
    avatarMediaId: raw.avatarMediaId ?? null,
    avatarUrl: raw.avatarUrl ?? null,
    memberCount: Number(raw.memberCount ?? 0),
    maxOffset: Number(raw.maxOffset ?? 0),
    myOffset: raw.myOffset == null ? undefined : Number(raw.myOffset),
    lastSeenOffset: raw.lastSeenOffset == null
      ? (raw.myOffset == null ? undefined : Number(raw.myOffset))
      : Number(raw.lastSeenOffset),
    createdBy: raw.createdBy ?? "",
    createdAt,
    updatedAt: raw.updatedAt ?? createdAt,
    lastMessage: raw.lastMessage != null ? normalizeLastMessage(raw.lastMessage) : undefined,
  };
}

export async function getConversations(params?: {
  page?: number;
  limit?: number;
  avatarVariant?: "thumb" | "original";
}): Promise<Conversation[]> {
  const res = await apiClient.get("/conversations", {
    params: { page: 1, limit: 20, avatarVariant: "thumb", ...params },
  });
  const d = res.data?.data?.conversations ?? res.data?.data;
  return Array.isArray(d) ? d.map(normalizeConversation) : [];
}

export async function searchConversations(params: {
  q?: string;
  page?: number;
  limit?: number;
  avatarVariant?: "thumb" | "original";
}): Promise<ConversationSearchResult> {
  const res = await apiClient.get("/conversations/search", {
    params: {
      page: 1,
      limit: 20,
      avatarVariant: "thumb",
      ...params,
    },
  });
  const data = res.data?.data ?? {};
  const conversations = Array.isArray(data.conversations)
    ? data.conversations.map(normalizeConversation)
    : [];
  return {
    conversations,
    total: Number(data.total ?? conversations.length),
    page: Number(data.page ?? params.page ?? 1),
    limit: Number(data.limit ?? params.limit ?? 20),
  };
}

export async function getConversation(id: string): Promise<Conversation> {
  const res = await apiClient.get(`/conversations/${id}`);
  return normalizeConversation(res.data.data);
}

export async function getConversationMembers(id: string): Promise<ConversationMember[]> {
  const res = await apiClient.get(`/conversations/${id}/members`, {
    params: { avatarVariant: "thumb" },
  });
  const d = res.data?.data;
  if (!Array.isArray(d)) return [];
  return d.map((member) => ({
    id: member.id ?? member.userId,
    conversationId: member.conversationId ?? id,
    userId: member.userId,
    role: String(member.role ?? "member").toLowerCase() as MemberRole,
    displayName: member.displayName,
    email: member.email,
    username: member.username ?? member.email,
    avatarUrl: member.avatarUrl ?? null,
    lastSeenOffset: Number(member.lastSeenOffset ?? 0),
    lastDeliveredOffset: Number(member.lastDeliveredOffset ?? 0),
    joinedAt: member.joinedAt ?? "",
    leftAt: member.leftAt ?? null,
  }));
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

export type AddMembersResult =
  | { success: true; requiresApproval: false; addedUserIds: string[] }
  | { success: true; requiresApproval: true; pendingRequests: Array<{ requestId: string; userId: string }>; skippedAlreadyMembers: string[]; skippedAlreadyRequested: string[] };

export async function addConversationMembers(
  id: string,
  userIds: string[]
): Promise<AddMembersResult> {
  const res = await apiClient.post(`/conversations/${id}/members`, { userIds });
  return res.data.data as AddMembersResult;
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
