"use client";

import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { v4 as uuid } from "uuid";
import { getChatSocket } from "@/lib/socket/socket";
import { useAuthStore } from "@/stores/authStore";
import { queryKeys } from "@/lib/query/keys";
import type { Message } from "@/lib/api/messages";
import type { MessageType } from "@/lib/socket/events";
import type { MessagesInfiniteData } from "./useMessages";

interface SendOptions {
  conversationId: string;
  content: string;
  type?: MessageType;
  replyToMessageId?: string;
  mediaId?: string;
}

export function useSendMessage() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const pendingMap = useRef<Map<string, string>>(new Map()); // clientMessageId → conversationId

  const send = useCallback(
    ({ conversationId, content, type = "TEXT", replyToMessageId, mediaId }: SendOptions) => {
      const clientMessageId = uuid();
      const socket = getChatSocket();

      // 1. Optimistic insert
      const optimisticMsg: Message & { _pending: boolean } = {
        messageId: clientMessageId, // temp id
        conversationId,
        senderId: userId,
        content,
        type,
        offset: -1,
        replyToMessageId,
        mediaId,
        clientMessageId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        _pending: true,
      };

      qc.setQueryData<MessagesInfiniteData>(
        queryKeys.messages.list(conversationId),
        (old) => {
          if (!old) return old;
          const pages = [...old.pages];
          const last = pages[pages.length - 1];
          pages[pages.length - 1] = {
            ...last,
            data: [...last.data, optimisticMsg],
          };
          return { ...old, pages };
        }
      );

      pendingMap.current.set(clientMessageId, conversationId);

      // 2. Emit via WebSocket
      socket.emit("message:send", {
        conversationId,
        content,
        type,
        clientMessageId,
        replyToMessageId,
        mediaId,
      });

      return clientMessageId;
    },
    [qc, userId]
  );

  return { send };
}
