"use client";

import { useState, useRef, useEffect } from "react";
import { Pin, ChevronUp, ChevronDown, X, FileText, Image, Mic, Sticker, Video, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePinnedMessages } from "@/hooks/useMessages";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { unpinMessage } from "@/lib/api/messages";
import type { Message } from "@/lib/api/messages";
import type { MessagesInfiniteData } from "@/hooks/useMessages";

interface PinnedMessageBannerProps {
  conversationId: string;
  onViewDetails?: (msg: Message) => void;
}

export function PinnedMessageBanner({ conversationId, onViewDetails }: PinnedMessageBannerProps) {
  const { data: pinned = [] } = usePinnedMessages(conversationId);
  const [index, setIndex] = useState(0);
  const [popoverOpen, setPopoverOpen] = useState(false);
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

  const preview = msg.isRevoked
    ? { icon: null, label: "Tin nhắn đã thu hồi" }
    : (msg.type === "text" || !msg.type)
      ? { icon: null, label: msg.content || "…" }
      : msg.type === "image"
        ? { icon: Image, label: "Hình ảnh" }
        : msg.type === "video"
          ? { icon: Video, label: "Video" }
          : msg.type === "audio"
            ? { icon: Mic, label: "Âm thanh" }
            : msg.type === "file"
              ? { icon: FileText, label: "File" }
              : msg.type === "sticker"
                ? { icon: Sticker, label: "Sticker" }
                : { icon: null, label: msg.content || `[${msg.type}]` };

  const handleUnpin = async (m: Message) => {
    setPopoverOpen(false);
    try {
      await unpinMessage(m.messageId, conversationId);
      qc.setQueryData(
        queryKeys.messages.pinned(conversationId),
        (old: Message[] | undefined) => old?.filter((x) => x.messageId !== m.messageId) ?? []
      );
      qc.setQueryData(
        queryKeys.messages.list(conversationId),
        (old: MessagesInfiniteData | undefined) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((p) => ({
              ...p,
              data: p.data.map((x) =>
                x.messageId === m.messageId ? { ...x, isPinned: false } : x
              ),
            })),
          };
        }
      );
      if (safeIndex >= pinned.length - 1) setIndex(Math.max(0, safeIndex - 1));
    } catch {
      // noop
    }
  };

  const handleViewDetails = () => {
    setPopoverOpen(false);
    onViewDetails?.(msg);
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
          onClick={() => setPopoverOpen((v) => !v)}
          className="w-full text-left hover:bg-border/30 rounded-lg px-1 py-0.5 transition-colors cursor-pointer"
        >
          <p className="text-[10px] font-semibold text-cta leading-none mb-0.5">
            Tin nhắn ghim{pinned.length > 1 ? ` (${safeIndex + 1}/${pinned.length})` : ""}
          </p>
          <div className="flex items-center gap-1 min-w-0 text-xs text-text truncate leading-tight">
            {preview.icon ? <preview.icon className="w-3 h-3 shrink-0 text-cta" /> : null}
            <p className="truncate">{preview.label}</p>
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
