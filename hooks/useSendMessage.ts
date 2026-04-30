"use client";

import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { v4 as uuid } from "uuid";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/authStore";
import { queryKeys } from "@/lib/query/keys";
import { sendMessage, type Message, type AttachmentRef, type LocalAttachmentPreview } from "@/lib/api/messages";
import type { MessageType } from "@/lib/socket/events";
import type { MessagesInfiniteData } from "./useMessages";

// ─── Error classifiers ────────────────────────────────────────────────────────

function isBlockedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const err = error as { status?: number; message?: string };
  return err.status === 403 && err.message === "FORBIDDEN_BLOCKED_USER";
}

// ─── Global upload tracker (used by beforeunload guard in AppShell) ───────────
const _activeUploadIds = new Set<string>();
export function hasActiveUploads(): boolean { return _activeUploadIds.size > 0; }

// ─── Upload function tracker (for retry logic) ────────────────────────────────
const _uploadFnMap = new Map<string, (onProgress?: (progress: number) => void) => Promise<string | null>>();

// ─── Upload file item for media group ───────────────────────────────────────
export interface UploadFileItem {
  uploadFn: (onProgress?: (p: number) => void) => Promise<string | null>;
  mediaType: "image" | "video" | "audio" | "file";
  filename?: string;
  localPreviewUrl?: string;
  thumbPreviewUrl?: string;
}

interface SendOptions {
  conversationId: string;
  content?: string;
  type?: MessageType;
  replyToMessageId?: string;
  mediaId?: string;
  attachments?: AttachmentRef[];
  /** Explicit user-ID mentions (top-level, not in metadata) */
  mentions?: string[];
  /** @all / @here / @channel — only owner/admin may send */
  mentionAll?: boolean;
  metadata?: {
    mentions?: string[];
    mentionAll?: boolean;
    tags?: string[];
    attachmentUrls?: string[];
    url?: string;
    waveform?: number[];
    durationMs?: number;
    thumbMediaId?: string;
    fileSize?: number;
    filename?: string;
    contactUserId?: string;
  };
  // Client-only: shown while upload is in progress
  localPreviewUrl?: string;
  // When provided, message appears optimistically then this runs to get the mediaId
  uploadFile?: (onProgress?: (progress: number) => void) => Promise<string | null>;
  // For media group: upload multiple files, then send as type "media"
  uploadFileItems?: UploadFileItem[];
}

export function useSendMessage() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const pendingMap = useRef<Map<string, string>>(new Map()); // clientMessageId → conversationId

  const mergeAttachments = useCallback(
    (optimistic: AttachmentRef[] | null | undefined, server: AttachmentRef[] | null | undefined) => {
      if (!server) return optimistic ?? null;
      return server.map((attachment, index) => {
        const optimisticMatch = optimistic?.find((item) => item.mediaId === attachment.mediaId)
          ?? optimistic?.[index];
        return {
          ...attachment,
          filename: attachment.filename ?? optimisticMatch?.filename,
        };
      });
    },
    []
  );

  const mergeMetadata = useCallback(
    (optimistic: Message["metadata"], server: Message["metadata"]) => {
      if (!server) return optimistic;
      if (!optimistic) return server;
      return {
        ...optimistic,
        ...server,
        filename: server.filename ?? optimistic.filename,
      };
    },
    []
  );

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
                    attachments: mergeAttachments(m.attachments, serverMessage.attachments),
                    metadata: mergeMetadata(m.metadata, serverMessage.metadata),
                  }
                : { ...m };
              return {
                ...nextMessage,
                _pending: false,
                _failed: false,
                deliveryStatus: nextMessage.deliveryStatus ?? "sent",
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
    [mergeAttachments, mergeMetadata, qc]
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
    // Errors arrive as ApiError (transformed by interceptor), not raw axios errors.
    if (!(error instanceof Error)) return false;
    const err = error as { status?: number; code?: string };
    // Never retry 4xx client errors (blocked, bad request, etc.)
    if (err.status && err.status >= 400 && err.status < 500) return false;
    // No response (network down) or request timeout → retry
    if (!err.status) return true;
    return err.code === "ECONNABORTED";
  };

  const removeOptimisticMessage = useCallback(
    (conversationId: string, clientMessageId: string) => {
      qc.setQueryData<MessagesInfiniteData>(
        queryKeys.messages.list(conversationId),
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              data: page.data.filter((m) => m.clientMessageId !== clientMessageId),
            })),
          };
        }
      );
    },
    [qc]
  );

  const retrySend = async (
    payload: {
      conversationId: string;
      content?: string;
      type: MessageType;
      clientMessageId: string;
      replyToMessageId?: string;
      mediaId?: string;
      attachments?: AttachmentRef[];
      mentions?: string[];
      metadata?: {
        mentions?: string[];
        mentionAll?: boolean;
        tags?: string[];
        attachmentUrls?: string[];
        url?: string;
        waveform?: number[];
        durationMs?: number;
        thumbMediaId?: string;
        fileSize?: number;
        filename?: string;
        contactUserId?: string;
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
      mentions,
      mentionAll,
      metadata,
      localPreviewUrl,
      uploadFile,
      uploadFileItems,
    }: SendOptions) => {
      const clientMessageId = uuid();
      const resolvedContent = content ?? "";

      // Merge mentions/mentionAll into metadata so they appear on the optimistic bubble
      const resolvedMetadata = mentions?.length || mentionAll
        ? {
            ...metadata,
            ...(mentions?.length ? { mentions } : {}),
            ...(mentionAll ? { mentionAll } : {}),
          }
        : metadata;

      // Build local attachment previews for media group optimistic display
      const localAttachments: LocalAttachmentPreview[] | undefined =
        uploadFileItems && uploadFileItems.length > 0
          ? uploadFileItems.map((item) => ({
              previewUrl: item.localPreviewUrl,
              thumbPreviewUrl: item.thumbPreviewUrl,
              mediaType: item.mediaType,
              filename: item.filename,
            }))
          : undefined;

      // Resolve effective type: group upload always sends as "media"
      const resolvedType: MessageType = uploadFileItems && uploadFileItems.length > 0 ? "media" : type;

      // 1. Optimistic insert — always immediate
      const optimisticMsg: Message & { _pending: boolean } = {
        messageId: clientMessageId, // temp id
        conversationId,
        senderId: userId,
        content: resolvedContent,
        type: resolvedType,
        offset: -1,
        replyToMessageId,
        mediaId,
        mediaStatus: (uploadFile || uploadFileItems || mediaId) ? "processing" : undefined,
        attachments: attachments ?? null,
        metadata: resolvedMetadata,
        clientMessageId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        _pending: true,
        _localPreviewUrl: localPreviewUrl,
        _uploadProgress: (uploadFile || (uploadFileItems && uploadFileItems.length > 0)) ? 0 : undefined,
        _localAttachments: localAttachments,
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

      if (uploadFileItems && uploadFileItems.length > 0) {
        // 2a-group. Upload all files concurrently → send one "media" message
        _activeUploadIds.add(clientMessageId);
        (async () => {
          try {
            const perFileProgress = new Array(uploadFileItems.length).fill(0);
            const uploadResults = await Promise.all(
              uploadFileItems.map((item, idx) =>
                item.uploadFn((p) => {
                  perFileProgress[idx] = p;
                  const avg = perFileProgress.reduce((a, b) => a + b, 0) / perFileProgress.length;
                  updateUploadProgress(conversationId, clientMessageId, avg);
                }).then((mediaId) => ({ mediaId, item }))
              )
            );

            if (uploadResults.some(({ mediaId }) => !mediaId)) {
              markFailed(conversationId, clientMessageId);
              return;
            }

            const resolvedAttachments: AttachmentRef[] = uploadResults.map(({ mediaId, item }) => ({
              mediaId: mediaId!,
              type: item.mediaType,
              filename: item.filename,
            }));

            // Store resolved attachments on optimistic msg so retry can skip re-upload
            updateOptimisticMessage(conversationId, clientMessageId, (m) => ({
              ...m,
              attachments: resolvedAttachments,
            }));

            const serverMessage = await retrySend({
              conversationId,
              content: resolvedContent,
              type: "media" as MessageType,
              clientMessageId,
              replyToMessageId,
              attachments: resolvedAttachments,
              mentions,
              metadata: resolvedMetadata,
            });
            markAcked(conversationId, clientMessageId, serverMessage);
          } catch (err) {
            if (isBlockedError(err)) {
              removeOptimisticMessage(conversationId, clientMessageId);
              toast.error("You can't send messages here. You may have been blocked.");
              return;
            }
            markFailed(conversationId, clientMessageId);
          } finally {
            _activeUploadIds.delete(clientMessageId);
            pendingMap.current.delete(clientMessageId);
          }
        })();
      } else if (uploadFile) {
        // 2a. Deferred upload: fire-and-forget, optimistic already visible
        _activeUploadIds.add(clientMessageId);
        _uploadFnMap.set(clientMessageId, uploadFile); // Store for retry
        (async () => {
          try {
            const uploadedId = await uploadFile((progress) => {
              updateUploadProgress(conversationId, clientMessageId, progress);
            });
            if (!uploadedId) {
              markFailed(conversationId, clientMessageId);
              return;
            }
            // Store uploadedId in cache so retryMessage can use it
            updateOptimisticMessage(conversationId, clientMessageId, (m) => ({
              ...m,
              mediaId: uploadedId,
            }));
            const serverMessage = await retrySend({
              conversationId,
              content: resolvedContent,
              type: resolvedType,
              clientMessageId,
              replyToMessageId,
              mediaId: uploadedId,
              attachments,
              mentions,
              metadata: resolvedMetadata,
            });
            markAcked(conversationId, clientMessageId, serverMessage);
            _uploadFnMap.delete(clientMessageId); // Clean up on success
          } catch (err) {
            if (isBlockedError(err)) {
              removeOptimisticMessage(conversationId, clientMessageId);
              toast.error("You can't send messages here. You may have been blocked.");
              return;
            }
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
          type: resolvedType,
          clientMessageId,
          replyToMessageId,
          mediaId,
          attachments,
          mentions,
          metadata: resolvedMetadata,
        })
          .then((serverMessage) => {
            markAcked(conversationId, clientMessageId, serverMessage);
          })
          .catch((err: unknown) => {
            if (isBlockedError(err)) {
              removeOptimisticMessage(conversationId, clientMessageId);
              toast.error("You can't send messages here. You may have been blocked.");
              return;
            }
            markFailed(conversationId, clientMessageId);
          })
          .finally(() => {
            pendingMap.current.delete(clientMessageId);
          });
      }

      return clientMessageId;
    },
    [markAcked, markFailed, updateUploadProgress, updateOptimisticMessage, removeOptimisticMessage, qc, userId]
  );

  const retryMessage = useCallback(
    (conversationId: string, clientMessageId: string) => {
      const data = qc.getQueryData<MessagesInfiniteData>(queryKeys.messages.list(conversationId));
      if (!data) return;
      let failedMsg: Message | null = null;
      for (const page of data.pages) {
        const found = page.data.find((m) => m.clientMessageId === clientMessageId);
        if (found) { failedMsg = found; break; }
      }
      if (!failedMsg) return;

      updateOptimisticMessage(conversationId, clientMessageId, (m) => ({
        ...m,
        _failed: false,
        _pending: true,
        mediaStatus: m.mediaStatus === "failed" ? "processing" : m.mediaStatus,
      }));

      const uploadFile = _uploadFnMap.get(clientMessageId);
      const hasMediaId = failedMsg.mediaId || (failedMsg.attachments && failedMsg.attachments.length > 0);

      // If we have uploadFile and no mediaId yet, retry full upload + send
      if (uploadFile && !hasMediaId) {
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
            // Store uploadedId
            updateOptimisticMessage(conversationId, clientMessageId, (m) => ({
              ...m,
              mediaId: uploadedId,
            }));
            const serverMessage = await retrySend({
              conversationId,
              content: failedMsg.content ?? "",
              type: failedMsg.type as MessageType,
              clientMessageId,
              replyToMessageId: failedMsg.replyToMessageId ?? undefined,
              mediaId: uploadedId,
              attachments: failedMsg.attachments ?? undefined,
              metadata: failedMsg.metadata ?? undefined,
            });
            markAcked(conversationId, clientMessageId, serverMessage);
            _uploadFnMap.delete(clientMessageId); // Clean up on success
          } catch {
            markFailed(conversationId, clientMessageId);
          } finally {
            _activeUploadIds.delete(clientMessageId);
          }
        })();
      } else {
        // Just retry send (mediaId already available)
        retrySend({
          conversationId,
          content: failedMsg.content ?? "",
          type: failedMsg.type as MessageType,
          clientMessageId,
          replyToMessageId: failedMsg.replyToMessageId ?? undefined,
          mediaId: failedMsg.mediaId ?? undefined,
          attachments: failedMsg.attachments ?? undefined,
          metadata: failedMsg.metadata ?? undefined,
        })
          .then((serverMessage) => {
            markAcked(conversationId, clientMessageId, serverMessage);
            _uploadFnMap.delete(clientMessageId); // Clean up on success
          })
          .catch(() => markFailed(conversationId, clientMessageId));
      }
    },
    [qc, updateOptimisticMessage, markAcked, markFailed, updateUploadProgress]
  );

  const cancelMessage = useCallback((clientMessageId: string) => {
    _uploadFnMap.delete(clientMessageId);
    _activeUploadIds.delete(clientMessageId);
    pendingMap.current.delete(clientMessageId);
  }, []);

  return { send, retryMessage, cancelMessage };
}
