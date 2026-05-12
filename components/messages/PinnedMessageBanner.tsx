"use client";

import { useState, useRef, useEffect } from "react";
import { Pin, ChevronUp, ChevronDown, X, FileText, Image, Mic, Sticker, Video, Info, Contact, QrCode } from "lucide-react";
import { usePinnedMessages } from "@/hooks/useMessages";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { getMessagesAround, unpinMessage } from "@/lib/api/messages";
import type { Message } from "@/lib/api/messages";
import type { MessagesInfiniteData } from "@/hooks/useMessages";
import { useConversationStore } from "@/stores/conversationStore";

interface PinnedMessageBannerProps {
  conversationId: string;
  onViewDetails?: (msg: Message) => void;
}

const INVITE_LINK_RE = /^Join "(.+)" on Zolo:\n(https?:\/\/\S+)$/;

function mediaPreview(message: Message) {
  const attachments = message.attachments ?? [];
  const total = attachments.length;
  const counts = attachments.reduce(
    (acc, attachment) => {
      const type = attachment.type ?? attachment.kind;
      if (type === "image" || type === "video" || type === "audio" || type === "file") {
        acc[type] += 1;
      }
      return acc;
    },
    { image: 0, video: 0, audio: 0, file: 0 }
  );
  const firstType = attachments[0]?.type ?? attachments[0]?.kind;

  if (total === 1) {
    if (firstType === "image") return { icon: Image, label: "Hình ảnh" };
    if (firstType === "video") return { icon: Video, label: "Video" };
    if (firstType === "audio") return { icon: Mic, label: "Âm thanh" };
    if (firstType === "file") return { icon: FileText, label: attachments[0]?.filename ?? "File" };
  }

  if (total > 1) {
    if (counts.image === total) return { icon: Image, label: `${total} hình ảnh` };
    if (counts.video === total) return { icon: Video, label: `${total} video` };
    if (counts.audio === total) return { icon: Mic, label: `${total} âm thanh` };
    if (counts.file === total) return { icon: FileText, label: `${total} file` };
    return { icon: Image, label: `${total} tệp đính kèm` };
  }

  return { icon: Image, label: message.content || "Media" };
}

function pinnedPreview(message: Message) {
  if (message.isRevoked) return { icon: null, label: "Tin nhắn đã thu hồi" };
  if (message.type === "text" || !message.type) {
    const inviteMatch = INVITE_LINK_RE.exec(message.content.trim());
    if (inviteMatch) return { icon: QrCode, label: `QR mời nhóm: ${inviteMatch[1]}` };
    return { icon: null, label: message.content || "…" };
  }
  if (message.type === "image") return { icon: Image, label: "Hình ảnh" };
  if (message.type === "video") return { icon: Video, label: "Video" };
  if (message.type === "audio") return { icon: Mic, label: "Âm thanh" };
  if (message.type === "file") return { icon: FileText, label: message.metadata?.filename ?? message.attachments?.[0]?.filename ?? "File" };
  if (message.type === "media") return mediaPreview(message);
  if (message.type === "sticker") return { icon: Sticker, label: "Sticker" };
  if (message.type === "contact_card") return { icon: Contact, label: (message.metadata?.contactUsername ?? message.content) || "Danh thiếp" };
  return { icon: null, label: message.content || `[${message.type}]` };
}

export function PinnedMessageBanner({ conversationId, onViewDetails }: PinnedMessageBannerProps) {
  const { data: pinned = [] } = usePinnedMessages(conversationId);
  const [index, setIndex] = useState(0);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [jumping, setJumping] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  // Close popover on outside click
  useEffect(() => {
    if (!popoverOpen) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [popoverOpen]);

  if (pinned.length === 0) return null;

  const safeIndex = Math.min(index, pinned.length - 1);
  const msg = pinned[safeIndex];

  const preview = pinnedPreview(msg);

  const handleUnpin = async (m: Message) => {
    setPopoverOpen(false);
    try {
      await unpinMessage(m.messageId, conversationId);
    } catch {
      // noop
    }
  };

  const handleViewDetails = () => {
    setPopoverOpen(false);
    onViewDetails?.(msg);
  };

  const handleJumpToMessage = async () => {
    if (jumping) return;
    setPopoverOpen(false);
    setJumping(true);
    try {
      const page = await getMessagesAround({
        conversationId,
        messageId: msg.messageId,
        limit: 30,
      });
      qc.setQueryData<MessagesInfiniteData>(
        queryKeys.messages.list(conversationId),
        {
          pages: [page],
          pageParams: [undefined],
        }
      );
      const store = useConversationStore.getState();
      store.setMessageMode("JUMPED");
      store.clearPendingJumpedMessages(conversationId);
      store.setTargetMessageId(msg.messageId);
      store.setTargetOffset(page.meta.targetOffset ?? msg.offset);
    } finally {
      setJumping(false);
    }
  };

  return (
    <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-surface border-b border-border/60 min-w-0">
      {/* Pin icon + navigate multiple pinned */}
      <div className="flex flex-col items-center gap-0">
        {pinned.length > 1 && (
          <button
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={safeIndex === 0}
            className="text-muted hover:text-cta disabled:opacity-30 cursor-pointer disabled:cursor-default transition-colors"
          >
            <ChevronUp className="w-3 h-3" />
          </button>
        )}
        <Pin className="w-3.5 h-3.5 text-cta shrink-0" />
        {pinned.length > 1 && (
          <button
            onClick={() => setIndex((i) => Math.min(pinned.length - 1, i + 1))}
            disabled={safeIndex === pinned.length - 1}
            className="text-muted hover:text-cta disabled:opacity-30 cursor-pointer disabled:cursor-default transition-colors"
          >
            <ChevronDown className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Clickable content area — opens popover */}
      <div
        ref={popoverRef}
        className="flex-1 min-w-0 relative"
      >
        <button
          type="button"
          onClick={handleJumpToMessage}
          onContextMenu={(e) => {
            e.preventDefault();
            setPopoverOpen((v) => !v);
          }}
          className="w-full text-left hover:bg-border/30 rounded-lg px-1 py-0.5 transition-colors cursor-pointer"
          title="Click to jump to message. Right-click for options."
        >
          <p className="text-[10px] font-semibold text-cta leading-none mb-0.5">
            Tin nhắn ghim{pinned.length > 1 ? ` (${safeIndex + 1}/${pinned.length})` : ""}
          </p>
          <div className="flex items-center gap-1 min-w-0 text-xs text-text truncate leading-tight">
            {preview.icon ? <preview.icon className="w-3 h-3 shrink-0 text-cta" /> : null}
            <p className="truncate">{jumping ? "Đang mở tin nhắn…" : preview.label}</p>
          </div>
        </button>

        {/* Popover */}
        {popoverOpen && (
          <div className="absolute left-0 top-full mt-1.5 z-50 bg-surface rounded-xl border border-border/80 shadow-xl overflow-hidden min-w-[180px]">
            <div className="py-1">
              {onViewDetails && (
                <button
                  onClick={handleViewDetails}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-text hover:bg-border/40 transition-colors cursor-pointer text-left"
                >
                  <Info className="w-3.5 h-3.5 opacity-60 shrink-0" />
                  Xem chi tiết
                </button>
              )}
              <button
                onClick={() => handleUnpin(msg)}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-error hover:bg-error/8 transition-colors cursor-pointer text-left"
              >
                <X className="w-3.5 h-3.5 opacity-60 shrink-0" />
                Bỏ ghim
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Quick unpin button */}
      <button
        onClick={() => handleUnpin(msg)}
        className="w-6 h-6 rounded-full flex items-center justify-center text-muted hover:text-error hover:bg-error/10 transition-colors cursor-pointer shrink-0"
        title="Bỏ ghim"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
