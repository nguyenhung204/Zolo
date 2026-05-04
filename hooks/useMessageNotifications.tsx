"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getChatSocket } from "@/lib/socket/socket";
import { useConversationStore } from "@/stores/conversationStore";
import { playNotificationSound } from "@/lib/utils/notificationSound";
import type { WsMessage } from "@/lib/socket/events";
import { encodeId } from "@/lib/utils/obfuscateId";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function messagePreview(type: WsMessage["type"], content: string): string {
  switch (type) {
    case "image":   return "Sent an image 🖼️";
    case "video":   return "Sent a video 🎬";
    case "audio":   return "Sent a voice message 🎤";
    case "file":    return "Sent a file 📎";
    case "sticker": return "Sent a sticker 😄";
    case "media":   return "Sent media";
    default:        return content.length > 80 ? content.slice(0, 80) + "…" : content;
  }
}

function isPinSystemPayload(payload: { type?: string; content?: string; metadata?: { action?: unknown } }) {
  if (payload.type !== "system") return false;
  if (payload.metadata?.action === "MESSAGE_PINNED" || payload.metadata?.action === "MESSAGE_UNPINNED") {
    return true;
  }
  return /\b(un)?pinned a message\b/i.test(payload.content ?? "");
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
  subtitle?: string;
  body: string;
  onNavigate: () => void;
  onDismiss: () => void;
}

function NotificationToast({
  title,
  subtitle,
  body,
  onNavigate,
  onDismiss,
}: ToastPayload) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onNavigate}
      onKeyDown={(e) => e.key === "Enter" && onNavigate()}
      className="flex items-center gap-3 w-[340px] max-w-[92vw] px-3.5 py-3 rounded-2xl bg-surface border border-border shadow-xl cursor-pointer hover:brightness-105 active:scale-[0.98] transition-all duration-150 select-none"
    >
      {/* Zolo logo */}
      <div className="relative shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/zolo.png"
          alt="Zolo"
          className="w-10 h-10 rounded-xl object-cover"
        />
        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-cta border-2 border-surface" />
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-text truncate leading-snug">{title}</p>
        {subtitle ? (
          <p className="text-[11px] text-cta/80 font-medium truncate leading-snug">{subtitle}</p>
        ) : null}
        <p className="text-xs text-muted truncate leading-snug">{body}</p>
      </div>

      {/* Dismiss */}
      <button
        aria-label="Dismiss notification"
        onClick={(e) => { e.stopPropagation(); onDismiss(); }}
        className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full hover:bg-border/70 text-muted hover:text-text transition-colors"
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
 * Mount once inside AppShell.
 */
export function useMessageNotifications() {
  const router = useRouter();
  const activeConvId = useConversationStore((s) => s.activeConversationId);
  const setActive = useConversationStore((s) => s.setActiveConversation);

  // Capture latest activeConvId without re-registering socket listeners
  const activeConvIdRef = useRef(activeConvId);
  useEffect(() => { activeConvIdRef.current = activeConvId; }, [activeConvId]);

  const showNotification = useCallback(
    (conversationId: string, title: string, subtitle: string | undefined, body: string) => {
      const navigate = () => {
        setActive(conversationId);
        router.push(`/conversations/${encodeId(conversationId)}`);
      };

      toast.custom(
        (id) => (
          <NotificationToast
            toastId={id}
            title={title}
            subtitle={subtitle}
            body={body}
            onNavigate={navigate}
            onDismiss={() => { toast.dismiss(id); }}
          />
        ),
        { duration: 5_000, position: "top-right" }
      );
      playNotificationSound();

      if (!document.hasFocus()) {
        ensureNotificationPermission().then((granted) => {
          if (granted) {
            const browserBody = subtitle ? `${subtitle}: ${body}` : body;
            showBrowserNotification(title, browserBody, "/zolo.png");
          }
        });
      }
    },
    [router, setActive]
  );

  useEffect(() => {
    const socket = getChatSocket();

    // ─── message:notify — server pushes to clients NOT in the room ───────────
    const handleMessageNotify = ({
      conversationId,
      senderName,
      content,
      type,
      metadata,
      conversationName,
    }: {
      conversationId: string;
      latestOffset: number;
      senderName: string;
      content: string;
      type: string;
      metadata?: WsMessage["metadata"];
      conversationName?: string;
    }) => {
      if (conversationId === activeConvIdRef.current) return;
      if (isPinSystemPayload({ type, content, metadata })) return;

      const title = conversationName ?? senderName;
      const subtitle = conversationName ? senderName : undefined;
      const body = messagePreview(type as WsMessage["type"], content);

      showNotification(conversationId, title, subtitle, body);
    };

    socket.on("message:notify", handleMessageNotify);
    return () => { socket.off("message:notify", handleMessageNotify); };
  }, [showNotification]);
}