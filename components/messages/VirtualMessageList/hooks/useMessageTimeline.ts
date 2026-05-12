"use client";

import { useEffect, useMemo } from "react";
import type { Message } from "@/lib/api/messages";
import type { ConversationMember } from "@/lib/api/conversations";
import type { ListItem, RichMember, OtherMember } from "../types";
import { useMessages } from "@/hooks/useMessages";
import { useConversation, useMyConversationRole } from "@/hooks/useConversations";
import { usePolls } from "@/hooks/useGroup";
import { useAuthStore } from "@/stores/authStore";
import { buildItems, isActivePoll } from "../utils/buildItems";
import { getQueryClient } from "@/lib/query/queryClient";
import { queryKeys } from "@/lib/query/keys";

export function useMessageTimeline(conversationId: string, members: ConversationMember[]) {
  const userId = useAuthStore((s) => s.user?.id ?? "");

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, refetch } =
    useMessages(conversationId);

  const { data: conversation } = useConversation(conversationId);
  const myRole = useMyConversationRole(conversationId);
  const canPinMessages = !!myRole;
  const supportsPolls = conversation?.kind === "group";
  const { data: polls = [] } = usePolls(conversationId, supportsPolls);
  const allowMemberMessage = conversation?.allowMemberMessage ?? true;

  // Flatten pages — oldest first
  const messages: Message[] = useMemo(
    () => (data?.pages ? [...data.pages].reverse().flatMap((p) => p.data) : []),
    [data?.pages],
  );

  const visiblePolls = useMemo(
    () =>
      supportsPolls
        ? polls.filter((p) => p.id && p.question && p.options.length > 0)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supportsPolls, polls],
  );

  const latestActivePoll = useMemo(
    () =>
      visiblePolls
        .filter(isActivePoll)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .at(-1) ?? null,
    [visiblePolls],
  );

  const items: ListItem[] = useMemo(
    () => buildItems(messages, visiblePolls),
    [messages, visiblePolls],
  );

  const messageById = useMemo(
    () => new Map(messages.map((m) => [m.messageId, m])),
    [messages],
  );

  const memberMap = useMemo(
    () => new Map(members.map((m) => [m.userId, m as RichMember])),
    [members],
  );

  const otherMembers: OtherMember[] = useMemo(() => {
    const memberCursors = new Map<string, { seen: number; delivered: number }>();
    for (const page of data?.pages ?? []) {
      for (const [cursorUserId, cursor] of Object.entries(page.memberCursors ?? {})) {
        const prev = memberCursors.get(cursorUserId);
        memberCursors.set(cursorUserId, {
          seen: Math.max(prev?.seen ?? 0, Number(cursor.seen ?? 0)),
          delivered: Math.max(prev?.delivered ?? 0, Number(cursor.delivered ?? 0)),
        });
      }
    }
    const result: OtherMember[] = members
      .filter((m) => m.userId !== userId)
      .map((m) => ({
        userId: m.userId,
        lastSeenOffset: Math.max(
          Number(m.lastSeenOffset ?? 0),
          memberCursors.get(m.userId)?.seen ?? 0,
        ),
        lastDeliveredOffset: Math.max(
          Number(m.lastDeliveredOffset ?? 0),
          memberCursors.get(m.userId)?.delivered ?? 0,
        ),
        avatarUrl: (m as RichMember).avatarUrl ?? null,
        displayName: (m as RichMember).displayName,
        username: (m as RichMember).username,
      }));

    const memberIds = new Set(result.map((m) => m.userId));
    for (const [cursorUserId, cursor] of memberCursors) {
      if (cursorUserId === userId || memberIds.has(cursorUserId)) continue;
      result.push({
        userId: cursorUserId,
        lastSeenOffset: cursor.seen,
        lastDeliveredOffset: cursor.delivered,
        avatarUrl: null,
      });
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, data?.pages, userId]);

  // Keep conversation list updated with the latest active poll as "last message"
  useEffect(() => {
    if (!latestActivePoll) return;
    getQueryClient().setQueryData<import("@/lib/api/conversations").Conversation[]>(
      queryKeys.conversations.list(),
      (old) =>
        old?.map((conv) =>
          conv.id === conversationId
            ? {
                ...conv,
                lastMessage: {
                  id: latestActivePoll.id,
                  content: latestActivePoll.question || "Bình chọn",
                  type: "poll",
                  senderId: latestActivePoll.creatorId,
                  createdAt: latestActivePoll.createdAt,
                },
                updatedAt: latestActivePoll.createdAt,
              }
            : conv,
        ) ?? old,
    );
  }, [conversationId, latestActivePoll]);

  return {
    userId,
    messages,
    visiblePolls,
    items,
    messageById,
    memberMap,
    otherMembers,
    myRole,
    canPinMessages,
    allowMemberMessage,
    stableTimelineCount: messages.length + visiblePolls.length,
    isEmpty: messages.length === 0 && visiblePolls.length === 0,
    isLoading,
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  };
}
