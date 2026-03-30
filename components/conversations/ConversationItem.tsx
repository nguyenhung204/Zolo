"use client";

import { useConversationStore } from "@/stores/conversationStore";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/presence/UserAvatar";
import { formatDistanceToNowStrict } from "@/lib/utils/date";
import type { Conversation } from "@/lib/api/conversations";
import { Hash, Megaphone } from "lucide-react";

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onClick: () => void;
}

const typeIconMap: Record<string, React.ElementType | null> = {
  DEPARTMENT: Hash,
  PROJECT: Hash,
  ANNOUNCEMENT: Megaphone,
  DIRECT: null,
  department: Hash,
  project: Hash,
  announcement: Megaphone,
  direct: null,
};

export function ConversationItem({ conversation, isActive, onClick }: ConversationItemProps) {
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const unread = Math.max(
    0,
    Number(conversation.maxOffset) - (conversation.lastSeenOffset ?? Number(conversation.maxOffset))
  );
  const TypeIcon = typeIconMap[conversation.type] ?? null;

  const isDirect = conversation.type.toUpperCase() === "DIRECT";

  const displayName =
    isDirect
      ? conversation.otherUser?.displayName ?? conversation.otherUser?.username ?? "Direct Message"
      : conversation.name ?? "Unnamed";

  const directAvatarUrl = isDirect ? (conversation.otherUser?.avatarUrl ?? undefined) : undefined;
  const directUserId = isDirect ? (conversation.otherUser?.id ?? conversation.id) : conversation.id;

  const lastMsg = conversation.lastMessage;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors duration-150 cursor-pointer",
        isActive
          ? "bg-primary/8 text-primary"
          : "hover:bg-border/50 text-secondary"
      )}
    >
      {/* Avatar / type icon */}
      <div className="shrink-0 relative">
        {isDirect ? (
          <UserAvatar
            userId={directUserId}
            name={displayName}
            avatarUrl={directAvatarUrl}
            size="md"
          />
        ) : conversation.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={conversation.avatarUrl}
            alt={displayName}
            className="w-10 h-10 rounded-full object-cover"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-cta/10 flex items-center justify-center">
            {TypeIcon ? (
              <TypeIcon className="w-5 h-5 text-cta" />
            ) : (
              <span className="text-xs font-bold text-cta">
                {displayName.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-1">
          <span className={cn("text-sm font-semibold truncate", isActive ? "text-primary" : "text-text")}>
            {displayName}
          </span>
          {lastMsg && (
            <span className="text-[10px] text-muted shrink-0">
              {formatDistanceToNowStrict(lastMsg.createdAt)}
            </span>
          )}
        </div>
        {lastMsg && (
          <p className="text-xs text-muted truncate mt-0.5">
            {lastMsg.senderId === userId ? "You: " : ""}
            {lastMsg.type === "text" ? lastMsg.content : `📎 ${lastMsg.type}`}
          </p>
        )}
      </div>

      {/* Unread badge */}
      {unread > 0 && (
        <span className="shrink-0 min-w-4.5 h-4.5 px-1 rounded-full bg-cta text-white text-[10px] font-bold flex items-center justify-center">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}
