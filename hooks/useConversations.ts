import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getConversations,
  getConversation,
  createConversation,
  updateConversationInfo,
  addConversationMembers,
  removeConversationMembers,
  setConversationMemberRole,
  type ConversationMember,
  type MemberRole,
  type CreateConversationPayload,
  type UpdateConversationInfoPayload,
} from "@/lib/api/conversations";
import { queryKeys } from "@/lib/query/keys";
import { useAuthStore } from "@/stores/authStore";
import { prefetchMessages } from "@/hooks/useMessages";

const TOP_CONVERSATIONS_TO_PREFETCH = 10;

export function useConversations() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.conversations.list(),
    queryFn: getConversations,
    staleTime: 30_000,
    enabled: isAuthenticated,
  });

  // Warm the message cache for the top-N most recent conversations
  useEffect(() => {
    if (!query.data) return;
    query.data.slice(0, TOP_CONVERSATIONS_TO_PREFETCH).forEach((conv) => {
      prefetchMessages(qc, conv.id);
    });
  // Only run when the conversation list first loads or changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.dataUpdatedAt]);

  return query;
}

export function useConversation(id: string) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: queryKeys.conversations.detail(id),
    queryFn: () => getConversation(id),
    enabled: isAuthenticated && !!id,
  });
}

export function useConversationMembers(id: string) {
  const { data: conversation } = useConversation(id);

  const members: (ConversationMember & { displayName?: string; username?: string; avatarUrl?: string | null })[] =
    (conversation?.participants ?? []).map((p) => ({
      id: p.userId,
      conversationId: id,
      userId: p.userId,
      role: p.role.toUpperCase() as MemberRole,
      lastSeenOffset: 0,
      lastDeliveredOffset: 0,
      joinedAt: conversation?.createdAt ?? "",
      leftAt: null,
      displayName: p.displayName,
      username: p.username,
      avatarUrl: p.avatarUrl,
    }));

  return { data: members, isLoading: !conversation };
}

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateConversationPayload) => createConversation(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.conversations.list() });
    },
  });
}

export function useMyConversationRole(conversationId: string): MemberRole | null {
  const { data: conv } = useConversation(conversationId);
  const userId = useAuthStore((s) => s.user?.id);
  if (!conv || !userId) return null;
  const p = conv.participants?.find((part) => part.userId === userId);
  if (!p) return null;
  return p.role.toUpperCase() as MemberRole;
}

export function useUpdateConversationInfo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & UpdateConversationInfoPayload) =>
      updateConversationInfo(id, payload),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.conversations.list() });
    },
  });
}

export function useAddConversationMembers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, userIds }: { conversationId: string; userIds: string[] }) =>
      addConversationMembers(conversationId, userIds),
    onSuccess: (_data, { conversationId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
    },
  });
}

export function useRemoveConversationMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, userId }: { conversationId: string; userId: string }) =>
      removeConversationMembers(conversationId, [userId]),
    onSuccess: (_data, { conversationId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
    },
  });
}

export function useSetMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      userId,
      role,
    }: {
      conversationId: string;
      userId: string;
      role: MemberRole;
    }) => setConversationMemberRole(conversationId, userId, role),
    onSuccess: (_data, { conversationId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
    },
  });
}
