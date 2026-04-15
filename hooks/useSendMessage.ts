"use client";

import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { v4 as uuid } from "uuid";
import { useAuthStore } from "@/stores/authStore";
import { queryKeys } from "@/lib/query/keys";
import { sendMessage, type Message } from "@/lib/api/messages";
import type { MessageType } from "@/lib/socket/events";
import type { MessagesInfiniteData } from "./useMessages";

interface SendOptions {
  conversationId: string;
  content: string;
  type?: MessageType;
  replyToMessageId?: string;
  mediaId?: string;
  metadata?: {
    mentions?: string[];
    tags?: string[];
    attachmentUrls?: string[];
    url?: string;
  };
}

export function useSendMessage() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const pendingMap = useRef<Map<string, string>>(new Map()); // clientMessageId → conversationId

  const markFailed = useCallback(
    (conversationId: string, clientMessageId: string) => {
      qc.setQueryData<MessagesInfiniteData>(
        queryKeys.messages.list(conversationId),
        (old) => {
          if (!old) return old;
          const pages = old.pages.map((page) => ({
            ...page,
            data: page.data.map((m) =>
              m.clientMessageId === clientMessageId
                ? { ...m, _failed: true, _pending: false }
                : m
            ),
          }));
          return { ...old, pages };
        }
      );
    },
    [qc]
  );

  const markAcked = useCallback(
    (conversationId: string, clientMessageId: string, serverMessage: Message | null) => {
      qc.setQueryData<MessagesInfiniteData>(
        queryKeys.messages.list(conversationId),
        (old) => {
          if (!old) return old;
          const pages = old.pages.map((page) => ({
            ...page,
            data: page.data.map((m) => {
              if (m.clientMessageId !== clientMessageId) return m;
              return {
                ...m,
                ...(serverMessage ?? {}),
                _pending: false,
                _failed: false,
              };
            }),
          }));
          return { ...old, pages };
        }
      );
    },
    [qc]
  );

  const shouldRetry = (error: unknown) => {
    if (!axios.isAxiosError(error)) return false;
    if (!error.response) return true;
    return error.code === "ECONNABORTED";
  };

  const retrySend = async (
    payload: {
      conversationId: string;
      content: string;
      type: MessageType;
      clientMessageId: string;
      replyToMessageId?: string;
      mediaId?: string;
      metadata?: {
        mentions?: string[];
        tags?: string[];
        attachmentUrls?: string[];
      };
    },
    maxAttempts = 5
  ) => {
    let attempt = 0;
    let lastError: unknown = null;

    while (attempt < maxAttempts) {
      try {
        return await sendMessage(payload);
      } catch (error) {
        lastError = error;
        attempt += 1;
        if (!shouldRetry(error) || attempt >= maxAttempts) {
          throw lastError;
        }

        const backoffMs = Math.min(8_000, 500 * 2 ** (attempt - 1));
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    throw lastError;
  };

  const send = useCallback(
    async ({ conversationId, content, type = "text", replyToMessageId, mediaId, metadata }: SendOptions) => {
      const clientMessageId = uuid();

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
        metadata,
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

      // 2. Send via HTTP with stable clientMessageId retries
      retrySend({
        conversationId,
        content,
        type,
        clientMessageId,
        replyToMessageId,
        mediaId,
        metadata,
      })
        .then((serverMessage) => {
          markAcked(conversationId, clientMessageId, serverMessage);
        })
        .catch(() => {
          markFailed(conversationId, clientMessageId);
        })
        .finally(() => {
          pendingMap.current.delete(clientMessageId);
        });

      return clientMessageId;
    },
    [markAcked, markFailed, qc, userId]
  );

  return { send };
}
