"use client";

import { X, CornerUpLeft, FileText, Image, Video, Mic, Contact } from "lucide-react";
import { cn } from "@/lib/utils";

interface ReplyMeta {
  filename?: string;
  durationMs?: number;
  contactUsername?: string;
  [key: string]: unknown;
}

interface ReplyPreviewProps {
  content: string;
  type: string;
  metadata?: ReplyMeta;
  onClose: () => void;
  /** Compact mode used inside message bubbles (no close button) */
  compact?: boolean;
}

/** Returns the display label and icon for a reply snippet. */
export function replyLabel(
  type: string,
  content: string,
  metadata?: ReplyMeta
): { icon: React.ReactNode; label: string } {
  const t = type.toLowerCase();
  if (t === "audio" || t === "voice") {
    return { icon: <Mic className="w-3.5 h-3.5 shrink-0" />, label: "Voice" };
  }
  if (t === "image") {
    return { icon: <Image className="w-3.5 h-3.5 shrink-0" />, label: (metadata?.filename ?? content) || "Ảnh" };
  }
  if (t === "video") {
    return { icon: <Video className="w-3.5 h-3.5 shrink-0" />, label: (metadata?.filename ?? content) || "Video" };
  }
  if (t === "contact_card") {
    return { icon: <Contact className="w-3.5 h-3.5 shrink-0" />, label: content || metadata?.contactUsername || "Contact" };
  }
  if (t === "file") {
    return { icon: <FileText className="w-3.5 h-3.5 shrink-0" />, label: (metadata?.filename ?? content) || "File" };
  }
  return { icon: null, label: content };
}

export function ReplyPreview({ content, type, metadata, onClose, compact }: ReplyPreviewProps) {
  const { icon, label } = replyLabel(type, content, metadata);
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border-l-2 border-cta bg-cta/5 px-3 py-2 text-xs",
        compact ? "mb-1.5" : "mb-2"
      )}
    >
      <CornerUpLeft className="w-3.5 h-3.5 text-cta shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-muted truncate flex items-center gap-1">
          {icon}
          {label}
        </p>
      </div>
      {!compact && (
        <button
          onClick={onClose}
          className="shrink-0 text-muted hover:text-error transition-colors cursor-pointer"
          title="Cancel reply"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
