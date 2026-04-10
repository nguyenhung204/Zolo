"use client";

import { Phone, Users, Search, MoreHorizontal, Hash, Megaphone } from "lucide-react";
import { useConversation } from "@/hooks/useConversations";
import { UserAvatar } from "@/components/presence/UserAvatar";
import { ConversationSettingsModal } from "./ConversationSettingsModal";
import { useRouter } from "next/navigation";
import { useCall } from "@/hooks/useCall";
import { useAuthStore } from "@/stores/authStore";
import type { ConversationType } from "@/lib/api/conversations";
import { cn } from "@/lib/utils";
import { useState } from "react";
import type { ConversationKind } from "@/lib/api/conversations";

const kindLabel: Record<ConversationKind, string> = {
  DIRECT: "Direct",
  GROUP: "Group",
  COMMUNITY: "Community",
};

const kindColor: Record<ConversationKind, string> = {
  DIRECT: "bg-secondary/10 text-secondary",
  GROUP: "bg-cta/10 text-cta",
  COMMUNITY: "bg-warning/10 text-warning",
};

interface ConversationHeaderProps {
  conversationId: string;
  onMembersClick: () => void;
}

export function ConversationHeader({ conversationId, onMembersClick }: ConversationHeaderProps) {
  const { data: conv } = useConversation(conversationId);
  const router = useRouter();
  const { startMeeting } = useCall();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const currentUserId = useAuthStore((s) => s.user?.id ?? "");

  if (!conv) {
    return (
      <div className="h-14 border-b border-border px-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-border animate-pulse" />
        <div className="h-4 w-32 bg-border animate-pulse rounded" />
      </div>
    );
  }

  const isDirect = conv.kind === "DIRECT";
  const isCommunity = conv.kind === "COMMUNITY";

  // GET /conversations/:id returns participants but not otherUser — derive from participants as fallback
  const otherParticipant = isDirect && !conv.otherUser
    ? conv.participants?.find((p) => p.userId !== currentUserId)
    : null;

  const resolvedOtherUser = conv.otherUser ?? (
    otherParticipant ? {
      id: otherParticipant.userId,
      username: otherParticipant.username ?? "",
      displayName: otherParticipant.displayName ?? "",
      avatarUrl: otherParticipant.avatarUrl,
    } : null
  );

  const displayName =
    isDirect
      ? resolvedOtherUser?.displayName || resolvedOtherUser?.username || "Direct Message"
      : conv.name ?? "Unnamed";

  const handleStartCall = async () => {
    if (!conv) return;
    try {
      const meeting = await startMeeting(conversationId, "", false);
      router.push(`/calls/${meeting.meetingId}`);
    } catch {
      // TODO: toast error
    }
  };

  return (
    <div className="h-14 border-b border-border px-4 flex items-center gap-3 shrink-0 bg-surface">
      {/* Avatar / icon */}
      {isDirect ? (
        <UserAvatar
          userId={resolvedOtherUser?.id ?? conv.id}
          name={displayName}
          avatarUrl={resolvedOtherUser?.avatarUrl ?? undefined}
          size="sm"
        />
      ) : conv.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={conv.avatarUrl}
          alt={displayName}
          className="w-8 h-8 rounded-full object-cover shrink-0"
        />
      ) : (
        <div className="w-8 h-8 rounded-full bg-cta/10 flex items-center justify-center shrink-0">
          {isCommunity ? (
            <Megaphone className="w-4 h-4 text-cta" />
          ) : (
            <Hash className="w-4 h-4 text-cta" />
          )}
        </div>
      )}

      {/* Name + badge */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <h1 className="text-sm font-semibold text-text truncate">{displayName}</h1>
        <span
          className={cn(
            "text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0",
            kindColor[conv.kind]
          )}
        >
          {kindLabel[conv.kind]}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {!isCommunity && (
          <ActionButton onClick={handleStartCall} title="Start call">
            <Phone className="w-4 h-4" />
          </ActionButton>
        )}
        <ActionButton onClick={onMembersClick} title="Members">
          <Users className="w-4 h-4" />
          <span className="text-xs font-medium">{conv.memberCount}</span>
        </ActionButton>
        <ActionButton onClick={() => {}} title="Search in conversation">
          <Search className="w-4 h-4" />
        </ActionButton>
        <ActionButton onClick={() => setSettingsOpen(true)} title="More options">
          <MoreHorizontal className="w-4 h-4" />
        </ActionButton>
      </div>

      <ConversationSettingsModal
        conversationId={conversationId}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

function ActionButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center gap-1 px-2 h-8 rounded-lg text-secondary hover:text-primary hover:bg-border/50 transition-colors cursor-pointer"
    >
      {children}
    </button>
  );
}
