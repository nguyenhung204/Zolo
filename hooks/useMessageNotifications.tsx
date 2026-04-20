"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getChatSocket } from "@/lib/socket/socket";
import { useAuthStore } from "@/stores/authStore";
import { useConversationStore } from "@/stores/conversationStore";
import { queryKeys } from "@/lib/query/keys";
import { playNotificationSound } from "@/lib/utils/notificationSound";
import type { Conversation } from "@/lib/api/conversations";
import type { WsMessage } from "@/lib/socket/events";

// ─── Config ────────────────────────────────────────────────────────────────────

/** Minimum ms between notifications for the same conversation. */
const THROTTLE_MS = 3_000;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function messagePreview(type: WsMessage["type"], content: string): string {
  switch (type) {
    case "image":   return "Đã gửi một ảnh 🖼️";
    case "video":   return "Đã gửi một video 🎬";
    case "audio":   return "Đã gửi một tin nhắn thoại 🎤";
    case "file":    return "Đã gửi một file 📎";
    case "sticker": return "Đã gửi sticker 😄";
    case "media":   return "Đã gửi media";
    default:        return content.length > 80 ? content.slice(0, 80) + "…" : content;
  }
}

/** Request browser Notification permission lazily (triggered by first message). */
async function ensureNotificationPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

function showBrowserNotification(title: string, body: string, icon?: string) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, {
      body,
      icon: icon ?? "/favicon.ico",
      silent: true, // We handle sound ourselves
      tag: `zolo-msg-${title}`,   // Collapse duplicate from same sender
    });
    // Auto-close after 5 s to keep desktop clean
    setTimeout(() => n.close(), 5_000);
  } catch {
    // Blocked by browser policy — non-critical
  }
}

// ─── Toast component (rendered by sonner) ─────────────────────────────────────

interface ToastPayload {
  toastId: string | number;
  title: string;
  body: string;
  avatarUrl?: string | null;
  initials: string;
  onNavigate: () => void;
  onDismiss: () => void;
}

function NotificationToast({
  toastId,
  title,
  body,
  avatarUrl,
  initials,
  onNavigate,
  onDismiss,
}: ToastPayload) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onNavigate}
      onKeyDown={(e) => e.key === "Enter" && onNavigate()}
      className="flex items-center gap-3 w-80 max-w-[90vw] p-3 rounded-xl bg-surface border border-border shadow-lg cursor-pointer hover:bg-border/40 active:scale-[0.98] transition-all duration-150 select-none"
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt={title}
            className="w-10 h-10 rounded-full object-cover"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-cta/15 flex items-center justify-center">
            <span className="text-xs font-bold text-cta">{initials}</span>
          </div>
        )}
        {/* New-message pulse dot */}
        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-cta border-2 border-surface animate-pulse" />
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text truncate leading-tight">{title}</p>
        <p className="text-xs text-muted truncate mt-0.5">{body}</p>
      </div>

      {/* Dismiss button */}
      <button
        aria-label="Đóng thông báo"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full hover:bg-border/60 text-muted hover:text-text transition-colors"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Listens for incoming messages on background/unjoined conversations and
 * surfaces them as:
 *   1. In-app sonner toast (always when conversation not active)
 *   2. Browser Notification API (when browser tab not focused)
 *   3. Soft chime sound
 *
 * Throttle: max 1 notification per conversation per 3 s.
 * Mount once inside AppShell.
 */
export function useMessageNotifications() {
  const router = useRouter();
  const qc = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id);
  const activeConvId = useConversationStore((s) => s.activeConversationId);
  const setActive = useConversationStore((s) => s.setActiveConversation);

  // Tracks last notification timestamp per conversationId
  const lastNotifiedAt = useRef<Map<string, number>>(new Map());
  // Tracks current open toast id per conversationId (so we can dismiss/replace)
  const activeToastId = useRef<Map<string, string | number>>(new Map());

  // Capture latest activeConvId without re-registering socket listeners
  const activeConvIdRef = useRef(activeConvId);
  useEffect(() => { activeConvIdRef.current = activeConvId; }, [activeConvId]);

  const myIdRef = useRef(myId);
  useEffect(() => { myIdRef.current = myId; }, [myId]);

  const showNotification = useCallback(
    (
      conversationId: string,
      title: string,
      body: string,
      avatarUrl?: string | null
    ) => {
      const now = Date.now();
      const last = lastNotifiedAt.current.get(conversationId) ?? 0;
      if (now - last < THROTTLE_MS) return;
      lastNotifiedAt.current.set(conversationId, now);

      // Dismiss previous toast for this conversation (replace with latest)
      const prevToastId = activeToastId.current.get(conversationId);
      if (prevToastId !== undefined) toast.dismiss(prevToastId);

      const initials = title.slice(0, 2).toUpperCase();

      const navigate = () => {
        setActive(conversationId);
        router.push(`/conversations/${conversationId}`);
        const tId = activeToastId.current.get(conversationId);
        if (tId !== undefined) toast.dismiss(tId);
        activeToastId.current.delete(conversationId);
      };

      const toastId = toast.custom(
        (id) => (
          <NotificationToast
            toastId={id}
            title={title}
            body={body}
            avatarUrl={avatarUrl}
            initials={initials}
            onNavigate={navigate}
            onDismiss={() => { toast.dismiss(id); activeToastId.current.delete(conversationId); }}
          />
        ),
        {
          duration: 5_000,
          position: "top-right",
        }
      );

      activeToastId.current.set(conversationId, toastId);

      // Sound
      playNotificationSound();

      // Browser notification when tab is not focused
      if (!document.hasFocus()) {
        ensureNotificationPermission().then((granted) => {
          if (granted) showBrowserNotification(title, body, avatarUrl ?? undefined);
        });
      }
    },
    [router, setActive]
  );

  useEffect(() => {
    const socket = getChatSocket();

    // ─── message:new (we ARE in the room but viewing a different conversation) ─
    const handleMessageNew = (msg: WsMessage) => {
      // Skip own messages and messages from the currently open conversation
      if (msg.senderId === myIdRef.current) return;
      if (msg.conversationId === activeConvIdRef.current) return;

      const convs = qc.getQueryData<Conversation[]>(queryKeys.conversations.list());
      const conv = convs?.find((c) => c.id === msg.conversationId);

      const senderInfo = conv?.participants?.find((p) => p.userId === msg.senderId);
      const senderName =
        senderInfo?.displayName ??
        senderInfo?.username ??
        (conv?.kind === "direct" ? conv.otherUser?.displayName ?? conv.otherUser?.username : null) ??
        "Người dùng";

      const title =
        conv?.kind === "group" || conv?.kind === "community"
          ? `${senderName} · ${conv.name ?? "Nhóm"}`
          : senderName;

      const body = messagePreview(msg.type, msg.content ?? "");
      const avatarUrl =
        conv?.kind === "direct" ? (conv.otherUser?.avatarUrl ?? null) : (conv?.avatarUrl ?? null);

      showNotification(msg.conversationId, title, body, avatarUrl);
    };

    // ─── message:notify (we are NOT in the room at all) ───────────────────────
    const handleMessageNotify = ({
      conversationId,
    }: {
      conversationId: string;
      latestOffset: number;
    }) => {
      if (conversationId === activeConvIdRef.current) return;

      const convs = qc.getQueryData<Conversation[]>(queryKeys.conversations.list());
      const conv = convs?.find((c) => c.id === conversationId);

      const title =
        conv?.kind === "direct"
          ? (conv.otherUser?.displayName ?? conv.otherUser?.username ?? "Tin nhắn mới")
          : (conv?.name ?? "Tin nhắn mới");

      // Use lastMessage preview from cache if available (updated by message:new path)
      const last = conv?.lastMessage;
      const body =
        last
          ? messagePreview(last.type as WsMessage["type"], last.content ?? "")
          : "Bạn có tin nhắn mới";

      const avatarUrl =
        conv?.kind === "direct" ? (conv.otherUser?.avatarUrl ?? null) : (conv?.avatarUrl ?? null);

      showNotification(conversationId, title, body, avatarUrl);
    };

    socket.on("message:new", handleMessageNew);
    socket.on("chat:message_received", handleMessageNew);
    socket.on("message:notify", handleMessageNotify);

    return () => {
      socket.off("message:new", handleMessageNew);
      socket.off("chat:message_received", handleMessageNew);
      socket.off("message:notify", handleMessageNotify);
    };
  }, [qc, showNotification]);
}