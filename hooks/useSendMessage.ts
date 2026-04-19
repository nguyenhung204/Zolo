"use client";

import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { v4 as uuid } from "uuid";
import { useAuthStore } from "@/stores/authStore";
import { queryKeys } from "@/lib/query/keys";
import { sendMessage, type Message, type AttachmentRef } from "@/lib/api/messages";
import type { MessageType } from "@/lib/socket/events";
import type { MessagesInfiniteData } from "./useMessages";

// ─── Global upload tracker (used by beforeunload guard in AppShell) ───────────
const _activeUploadIds = new Set<string>();
export function hasActiveUploads(): boolean { return _activeUploadIds.size > 0; }

interface SendOptions {
  conversationId: string;
  content?: string;
  type?: MessageType;
  replyToMessageId?: string;
  mediaId?: string;
  attachments?: AttachmentRef[];
  metadata?: {
    mentions?: string[];
    tags?: string[];
    attachmentUrls?: string[];
    url?: string;
    waveform?: number[];
    durationMs?: number;
    thumbMediaId?: string;
    fileSize?: number;
  };
  // Client-only: shown while upload is in progress
  localPreviewUrl?: string;
  // When provided, message appears optimistically then this runs to get the mediaId
  uploadFile?: (onProgress?: (progress: number) => void) => Promise<string | null>;
}

export function useSendMessage() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const pendingMap = useRef<Map<string, string>>(new Map()); // clientMessageId → conversationId

  const updateOptimisticMessage = useCallback(
    (
      conversationId: string,
      clientMessageId: string,
      updater: (message: Message & { _pending?: boolean; _failed?: boolean }) => Message
    ) => {
      qc.setQueryData<MessagesInfiniteData>(
        queryKeys.messages.list(conversationId),
        (old) => {
          if (!old) return old;
          const pages = old.pages.map((page) => ({
            ...page,
            data: page.data.map((message) =>
              message.clientMessageId === clientMessageId ? updater(message) : message
            ),
          }));
          return { ...old, pages };
        }
      );
    },
    [qc]
  );

  const markFailed = useCallback(
    (conversationId: string, clientMessageId: string) => {
      updateOptimisticMessage(conversationId, clientMessageId, (message) => ({
        ...message,
        _failed: true,
        _pending: false,
        mediaStatus: "failed",
      }));
    },
    [updateOptimisticMessage]
  );

  const markAcked = useCallback(
    (conversationId: string, clientMessageId: string, serverMessage: Message | null) => {
      qc.setQueryData<MessagesInfiniteData>(
        queryKeys.messages.list(conversationId),
        (old) => {
          if (!old) return old;
          const realMessageId = serverMessage?.messageId;
          const pages = old.pages.map((page) => {
            const reconciled = page.data.map((m) => {
              if (m.clientMessageId !== clientMessageId) return m;
              const nextMessage = serverMessage
                ? {
                    ...m,
                    ...Object.fromEntries(
                      Object.entries(serverMessage).filter(([, value]) => value !== undefined)
                    ),
                  }
                : { ...m };
              return {
                ...nextMessage,
                _pending: false,
                _failed: false,
                _uploadProgress: 100,
              };
            });
            // Remove any duplicate with the same real messageId that was inserted by
            // message:new arriving before the HTTP ack (race condition).
            // Keep only the reconciled entry (identified by clientMessageId still present).
            const deduped = realMessageId
              ? reconciled.filter(
                  (m) => m.messageId !== realMessageId || m.clientMessageId === clientMessageId
                )
              : reconciled;
            return { ...page, data: deduped };
          });
          return { ...old, pages };
        }
      );
    },
    [qc]
  );

  const updateUploadProgress = useCallback(
    (conversationId: string, clientMessageId: string, progress: number) => {
      updateOptimisticMessage(conversationId, clientMessageId, (message) => ({
        ...message,
        _uploadProgress: progress,
        mediaStatus: progress >= 100 ? "processing" : "uploaded",
      }));
    },
    [updateOptimisticMessage]
  );

  const shouldRetry = (error: unknown) => {
    if (!axios.isAxiosError(error)) return false;
    if (!error.response) return true;
    return error.code === "ECONNABORTED";
  };

  const retrySend = async (
    payload: {
      conversationId: string;
      content?: string;
      type: MessageType;
      clientMessageId: string;
      replyToMessageId?: string;
      mediaId?: string;
      attachments?: AttachmentRef[];
      metadata?: {
        mentions?: string[];
        tags?: string[];
        attachmentUrls?: string[];
        url?: string;
        waveform?: number[];
        durationMs?: number;
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
    async ({
      conversationId,
      content = "",
      type = "text",
      replyToMessageId,
      mediaId,
      attachments,
      metadata,
      localPreviewUrl,
      uploadFile,
    }: SendOptions) => {
      const clientMessageId = uuid();
      const resolvedContent = content ?? "";

      // 1. Optimistic insert — always immediate
      const optimisticMsg: Message & { _pending: boolean } = {
        messageId: clientMessageId, // temp id
        conversationId,
        senderId: userId,
        content: resolvedContent,
        type,
        offset: -1,
        replyToMessageId,
        mediaId,
        mediaStatus: (uploadFile || mediaId) ? "processing" : undefined,
        attachments: attachments ?? null,
        metadata,
        clientMessageId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        _pending: true,
        _localPreviewUrl: localPreviewUrl,
        _uploadProgress: uploadFile ? 0 : undefined,
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

      if (uploadFile) {
        // 2a. Deferred upload: fire-and-forget, optimistic already visible
        _activeUploadIds.add(clientMessageId);
        (async () => {
          try {
            const uploadedId = await uploadFile((progress) => {
              updateUploadProgress(conversationId, clientMessageId, progress);
            });
            if (!uploadedId) {
              markFailed(conversationId, clientMessageId);
              return;
            }
            const serverMessage = await retrySend({
              conversationId,
              content: resolvedContent,
              type,
              clientMessageId,
              replyToMessageId,
              mediaId: uploadedId,
              attachments,
              metadata,
            });
            markAcked(conversationId, clientMessageId, serverMessage);
          } catch {
            markFailed(conversationId, clientMessageId);
          } finally {
            _activeUploadIds.delete(clientMessageId);
            pendingMap.current.delete(clientMessageId);
          }
        })();
      } else {
        // 2b. Standard: send HTTP immediately (mediaId already known)
        retrySend({
          conversationId,
          content: resolvedContent,
          type,
          clientMessageId,
          replyToMessageId,
          mediaId,
          attachments,
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
      }

      return clientMessageId;
    },
    [markAcked, markFailed, qc, userId]
  );

  return { send };
}
