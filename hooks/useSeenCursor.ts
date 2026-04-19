"use client";

import { useEffect, useRef, useCallback } from "react";
import { getChatSocket } from "@/lib/socket/socket";
import { updateSeenOffset } from "@/lib/api/conversations";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import type { Conversation } from "@/lib/api/conversations";

/**
 * Watches the bottom-most visible message via IntersectionObserver and
 * debounces a `conversation:update_seen_cursor` WS emit + REST PATCH.
 */
export function useSeenCursor(
  conversationId: string,
  lastVisibleOffset: number | null
) {
  const lastEmittedOffset = useRef<number>(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qc = useQueryClient();

  const markSeen = useCallback(
    (offset: number) => {
      if (offset <= lastEmittedOffset.current) return;
      lastEmittedOffset.current = offset;

      const socket = getChatSocket();
      socket.emit("conversation:update_seen_cursor", {
        conversationId,
        upToOffset: offset,
      });

      // Fire-and-forget REST (keeps cursor persistent across devices)
      updateSeenOffset(conversationId, offset).catch(() => {});

      // Update local unread badge without re-fetching the entire list
      qc.setQueryData<Conversation[]>(
        queryKeys.conversations.list(),
        (old) => old?.map((c) =>
          c.id === conversationId ? { ...c, lastSeenOffset: Math.max(c.lastSeenOffset ?? 0, offset) } : c
        )
      );
    },
    [conversationId, qc]
  );

  useEffect(() => {
    if (lastVisibleOffset === null) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      markSeen(lastVisibleOffset);
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [lastVisibleOffset, markSeen]);
}
