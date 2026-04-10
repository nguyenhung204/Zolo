"use client";

import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/presence/UserAvatar";
import { formatTime } from "@/lib/utils/date";
import type { Message } from "@/lib/api/messages";
import { Check, CheckCheck, Clock, AlertCircle, FileText, Mic, Reply } from "lucide-react";

interface MessageRowProps {
  message: Message;
  isMine: boolean;
  /** First message in a consecutive run from the same sender */
  isGroupStart: boolean;
  /** Last message in a consecutive run from the same sender */
  isGroupEnd: boolean;
  senderName?: string;
  senderAvatarUrl?: string;
  onReply?: (msg: Message) => void;
}

export function MessageRow({
  message,
  isMine,
  isGroupStart,
  isGroupEnd,
  senderName = "",
  senderAvatarUrl,
  onReply,
}: MessageRowProps) {
  const isDeleted = !!message.deletedAt;
  const isSystem = message.type === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center py-2">
        <span className="text-xs text-muted bg-border/50 rounded-full px-3 py-1 select-none">
          {message.content}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex items-end gap-2",
        isMine ? "flex-row-reverse pr-3 pl-8" : "flex-row pl-3 pr-8",
      )}
      style={{ marginBottom: isGroupEnd ? "var(--msg-gap-end, 0.625rem)" : "var(--msg-gap-mid, 0.25rem)" }}
    >
      {/* Avatar slot — always reserve space so bubbles align */}
      <div className="w-8 shrink-0 self-end">
        {isGroupEnd && !isMine && (
          <UserAvatar
            userId={message.senderId}
            name={senderName}
            avatarUrl={senderAvatarUrl}
            size="sm"
            showPresence={false}
          />
        )}
      </div>

      {/* Bubble column */}
      <div className={cn("max-w-[72%] flex flex-col", isMine ? "items-end" : "items-start")}>
        {/* Sender name — only on first message of a group from others */}
        {isGroupStart && !isMine && (
          <span className="text-xs font-semibold text-muted mb-1 ml-1">{senderName}</span>
        )}

        <div className="relative flex items-end gap-1">
          {/* Reply action — shown on hover */}
          {!isDeleted && (
            <button
              onClick={() => onReply?.(message)}
              className={cn(
                "opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full hover:bg-border/60 text-muted shrink-0 cursor-pointer",
                isMine ? "order-first" : "order-last"
              )}
              title="Reply"
            >
              <Reply className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Bubble */}
          <div
            className={cn(
              "px-3.5 py-2 text-sm leading-relaxed wrap-break-word",
              isMine
                ? "bg-cta text-white"
                : "bg-surface border border-border text-text shadow-sm",
              isDeleted && "opacity-50 italic",
              // Rounded corners: full except the corner touching the avatar run
              isMine
                ? cn(
                    "rounded-2xl",
                    isGroupStart && "rounded-tr-md",
                    isGroupEnd && "rounded-br-md"
                  )
                : cn(
                    "rounded-2xl",
                    isGroupStart && "rounded-tl-md",
                    isGroupEnd && "rounded-bl-md"
                  )
            )}
          >
            {isDeleted ? (
              <span className="text-xs opacity-70">This message was deleted</span>
            ) : (
              <MessageContent message={message} isMine={isMine} />
            )}
          </div>
        </div>

        {/* Timestamp + status — only on the last bubble of a group */}
        {isGroupEnd && (
          <div
            className={cn(
              "flex items-center gap-1 mt-1 px-1",
              isMine ? "flex-row-reverse" : "flex-row"
            )}
          >
            <span className="text-[10px] text-muted tabular-nums">
              {formatTime(message.createdAt)}
              {message.editedAt && " · edited"}
            </span>
            {isMine && <MessageStatusIcon message={message} />}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Content renderer ─────────────────────────────────────────────────────────

function MessageContent({ message, isMine }: { message: Message; isMine: boolean }) {
  switch (message.type) {
    case "text":
      return <p className="whitespace-pre-wrap">{message.content}</p>;

    case "image":
      return (
        <div className="space-y-1.5">
          {message.content && (
            <p className="whitespace-pre-wrap text-sm">{message.content}</p>
          )}
          <MediaPlaceholder type="image" mediaId={message.mediaId} status={message.mediaStatus} isMine={isMine} />
        </div>
      );

    case "video":
      return (
        <MediaPlaceholder type="video" mediaId={message.mediaId} status={message.mediaStatus} isMine={isMine} />
      );

    case "audio":
      return (
        <div className="flex items-center gap-2 min-w-36">
          <Mic className="w-4 h-4 shrink-0 opacity-70" />
          <MediaPlaceholder type="audio" mediaId={message.mediaId} status={message.mediaStatus} isMine={isMine} />
        </div>
      );

    case "file":
      return (
        <div className="flex items-center gap-2.5 min-w-40">
          <span className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
            isMine ? "bg-white/20" : "bg-border"
          )}>
            <FileText className="w-4 h-4" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{message.content || "File"}</p>
            <span className={cn("text-xs", isMine ? "text-white/70" : "text-muted")}>
              {mediaStatusLabel(message.mediaStatus)}
            </span>
          </div>
        </div>
      );

    default:
      return <p className="whitespace-pre-wrap">{message.content}</p>;
  }
}

// ─── Media placeholder ────────────────────────────────────────────────────────

function MediaPlaceholder({
  type,
  mediaId,
  status,
  isMine,
}: {
  type: string;
  mediaId?: string;
  status?: string;
  isMine: boolean;
}) {
  const isReady = status === "ready";

  if (type === "image") {
    if (isReady && mediaId) {
      return (
        <div className="rounded-xl overflow-hidden max-w-64 bg-border/30">
          <div className="w-full aspect-video bg-border/40 animate-pulse" />
        </div>
      );
    }
    return (
      <div className="w-52 aspect-video rounded-xl bg-border/30 flex items-center justify-center">
        <span className={cn("text-xs", isMine ? "text-white/60" : "text-muted")}>
          {mediaStatusLabel(status)}
        </span>
      </div>
    );
  }

  return (
    <span className={cn("text-xs", isMine ? "text-white/70" : "text-muted")}>
      {mediaStatusLabel(status)}
    </span>
  );
}

function mediaStatusLabel(status?: string) {
  switch (status) {
    case "ready":       return "Ready";
    case "processing":  return "Processing…";
    case "uploaded":    return "Uploading…";
    case "failed":      return "Failed";
    default:            return "Pending…";
  }
}

// ─── Status icon ──────────────────────────────────────────────────────────────

function MessageStatusIcon({ message }: { message: Message & { _pending?: boolean; _failed?: boolean } }) {
  if (message._failed) return <AlertCircle className="w-3 h-3 text-error shrink-0" />;
  if (message._pending || !message.offset) return <Clock className="w-3 h-3 text-white/50 shrink-0" />;
  return <CheckCheck className="w-3 h-3 text-white/80 shrink-0" />;
}


