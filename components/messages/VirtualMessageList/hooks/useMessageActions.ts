"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { Message } from "@/lib/api/messages";
import { deleteMessageForMe, revokeMessage, pinMessage } from "@/lib/api/messages";
import { useConversationStore } from "@/stores/conversationStore";
import { getQueryClient } from "@/lib/query/queryClient";
import { queryKeys } from "@/lib/query/keys";
import type { MessagesInfiniteData } from "@/hooks/useMessages";
import { useSendMessage } from "@/hooks/useSendMessage";

export function useMessageActions(conversationId: string) {
  const setEditingMessage = useConversationStore((s) => s.setEditingMessage);
  const { retryMessage } = useSendMessage();

  const handleRetry = useCallback(
    (convId: string, clientMessageId: string) => {
      retryMessage(convId, clientMessageId);
    },
    [retryMessage],
  );

  const handleEdit = useCallback(
    (msg: Message) => {
      setEditingMessage({ messageId: msg.messageId, content: msg.content ?? "" });
    },
    [setEditingMessage],
  );

  const handleDelete = useCallback(
    async (msg: Message) => {
      try {
        await deleteMessageForMe(msg.messageId, conversationId);
        getQueryClient().setQueryData(
          queryKeys.messages.list(conversationId),
          (old: MessagesInfiniteData | undefined) => {
            if (!old) return old;
            return {
              ...old,
              pages: old.pages.map((p) => ({
                ...p,
                data: p.data.filter((m) => m.messageId !== msg.messageId),
              })),
            };
          },
        );
      } catch {
        // noop
      }
    },
    [conversationId],
  );

  const handleRevoke = useCallback(
    async (msg: Message) => {
      try {
        await revokeMessage(msg.messageId, conversationId);
        getQueryClient().setQueryData(
          queryKeys.messages.list(conversationId),
          (old: MessagesInfiniteData | undefined) => {
            if (!old) return old;
            return {
              ...old,
              pages: old.pages.map((p) => ({
                ...p,
                data: p.data.map((m) =>
                  m.messageId === msg.messageId ? { ...m, isRevoked: true, content: "" } : m,
                ),
              })),
            };
          },
        );
      } catch (err) {
        if ((err as { response?: { status?: number } }).response?.status === 403) {
          toast.error("The allowed time window for this action has expired.");
        }
      }
    },
    [conversationId],
  );

  const [forwardTarget, setForwardTarget] = useState<Message | null>(null);
  const handleForward = useCallback((msg: Message) => setForwardTarget(msg), []);

  const [internalDetailsTarget, setInternalDetailsTarget] = useState<Message | null>(null);

  const handlePin = useCallback(
    async (msg: Message) => {
      try {
        await pinMessage(msg.messageId, conversationId);
      } catch {
        toast.error("You can pin up to 3 messages in a conversation.");
      }
    },
    [conversationId],
  );

  return {
    handleRetry,
    handleEdit,
    handleDelete,
    handleRevoke,
    forwardTarget,
    setForwardTarget,
    handleForward,
    internalDetailsTarget,
    setInternalDetailsTarget,
    handlePin,
  };
}
