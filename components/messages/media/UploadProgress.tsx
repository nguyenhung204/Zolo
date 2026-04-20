"use client";

import { cn } from "@/lib/utils";

export function UploadProgressBar({
  isMine,
  progress,
  compact = false,
}: {
  isMine: boolean;
  progress?: number;
  compact?: boolean;
}) {
  const value = Math.max(0, Math.min(progress ?? 0, 100));
  return (
    <div
      className={cn(
        "mt-2 overflow-hidden rounded-full",
        compact ? "h-1" : "h-1.5",
        isMine ? "bg-white/15" : "bg-border/70"
      )}
    >
      <div
        className={cn(
          "h-full rounded-full transition-all duration-200",
          isMine ? "bg-white/85" : "bg-cta"
        )}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

export function UploadOverlay({
  isMine,
  progress,
}: {
  isMine: boolean;
  progress?: number;
}) {
  return (
    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 via-black/25 to-transparent px-3 py-2.5">
      <div className="flex items-center justify-end gap-3 text-[11px] text-white/90">
        {typeof progress === "number" && progress < 100 && <span>{progress}%</span>}
      </div>
      <UploadProgressBar isMine={isMine} progress={progress} compact />
    </div>
  );
}
