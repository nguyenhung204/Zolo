"use client";

import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/presence/UserAvatar";
import { formatDistanceToNowStrict } from "@/lib/utils/date";
import type { Message } from "@/lib/api/messages";
import { Check, CheckCheck, Clock, AlertCircle, FileText, Mic } from "lucide-react";

interface MessageRowProps {
  message: Message;
  isMine: boolean;
  showAvatar: boolean;
  senderName?: string;
  senderAvatarUrl?: string;
  /** Called when user clicks the reply icon */
  onReply?: (msg: Message) => void;
}

export function MessageRow({
  message,
  isMine,
  showAvatar,
  senderName = "",
  senderAvatarUrl,
  onReply,
}: MessageRowProps) {
  const isDeleted = !!message.deletedAt;
  const isSystem = message.type === "SYSTEM";

  // System messages render centred
  if (isSystem) {
    return (
      <div className="flex justify-center py-1.5">
        <span className="text-xs text-muted bg-border/40 rounded-full px-3 py-1">
          {message.content}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex items-end gap-2 px-4 py-0.5",
        isMine ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar — only shown at the bottom of a run */}
      <div className="w-8 shrink-0">
        {showAvatar && !isMine && (
          <UserAvatar
            userId={message.senderId}
            name={senderName}
            avatarUrl={senderAvatarUrl}
            size="sm"
            showPresence={false}
          />
        )}
      </div>

      {/* Bubble */}
      <div className={cn("max-w-[70%] flex flex-col gap-0.5", isMine && "items-end")}>
        {showAvatar && !isMine && (
          <span className="text-xs text-muted ml-1 font-medium">{senderName}</span>
        )}

        <div
          className={cn(
            "relative rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
            isMine
              ? "bg-cta text-white rounded-br-sm"
              : "bg-surface border border-border text-text rounded-bl-sm shadow-sm",
            isDeleted && "opacity-50 italic"
          )}
        >
          {isDeleted ? (
            <span className="text-xs">Message deleted</span>
          ) : (
            <MessageContent message={message} isMine={isMine} />
          )}
        </div>

        {/* Footer: time + status */}
        <div
          className={cn(
            "flex items-center gap-1 px-1",
            isMine ? "flex-row-reverse" : "flex-row"
          )}
        >
          <span className="text-[10px] text-muted">
            {formatDistanceToNowStrict(message.createdAt)}
            {message.editedAt && " · edited"}
          </span>
          {isMine && <MessageStatusIcon message={message} />}
        </div>
      </div>
    </div>
  );
}

// ─── Content renderer per type ────────────────────────────────────────────────

function MessageContent({ message, isMine }: { message: Message; isMine: boolean }) {
  switch (message.type) {
    case "TEXT":
      return <p className="whitespace-pre-wrap break-words">{message.content}</p>;

    case "IMAGE":
      return (
        <div className="space-y-1.5">
          {message.content && (
            <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
          )}
          <MediaPlaceholder type="IMAGE" mediaId={message.mediaId} status={message.mediaStatus} isMine={isMine} />
        </div>
      );

    case "VIDEO":
      return <MediaPlaceholder type="VIDEO" mediaId={message.mediaId} status={message.mediaStatus} isMine={isMine} />;

    case "AUDIO":
      return (
        <div className="flex items-center gap-2 min-w-[140px]">
          <Mic className="w-4 h-4 shrink-0" />
          <MediaPlaceholder type="AUDIO" mediaId={message.mediaId} status={message.mediaStatus} isMine={isMine} />
        </div>
      );

    case "FILE":
      return (
        <div className="flex items-center gap-2 min-w-[160px]">
          <FileText className="w-5 h-5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{message.content || "File"}</p>
            <span className={cn("text-xs", isMine ? "text-white/70" : "text-muted")}>
              {mediaStatusLabel(message.mediaStatus)}
            </span>
          </div>
        </div>
      );

    default:
      return <p className="whitespace-pre-wrap break-words">{message.content}</p>;
  }
}

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
  const isReady = status === "READY";
  const isProcessing = status === "PROCESSING" || status === "UPLOADED";

  if (type === "IMAGE") {
    if (isReady && mediaId) {
      // Actual image loaded via the media endpoint (getMediaUrl)
      return (
        <div className="rounded-lg overflow-hidden max-w-[260px] bg-border/30">
          <div className="w-full aspect-video bg-border/40 animate-pulse rounded-lg" />
        </div>
      );
    }
    return (
      <div className="w-[200px] aspect-video rounded-lg bg-border/30 flex items-center justify-center">
        <span className={cn("text-xs", isMine ? "text-white/70" : "text-muted")}>
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
    case "READY":       return "Ready";
    case "PROCESSING":  return "Processing…";
    case "UPLOADED":    return "Uploading…";
    case "FAILED":      return "Failed";
    default:            return "Pending…";
  }
}

// ─── Status icon ─────────────────────────────────────────────────────────────

function MessageStatusIcon({ message }: { message: Message & { _pending?: boolean; _failed?: boolean } }) {
  if ((message as Message & { _failed?: boolean })._failed) {
    return <AlertCircle className="w-3 h-3 text-error" />;
  }
  if ((message as Message & { _pending?: boolean })._pending || !message.offset) {
    return <Clock className="w-3 h-3 text-white/60" />;
  }
  // TODO: derive delivered/read from conversation member cursors via prop
  return <CheckCheck className="w-3 h-3 text-white/80" />;
}
