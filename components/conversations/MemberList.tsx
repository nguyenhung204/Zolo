"use client";

import { useConversationMembers } from "@/hooks/useConversations";
import { UserAvatar } from "@/components/presence/UserAvatar";
import { X, Crown, Shield, User } from "lucide-react";
import type { MemberRole } from "@/lib/api/conversations";
import { cn } from "@/lib/utils";

const roleIcon: Record<MemberRole, React.ReactNode> = {
  owner: <Crown className="w-3 h-3 text-warning" />,
  admin: <Shield className="w-3 h-3 text-cta" />,
  moderator: <Shield className="w-3 h-3 text-success" />,
  member: <User className="w-3 h-3 text-muted" />,
  guest: <User className="w-3 h-3 text-muted/60" />,
};

const roleLabel: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  moderator: "Mod",
  member: "Member",
  guest: "Guest",
};

interface MemberListProps {
  conversationId: string;
  open: boolean;
  onClose: () => void;
}

export function MemberList({ conversationId, open, onClose }: MemberListProps) {
  const { data: members = [], isLoading } = useConversationMembers(conversationId);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-30 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="fixed top-0 right-0 bottom-0 z-40 w-80 bg-surface shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-bold text-primary">
            Members ({members.length})
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-primary hover:bg-border/50 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {isLoading &&
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-2.5">
                <div className="w-9 h-9 rounded-full bg-border animate-pulse" />
                <div className="space-y-1.5 flex-1">
                  <div className="h-3 bg-border animate-pulse rounded w-3/4" />
                  <div className="h-2.5 bg-border animate-pulse rounded w-1/3" />
                </div>
              </div>
            ))}

          {!isLoading &&
            members.map((member) => {
              const safeName =
                (member as { displayName?: string }).displayName ??
                (member as { username?: string }).username ??
                "Người dùng";

              return (
                <div
                  key={member.id}
                  className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-border/30 transition"
                >
                  <UserAvatar
                    userId={member.userId}
                    name={safeName}
                    avatarUrl={(member as { avatarUrl?: string | null }).avatarUrl ?? undefined}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text truncate">{safeName}</p>
                    <p className="text-xs text-muted">
                      Joined {new Date(member.joinedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted">
                    {roleIcon[member.role]}
                    <span>{roleLabel[member.role]}</span>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </>
  );
}
