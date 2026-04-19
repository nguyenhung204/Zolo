"use client";

import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/presence/UserAvatar";
import { formatDistanceToNowStrict } from "@/lib/utils/date";
import { usePinnedMessages } from "@/hooks/useMessages";
import type { Conversation } from "@/lib/api/conversations";
import { FileText, Hash, Image, Mic, Megaphone, Pin, Sticker, Video } from "lucide-react";

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onClick: () => void;
}

const typeIconMap: Record<string, React.ElementType | null> = {
  direct: null,
  group: Hash,
  community: Megaphone,
};

function lastMsgPreview(msg: Conversation["lastMessage"], isMe: boolean) {
  if (!msg) return null;
  const prefix = isMe ? "Bạn: " : "";
  switch (msg.type) {
    case "image":
      return { icon: Image, label: prefix + "Hình ảnh" };
    case "video":
      return { icon: Video, label: prefix + "Video" };
    case "audio":
      return { icon: Mic, label: prefix + "Âm thanh" };
    case "file":
      return { icon: FileText, label: prefix + "File" };
    case "sticker":
      return { icon: Sticker, label: prefix + "Sticker" };
    case "media":
      return { icon: Image, label: prefix + "Media" };
    case "system":
      return { icon: null, label: msg.content };
    default:
      return { icon: null, label: prefix + (msg.content || "") };
  }
}

export function ConversationItem({ conversation, isActive, onClick }: ConversationItemProps) {
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const unread = Math.max(
    0,
    Number(conversation.maxOffset) - (conversation.lastSeenOffset ?? Number(conversation.maxOffset))
  );
  const hasUnread = unread > 0 && !isActive;
  const TypeIcon = typeIconMap[conversation.kind] ?? null;
  const isDirect = conversation.kind === "direct";

  const { data: pinned = [] } = usePinnedMessages(conversation.id);
  const hasPinned = pinned.length > 0;

  const displayName =
    isDirect
      ? conversation.otherUser?.displayName ?? conversation.otherUser?.username ?? "Direct Message"
      : conversation.name ?? "Unnamed";

  const directAvatarUrl = isDirect ? (conversation.otherUser?.avatarUrl ?? undefined) : undefined;
  const directUserId = isDirect ? (conversation.otherUser?.id ?? conversation.id) : conversation.id;

  const lastMsg = conversation.lastMessage;
  const isMyMsg = lastMsg?.senderId === userId;
  const preview = lastMsgPreview(lastMsg, isMyMsg);

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
        {/* Unread dot on avatar */}
        {hasUnread && (
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-cta border-2 border-bg" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-1">
          <span className={cn(
            "text-sm truncate",
            hasUnread ? "font-bold text-text" : isActive ? "font-semibold text-primary" : "font-semibold text-text"
          )}>
            {displayName}
          </span>
          {lastMsg && (
            <span className={cn("text-[10px] shrink-0", hasUnread ? "text-cta font-semibold" : "text-muted")}>
              {formatDistanceToNowStrict(lastMsg.createdAt)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 mt-0.5">
          {hasPinned && (
            <Pin className="w-2.5 h-2.5 text-cta shrink-0 opacity-70" />
          )}
          {preview ? (
            <div className={cn("flex items-center gap-1 min-w-0 text-xs truncate", hasUnread ? "text-text font-medium" : "text-muted")}>
              {preview.icon ? <preview.icon className="w-3 h-3 shrink-0" /> : null}
              <p className="truncate">{preview.label}</p>
            </div>
          ) : hasPinned ? (
            <p className="text-xs text-muted truncate">{pinned.length} tin ghim</p>
          ) : null}
        </div>
      </div>

      {/* Unread badge */}
      {hasUnread && (
        <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-cta text-white text-[10px] font-bold flex items-center justify-center">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}
