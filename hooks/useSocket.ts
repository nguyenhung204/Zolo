"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/authStore";
import { useSocketStore } from "@/stores/socketStore";
import { usePresenceStore } from "@/stores/presenceStore";
import { useTypingStore } from "@/stores/typingStore";
import { useMentionStore } from "@/stores/mentionStore";
import { getChatSocket } from "@/lib/socket/socket";
import { getQueryClient } from "@/lib/query/queryClient";
import { queryKeys } from "@/lib/query/keys";
import type { WsMessage } from "@/lib/socket/events";
import { upsertMessage, prefetchMessages, type MessagesInfiniteData } from "@/hooks/useMessages";
import { getMediaSignedUrl } from "@/lib/api/media";
import { getFriendsPresence, getMyPresenceStatus } from "@/lib/api/presence";
import { getConversation } from "@/lib/api/conversations";
import { normalizeReactionMap, type Message } from "@/lib/api/messages";
import type { Friendship, FriendshipStatus, FriendshipStatusResponse, PendingRequestsResponse, UserSearchResult } from "@/lib/api/friends";
import { decodeId } from "@/lib/utils/obfuscateId";
import { toast } from "sonner";

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
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const myId = useAuthStore((s) => s.user?.id);
  const setSessionRevoked = useAuthStore((s) => s.setSessionRevoked);
  const { setConnected } = useSocketStore();
  const { setPresence, setUserProfile } = usePresenceStore();
  const { setTyping, clearTyping, clearConversationTyping } = useTypingStore();
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
    const unique = (ids: string[]) => Array.from(new Set(ids.filter(Boolean)));
    const getOtherUserId = (ids: Array<string | undefined>) =>
      ids.find((id) => !!id && id !== myId) ?? ids.find(Boolean);
    const patchFriendRequests = (updater: (old: PendingRequestsResponse) => PendingRequestsResponse) => {
      qc.setQueryData<PendingRequestsResponse>(
        queryKeys.friends.requests(),
        (old) => updater({
          incoming: old?.incoming ?? [],
          outgoing: old?.outgoing ?? [],
        })
      );
    };
    const patchFriendshipStatus = (targetUserId: string | undefined, status: FriendshipStatus) => {
      if (!targetUserId) return;
      qc.setQueryData<FriendshipStatusResponse>(
        queryKeys.friends.status(targetUserId),
        (old) => ({
          userId: old?.userId ?? myId ?? "",
          targetUserId: old?.targetUserId ?? targetUserId,
          status,
        })
      );
      qc.getQueryCache().findAll({ queryKey: queryKeys.users.all }).forEach((query) => {
        qc.setQueryData<UserSearchResult[] | unknown>(
          query.queryKey,
          (old: unknown) => Array.isArray(old)
            ? old.map((user) =>
                user && typeof user === "object" && "id" in user && user.id === targetUserId
                  ? { ...user, friendship: status }
                  : user
              )
            : old
        );
      });
    };
    const addFriendToCache = (friendId: string | undefined) => {
      if (!friendId) return;
      qc.setQueryData<Friendship[]>(
        queryKeys.friends.list(),
        (old) => {
          const current = old ?? [];
          if (current.some((friendship) => friendship.friendId === friendId)) return current;
          return [
            { id: friendId, userId: myId ?? "", friendId, status: "FRIEND" },
            ...current,
          ];
        }
      );
    };
    const removeFriendFromCache = (friendId: string | undefined) => {
      if (!friendId) return;
      qc.setQueryData<Friendship[]>(
        queryKeys.friends.list(),
        (old) => old?.filter((friendship) => friendship.friendId !== friendId) ?? old
      );
    };
    const forgetConversation = (conversationId: string) => {
      qc.removeQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
      qc.removeQueries({ queryKey: queryKeys.conversations.members(conversationId) });
      qc.removeQueries({ queryKey: queryKeys.messages.list(conversationId) });
      qc.removeQueries({ queryKey: queryKeys.polls.list(conversationId) });
      qc.removeQueries({ queryKey: queryKeys.appointments.list(conversationId) });
      qc.removeQueries({ queryKey: queryKeys.inviteLink.detail(conversationId) });
      clearConversationTyping(conversationId);
      qc.setQueryData<import("@/lib/api/conversations").Conversation[]>(
        queryKeys.conversations.list(),
        (old) => old?.filter((c) => c.id !== conversationId) ?? old
      );
    };
    const leaveActiveConversationIfNeeded = (conversationId: string) => {
      const activeId = decodeId(window.location.pathname.split("/").filter(Boolean).at(-1) ?? "");
      if (activeId === conversationId) router.push("/conversations");
    };
    const patchCachedMessages = (
      updater: (message: Message) => Message
    ) => {
      const listKeys = qc.getQueryCache().findAll({ queryKey: queryKeys.messages.all });
      for (const query of listKeys) {
        qc.setQueryData(
          query.queryKey,
          (old: MessagesInfiniteData | undefined) => {
            if (!old || !Array.isArray(old.pages)) return old;
            return {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                data: Array.isArray(page.data) ? page.data.map(updater) : page.data,
              })),
            };
          }
        );
      }
    };
    const updateMessageDeliveryByCursor = (
      conversationId: string,
      userId: string | undefined,
      upToOffset: number,
      status: "delivered" | "read"
    ) => {
      if (!userId || userId === myId) return;
      qc.setQueryData(
        queryKeys.messages.list(conversationId),
        (old: MessagesInfiniteData | undefined) => {
          if (!old || !Array.isArray(old.pages)) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              data: page.data.map((m) => {
                if (m.senderId !== myId || Number(m.offset ?? 0) <= 0 || Number(m.offset) > upToOffset) {
                  return m;
                }
                if (status === "delivered" && m.deliveryStatus === "read") return m;
                return { ...m, deliveryStatus: status };
              }),
            })),
          };
        }
      );
    };
    const handleMediaMutation = ({ messageId, attachment, mediaStatus: legacyStatus, metadata }: {
      messageId: string;
      attachment?: {
        mediaId: string;
        kind?: "image" | "video" | "audio" | "file";
        status?: string;
        variantsReady?: boolean;
        thumbReady?: boolean;
        meta?: { width?: number; height?: number; format?: string };
        error?: string;
      };
      mediaStatus?: string;
      metadata?: Message["metadata"];
    }) => {
      const resolvedStatus = normalizeMediaStatus(attachment?.status ?? legacyStatus);
      patchCachedMessages((m) => {
        if (m.messageId !== messageId) return m;
        const attachments = attachment
          ? (m.attachments ?? []).map((item) =>
              item.mediaId === attachment.mediaId
                ? {
                    ...item,
                    type: item.type ?? attachment.kind,
                    status: attachment.status ?? item.status,
                    variantsReady: attachment.variantsReady ?? item.variantsReady,
                  }
                : item
            )
          : m.attachments;
        return {
          ...m,
          mediaStatus: resolvedStatus ?? m.mediaStatus,
          attachments,
          metadata: metadata ? { ...m.metadata, ...metadata } : m.metadata,
        };
      });
    };

    // ─── Connection lifecycle ───────────────────────────────────────────────
    socket.on("connect", () => {
      setConnected(true, socket.id);
      // Some server configurations require an explicit authenticate event
      // after connection in addition to the handshake auth object
      socket.emit("authenticate", { token });
      // Start heartbeat every 3 s
      heartbeatRef.current = setInterval(() => {
        socket.emit("heartbeat");
      }, 3_000);
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

    socket.on("authenticated", ({ socketId }: { userId: string; socketId: string }) => {
      setConnected(true, socketId);
    });

    socket.on("heartbeat:ack", () => {});

    socket.on("conversation:joined", ({ conversationId, success, latestOffset }: { conversationId?: string; success: boolean; latestOffset?: number; error?: string }) => {
      if (!success || !conversationId || latestOffset === undefined) return;
      qc.setQueryData(
        queryKeys.conversations.list(),
        (old: import("@/lib/api/conversations").Conversation[] | undefined) =>
          old?.map((c) =>
            c.id === conversationId
              ? { ...c, maxOffset: Math.max(Number(c.maxOffset ?? 0), Number(latestOffset ?? 0)) }
              : c
          )
      );
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
        senderId: msg.senderId ?? "SYSTEM",
        content: typeof msg.content === "string" ? msg.content : "",
        updatedAt: msg.editedAt ?? msg.createdAt,
      } as Message;
      // Track mentions if the current user is mentioned
      const mentions = (msg as WsMessage & { mentions?: string[] }).mentions ?? (normalized as { metadata?: { mentions?: string[] } }).metadata?.mentions;
      if (mentions?.includes(myId ?? "")) {
        useMentionStore.getState().setMention(msg.conversationId);
      }
      // If this conversation has no cache yet, prefetch the latest 30 messages
      // so opening the conversation later is instant (no loading spinner).
      // For active conversations (cache exists) upsertMessage does the live update.
      if (!qc.getQueryData(queryKeys.messages.list(msg.conversationId))) {
        prefetchMessages(qc, msg.conversationId);
      } else {
        upsertMessage(qc, msg.conversationId, normalized);
      }
      // Throttle-emit delivered cursor for incoming messages from others (1s per conversation)
      if (msg.senderId && msg.senderId !== myId && msg.offset > 0) {
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
                    content: msg.content ?? "",
                    senderId: msg.senderId ?? "SYSTEM",
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

    socket.on("message:notify", ({ conversationId, latestOffset, mentions, content, type }: { conversationId: string; latestOffset: number; mentions?: string[]; content?: string; type?: string }) => {
      // Update maxOffset in the conversations list so the unread badge recalculates
      // without fetching the full conversation detail.
      qc.setQueryData(
        queryKeys.conversations.list(),
        (old: import("@/lib/api/conversations").Conversation[] | undefined) => {
          if (!old) return old;
          return old.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  lastMessage: content !== undefined && type
                    ? {
                        content,
                        senderId: c.lastMessage?.senderId ?? "",
                        type,
                        createdAt: new Date().toISOString(),
                      }
                    : c.lastMessage,
                  maxOffset: Math.max(Number(c.maxOffset ?? 0), latestOffset),
                }
              : c
          );
        }
      );
      // Check if the current user was mentioned
      if (mentions?.includes(myId ?? "")) {
        useMentionStore.getState().setMention(conversationId);
      }
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
              return { ...m, messageId, offset, clientMessageId: undefined, _pending: false, deliveryStatus: "sent" };
            }),
          }));
          return { ...old, pages };
        }
      );
    });

    socket.on("message:rejected", ({ clientMessageId }) => {
      // Mark optimistic message as failed — scan all conversation caches
      patchCachedMessages((m) =>
        m.clientMessageId === clientMessageId
          ? { ...m, _failed: true, _pending: false, deliveryStatus: "failed" }
          : m
      );
    });

    socket.on("message:failed", ({ clientMessageId, conversationId }: { clientMessageId?: string; conversationId: string; errorMessage?: string; failedAt?: string; originalTopic?: string }) => {
      qc.setQueryData(
        queryKeys.messages.list(conversationId),
        (old: MessagesInfiniteData | undefined) => {
          if (!old || !Array.isArray(old.pages)) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              data: page.data.map((m) =>
                clientMessageId && m.clientMessageId === clientMessageId
                  ? { ...m, _failed: true, _pending: false, deliveryStatus: "failed" }
                  : m
              ),
            })),
          };
        }
      );
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

    socket.on("message:deleted", ({ messageId, conversationId, deletedAt }: { messageId: string; conversationId: string; deletedAt?: string }) => {
      qc.setQueryData(
        queryKeys.messages.list(conversationId),
        (old: MessagesInfiniteData | undefined) => {
          if (!old) return old;
          const pages = old.pages.map((page) => ({
            ...page,
            data: page.data.map((m) =>
              m.messageId === messageId
                ? { ...m, deletedAt: deletedAt ?? new Date().toISOString() }
                : m
            ),
          }));
          return { ...old, pages };
        }
      );
    });

    socket.on("message:deleted_for_me", ({ messageId, conversationId, deletedAt }: { messageId: string; conversationId: string; deletedAt: string }) => {
      qc.setQueryData(
        queryKeys.messages.list(conversationId),
        (old: MessagesInfiniteData | undefined) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              data: page.data.filter((m) => m.messageId !== messageId).map((m) =>
                m.messageId === messageId ? { ...m, deletedAt } : m
              ),
            })),
          };
        }
      );
    });

    socket.on("message:revoked", ({ messageId, conversationId, revokedAt }: { messageId: string; conversationId: string; revokedAt?: string; tombstoneTextKey?: string }) => {
      qc.setQueryData(
        queryKeys.messages.list(conversationId),
        (old: MessagesInfiniteData | undefined) => {
          if (!old) return old;
          const pages = old.pages.map((page) => ({
            ...page,
            data: page.data.map((m) =>
              m.messageId === messageId ? { ...m, isRevoked: true, deletedAt: revokedAt ?? m.deletedAt, content: "" } : m
            ),
          }));
          return { ...old, pages };
        }
      );
    });

    socket.on("message:media_ready", handleMediaMutation);
    socket.on("message:updated", handleMediaMutation);

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

    // ─── Friendship lifecycle ────────────────────────────────────────────────
    socket.on("friendship:request_sent", ({ fromUserId, toUserId }) => {
      if (fromUserId !== myId) return;
      patchFriendRequests((old) => ({
        incoming: old.incoming.filter((id) => id !== toUserId),
        outgoing: unique([...old.outgoing, toUserId]),
      }));
      patchFriendshipStatus(toUserId, "PENDING_OUT");
    });

    socket.on("friendship:request_received", ({ fromUserId, toUserId, fromUserName }) => {
      if (toUserId !== myId) return;
      patchFriendRequests((old) => ({
        incoming: unique([...old.incoming, fromUserId]),
        outgoing: old.outgoing.filter((id) => id !== fromUserId),
      }));
      patchFriendshipStatus(fromUserId, "PENDING_IN");
      toast.info(`${fromUserName ?? "Someone"} sent you a friend request.`);
    });

    socket.on("friendship:request_accepted", ({ acceptedBy, acceptedByName, requesterId, requesterName, userIds }) => {
      const otherUserId = getOtherUserId([...(userIds ?? []), acceptedBy, requesterId]);
      if (!otherUserId) return;
      patchFriendRequests((old) => ({
        incoming: old.incoming.filter((id) => id !== otherUserId),
        outgoing: old.outgoing.filter((id) => id !== otherUserId),
      }));
      patchFriendshipStatus(otherUserId, "FRIEND");
      addFriendToCache(otherUserId);
      if (acceptedBy !== myId) {
        toast.success(`${acceptedByName ?? requesterName ?? "Your contact"} accepted your friend request.`);
      }
      qc.invalidateQueries({ queryKey: queryKeys.conversations.list() });
    });

    socket.on("friendship:request_rejected", ({ rejectedBy, rejectedByName, requesterId, userIds }) => {
      const otherUserId = getOtherUserId([...(userIds ?? []), rejectedBy, requesterId]);
      if (!otherUserId) return;
      patchFriendRequests((old) => ({
        incoming: old.incoming.filter((id) => id !== otherUserId),
        outgoing: old.outgoing.filter((id) => id !== otherUserId),
      }));
      patchFriendshipStatus(otherUserId, "NONE");
      if (rejectedBy !== myId && requesterId === myId) {
        toast.info(`${rejectedByName ?? "The user"} declined your friend request.`);
      }
    });

    socket.on("friendship:removed", ({ userIds, removedBy, targetUserId }) => {
      const otherUserId = getOtherUserId([...(userIds ?? []), removedBy, targetUserId]);
      if (!otherUserId) return;
      removeFriendFromCache(otherUserId);
      patchFriendshipStatus(otherUserId, "NONE");
      qc.invalidateQueries({ queryKey: queryKeys.conversations.list() });
    });

    socket.on("friendship:blocked", ({ blocker, blocked }) => {
      const otherUserId = blocker === myId ? blocked : blocker;
      removeFriendFromCache(otherUserId);
      patchFriendRequests((old) => ({
        incoming: old.incoming.filter((id) => id !== otherUserId),
        outgoing: old.outgoing.filter((id) => id !== otherUserId),
      }));
      patchFriendshipStatus(otherUserId, blocker === myId ? "BLOCKED" : "NONE");
      qc.invalidateQueries({ queryKey: queryKeys.friends.blocked() });
    });

    socket.on("friendship:unblocked", ({ unblocker, unblocked }) => {
      const otherUserId = unblocker === myId ? unblocked : unblocker;
      patchFriendshipStatus(otherUserId, "NONE");
      qc.invalidateQueries({ queryKey: queryKeys.friends.blocked() });
    });

    // ─── Membership ────────────────────────────────────────────────────────
    socket.on("conversation:member-added", ({ conversationId, addedUsers, addedUserIds }) => {
      const addedIds = [...(addedUsers?.map((user) => user.id) ?? []), ...(addedUserIds ?? [])];
      if (myId && addedIds.includes(myId)) {
        getConversation(conversationId)
          .then((fresh) => {
            qc.setQueryData(queryKeys.conversations.detail(conversationId), fresh);
            qc.setQueryData<import("@/lib/api/conversations").Conversation[]>(
              queryKeys.conversations.list(),
              (old) => {
                if (!old) return [fresh];
                return old.some((c) => c.id === conversationId)
                  ? old.map((c) => (c.id === conversationId ? fresh : c))
                  : [fresh, ...old];
              }
            );
          })
          .catch(scheduleListInvalidate);
      }
      qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
      qc.invalidateQueries({ queryKey: queryKeys.conversations.members(conversationId) });
      scheduleListInvalidate();
    });

    socket.on("conversation:member-removed", ({ conversationId, removedUserIds, removedUsers, removedByName, source }) => {
      const selfId = useAuthStore.getState().user?.id;
      const removedIds = [...(removedUsers?.map((user) => user.id) ?? []), ...(removedUserIds ?? [])];
      if (selfId && removedIds.includes(selfId)) {
        // Current user was removed — evict conversation from the list cache
        forgetConversation(conversationId);
        leaveActiveConversationIfNeeded(conversationId);
        toast.error(source === "member_left" ? "You left this group." : `You were removed${removedByName ? ` by ${removedByName}` : ""}.`);
      } else {
        qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
        qc.invalidateQueries({ queryKey: queryKeys.conversations.members(conversationId) });
        scheduleListInvalidate();
      }
    });

    // ─── Group lifecycle / membership events that can arrive while not viewing the group ──
    socket.on("group:settings_updated", ({ conversationId, changes }: { conversationId: string; changes: Record<string, unknown> }) => {
      qc.setQueryData<import("@/lib/api/conversations").Conversation>(
        queryKeys.conversations.detail(conversationId),
        (old) => (old ? { ...old, ...changes } : old)
      );
      qc.setQueryData<import("@/lib/api/conversations").Conversation[]>(
        queryKeys.conversations.list(),
        (old) => old?.map((c) => (c.id === conversationId ? { ...c, ...changes } : c)) ?? old
      );
    });

    socket.on("group:member_role_changed", ({ conversationId, userId, newRole }: { conversationId: string; userId: string; newRole: string }) => {
      qc.setQueryData<import("@/lib/api/conversations").ConversationMember[]>(
        queryKeys.conversations.members(conversationId),
        (old) => old?.map((m) => (m.userId === userId ? { ...m, role: newRole as import("@/lib/api/conversations").MemberRole } : m))
      );
      qc.setQueryData<import("@/lib/api/conversations").Conversation>(
        queryKeys.conversations.detail(conversationId),
        (old) =>
          old?.participants
            ? {
                ...old,
                participants: old.participants.map((p) =>
                  p.userId === userId ? { ...p, role: newRole } : p
                ),
              }
            : old
      );
    });

    socket.on("group:member_kicked", ({ conversationId, userId, kickedByName }: { conversationId: string; userId: string; kickedByName?: string }) => {
      const selfId = useAuthStore.getState().user?.id;
      if (selfId && userId === selfId) {
        forgetConversation(conversationId);
        leaveActiveConversationIfNeeded(conversationId);
        toast.error(`You have been removed from this group${kickedByName ? ` by ${kickedByName}` : ""}.`);
      } else {
        qc.setQueryData<import("@/lib/api/conversations").ConversationMember[]>(
          queryKeys.conversations.members(conversationId),
          (old) => old?.filter((m) => m.userId !== userId)
        );
        qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
      }
    });

    socket.on("group:disbanded", ({ conversationId, disbandedByName }: { conversationId: string; disbandedBy: string; disbandedByName?: string; timestamp: string }) => {
      forgetConversation(conversationId);
      leaveActiveConversationIfNeeded(conversationId);
      toast.error(`This group has been disbanded${disbandedByName ? ` by ${disbandedByName}` : ""}.`);
    });

    socket.on("group:join_requested", ({ conversationId }: { conversationId: string; userId: string; userName?: string; requestId: string; requestMessage: string | null; source?: "invite_link" | "request"; timestamp: string }) => {
      qc.invalidateQueries({ queryKey: queryKeys.joinRequests.list(conversationId) });
    });

    socket.on("group:join_approved", ({ conversationId, userId, requestId, reviewedByName }: { conversationId: string; userId?: string; userName?: string; requestId: string; reviewedBy: string; reviewedByName?: string; timestamp: string }) => {
      qc.setQueryData(
        queryKeys.joinRequests.list(conversationId),
        (old: Array<{ id: string }> | undefined) => old?.filter((r) => r.id !== requestId)
      );
      qc.invalidateQueries({ queryKey: queryKeys.conversations.list() });
      qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
      qc.invalidateQueries({ queryKey: queryKeys.conversations.members(conversationId) });
      qc.invalidateQueries({ queryKey: queryKeys.messages.list(conversationId) });
      if (!userId || userId === useAuthStore.getState().user?.id) {
        toast.success(`Your request to join the group has been approved${reviewedByName ? ` by ${reviewedByName}` : ""}!`);
      }
    });

    socket.on("group:join_rejected", ({ conversationId, requestId, userId, reviewedByName }: { conversationId: string; userId?: string; userName?: string; requestId: string; reviewedBy: string; reviewedByName?: string; timestamp: string }) => {
      qc.setQueryData(
        queryKeys.joinRequests.list(conversationId),
        (old: Array<{ id: string }> | undefined) => old?.filter((r) => r.id !== requestId)
      );
      if (!userId || userId === useAuthStore.getState().user?.id) {
        toast.error(`Your request to join the group was declined${reviewedByName ? ` by ${reviewedByName}` : ""}.`);
      }
    });

    socket.on("conversation:removed", ({ conversationId, message }) => {
      forgetConversation(conversationId);
      leaveActiveConversationIfNeeded(conversationId);
      if (message) toast.error(message);
    });

    // ─── Cursor tracking ──────────────────────────────────────────────────
    socket.on("cursor:seen_updated", ({ conversationId, userId, upToOffset }: { conversationId: string; userId?: string; upToOffset: number }) => {
      const targetUserId = userId ?? myId;
      qc.setQueryData(
        queryKeys.conversations.members(conversationId),
        (old: import("@/lib/api/conversations").ConversationMember[] | undefined) => {
          if (!old) return old;
          return old.map((m) =>
            m.userId === targetUserId
              ? { ...m, lastSeenOffset: Math.max(m.lastSeenOffset, upToOffset) }
              : m
          );
        }
      );
      updateMessageDeliveryByCursor(conversationId, targetUserId, upToOffset, "read");
    });

    socket.on("cursor:delivered_updated", ({ conversationId, userId, upToOffset }: { conversationId: string; userId?: string; upToOffset: number }) => {
      const targetUserId = userId ?? myId;
      qc.setQueryData(
        queryKeys.conversations.members(conversationId),
        (old: import("@/lib/api/conversations").ConversationMember[] | undefined) => {
          if (!old) return old;
          return old.map((m) =>
            m.userId === targetUserId
              ? { ...m, lastDeliveredOffset: Math.max(m.lastDeliveredOffset, upToOffset) }
              : m
          );
        }
      );
      updateMessageDeliveryByCursor(conversationId, targetUserId, upToOffset, "delivered");
    });

    socket.on("message:status", ({ messageId, status, seen, delivered, seenByCount, deliveredToCount, error }: {
      messageId: string;
      status?: "sending" | "sent" | "delivered" | "read" | "failed";
      seen?: { count: number };
      delivered?: { count: number };
      seenByCount?: number;
      deliveredToCount?: number;
      error?: string;
    }) => {
      if (error) return;
      const resolvedStatus =
        status ??
        ((seen?.count ?? seenByCount ?? 0) > 0
          ? "read"
          : (delivered?.count ?? deliveredToCount ?? 0) > 0
            ? "delivered"
            : "sent");
      patchCachedMessages((m) =>
        m.messageId === messageId ? { ...m, deliveryStatus: resolvedStatus } : m
      );
    });

    socket.on("message:reaction_updated", ({ messageId, conversationId, reactions }: { messageId: string; conversationId: string; reactions: unknown }) => {
      const normalizedReactions = normalizeReactionMap(reactions, myId) ?? {};
      qc.setQueryData(
        queryKeys.messages.list(conversationId),
        (old: MessagesInfiniteData | undefined) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              data: page.data.map((m) =>
                m.messageId === messageId ? { ...m, reactions: normalizedReactions } : m
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
  }, [myId, router, setConnected, setPresence, setSessionRevoked, setTyping, clearTyping, clearConversationTyping, setUserProfile, token]); // Re-bind after token change (reconnect)
}
