"use client";

import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import {
  getMessages,
  getPinnedMessages,
  type Message,
  type MessagePage,
} from "@/lib/api/messages";
import { queryKeys } from "@/lib/query/keys";
import { useAuthStore } from "@/stores/authStore";

export type MessagesInfiniteData = InfiniteData<MessagePage>;

/** Number of messages per page and max pages to keep in cache (3 × 20 = 60 messages). */
export const MESSAGE_PAGE_SIZE = 20;
export const MAX_MESSAGE_PAGES = 3;

export function useMessages(conversationId: string) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useInfiniteQuery<MessagePage, Error, MessagesInfiniteData, ReturnType<typeof queryKeys.messages.list>, number | undefined>({
    queryKey: queryKeys.messages.list(conversationId),
    queryFn: ({ pageParam }) =>
      getMessages({
        conversationId,
        before: pageParam,
        limit: MESSAGE_PAGE_SIZE,
      }),
    initialPageParam: undefined,
    // Pages are prepended (oldest first via reverse in VirtualMessageList)
    getNextPageParam: (firstPage) =>
      firstPage?.meta?.hasMore ? firstPage.meta.oldestOffset : undefined,
    maxPages: MAX_MESSAGE_PAGES,
    enabled: isAuthenticated && !!conversationId,
    staleTime: Infinity, // Messages are updated via WS, not polling
  });
}

/**
 * Prefetch the first page of messages for a conversation.
 * Call this for the top-N conversations to warm the cache.
 */
export function prefetchMessages(
  qc: ReturnType<typeof useQueryClient>,
  conversationId: string
): Promise<void> {
  return qc.prefetchInfiniteQuery<MessagePage, Error, MessagesInfiniteData, ReturnType<typeof queryKeys.messages.list>, number | undefined>({
    queryKey: queryKeys.messages.list(conversationId),
    queryFn: () => getMessages({ conversationId, limit: MESSAGE_PAGE_SIZE }),
    initialPageParam: undefined,
    staleTime: Infinity,
  });
}

/**
 * Append a single message directly into the query cache (used by useSocket + useSendMessage).
 */
export function appendMessage(
  qc: ReturnType<typeof useQueryClient>,
  conversationId: string,
  msg: Message
) {
  upsertMessage(qc, conversationId, msg);
}

export function upsertMessage(
  qc: ReturnType<typeof useQueryClient>,
  conversationId: string,
  msg: Message
) {
  qc.setQueryData<MessagesInfiniteData>(
    queryKeys.messages.list(conversationId),
    (old) => {
      if (!old) return old;
      const pages = [...old.pages];
      const last = pages[pages.length - 1];

      const existingIdx = last.data.findIndex(
        (m) =>
          m.messageId === msg.messageId ||
          (!!m.clientMessageId && !!msg.clientMessageId && m.clientMessageId === msg.clientMessageId)
      );

      if (existingIdx !== -1) {
        const next = [...last.data];
        // Only overwrite with defined/truthy values so socket events never clear
        // replyToMessageId (server may echo null for this field even when a reply exists).
        // Also skip empty-string content so a socket echo with missing content never
        // overwrites the real message text already stored in the cache.
        const safeFields = Object.fromEntries(
          Object.entries(msg).filter(([key, v]) => {
            if (v === undefined) return false;
            if (key === "replyToMessageId" && !v) return false;
            if (key === "content" && v === "" && next[existingIdx]?.content) return false;
            return true;
          })
        ) as Partial<Message>;
        const current = next[existingIdx];
        const shouldKeepOptimisticSender =
          !!current._pending &&
          !!current.clientMessageId &&
          (!safeFields.senderId || safeFields.senderId === "SYSTEM");
        next[existingIdx] = {
          ...current,
          ...safeFields,
          senderId: shouldKeepOptimisticSender
            ? current.senderId
            : safeFields.senderId ?? current.senderId,
          attachments: safeFields.attachments ?? current.attachments,
          metadata: current.metadata || safeFields.metadata
            ? { ...current.metadata, ...safeFields.metadata }
            : undefined,
          _pending: false,
          _failed: false,
        };
        pages[pages.length - 1] = {
          ...last,
          data: next,
        };
        return { ...old, pages };
      }

      pages[pages.length - 1] = {
        ...last,
        data: [...last.data, msg],
      };
      return { ...old, pages };
    }
  );
}

export function usePinnedMessages(conversationId: string) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: queryKeys.messages.pinned(conversationId),
    queryFn: () => getPinnedMessages(conversationId),
    enabled: isAuthenticated && !!conversationId,
    staleTime: 60_000,
  });
}
