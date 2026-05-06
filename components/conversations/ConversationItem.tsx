"use client";

import { useAuthStore } from "@/stores/authStore";
import { useCallStore } from "@/stores/callStore";
import { useMentionStore } from "@/stores/mentionStore";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/presence/UserAvatar";
import { formatDistanceToNowStrict } from "@/lib/utils/date";
import type { Conversation } from "@/lib/api/conversations";
import { FileText, Hash, Image, Mic, Megaphone, Phone, Sticker, Video, AtSign } from "lucide-react";

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
  if (msg.isRevoked) return { icon: null, label: "Tin nhắn đã bị thu hồi" };
  if (msg.isDeleted) return { icon: null, label: "Tin nhắn đã bị xóa" };
  // system_call: present on both type="system" (group) and type="text" (direct)
  if (msg.metadata?.systemType === "system_call") {
    return { icon: Phone, label: msg.content };
  }
  if (msg.type === "system") {
    return { icon: null, label: msg.content || "Group activity" };
  }
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
      return { icon: null, label: prefix + (msg.content || "Tin nhắn") };
  }
}

export function ConversationItem({ conversation, isActive, onClick }: ConversationItemProps) {
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const callEntry = useCallStore((s) => s.groupCallsByConversation[conversation.id]);
  const mentionedConversations = useMentionStore((s) => s.mentionedConversations);
  const hasMention = mentionedConversations.has(conversation.id) && !isActive;
  const unread = Math.max(
    0,
    Number(conversation.maxOffset) - (conversation.lastSeenOffset ?? Number(conversation.maxOffset))
  );
  const hasUnread = unread > 0 && !isActive;
  const TypeIcon = typeIconMap[conversation.kind] ?? null;
  const isDirect = conversation.kind === "direct";

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
        {/* Active call badge */}
        {callEntry && !hasUnread && (
          <span className={cn(
            "absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-bg flex items-center justify-center",
            callEntry.status === "RINGING" ? "bg-warning" : "bg-success",
          )}>
            <Phone className="w-2 h-2 text-white" />
          </span>
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
          {preview ? (
            <div className={cn("flex items-center gap-1 min-w-0 text-xs truncate", hasUnread ? "text-text font-medium" : "text-muted")}>
              {preview.icon ? <preview.icon className="w-3 h-3 shrink-0" /> : null}
              <p className="truncate">{preview.label}</p>
            </div>
          ) : (
            <p className="text-xs text-muted truncate italic">Bắt đầu cuộc trò chuyện</p>
          )}
        </div>
      </div>

      {/* Mention badge (shows @mention icon) */}
      {hasMention && (
        <div className="shrink-0 w-[18px] h-[18px] rounded-full bg-warning/10 border border-warning flex items-center justify-center">
          <AtSign className="w-2.5 h-2.5 text-warning" />
        </div>
      )}

      {/* Unread badge */}
      {hasUnread && !hasMention && (
        <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-cta text-white text-[10px] font-bold flex items-center justify-center">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}
