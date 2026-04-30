"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { AtSign, Users } from "lucide-react";

export interface MentionMember {
  userId: string;
  displayName?: string;
  username?: string;
  avatarUrl?: string | null;
  role?: string;
}

interface MentionPickerProps {
  members: MentionMember[];
  query: string;
  showMentionAll: boolean;
  onSelect: (member: MentionMember | "all") => void;
  onDismiss: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

const MAX_RESULTS = 8;

export function MentionPicker({
  members,
  query,
  showMentionAll,
  onSelect,
  onDismiss,
  anchorRef,
}: MentionPickerProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Filter members by query (match displayName or username, case-insensitive)
  const q = query.toLowerCase();
  const filtered = members
    .filter((m) => {
      if (!q) return true;
      return (
        m.displayName?.toLowerCase().includes(q) ||
        m.username?.toLowerCase().includes(q)
      );
    })
    .slice(0, MAX_RESULTS);

  // Show @All option when no specific query or query matches "all"/"here"/"channel"
  const showAll =
    showMentionAll &&
    (!q || "all".startsWith(q) || "here".startsWith(q) || "channel".startsWith(q));

  const hasResults = showAll || filtered.length > 0;

  // Outside-click dismiss
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        listRef.current?.contains(e.target as Node) ||
        anchorRef.current?.contains(e.target as Node)
      )
        return;
      onDismiss();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [anchorRef, onDismiss]);

  if (!hasResults) return null;

  return (
    <div
      ref={listRef}
      className="absolute bottom-full mb-1 left-0 right-0 z-50 bg-surface border border-border rounded-xl shadow-lg overflow-hidden max-h-64 overflow-y-auto"
    >
      <div className="px-3 py-1.5 text-[10px] font-semibold text-muted uppercase tracking-wide border-b border-border">
        Mention
      </div>

      {showAll && (
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect("all");
          }}
          className={cn(
            "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-border/50 text-sm"
          )}
        >
          <div className="w-7 h-7 rounded-full bg-cta/10 flex items-center justify-center shrink-0">
            <Users className="w-3.5 h-3.5 text-cta" />
          </div>
          <div>
            <span className="font-semibold text-text">@All</span>
            <span className="text-xs text-muted ml-2">Thông báo tất cả thành viên</span>
          </div>
        </button>
      )}

      {filtered.map((member) => {
        const label = member.displayName || member.username || member.userId;
        const initials = label.slice(0, 2).toUpperCase();
        return (
          <button
            key={member.userId}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(member);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-border/50 text-sm"
          >
            {member.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={member.avatarUrl}
                alt={label}
                className="w-7 h-7 rounded-full object-cover shrink-0"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-cta/10 flex items-center justify-center shrink-0">
                <AtSign className="w-3.5 h-3.5 text-cta" />
              </div>
            )}
            <div className="min-w-0">
              <span className="font-semibold text-text truncate">{label}</span>
              {member.username && member.displayName && (
                <span className="text-xs text-muted ml-1.5">@{member.username}</span>
              )}
            </div>
            <span className="ml-auto text-[10px] text-muted shrink-0">{initials}</span>
          </button>
        );
      })}
    </div>
  );
}
