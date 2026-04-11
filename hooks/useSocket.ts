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
import { upsertMessage, type MessagesInfiniteData } from "@/hooks/useMessages";
import { getMediaSignedUrl } from "@/lib/api/media";
import { getFriendsPresence } from "@/lib/api/presence";
import { getConversation } from "@/lib/api/conversations";

/**
 * Initialise the Socket.IO event listeners and keep them alive.
 * Should be mounted once inside the authenticated app shell.
 */
export function useSocket() {
  const token = useAuthStore((s) => s.token);
  const setSessionRevoked = useAuthStore((s) => s.setSessionRevoked);
  const { setConnected } = useSocketStore();
  const { setPresence, setUserProfile } = usePresenceStore();
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
      // Seed initial presence state — do this after every (re)connect
      getFriendsPresence()
        .then((entries) => {
          usePresenceStore.getState().bulkSetPresence(
            entries.map(({ userId, status, lastSeen }) => ({
              userId,
              status,
              lastSeen: lastSeen ?? undefined,
            }))
          );
        })
        .catch(() => {});
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

    socket.on("session_revoked", (_data: { reason: "logged_in_elsewhere" | "manual_logout" | "token_expired" | "tab_limit_exceeded" }) => {
      setConnected(false);
      setSessionRevoked(true);
      // Prevent auto reconnect loop from immediately flipping UI state.
      socket.io.reconnection(false);
      if (socket.connected || socket.active) {
        socket.disconnect();
      }
      if (typeof window !== "undefined") {
        const channel = new BroadcastChannel("zolo-session");
        channel.postMessage({ type: "SESSION_REVOKED" });
        channel.close();
      }
    });

    // ─── Messages ──────────────────────────────────────────────────────────
    const handleIncomingMessage = (msg: WsMessage) => {
      upsertMessage(qc, msg.conversationId, {
        ...msg,
        type: (msg.type ?? "text").toLowerCase() as WsMessage["type"],
        updatedAt: msg.editedAt ?? msg.createdAt,
      });
    };

    socket.on("chat:message_received", handleIncomingMessage);
    socket.on("message:new", handleIncomingMessage);

    socket.on("message:notify", ({ conversationId }: { conversationId: string; latestOffset: number }) => {
      // Keep unread/detail in sync without issuing pull-after-notify message fetches.
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

    // ─── Presence ───────────────────────────────────────────────────────────
    socket.on("user:online", ({ userId }) => {
      setPresence(userId, "online");
    });

    socket.on("user:offline", ({ userId, lastSeen }) => {
      setPresence(userId, "offline", lastSeen ?? undefined);
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
    // ─── User profile ──────────────────────────────────────────────────────────
    socket.on("user:profile-updated", async ({ userId, changedFields, snapshot }) => {
      // Preserve the existing resolved URL if avatar didn't change
      const existing = usePresenceStore.getState().profileMap[userId];
      let avatarUrl: string | null = existing?.avatarUrl ?? null;

      if (changedFields.includes("avatarMediaId")) {
        avatarUrl = null; // clear stale URL while we resolve the new one
        if (snapshot.avatarMediaId) {
          try {
            avatarUrl = await getMediaSignedUrl(snapshot.avatarMediaId, "OPTIMIZED");
          } catch {
            // Swallow — UI falls back to the conversation-cache value
          }
        }
      }

      setUserProfile(userId, {
        displayName: snapshot.displayName,
        avatarMediaId: snapshot.avatarMediaId,
        avatarUrl,
      });

      // Re-fetch conversation list so embedded otherUser / participant URLs refresh
      qc.invalidateQueries({ queryKey: queryKeys.conversations.list() });
      qc.invalidateQueries({ queryKey: queryKeys.users.detail(userId) });
    });
    // ─── Membership ────────────────────────────────────────────────────────
    socket.on("member:added", ({ conversationId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
      qc.invalidateQueries({ queryKey: queryKeys.conversations.members(conversationId) });
      qc.invalidateQueries({ queryKey: queryKeys.conversations.list() });
    });

    socket.on("member:removed", ({ conversationId, removedUserIds }) => {
      const selfId = useAuthStore.getState().user?.id;
      if (selfId && removedUserIds.includes(selfId)) {
        // Current user was removed — evict conversation from the list cache
        qc.setQueryData<import("@/lib/api/conversations").Conversation[]>(
          queryKeys.conversations.list(),
          (old) => old?.filter((c) => c.id !== conversationId) ?? []
        );
        qc.removeQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
      } else {
        qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
        qc.invalidateQueries({ queryKey: queryKeys.conversations.members(conversationId) });
        qc.invalidateQueries({ queryKey: queryKeys.conversations.list() });
      }
    });

    // ─── Conversation info changes ─────────────────────────────────────────
    socket.on("conversation:updated", ({ conversationId }: { conversationId: string }) => {
      // Re-fetch the detail to get the new presigned avatarUrl (it is never
      // included in the WebSocket payload), then propagate it into the list.
      getConversation(conversationId)
        .then((fresh) => {
          qc.setQueryData(queryKeys.conversations.detail(conversationId), fresh);
          if (fresh.avatarUrl) {
            qc.setQueryData<import("@/lib/api/conversations").Conversation[]>(
              queryKeys.conversations.list(),
              (old) => old?.map((c) => (c.id === conversationId ? { ...c, ...fresh } : c))
            );
          } else {
            qc.invalidateQueries({ queryKey: queryKeys.conversations.list() });
          }
        })
        .catch(() => {
          qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
          qc.invalidateQueries({ queryKey: queryKeys.conversations.list() });
        });
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
  }, [setConnected, setPresence, setSessionRevoked, setTyping, clearTyping, setUserProfile, token]); // Re-bind after token change (reconnect)
}
