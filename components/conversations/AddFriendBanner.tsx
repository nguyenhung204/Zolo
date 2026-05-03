"use client";

import { UserPlus, Check, Clock, X } from "lucide-react";
import { useConversation } from "@/hooks/useConversations";
import {
  useFriendshipStatus,
  useSendFriendRequest,
  useAcceptFriendRequest,
  useRejectFriendRequest,
} from "@/hooks/useFriends";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";

interface AddFriendBannerProps {
  conversationId: string;
}

/**
 * Pinned banner that surfaces a "Send friend request" call-to-action when the
 * user is in a direct chat with someone they're NOT yet friends with.
 *
 * Hides itself for: group conversations, self-chat, blocked users, friends.
 */
export function AddFriendBanner({ conversationId }: AddFriendBannerProps) {
  const myId = useAuthStore((s) => s.user?.id);
  const { data: conv } = useConversation(conversationId);

  // otherUser comes from the list cache (seeded via initialData in useConversation).
  // Fall back to participants from the detail response when list cache is cold.
  const otherId =
    conv?.otherUser?.id ??
    (conv?.kind === "direct"
      ? conv.participants?.find((p) => p.userId !== myId)?.userId
      : undefined);

  const otherName =
    conv?.otherUser?.displayName ??
    conv?.otherUser?.username ??
    conv?.participants?.find((p) => p.userId === otherId)?.displayName ??
    conv?.participants?.find((p) => p.userId === otherId)?.username ??
    "this user";

  const { data: friendshipData } = useFriendshipStatus(
    conv?.kind === "direct" && otherId && otherId !== myId ? otherId : undefined,
  );
  const status = friendshipData?.status;

  const sendReq = useSendFriendRequest();
  const acceptReq = useAcceptFriendRequest();
  const rejectReq = useRejectFriendRequest();

  // Hide for: group chats, self chat, friends, blocked relationships, and
  // while the friendship status is still loading.
  if (
    !conv ||
    conv.kind !== "direct" ||
    !otherId ||
    otherId === myId ||
    !status ||
    status === "FRIEND" ||
    status === "BLOCKED"
  ) {
    return null;
  }

  // ── PENDING_OUT ─────────────────────────────────────────────────────────
  if (status === "PENDING_OUT") {
    return (
      <BannerShell tone="muted">
        <Clock className="w-4 h-4 text-muted shrink-0" />
        <p className="flex-1 text-xs text-secondary truncate">
          Friend request sent · waiting for {otherName} to accept
        </p>
        <BannerButton
          tone="ghost"
          loading={rejectReq.isPending}
          onClick={() => rejectReq.mutate(otherId)}
        >
          Cancel
        </BannerButton>
      </BannerShell>
    );
  }

  // ── PENDING_IN ──────────────────────────────────────────────────────────
  if (status === "PENDING_IN") {
    return (
      <BannerShell tone="cta">
        <UserPlus className="w-4 h-4 text-cta shrink-0" />
        <p className="flex-1 text-xs text-text truncate">
          <span className="font-semibold">{otherName}</span> wants to connect
        </p>
        <BannerButton
          tone="primary"
          loading={acceptReq.isPending}
          onClick={() => acceptReq.mutate(otherId)}
        >
          <Check className="w-3.5 h-3.5" />
          Accept
        </BannerButton>
        <BannerButton
          tone="ghost"
          loading={rejectReq.isPending}
          onClick={() => rejectReq.mutate(otherId)}
        >
          <X className="w-3.5 h-3.5" />
        </BannerButton>
      </BannerShell>
    );
  }

  // ── NONE — show "Add as friend" recommendation ──────────────────────────
  return (
    <BannerShell tone="cta">
      <UserPlus className="w-4 h-4 text-cta shrink-0" />
      <p className="flex-1 text-xs text-text truncate">
        You&apos;re not friends with{" "}
        <span className="font-semibold">{otherName}</span> yet
      </p>
      <BannerButton
        tone="primary"
        loading={sendReq.isPending}
        onClick={() => sendReq.mutate(otherId)}
      >
        <UserPlus className="w-3.5 h-3.5" />
        Add friend
      </BannerButton>
    </BannerShell>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────

function BannerShell({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "cta" | "muted";
}) {
  return (
    <div
      className={cn(
        "shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border/60 min-w-0",
        tone === "cta"
          ? "bg-cta/5"
          : "bg-surface-secondary",
      )}
    >
      {children}
    </div>
  );
}

function BannerButton({
  children,
  onClick,
  loading,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  loading?: boolean;
  tone: "primary" | "ghost";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={cn(
        "shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer disabled:opacity-50 disabled:cursor-default",
        tone === "primary"
          ? "bg-cta text-white hover:bg-cta-hover"
          : "text-secondary hover:bg-border/60",
      )}
    >
      {children}
    </button>
  );
}
