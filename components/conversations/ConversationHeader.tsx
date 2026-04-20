"use client";

import { UserAvatar } from "@/components/presence/UserAvatar";
import { useConversation } from "@/hooks/useConversations";
import type { ConversationKind } from "@/lib/api/conversations";
import { startInstantCall } from "@/lib/api/calls";
import { useCallStore } from "@/stores/callStore";
import { usePresenceStore } from "@/stores/presenceStore";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { Hash, Megaphone, MoreHorizontal, Phone, Search, Users } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ConversationSettingsModal } from "./ConversationSettingsModal";
import { getCallSocket } from "@/lib/socket/socket";

const kindLabel: Record<ConversationKind, string> = {
  direct: "Direct",
  group: "Group",
  community: "Community",
};

const kindColor: Record<ConversationKind, string> = {
  direct: "bg-secondary/10 text-secondary",
  group: "bg-cta/10 text-cta",
  community: "bg-warning/10 text-warning",
};

interface ConversationHeaderProps {
  conversationId: string;
  onMembersClick: () => void;
}

export function ConversationHeader({ conversationId, onMembersClick }: ConversationHeaderProps) {
  const { data: conv } = useConversation(conversationId);
  const { setOutgoingCall } = useCallStore();
  const { setUserProfile } = usePresenceStore();
  const isBusyRef = useRef(false);
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

  const isDirect = conv.kind === "direct";
  const isCommunity = conv.kind === "community";

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
    if (!conv || isBusyRef.current) return;
    isBusyRef.current = true;
    try {
      const otherMemberIds = (conv.participants ?? [])
        .map((p) => p.userId)
        .filter((id) => id !== currentUserId);
      const callDto = await startInstantCall({
        conversationId,
        calleeIds: otherMemberIds,
      });
      setOutgoingCall(callDto);
      // Sync participant profiles so GlobalCallOverlay can show names/avatars immediately
      (conv.participants ?? []).forEach((p) => {
        if (p.userId !== currentUserId) {
          setUserProfile(p.userId, {
            displayName: p.displayName ?? p.username ?? null,
            avatarMediaId: null,
            avatarUrl: p.avatarUrl ?? null,
          });
        }
      });
      // Join the call WS room so we receive call:accepted / call:declined
      getCallSocket().emit("call:join_room", { callId: callDto.id });
    } catch (err: unknown) {
      const code =
        typeof err === "object" &&
        err !== null &&
        "response" in err
          ? (err as { response?: { data?: { code?: string } } }).response?.data?.code
          : undefined;
      if (code === "CALL_CALLEE_BUSY") {
        toast.error("The other person is already in a call.");
      } else if (code === "CALL_CALLER_BUSY") {
        toast.error("You are already in a call.");
      } else {
        toast.error("Could not start call.");
      }
    } finally {
      isBusyRef.current = false;
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
