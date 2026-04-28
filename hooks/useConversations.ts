import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getConversations,
  getConversation,
  createConversation,
  updateConversationInfo,
  addConversationMembers,
  removeConversationMember,
  removeConversationMembers,
  setConversationMemberRole,
  getOutboxHealth,
  type MemberRole,
  type CreateConversationPayload,
  type UpdateConversationInfoPayload,
} from "@/lib/api/conversations";
import { queryKeys } from "@/lib/query/keys";
import { useAuthStore } from "@/stores/authStore";
import { usePresenceStore } from "@/stores/presenceStore";
import { prefetchMessages } from "@/hooks/useMessages";

const TOP_CONVERSATIONS_TO_PREFETCH = 10;

export function useConversations() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const qc = useQueryClient();
  const setUserProfile = usePresenceStore((s) => s.setUserProfile);

  const query = useQuery({
    queryKey: queryKeys.conversations.list(),
    queryFn: getConversations,
    // Presigned URLs expire in 5 min — keep stale time just under that so we
    // don't refetch more often than necessary. WS events keep all other fields
    // (lastMessage, maxOffset, unread) up-to-date without polling.
    staleTime: 4 * 60_000,
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

  // Seed presenceStore.profileMap for direct conversation peers so UserAvatar
  // can show avatars immediately without waiting for the conversation detail.
  useEffect(() => {
    if (!query.data) return;
    for (const conv of query.data) {
      const ou = conv.otherUser;
      if (!ou?.avatarUrl) continue;
      // Always seed with the freshest presigned URL from the API. WS
      // profile-updated events call setUserProfile directly and will overwrite
      // this when the user changes their avatar.
      setUserProfile(ou.id, {
        displayName: ou.displayName ?? ou.username ?? null,
        avatarMediaId: null,
        avatarUrl: ou.avatarUrl,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.dataUpdatedAt, setUserProfile]);

  return query;
}

export function useConversation(id: string) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const qc = useQueryClient();
  const result = useQuery({
    queryKey: queryKeys.conversations.detail(id),
    queryFn: () => getConversation(id),
    enabled: isAuthenticated && !!id,
    staleTime: 5 * 60 * 1000, // conversation metadata changes rarely; WS events handle real-time updates
    retry: (failureCount, error) => {
      // Never retry 403/404 — the user is not a member (or it doesn't exist).
      const status = (error as { status?: number })?.status;
      if (status === 403 || status === 404) return false;
      return failureCount < 2;
    },
  });

  // The detail response resolves avatarUrl via presigned URL while the list
  // response may not always include it. Sync it back so ConversationItem shows
  // the avatar without an extra fetch.
  const resolvedAvatarUrl = result.data?.avatarUrl;
  useEffect(() => {
    if (!resolvedAvatarUrl) return;
    qc.setQueryData<import("@/lib/api/conversations").Conversation[]>(
      queryKeys.conversations.list(),
      (old) => old?.map((c) => (c.id === id ? { ...c, avatarUrl: resolvedAvatarUrl } : c))
    );
  }, [resolvedAvatarUrl, id, qc]);

  return result;
}

export function useConversationMembers(id: string) {
  const profileMap = usePresenceStore((s) => s.profileMap);
  const setUserProfile = usePresenceStore((s) => s.setUserProfile);
  const { data: conversation, isLoading } = useConversation(id);

  // The /members endpoint only returns IDs. All profile data (displayName,
  // username, avatarUrl, role) comes from conv.participants in the detail response.
  const directOtherUser = conversation?.kind === "direct" ? conversation.otherUser : null;

  const members = (conversation?.participants ?? []).map((p) => {
    const profile = profileMap[p.userId];
    const otherUser = directOtherUser?.id === p.userId ? directOtherUser : null;
    return {
      id: p.userId,
      conversationId: id,
      userId: p.userId,
      role: p.role as MemberRole,
      displayName:
        profile?.displayName ??
        p.displayName ??
        otherUser?.displayName ??
        p.username ??
        otherUser?.username ??
        "User",
      username: p.username ?? otherUser?.username,
      avatarUrl:
        profile?.avatarUrl ??
        (p as { avatarUrl?: string | null }).avatarUrl ??
        otherUser?.avatarUrl ??
        null,
      lastSeenOffset: 0,
      lastDeliveredOffset: 0,
      joinedAt: "",
      leftAt: null as string | null,
    };
  });

  // Seed presenceStore.profileMap for each member so UserAvatar stays in sync.
  useEffect(() => {
    for (const m of members) {
      if (!m.avatarUrl) continue;
      const already = usePresenceStore.getState().profileMap[m.userId];
      if (already?.avatarUrl) continue; // don't overwrite fresher WS data
      setUserProfile(m.userId, {
        displayName: m.displayName !== "User" ? m.displayName : null,
        avatarMediaId: null,
        avatarUrl: m.avatarUrl,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, setUserProfile]);

  return { data: members, isLoading };
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
  return p.role.toLowerCase() as MemberRole;
}

export function useUpdateConversationInfo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & UpdateConversationInfoPayload) =>
      updateConversationInfo(id, payload),
    onSuccess: async (_data, { id }) => {
      // PATCH response doesn't include a resolved avatarUrl — fetch the detail
      // once so we have the presigned URL for immediate display.
      const fresh = await getConversation(id).catch(() => null);
      if (fresh) {
        qc.setQueryData(queryKeys.conversations.detail(id), fresh);
        // Apply all changed fields (name, description, avatarUrl) to the list cache
        // in one setQueryData — the WS conversation:updated event will arrive
        // shortly and apply the same patch idempotently.
        qc.setQueryData<import("@/lib/api/conversations").Conversation[]>(
          queryKeys.conversations.list(),
          (old) =>
            old?.map((c) =>
              c.id === id
                ? { ...c, name: fresh.name, description: fresh.description, avatarUrl: fresh.avatarUrl ?? c.avatarUrl }
                : c
            ) ?? old
        );
      } else {
        qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(id) });
        qc.invalidateQueries({ queryKey: queryKeys.conversations.list() });
      }
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
      removeConversationMember(conversationId, userId),
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

/** Bulk-remove members: DELETE /conversations/:id/members with body { userIds } */
export function useRemoveConversationMembers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, userIds }: { conversationId: string; userIds: string[] }) =>
      removeConversationMembers(conversationId, userIds),
    onSuccess: (_data, { conversationId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.conversations.members(conversationId) });
      qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
    },
  });
}

/** GET /conversations/health/outbox */
export function useOutboxHealth() {
  return useQuery({
    queryKey: ["outbox", "health"],
    queryFn: getOutboxHealth,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
