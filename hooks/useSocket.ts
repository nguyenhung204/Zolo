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
import { upsertMessage, prefetchMessages, type MessagesInfiniteData } from "@/hooks/useMessages";
import { getMediaSignedUrl } from "@/lib/api/media";
import { getFriendsPresence, getMyPresenceStatus } from "@/lib/api/presence";
import { getConversation } from "@/lib/api/conversations";

function isMediaMessageType(type: WsMessage["type"]) {
  return type === "image" || type === "video" || type === "audio" || type === "file" || type === "media";
}

function normalizeMediaStatus(status: string | undefined): WsMessage["mediaStatus"] {
  if (!status) return undefined;
  const s = status.toLowerCase();
  switch (s) {
    case "created":
      return "created";
    case "uploaded":
      return "uploaded";
    case "processing":
      return "processing";
    case "ready":
      return "ready";
    case "failed":
      return "failed";
    default:
      return undefined;
  }
}

/**
 * Initialise the Socket.IO event listeners and keep them alive.
 * Should be mounted once inside the authenticated app shell.
 */
export function useSocket() {
  const token = useAuthStore((s) => s.token);
  const myId = useAuthStore((s) => s.user?.id);
  const setSessionRevoked = useAuthStore((s) => s.setSessionRevoked);
  const { setConnected } = useSocketStore();
  const { setPresence, setUserProfile } = usePresenceStore();
  const { setTyping, clearTyping } = useTypingStore();
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Per-user typing auto-clear timers
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Per-conversation delivered cursor throttle timers
  const deliveredThrottleRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Debounce timer for conversations list invalidation — multiple socket events
  // can fire in quick succession; coalescing them prevents redundant API calls.
  const listInvalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!token) return;

    const socket = getChatSocket();
    const scheduleListInvalidate = () => {
      if (listInvalidateTimerRef.current) clearTimeout(listInvalidateTimerRef.current);
      listInvalidateTimerRef.current = setTimeout(() => {
        listInvalidateTimerRef.current = null;
        qc.invalidateQueries({ queryKey: queryKeys.conversations.list() });
      }, 300);
    };
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
      Promise.allSettled([getFriendsPresence(), getMyPresenceStatus()])
        .then(([friendsRes, meRes]) => {
          if (friendsRes.status === "fulfilled") {
            usePresenceStore.getState().bulkSetPresence(
              friendsRes.value.map(({ userId, status, lastSeen }) => ({
                userId,
                status,
                lastSeen: lastSeen ?? undefined,
              }))
            );
          }

          if (myId && meRes.status === "fulfilled" && meRes.value) {
            usePresenceStore
              .getState()
              .setPresence(myId, meRes.value.status, meRes.value.lastSeen ?? undefined);
          }
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

    socket.on("session_revoked", (data: { reason: "logged_in_elsewhere" | "new_login_elsewhere" | "manual_logout" | "token_expired" | "tab_limit_exceeded" }) => {
      setConnected(false);
      setSessionRevoked(true, data.reason);
      // Prevent auto reconnect loop from immediately flipping UI state.
      socket.io.reconnection(false);
      if (socket.connected || socket.active) {
        socket.disconnect();
      }
      if (typeof window !== "undefined") {
        const channel = new BroadcastChannel("zolo-session");
        channel.postMessage({ type: "SESSION_REVOKED", reason: data.reason });
        channel.close();
      }
    });

    // ─── Messages ──────────────────────────────────────────────────────────
    const handleIncomingMessage = (msg: WsMessage & { replyToId?: string }) => {
      // Backend may send replyToId instead of replyToMessageId
      const replyToMessageId = msg.replyToMessageId ?? (msg as { replyToId?: string }).replyToId;
      const normalizedType = (msg.type ?? "text").toLowerCase() as WsMessage["type"];
      const attachments = (msg as WsMessage & { attachments?: Array<{ mediaId: string; type?: "image" | "video" | "audio" | "file"; kind?: "image" | "video" | "audio" | "file"; status?: string; prefer?: "ORIGINAL" | "OPTIMIZED"; variantsReady?: boolean }> | null }).attachments ?? null;
      const firstAttachment = attachments?.[0];
      const derivedMediaId = msg.mediaId ?? firstAttachment?.mediaId;
      const derivedMediaStatus =
        normalizeMediaStatus(msg.mediaStatus as string | undefined) ??
        normalizeMediaStatus(firstAttachment?.status) ??
        // If the server confirmed this message (offset > 0), media is already accessible.
        // "processing" is only correct for brand-new optimistic messages (offset <= 0).
        (isMediaMessageType(normalizedType) && derivedMediaId
          ? (Number(msg.offset ?? 0) > 0 ? "ready" : "processing")
          : undefined);
      const normalized = {
        ...msg,
        replyToMessageId,
        type: normalizedType,
        mediaId: derivedMediaId,
        mediaStatus: derivedMediaStatus,
        attachments: attachments?.map((attachment) => ({
          ...attachment,
          type: attachment.type ?? attachment.kind,
        })) ?? null,
        offset: Number(msg.offset ?? 0),
        updatedAt: msg.editedAt ?? msg.createdAt,
      };
      // If this conversation has no cache yet, prefetch the latest 30 messages
      // so opening the conversation later is instant (no loading spinner).
      // For active conversations (cache exists) upsertMessage does the live update.
      if (!qc.getQueryData(queryKeys.messages.list(msg.conversationId))) {
        prefetchMessages(qc, msg.conversationId);
      } else {
        upsertMessage(qc, msg.conversationId, normalized);
      }
      // Throttle-emit delivered cursor for incoming messages from others (1s per conversation)
      if (msg.senderId !== myId && msg.offset > 0) {
        const existing = deliveredThrottleRef.current.get(msg.conversationId);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
          const s = getChatSocket();
          s.emit("conversation:update_delivered_cursor", {
            conversationId: msg.conversationId,
            upToOffset: msg.offset,
          });
          deliveredThrottleRef.current.delete(msg.conversationId);
        }, 1_000);
        deliveredThrottleRef.current.set(msg.conversationId, timer);
      }
      // Update the lastMessage preview in the conversations list cache
      qc.setQueryData(
        queryKeys.conversations.list(),
        (old: import("@/lib/api/conversations").Conversation[] | undefined) => {
          if (!old) return old;
          return old.map((c) =>
            c.id === msg.conversationId
              ? {
                  ...c,
                  lastMessage: {
                    content: msg.content,
                    senderId: msg.senderId,
                    type: msg.type,
                    createdAt: msg.createdAt,
                  },
                  maxOffset: Math.max(Number(c.maxOffset ?? 0), msg.offset),
                }
              : c
          );
        }
      );
    };

    socket.on("chat:message_received", handleIncomingMessage);
    socket.on("message:new", handleIncomingMessage);

    socket.on("message:notify", ({ conversationId, latestOffset }: { conversationId: string; latestOffset: number }) => {
      // Update maxOffset in the conversations list so the unread badge recalculates
      // without fetching the full conversation detail.
      qc.setQueryData(
        queryKeys.conversations.list(),
        (old: import("@/lib/api/conversations").Conversation[] | undefined) => {
          if (!old) return old;
          return old.map((c) =>
            c.id === conversationId
              ? { ...c, maxOffset: Math.max(Number(c.maxOffset ?? 0), latestOffset) }
              : c
          );
        }
      );
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
      // Reconcile optimistic message → real messageId + offset.
      // The server may or may not include clientMessageId in this event.
      // Strategy: match by clientMessageId first; if absent, match by real messageId
      // (markAcked already swapped the temp id → real id via HTTP response).
      qc.setQueryData(
        queryKeys.messages.list(conversationId),
        (old: MessagesInfiniteData | undefined) => {
          if (!old) return old;
          const pages = old.pages.map((page) => ({
            ...page,
            data: page.data.map((m) => {
              const matchByClientId = clientMessageId && m.clientMessageId === clientMessageId;
              const matchByMessageId = !clientMessageId && m.messageId === messageId;
              if (!matchByClientId && !matchByMessageId) return m;
              return { ...m, messageId, offset, clientMessageId: undefined, _pending: false };
            }),
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

    socket.on("message:revoked", ({ messageId, conversationId }: { messageId: string; conversationId: string }) => {
      qc.setQueryData(
        queryKeys.messages.list(conversationId),
        (old: MessagesInfiniteData | undefined) => {
          if (!old) return old;
          const pages = old.pages.map((page) => ({
            ...page,
            data: page.data.map((m) =>
              m.messageId === messageId ? { ...m, isRevoked: true, content: "" } : m
            ),
          }));
          return { ...old, pages };
        }
      );
    });

    socket.on("message:updated", ({ messageId, attachment, mediaStatus: legacyStatus, metadata }) => {
      // Resolve status from either new `attachment` payload or legacy `mediaStatus` field.
      const resolvedStatus = normalizeMediaStatus(attachment?.status ?? legacyStatus);
      // Media processing complete — update mediaStatus and optional waveform metadata.
      // We don't know which conversation the message belongs to, so scan all cached
      // message-list queries. Use findAll + setQueryData (instead of setQueriesData)
      // so we can safely skip pinned-message queries that store a plain Message[].
      const listKeys = qc.getQueryCache().findAll({ queryKey: queryKeys.messages.all });
      for (const query of listKeys) {
        qc.setQueryData(
          query.queryKey,
          (old: MessagesInfiniteData | undefined) => {
            if (!old || !Array.isArray(old.pages)) return old;
            const pages = old.pages.map((page) => ({
              ...page,
              data: Array.isArray(page?.data)
                ? page.data.map((m) => {
                    if (m.messageId !== messageId) return m;
                    const updated = { ...m, mediaStatus: resolvedStatus };
                    if (metadata) updated.metadata = { ...m.metadata, ...metadata };
                    return updated;
                  })
                : page?.data,
            }));
            return { ...old, pages };
          }
        );
      }
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

      // Surgically update the conversation list for DIRECT conversations where
      // this user is otherUser. UserAvatar already reads from presenceStore so
      // the display is already correct; this keeps the cache consistent.
      qc.setQueryData<import("@/lib/api/conversations").Conversation[]>(
        queryKeys.conversations.list(),
        (old) =>
          old?.map((c) => {
            if (c.otherUser?.id !== userId) return c;
            return {
              ...c,
              otherUser: {
                ...c.otherUser,
                displayName: snapshot.displayName ?? c.otherUser.displayName,
                avatarUrl: avatarUrl ?? c.otherUser.avatarUrl ?? null,
              },
            };
          }) ?? old
      );
      qc.invalidateQueries({ queryKey: queryKeys.users.detail(userId) });
    });
    // ─── Membership ────────────────────────────────────────────────────────
    socket.on("member:added", ({ conversationId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
      qc.invalidateQueries({ queryKey: queryKeys.conversations.members(conversationId) });
      scheduleListInvalidate();
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
        scheduleListInvalidate();
      }
    });

    // ─── Cursor tracking ──────────────────────────────────────────────────
    socket.on("cursor:seen_updated", ({ conversationId, userId, upToOffset }: { conversationId: string; userId: string; upToOffset: number }) => {
      qc.setQueryData(
        queryKeys.conversations.members(conversationId),
        (old: import("@/lib/api/conversations").ConversationMember[] | undefined) => {
          if (!old) return old;
          return old.map((m) =>
            m.userId === userId
              ? { ...m, lastSeenOffset: Math.max(m.lastSeenOffset, upToOffset) }
              : m
          );
        }
      );
    });

    socket.on("cursor:delivered_updated", ({ conversationId, userId, upToOffset }: { conversationId: string; userId: string; upToOffset: number }) => {
      qc.setQueryData(
        queryKeys.conversations.members(conversationId),
        (old: import("@/lib/api/conversations").ConversationMember[] | undefined) => {
          if (!old) return old;
          return old.map((m) =>
            m.userId === userId
              ? { ...m, lastDeliveredOffset: Math.max(m.lastDeliveredOffset, upToOffset) }
              : m
          );
        }
      );
    });

    socket.on("message:reaction_updated", ({ messageId, conversationId, reactions }: { messageId: string; conversationId: string; reactions: import("@/lib/api/messages").ReactionMap }) => {
      qc.setQueryData(
        queryKeys.messages.list(conversationId),
        (old: MessagesInfiniteData | undefined) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              data: page.data.map((m) =>
                m.messageId === messageId ? { ...m, reactions } : m
              ),
            })),
          };
        }
      );
    });

    // ─── New conversation (e.g. friend request accepted → DIRECT auto-created) ──
    socket.on("conversation:new", ({ conversationId }: { conversationId: string }) => {
      // Fetch once to get full details (presigned avatarUrl etc.), then insert
      // at the top of the list. Skip if it's already present (idempotent).
      getConversation(conversationId)
        .then((fresh) => {
          qc.setQueryData(queryKeys.conversations.detail(conversationId), fresh);
          qc.setQueryData<import("@/lib/api/conversations").Conversation[]>(
            queryKeys.conversations.list(),
            (old) => {
              if (!old) return [fresh];
              if (old.some((c) => c.id === conversationId)) return old;
              return [fresh, ...old];
            }
          );
        })
        .catch(() => {
          qc.invalidateQueries({ queryKey: queryKeys.conversations.list() });
        });
    });

    // ─── Conversation info changes ─────────────────────────────────────────
    socket.on("conversation:updated", async ({ conversationId, changes }: { conversationId: string; changes: Record<string, unknown> }) => {
      // Resolve a presigned URL only when avatarMediaId changed — avoid a full
      // getConversation() round-trip for every metadata change.
      let avatarUrl: string | undefined;
      if (changes.avatarMediaId) {
        try {
          avatarUrl = await getMediaSignedUrl(changes.avatarMediaId as string, "OPTIMIZED");
        } catch {
          // Media resolution failed — fall back to a full refetch
          qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
          scheduleListInvalidate();
          return;
        }
      }

      // Build a minimal patch from the event payload (undefined values already
      // stripped by backend before broadcasting).
      const patch: Partial<import("@/lib/api/conversations").Conversation> = {};
      if (changes.name !== undefined) patch.name = changes.name as string;
      if (changes.description !== undefined) patch.description = changes.description as string;
      if (changes.avatarMediaId !== undefined) {
        patch.avatarMediaId = (changes.avatarMediaId as string | null) ?? null;
        if (avatarUrl !== undefined) patch.avatarUrl = avatarUrl;
      }

      // Apply directly — no additional API call needed
      qc.setQueryData<import("@/lib/api/conversations").Conversation>(
        queryKeys.conversations.detail(conversationId),
        (old) => (old ? { ...old, ...patch } : old)
      );
      qc.setQueryData<import("@/lib/api/conversations").Conversation[]>(
        queryKeys.conversations.list(),
        (old) => old?.map((c) => (c.id === conversationId ? { ...c, ...patch } : c)) ?? old
      );
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
      deliveredThrottleRef.current.forEach((t) => clearTimeout(t));
      deliveredThrottleRef.current.clear();
      if (listInvalidateTimerRef.current) clearTimeout(listInvalidateTimerRef.current);
    };
  }, [myId, setConnected, setPresence, setSessionRevoked, setTyping, clearTyping, setUserProfile, token]); // Re-bind after token change (reconnect)
}
