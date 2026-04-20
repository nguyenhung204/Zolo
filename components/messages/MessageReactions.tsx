"use client";

import { cn } from "@/lib/utils";
import type { ReactionMap } from "@/lib/api/messages";

interface Props {
  reactions: ReactionMap;
  isMine: boolean;
  onEmojiPick: (emoji: string) => void;
}

export function MessageReactions({ reactions, isMine, onEmojiPick }: Props) {
  const entries = Object.entries(reactions).filter(([, v]) => v.count > 0).slice(0, 6);
  if (entries.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-1 mt-0.5", isMine ? "justify-end" : "justify-start")}>
      {entries.map(([emoji, detail]) => (
        <button
          key={emoji}
          onClick={() => onEmojiPick(emoji)}
          title={detail.myReaction ? "Bỏ cảm xúc" : "Thêm cảm xúc"}
          className={cn(
            "flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-all cursor-pointer active:scale-90",
            detail.myReaction
              ? "bg-cta/12 border-cta/50 hover:bg-cta/20"
              : "bg-surface border-border hover:bg-border/60"
          )}
        >
          <span>{emoji}</span>
          <span className={cn(
            "text-[11px] font-semibold tabular-nums",
            detail.myReaction ? "text-cta" : "text-muted"
          )}>
            {detail.count}
          </span>
        </button>
      ))}
    </div>
  );
}
