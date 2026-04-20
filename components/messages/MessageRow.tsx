"use client";

import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/presence/UserAvatar";
import { formatTime } from "@/lib/utils/date";
import type { Message } from "@/lib/api/messages";
import {
  CheckCheck, Check, Clock, AlertCircle, Reply, MoreHorizontal, CornerUpLeft, Ban, RotateCcw,
} from "lucide-react";
import { AnimatedSticker } from "@/components/messages/AnimatedSticker";
import { useState, useRef, useCallback, useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";
import { addReaction } from "@/lib/api/messages";
import type { ReactionMap } from "@/lib/api/messages";
import { toast } from "sonner";
import { MessageContextMenu } from "./MessageContextMenu";
import { MessageReactions } from "./MessageReactions";
import { replyLabel } from "./ReplyPreview";
import { MediaImage } from "./media/MediaImage";
import { MediaVideo } from "./media/MediaVideo";
import { VoiceMessage } from "./media/VoiceMessage";
import { MediaFile, AttachmentGrid } from "./media/MediaFile";
import { MarkdownMessage } from "./MarkdownMessage";
import { CallSummaryBubble } from "./CallSummaryBubble";

interface OtherMember {
  userId: string;
  lastSeenOffset: number;
  lastDeliveredOffset: number;
  avatarUrl?: string | null;
  displayName?: string;
  username?: string;
}

interface MessageRowProps {
  message: Message;
  isMine: boolean;
  isGroupStart: boolean;
  isGroupEnd: boolean;
  replyMsg?: Message | null;
  senderName?: string;
  senderAvatarUrl?: string;
  otherMembers?: OtherMember[];
  onReply?: (msg: Message) => void;
  onEdit?: (msg: Message) => void;
  onDelete?: (msg: Message) => void;
  onRevoke?: (msg: Message) => void;
  onForward?: (msg: Message) => void;
  onPin?: (msg: Message) => void;
  onViewDetails?: (msg: Message) => void;
  onRetry?: (msg: Message) => void;
}

export function MessageRow({
  message, isMine, isGroupStart, isGroupEnd,
  replyMsg,
  senderName = "", senderAvatarUrl,
  otherMembers = [],
  onReply, onEdit, onDelete, onRevoke, onForward, onPin, onViewDetails, onRetry,
}: MessageRowProps) {
  const isDeleted = !!message.deletedAt;
  const isRevoked = !!message.isRevoked;
  const isSystem = message.type === "system";
  const isCallSummary = message.type === "call_summary";
  const isSticker = message.type === "sticker";
  const isEdited = !!message.editedAt;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const myId = useAuthStore((s) => s.user?.id);

  // ─── Reactions ──────────────────────────────────────────────────────────
  const [localReactions, setLocalReactions] = useState<ReactionMap | null>(null);
  const reactionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mergedReactions: ReactionMap = localReactions ?? (message.reactions ?? {});

  // When the server delivers authoritative state via WS, discard our optimistic copy.
  const serverReactionsRef = useRef(message.reactions);
  useEffect(() => {
    if (message.reactions !== serverReactionsRef.current) {
      serverReactionsRef.current = message.reactions;
      setLocalReactions(null);
    }
  }, [message.reactions]);

  const handleEmojiPick = useCallback(async (emoji: string) => {
    const prev = localReactions ?? (message.reactions ?? {});
    const current = prev[emoji] ?? { count: 0, reactors: [], myReaction: false };
    const isRemoving = current.myReaction;
    const action: "add" | "remove" = isRemoving ? "remove" : "add";

    // Optimistic: flip myReaction and adjust count/reactors immediately
    const updated = {
      count: Math.max(0, current.count + (isRemoving ? -1 : 1)),
      reactors: isRemoving
        ? current.reactors.filter((uid) => uid !== myId)
        : [...current.reactors, ...(myId ? [myId] : [])],
      myReaction: !isRemoving,
    };
    const next: ReactionMap = { ...prev, [emoji]: updated };
    // Remove the emoji entirely if count reaches 0
    if (updated.count === 0) delete next[emoji];
    setLocalReactions(next);
    setMenuOpen(false);

    if (reactionDebounceRef.current) clearTimeout(reactionDebounceRef.current);
    reactionDebounceRef.current = setTimeout(async () => {
      try {
        await addReaction(message.messageId, message.conversationId, emoji, action);
      } catch {
        setLocalReactions(null);
        toast.error(isRemoving ? "Không thể bỏ cảm xúc" : "Không thể thêm cảm xúc");
      }
    }, 350);
  }, [localReactions, message.reactions, message.messageId, message.conversationId, myId]);

  useEffect(() => {
    if (!menuOpen) return;
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [menuOpen]);

  if (isSystem) {
    return (
      <div className="flex justify-center py-1.5 px-4">
        <span className="text-[11px] text-muted bg-border/40 rounded-full px-3 py-0.5 select-none">
          {message.content}
        </span>
      </div>
    );
  }

  if (isCallSummary) {
    const otherMemberIds = otherMembers.map((m) => m.userId);
    return (
      <div className={cn("flex px-3 mb-3", isMine ? "justify-end" : "justify-start")}>
        <div className={cn("flex flex-col", isMine ? "items-end" : "items-start")}>
          <CallSummaryBubble
            message={message}
            isMine={isMine}
            otherMemberIds={otherMemberIds}
          />
          <span className="text-[10px] text-muted mt-1 select-none tabular-nums px-1">
            {formatTime(message.createdAt)}
          </span>
        </div>
      </div>
    );
  }

  const bubbleShape = cn(
    "rounded-[18px]",
    !isGroupStart && !isGroupEnd && (isMine ? "rounded-tr-[4px] rounded-br-[4px]" : "rounded-tl-[4px] rounded-bl-[4px]"),
    isGroupStart && !isGroupEnd && (isMine ? "rounded-tr-[4px]" : "rounded-tl-[4px]"),
    !isGroupStart && isGroupEnd && (isMine ? "rounded-br-[4px]" : "rounded-bl-[4px]"),
  );

  const hasCaption = message.content.trim().length > 0;
  const isPureMedia = (message.type === "image" || message.type === "video") && !replyMsg && !hasCaption;

  return (
    <div className={cn("group flex items-end gap-2 px-3", isMine ? "flex-row-reverse" : "flex-row", isGroupEnd ? "mb-3" : "mb-0.5")}>
      <div className="w-8 shrink-0 self-end">
        {!isMine && isGroupEnd && (
          <UserAvatar userId={message.senderId} name={senderName} avatarUrl={senderAvatarUrl} size="sm" showPresence={false} />
        )}
      </div>

      <div className={cn("flex flex-col max-w-[78%]", isMine ? "items-end" : "items-start")}>
        {!isMine && isGroupStart && (
          <span className="text-[11px] font-semibold text-cta ml-1 mb-0.5 select-none">{senderName}</span>
        )}

        <div className={cn("flex items-center gap-1", isMine ? "flex-row-reverse" : "flex-row")}>
          {/* ── Message bubble ── */}
          {isSticker ? (
            <div className="p-0.5">
              <AnimatedSticker url={message.metadata?.url ?? ""} size={130} alt="sticker" />
            </div>
          ) : isRevoked ? (
            <div className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-[18px] border border-border/50 text-muted text-xs italic select-none">
              <Ban className="w-3 h-3 shrink-0" />
              Tin nhắn đã thu hồi
            </div>
          ) : isDeleted ? (
            <div className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-[18px] border border-border/50 text-muted text-xs italic select-none">
              Đã xóa
            </div>
          ) : (
            <div className={cn(
              bubbleShape,
              "text-sm leading-relaxed break-words max-w-full",
              isPureMedia
                ? "overflow-hidden"
                : isMine
                  ? "bg-cta text-white px-3.5 py-2.5"
                  : "bg-surface border border-border/60 text-text px-3.5 py-2.5 shadow-sm"
            )}>
              {replyMsg && (() => {
                if (replyMsg.isRevoked) {
                  return (
                    <div className={cn("flex items-start gap-2 rounded-xl px-2.5 py-1.5 mb-2 text-xs border-l-[3px]",
                      isMine ? "bg-white/15 border-white/50" : "bg-border/30 border-cta")}>
                      <CornerUpLeft className={cn("w-3 h-3 shrink-0 mt-0.5", isMine ? "text-white/70" : "text-cta")} />
                      <p className={cn("truncate text-[11px] leading-tight", isMine ? "text-white/60" : "text-muted")}>
                        Tin nhắn đã thu hồi
                      </p>
                    </div>
                  );
                }
                const { icon, label } = replyLabel(replyMsg.type, replyMsg.content, replyMsg.metadata);
                return (
                  <div className={cn("flex items-start gap-2 rounded-xl px-2.5 py-1.5 mb-2 text-xs border-l-[3px] cursor-pointer",
                    isMine ? "bg-white/15 border-white/50 hover:bg-white/20" : "bg-border/30 border-cta hover:bg-border/50")}>
                    <CornerUpLeft className={cn("w-3 h-3 shrink-0 mt-0.5", isMine ? "text-white/70" : "text-cta")} />
                    <p className={cn("truncate text-[11px] leading-tight flex items-center gap-1", isMine ? "text-white/60" : "text-muted")}>
                      {icon}
                      {label}
                    </p>
                  </div>
                );
              })()}
              <MessageContent message={message} isMine={isMine} />
              {isEdited && (
                <span className={cn("block text-[10px] mt-1 italic select-none", isMine ? "text-white/50" : "text-muted")}>Đã chỉnh sửa</span>
              )}
            </div>
          )}

          {/* ── Action buttons ── */}
          {!isRevoked && !isDeleted && (
            <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              {!isSticker && (
                <button
                  onClick={() => onReply?.(message)}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-muted hover:text-secondary hover:bg-border/60 transition-colors cursor-pointer"
                  title="Trả lời"
                >
                  <Reply className="w-3.5 h-3.5" />
                </button>
              )}
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-muted hover:text-secondary hover:bg-border/60 transition-colors cursor-pointer"
                  title="Thêm"
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
                {menuOpen && (
                  <MessageContextMenu
                    isMine={isMine}
                    message={message}
                    onEmojiPick={handleEmojiPick}
                    onReply={onReply ? () => { onReply(message); setMenuOpen(false); } : undefined}
                    onEdit={onEdit ? () => { onEdit(message); setMenuOpen(false); } : undefined}
                    onDelete={onDelete ? () => { onDelete(message); setMenuOpen(false); } : undefined}
                    onRevoke={onRevoke ? () => { onRevoke(message); setMenuOpen(false); } : undefined}
                    onForward={onForward ? () => { onForward(message); setMenuOpen(false); } : undefined}
                    onPin={onPin ? () => { onPin(message); setMenuOpen(false); } : undefined}
                    onViewDetails={onViewDetails ? () => { onViewDetails(message); setMenuOpen(false); } : undefined}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Reactions ── */}
        {!isRevoked && !isDeleted && (
          <MessageReactions reactions={mergedReactions} isMine={isMine} onEmojiPick={handleEmojiPick} />
        )}

        {/* ── Timestamp + status ── */}
        {(isGroupEnd || (message as Message & { _failed?: boolean })._failed) && (
          <div className={cn("flex items-center gap-1 mt-1 select-none", isMine ? "flex-row-reverse pr-1" : "flex-row pl-1")}>
            <span className="text-[10px] text-muted tabular-nums">
              {formatTime(message.createdAt)}
            </span>
            {isMine && !isRevoked && (
              <MessageStatusIcon message={message} otherMembers={otherMembers} onRetry={onRetry ? () => onRetry(message) : undefined} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MessageContent ───────────────────────────────────────────────────────────

function MessageContent({ message, isMine }: { message: Message; isMine: boolean }) {
  const caption = message.content.trim();
  const renderCaptioned = (body: React.ReactNode) => {
    if (!caption) return body;
    return (
      <div className="space-y-2">
        <p className="whitespace-pre-wrap break-words">{caption}</p>
        {body}
      </div>
    );
  };

  switch (message.type) {
    case "sticker":
      return message.metadata?.url
        ? <AnimatedSticker url={message.metadata.url} size={130} alt="sticker" />
        : null;
    case "text":
      return <MarkdownMessage content={message.content} isMine={isMine} />;
    case "image":
    case "video": {
      const fname = message.metadata?.filename;
      // Hide caption when it's empty, matches the filename, or looks like an
      // auto-populated filename (common media extension, no line-breaks).
      const isAutoCaption =
        !caption ||
        caption === fname ||
        /^[^\n\r]{1,255}\.(jpe?g|png|gif|webp|heic|avif|bmp|svg|mp4|mov|avi|mkv|webm)$/i.test(caption);
      const mediaCaption = isAutoCaption ? null : caption;
      const mediaNode =
        message.type === "image"
          ? <MediaImage message={message} isMine={isMine} />
          : <MediaVideo message={message} isMine={isMine} />;
      return mediaCaption ? (
        <div className="space-y-1.5">
          {mediaNode}
          <MarkdownMessage content={mediaCaption} isMine={isMine} />
        </div>
      ) : mediaNode;
    }
    case "audio":
      return <VoiceMessage message={message} isMine={isMine} />;
    case "file": {
      const fileCaption = caption && message.metadata?.filename && caption !== message.metadata.filename
        ? caption
        : null;
      return fileCaption ? (
        <div className="space-y-2">
          <p className="whitespace-pre-wrap break-words">{fileCaption}</p>
          <MediaFile message={message} isMine={isMine} />
        </div>
      ) : (
        <MediaFile message={message} isMine={isMine} />
      );
    }
    case "media":
      return (
        <div className="space-y-1.5">
          {caption && <p className="whitespace-pre-wrap text-sm">{caption}</p>}
          <AttachmentGrid
            attachments={message.attachments ?? []}
            isMine={isMine}
            conversationId={message.conversationId}
          />
        </div>
      );
    default:
      return <MarkdownMessage content={message.content} isMine={isMine} />;
  }
}

// ─── MessageStatusIcon ────────────────────────────────────────────────────────

function MessageStatusIcon({
  message,
  otherMembers,
  onRetry,
}: {
  message: Message & { _pending?: boolean; _failed?: boolean };
  otherMembers: OtherMember[];
  onRetry?: () => void;
}) {
  if (message._failed) return (
    <div className="flex items-center gap-1">
      <AlertCircle className="w-3 h-3 text-error shrink-0" />
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-0.5 text-[10px] text-error hover:text-error/80 font-medium cursor-pointer leading-none"
          title="Retry sending"
        >
          <RotateCcw className="w-2.5 h-2.5" />
          Retry
        </button>
      )}
    </div>
  );
  if (message._pending || message.offset == null || message.offset < 0)
    return <Clock className="w-3 h-3 text-muted shrink-0" />;

  const offset = message.offset;
  const seenBy = otherMembers.filter((m) => offset > 0 && m.lastSeenOffset >= offset);

  if (seenBy.length > 0) {
    return (
      <div className="flex items-center -space-x-0.5 shrink-0">
        {seenBy.slice(0, 3).map((m) => (
          <div key={m.userId} className="w-3.5 h-3.5 rounded-full overflow-hidden ring-1 ring-surface shrink-0">
            {m.avatarUrl ? (
              <img src={m.avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-cta flex items-center justify-center text-[6px] text-white font-bold">
                {(m.displayName ?? m.username ?? "?")[0].toUpperCase()}
              </div>
            )}
          </div>
        ))}
        {seenBy.length > 3 && (
          <div className="w-3.5 h-3.5 rounded-full bg-border text-[6px] text-muted flex items-center justify-center ring-1 ring-surface shrink-0">
            +{seenBy.length - 3}
          </div>
        )}
      </div>
    );
  }

  const deliveredTo = otherMembers.filter((m) => offset > 0 && m.lastDeliveredOffset >= offset);
  if (deliveredTo.length > 0) return <CheckCheck className="w-3 h-3 text-cta shrink-0" />;
  return <Check className="w-3 h-3 text-muted shrink-0" />;
}