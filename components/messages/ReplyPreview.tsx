"use client";

import { X, CornerUpLeft, FileText, Image } from "lucide-react";
import { cn } from "@/lib/utils";

interface ReplyPreviewProps {
  content: string;
  senderName: string;
  type: string;
  onClose: () => void;
  /** Compact mode used inside message bubbles (no close button) */
  compact?: boolean;
}

const typeIcon: Record<string, React.ReactNode> = {
  IMAGE: <Image className="w-3.5 h-3.5" />,
  FILE:  <FileText className="w-3.5 h-3.5" />,
  TEXT:  null,
};

export function ReplyPreview({ content, senderName, type, onClose, compact }: ReplyPreviewProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border-l-2 border-cta bg-cta/5 px-3 py-2 text-xs",
        compact ? "mb-1.5" : "mb-2"
      )}
    >
      <CornerUpLeft className="w-3.5 h-3.5 text-cta shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-cta truncate">{senderName}</p>
        <p className="text-muted truncate flex items-center gap-1 mt-0.5">
          {typeIcon[type] ?? null}
          {type !== "TEXT" ? type.toLowerCase() : content}
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
