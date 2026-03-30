"use client";

import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { getMessages, type Message, type MessagePage } from "@/lib/api/messages";
import { queryKeys } from "@/lib/query/keys";
import { useAuthStore } from "@/stores/authStore";

export type MessagesInfiniteData = InfiniteData<MessagePage>;

/** Number of messages per page and max pages to keep in cache (3 × 30 = 90 messages). */
export const MESSAGE_PAGE_SIZE = 30;
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
) {
  qc.prefetchInfiniteQuery<MessagePage, Error, MessagesInfiniteData, ReturnType<typeof queryKeys.messages.list>, number | undefined>({
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
  qc.setQueryData<MessagesInfiniteData>(
    queryKeys.messages.list(conversationId),
    (old) => {
      if (!old) return old;
      const pages = [...old.pages];
      const last = pages[pages.length - 1];
      if (last.data.some((m) => m.messageId === msg.messageId)) return old;
      pages[pages.length - 1] = {
        ...last,
        data: [...last.data, msg],
      };
      return { ...old, pages };
    }
  );
}
