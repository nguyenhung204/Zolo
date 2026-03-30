"use client";

import { useEffect, useRef } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useSocketStore } from "@/stores/socketStore";
import { usePresenceStore } from "@/stores/presenceStore";
import { useTypingStore } from "@/stores/typingStore";
import { getChatSocket } from "@/lib/socket/socket";
import { getQueryClient } from "@/lib/query/queryClient";
import { queryKeys } from "@/lib/query/keys";
import type { WsMessage } from "@/lib/socket/events";
import { appendMessage, type MessagesInfiniteData } from "@/hooks/useMessages";
import { getMessages } from "@/lib/api/messages";

/**
 * Initialise the Socket.IO event listeners and keep them alive.
 * Should be mounted once inside the authenticated app shell.
 */
export function useSocket() {
  const token = useAuthStore((s) => s.token);
  const { setConnected } = useSocketStore();
  const { setPresence } = usePresenceStore();
  const { setTyping, clearTyping } = useTypingStore();
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Per-user typing auto-clear timers
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!token) return;

    const socket = getChatSocket();
    const qc = getQueryClient();

    // ─── Connection lifecycle ───────────────────────────────────────────────
    socket.on("connect", () => {
      setConnected(true, socket.id);
      // Some server configurations require an explicit authenticate event
      // after connection in addition to the handshake auth object
      socket.emit("authenticate", { token });
      // Start heartbeat every 30 s
      heartbeatRef.current = setInterval(() => {
        socket.emit("heartbeat");
      }, 30_000);
    });

    socket.on("connect_error", (err) => {
      console.error("[Socket] connect_error:", err.message);
      setConnected(false);
      // If server explicitly rejects auth, stop reconnecting to avoid spam
      if (err.message?.includes("authen") || err.message?.includes("Unauthorized") || err.message?.includes("token")) {
        socket.io.reconnection(false);
      }
    });

    socket.on("disconnect", () => {
      setConnected(false);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    });

    // ─── Messages ──────────────────────────────────────────────────────────
    socket.on("message:new", (msg: WsMessage) => {
      // Backend may send a partial payload (no content/createdAt) — fetch the
      // full message from REST so the bubble renders correctly.
      if (!msg.content || !msg.createdAt) {
        getMessages({ conversationId: msg.conversationId, after: msg.offset - 1, limit: 1 })
          .then((page) => {
            const full = page.data[0];
            if (full) {
              appendMessage(qc, msg.conversationId, full);
              qc.invalidateQueries({ queryKey: queryKeys.conversations.list() });
            }
          })
          .catch(() => {});
        return;
      }
      // Full payload path — append directly without extra round-trip
      appendMessage(qc, msg.conversationId, {
        ...msg,
        type: (msg.type ?? "text").toLowerCase() as WsMessage["type"],
        updatedAt: msg.editedAt ?? msg.createdAt,
      });
      qc.invalidateQueries({ queryKey: queryKeys.conversations.list() });
    });

    socket.on("message:notify", ({ conversationId, latestOffset }: { conversationId: string; latestOffset: number }) => {
      // Fetch the new message and append it — smooth update without full cache invalidation.
      // This handles the case where message:new wasn't received (user not in the room).
      getMessages({ conversationId, after: latestOffset - 1, limit: 1 })
        .then((page) => {
          const msg = page.data[0];
          if (msg) appendMessage(qc, conversationId, msg);
        })
        .catch(() => {});
      // Re-order the sidebar + update unread badge
      qc.invalidateQueries({ queryKey: queryKeys.conversations.list() });
      qc.invalidateQueries({ queryKey: queryKeys.conversations.unread(conversationId) });
      qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
    });

    socket.on("message:queued", ({ clientMessageId, messageId }: { clientMessageId: string; messageId: string }) => {
      // Server confirmed message received — update temp id so message:new dedup works
      const allQueryKeys = qc.getQueryCache().findAll({ queryKey: queryKeys.messages.all });
      for (const query of allQueryKeys) {
        qc.setQueryData(
          query.queryKey,
          (old: MessagesInfiniteData | undefined) => {
            if (!old) return old;
            const pages = old.pages.map((page) => ({
              ...page,
              data: page.data.map((m) =>
                m.clientMessageId === clientMessageId ? { ...m, messageId } : m
              ),
            }));
            return { ...old, pages };
          }
        );
      }
    });

    socket.on("message:saved", ({ clientMessageId, messageId, conversationId, offset }) => {
      // Reconcile optimistic message: swap clientMessageId → real messageId, clear pending flag
      qc.setQueryData(
        queryKeys.messages.list(conversationId),
        (old: MessagesInfiniteData | undefined) => {
          if (!old) return old;
          const pages = old.pages.map((page) => ({
            ...page,
            data: page.data.map((m) =>
              m.clientMessageId === clientMessageId
                ? { ...m, messageId, offset, clientMessageId: undefined, _pending: false }
                : m
            ),
          }));
          return { ...old, pages };
        }
      );
    });

    socket.on("message:rejected", ({ clientMessageId }) => {
      // Mark optimistic message as failed — scan all conversation caches
      const allKeys = qc.getQueryCache().findAll({ queryKey: queryKeys.messages.all });
      for (const query of allKeys) {
        qc.setQueryData(
          query.queryKey,
          (old: MessagesInfiniteData | undefined) => {
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
      }
    });

    socket.on("message:edited", ({ messageId, conversationId, content, editedAt }) => {
      qc.setQueryData(
        queryKeys.messages.list(conversationId),
        (old: MessagesInfiniteData | undefined) => {
          if (!old) return old;
          const pages = old.pages.map((page) => ({
            ...page,
            data: page.data.map((m) =>
              m.messageId === messageId ? { ...m, content, editedAt } : m
            ),
          }));
          return { ...old, pages };
        }
      );
    });

    socket.on("message:deleted", ({ messageId, conversationId }) => {
      qc.setQueryData(
        queryKeys.messages.list(conversationId),
        (old: MessagesInfiniteData | undefined) => {
          if (!old) return old;
          const pages = old.pages.map((page) => ({
            ...page,
            data: page.data.map((m) =>
              m.messageId === messageId
                ? { ...m, deletedAt: new Date().toISOString() }
                : m
            ),
          }));
          return { ...old, pages };
        }
      );
    });

    socket.on("message:updated", ({ messageId, mediaStatus }) => {
      // Media processing complete — update cache across all conversations
      qc.setQueriesData(
        { queryKey: queryKeys.messages.all },
        (old: MessagesInfiniteData | undefined) => {
          if (!old) return old;
          const pages = old.pages.map((page) => ({
            ...page,
            data: page.data.map((m) =>
              m.messageId === messageId ? { ...m, mediaStatus } : m
            ),
          }));
          return { ...old, pages };
        }
      );
    });

    // ─── Typing ────────────────────────────────────────────────────────────
    socket.on("typing:started", ({ conversationId, userId }) => {
      setTyping(conversationId, userId);

      // Auto-clear after 5 s (matches server TTL)
      const key = `${conversationId}:${userId}`;
      const existing = typingTimers.current.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        clearTyping(conversationId, userId);
        typingTimers.current.delete(key);
      }, 5_000);
      typingTimers.current.set(key, timer);
    });

    socket.on("typing:stopped", ({ conversationId, userId }) => {
      clearTyping(conversationId, userId);
      const key = `${conversationId}:${userId}`;
      const t = typingTimers.current.get(key);
      if (t) { clearTimeout(t); typingTimers.current.delete(key); }
    });

    // ─── Membership ────────────────────────────────────────────────────────
    socket.on("member:added", ({ conversationId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
      qc.invalidateQueries({ queryKey: queryKeys.conversations.members(conversationId) });
      qc.invalidateQueries({ queryKey: queryKeys.conversations.list() });
    });

    socket.on("member:removed", ({ conversationId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
      qc.invalidateQueries({ queryKey: queryKeys.conversations.members(conversationId) });
      qc.invalidateQueries({ queryKey: queryKeys.conversations.list() });
    });

    // ─── Call events ───────────────────────────────────────────────────────
    // NOTE: All meeting:* events are handled in useCallSocket (namespace /call).
    // Nothing to register here.

    return () => {
      socket.removeAllListeners();
      // Restore reconnection in case it was disabled by a connect_error handler
      socket.io.reconnection(true);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      typingTimers.current.forEach((t) => clearTimeout(t));
      typingTimers.current.clear();
    };
  }, [token]); // Re-bind after token change (reconnect)
}
