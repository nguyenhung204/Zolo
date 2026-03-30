"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScrollToBottomFabProps {
  show: boolean;
  unreadCount: number;
  onClick: () => void;
}

export function ScrollToBottomFab({ show, unreadCount, onClick }: ScrollToBottomFabProps) {
  return (
    <button
      onClick={onClick}
      aria-label="Scroll to bottom"
      className={cn(
        "absolute bottom-24 right-6 z-10 flex items-center gap-1.5 rounded-full shadow-lg bg-surface border border-border px-3 py-2 text-sm text-secondary transition-all duration-200 cursor-pointer hover:shadow-xl hover:text-primary",
        show ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-2 pointer-events-none"
      )}
    >
      {unreadCount > 0 && (
        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-cta text-white text-[10px] font-bold flex items-center justify-center">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
      <ChevronDown className="w-4 h-4" />
    </button>
  );
}
