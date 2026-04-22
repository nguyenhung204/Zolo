"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  UserPlus,
  Check,
  X,
  UserMinus,
  MessageSquare,
  Users,
  Clock,
  UserCheck,
  Bell,
  Loader2,
  UsersRound,
  Ban,
  MoreHorizontal,
  Eye,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { UserAvatar } from "@/components/presence/UserAvatar";
import {
  useFriends,
  useFriendRequests,
  useUserSearch,
  useFriendshipStatus,
  useSendFriendRequest,
  useAcceptFriendRequest,
  useRejectFriendRequest,
  useUnfriend,
  useBlockUser,
} from "@/hooks/useFriends";
import { useConversations } from "@/hooks/useConversations";
import { useUserById } from "@/hooks/useUser";
import { usePresenceStore } from "@/stores/presenceStore";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";
import type { Friendship, FriendshipStatus, UserSearchResult } from "@/lib/api/friends";
import { encodeId } from "@/lib/utils/obfuscateId";

type Tab = "friends" | "requests" | "search";

type ActionKey =
  | "send"
  | "accept"
  | "reject"
  | "unfriend"
  | "block";

function formatSeenAgo(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "just now";

  const diffSeconds = Math.max(1, Math.floor((Date.now() - time) / 1000));
  if (diffSeconds < 60) return `${diffSeconds} second${diffSeconds === 1 ? "" : "s"} ago`;

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FriendsPage() {
  const [tab, setTab] = useState<Tab>("friends");
  const [searchQuery, setSearchQuery] = useState("");
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const { data: requests } = useFriendRequests();
  const incomingCount = requests?.incoming.length ?? 0;

  const tabs: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "friends", label: "Friends", icon: <Users className="w-4 h-4" /> },
    {
      id: "requests",
      label: "Requests",
      icon: <Bell className="w-4 h-4" />,
      badge: incomingCount || undefined,
    },
    { id: "search", label: "Add People", icon: <UserPlus className="w-4 h-4" /> },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg">
      {/* Header */}
      <div className="border-b border-border px-6 pt-5 pb-0 bg-surface shrink-0">
        <h1 className="text-xl font-bold text-primary mb-4 tracking-tight">Friends</h1>
        <nav className="flex gap-1">
          {tabs.map(({ id, label, icon, badge }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-all duration-150 cursor-pointer",
                tab === id
                  ? "border-cta text-cta bg-cta/5"
                  : "border-transparent text-muted hover:text-secondary hover:bg-border/30"
              )}
            >
              {icon}
              {label}
              {badge ? (
                <span className="absolute -top-1 -right-1 min-w-4.5 h-4.5 px-1 rounded-full bg-error text-white text-[10px] font-bold flex items-center justify-center leading-none">
                  {badge > 99 ? "99+" : badge}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === "friends" && <FriendList onViewProfile={setProfileUserId} />}
        {tab === "requests" && <RequestList />}
        {tab === "search" && (
          <SearchPeople
            query={searchQuery}
            onQueryChange={setSearchQuery}
            onViewProfile={setProfileUserId}
          />
        )}
      </div>
      <UserProfileModal
        userId={profileUserId}
        open={!!profileUserId}
        onClose={() => setProfileUserId(null)}
      />
    </div>
  );
}

// ─── Friend List ──────────────────────────────────────────────────────────────

function FriendList({ onViewProfile }: { onViewProfile: (userId: string) => void }) {
  const { data: friends = [], isLoading } = useFriends();

  if (isLoading) return <ListSkeleton count={5} />;

  if (friends.length === 0) {
    return (
      <EmptyState
        icon={<UsersRound className="w-10 h-10 text-muted/40" />}
        title="No friends yet"
        description="Switch to 'Add People' to connect with others."
      />
    );
  }

  return (
    <div className="p-4">
      <p className="text-xs font-semibold text-muted uppercase tracking-wider px-2 mb-3">
        {friends.length} {friends.length === 1 ? "Friend" : "Friends"}
      </p>
      <ul className="space-y-1">
        {friends.map((f) => (
          <FriendRow
            key={f.id}
            friendship={f}
            onViewProfile={() => onViewProfile(f.friendId)}
          />
        ))}
      </ul>
    </div>
  );
}

function FriendRow({
  friendship,
  onViewProfile,
}: {
  friendship: Friendship;
  onViewProfile: () => void;
}) {
  const router = useRouter();
  const { data: user, isLoading } = useUserById(friendship.friendId);
  const { mutateAsync: unfriend } = useUnfriend();
  const { mutateAsync: blockUser } = useBlockUser();
  const { data: conversations = [] } = useConversations();
  const [pendingAction, setPendingAction] = useState<ActionKey | null>(null);
  const status = usePresenceStore((s) => s.presenceMap[friendship.friendId] ?? "offline");
  const lastSeen = usePresenceStore((s) => s.lastSeenMap[friendship.friendId]);
  const profile = usePresenceStore((s) => s.profileMap[friendship.friendId]);

  const displayName = profile?.displayName
    ?? (user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username : null);

  const dmConversation = useMemo(
    () =>
      conversations.find(
        (c) => c.kind === "direct" && c.otherUser?.id === friendship.friendId
      ),
    [conversations, friendship.friendId]
  );

  function handleMessage() {
    if (dmConversation) {
      router.push(`/conversations/${encodeId(dmConversation.id)}`);
    }
  }

  async function run(action: ActionKey, fn: () => Promise<unknown>) {
    setPendingAction(action);
    try {
      await fn();
    } finally {
      setPendingAction(null);
    }
  }

  const actionDisabled = pendingAction !== null;

  const safeName = displayName ?? user?.username ?? "User";

  return (
    <li className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-border/30 transition-colors duration-150">
      <UserAvatar
        userId={friendship.friendId}
        name={safeName}
        avatarUrl={user?.avatarUrl}
        size="md"
        showPresence
      />
      <div className="flex-1 min-w-0">
        {isLoading && !displayName ? (
          <div className="h-3.5 bg-border animate-pulse rounded w-28 mb-1.5" />
        ) : (
          <p className="text-sm font-semibold text-text truncate">{safeName}</p>
        )}
        <p className={cn("text-xs font-medium", status === "online" ? "text-online" : "text-muted")}>
          {status === "online"
            ? "Online"
            : lastSeen
              ? `Offline · seen ${formatSeenAgo(lastSeen)}`
              : "Offline"}
        </p>
      </div>
      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        {dmConversation && (
          <button
            onClick={handleMessage}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cta/10 text-cta text-xs font-semibold hover:bg-cta/20 transition-colors cursor-pointer"
            title="Send message"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Message
          </button>
        )}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-secondary hover:bg-border/70 transition-colors cursor-pointer"
              aria-label="More actions"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              sideOffset={6}
              align="end"
              className="z-50 min-w-40 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
            >
              <DropdownMenu.Item
                onSelect={onViewProfile}
                className="flex items-center gap-2 px-2.5 py-2 text-xs text-secondary rounded-lg outline-none hover:bg-border/60 cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                View profile
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="h-px my-1 bg-border" />
              <DropdownMenu.Item
                disabled={actionDisabled}
                onSelect={() => {
                  void run("unfriend", () => unfriend(friendship.friendId));
                }}
                className="flex items-center gap-2 px-2.5 py-2 text-xs text-error rounded-lg outline-none hover:bg-error/10 cursor-pointer disabled:opacity-60"
              >
                {pendingAction === "unfriend" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <UserMinus className="w-3.5 h-3.5" />
                )}
                Unfriend
              </DropdownMenu.Item>
              <DropdownMenu.Item
                disabled={actionDisabled}
                onSelect={() => {
                  void run("block", () => blockUser(friendship.friendId));
                }}
                className="flex items-center gap-2 px-2.5 py-2 text-xs text-error rounded-lg outline-none hover:bg-error/10 cursor-pointer disabled:opacity-60"
              >
                {pendingAction === "block" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Ban className="w-3.5 h-3.5" />
                )}
                Block user
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </li>
  );
}

// ─── Incoming Requests ────────────────────────────────────────────────────────

function RequestList() {
  const { data: requests, isLoading } = useFriendRequests();
  const incoming = requests?.incoming ?? [];
  const outgoing = requests?.outgoing ?? [];

  if (isLoading) return <ListSkeleton count={3} />;

  if (incoming.length === 0 && outgoing.length === 0) {
    return (
      <EmptyState
        icon={<Bell className="w-10 h-10 text-muted/40" />}
        title="No pending requests"
        description="Incoming and sent requests will appear here."
      />
    );
  }

  return (
    <div className="p-4">
      <div className="mb-4">
        <p className="text-xs font-semibold text-muted uppercase tracking-wider px-2 mb-2">
          Incoming ({incoming.length})
        </p>
        {incoming.length > 0 ? (
          <ul className="space-y-2">
            {incoming.map((userId) => (
              <RequestRow key={`in-${userId}`} userId={userId} direction="incoming" />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted px-2">No incoming requests.</p>
        )}
      </div>

      <div>
        <p className="text-xs font-semibold text-muted uppercase tracking-wider px-2 mb-2">
          Sent ({outgoing.length})
        </p>
        {outgoing.length > 0 ? (
          <ul className="space-y-2">
            {outgoing.map((userId) => (
              <RequestRow key={`out-${userId}`} userId={userId} direction="outgoing" />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted px-2">No sent requests.</p>
        )}
      </div>
    </div>
  );
}

function RequestRow({ userId, direction }: { userId: string; direction: "incoming" | "outgoing" }) {
  const { data: user, isLoading } = useUserById(userId);
  const { mutateAsync: accept } = useAcceptFriendRequest();
  const { mutateAsync: rejectOrCancel } = useRejectFriendRequest();
  const [pendingAction, setPendingAction] = useState<ActionKey | null>(null);

  const displayName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username
    : null;

  async function run(action: ActionKey, fn: () => Promise<unknown>) {
    setPendingAction(action);
    try {
      await fn();
    } finally {
      setPendingAction(null);
    }
  }

  const safeName = displayName ?? user?.username ?? "User";

  return (
    <li className="flex items-center gap-3 px-3 py-3 rounded-xl border border-border/60 bg-surface hover:border-border transition-colors duration-150">
      <UserAvatar
        userId={userId}
        name={safeName}
        avatarUrl={user?.avatarUrl}
        size="md"
        showPresence={false}
      />
      <div className="flex-1 min-w-0">
        {isLoading && !displayName ? (
          <>
            <div className="h-3.5 bg-border animate-pulse rounded w-32 mb-1.5" />
            <div className="h-2.5 bg-border animate-pulse rounded w-20" />
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-text truncate">{safeName}</p>
            {user?.username && (
              <p className="text-xs text-muted truncate">@{user.username}</p>
            )}
          </>
        )}
      </div>
      <div className="flex flex-col items-end gap-2">
        <p className="text-[11px] text-muted flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Pending
        </p>
        <div className="flex items-center gap-2">
          {direction === "incoming" && (
            <button
              onClick={() => run("accept", () => accept(userId))}
              disabled={pendingAction !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-success/10 text-success text-xs font-semibold hover:bg-success/20 transition-colors cursor-pointer disabled:opacity-50"
            >
              {pendingAction === "accept" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Accept
            </button>
          )}
          <button
            onClick={() => run("reject", () => rejectOrCancel(userId))}
            disabled={pendingAction !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-error/10 text-error text-xs font-semibold hover:bg-error/20 transition-colors cursor-pointer disabled:opacity-50"
          >
            {pendingAction === "reject" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
            {direction === "incoming" ? "Decline" : "Cancel"}
          </button>
        </div>
      </div>
    </li>
  );
}

// ─── Search / Add People ──────────────────────────────────────────────────────

function SearchPeople({
  query,
  onQueryChange,
  onViewProfile,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  onViewProfile: (userId: string) => void;
}) {
  const { data: results = [], isLoading, isFetching } = useUserSearch(query);
  const myId = useAuthStore((s) => s.user?.id);

  const showResults = query.trim().length >= 2;

  return (
    <div className="p-4 max-w-lg">
      {/* Search input */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
        <input
          type="search"
          placeholder="Search by name, username or email…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="w-full pl-10 pr-4 py-3 rounded-xl border border-border bg-bg text-sm focus:border-cta focus:outline-none focus:ring-2 focus:ring-cta/10 transition-all duration-150 placeholder:text-muted"
          autoFocus
        />
        {isFetching && showResults && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted animate-spin" />
        )}
      </div>

      {/* Hint */}
      {!showResults && (
        <div className="py-12 flex flex-col items-center gap-3 text-center">
          <UserPlus className="w-10 h-10 text-muted/40" />
          <p className="text-sm text-muted">Type at least 2 characters to search for people.</p>
        </div>
      )}

      {/* Loading */}
      {isLoading && showResults && <ListSkeleton count={3} />}

      {/* Results */}
      {!isLoading && showResults && results.length > 0 && (
        <ul className="space-y-1.5">
          {results.map((u) => {
            return (
              <SearchResultRow
                key={u.id}
                user={u}
                myId={myId}
                onViewProfile={onViewProfile}
              />
            );
          })}
        </ul>
      )}

      {/* Empty */}
      {!isLoading && showResults && results.length === 0 && (
        <EmptyState
          icon={<Search className="w-10 h-10 text-muted/40" />}
          title="No users found"
          description={`No results for "${query}". Try a different name or email.`}
        />
      )}
    </div>
  );
}

function SearchResultRow({
  user,
  myId,
  onViewProfile,
}: {
  user: UserSearchResult;
  myId?: string;
  onViewProfile: (userId: string) => void;
}) {
  const isMe = user.id === myId;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username;

  const { data: statusData, isFetching: statusLoading } = useFriendshipStatus(
    isMe ? undefined : user.id,
    user.friendship
  );
  const status: FriendshipStatus = statusData?.status ?? user.friendship ?? "NONE";

  const { mutateAsync: send } = useSendFriendRequest();
  const { mutateAsync: accept } = useAcceptFriendRequest();
  const { mutateAsync: rejectOrCancel } = useRejectFriendRequest();
  const { mutateAsync: unfriend } = useUnfriend();
  const [pendingAction, setPendingAction] = useState<ActionKey | null>(null);

  async function run(action: ActionKey, fn: () => Promise<unknown>) {
    setPendingAction(action);
    try {
      await fn();
    } finally {
      setPendingAction(null);
    }
  }

  const actionDisabled = pendingAction !== null || statusLoading;

  return (
    <li className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-border/30 transition-colors duration-150">
      <UserAvatar
        userId={user.id}
        name={name}
        avatarUrl={user.avatarUrl}
        size="md"
        showPresence={false}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text truncate">{name}</p>
        <p className="text-xs text-muted truncate">@{user.username}</p>
      </div>

      {!isMe && (
        <button
          onClick={() => onViewProfile(user.id)}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-secondary hover:bg-border/70 transition-colors cursor-pointer shrink-0"
          aria-label="View profile"
          title="View profile"
        >
          <Eye className="w-4 h-4" />
        </button>
      )}

      {isMe && (
        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-border/60 text-muted text-xs font-medium shrink-0">
          You
        </span>
      )}

      {!isMe && status === "NONE" && (
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => run("send", () => send(user.id))}
            disabled={actionDisabled}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cta text-white text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-60"
          >
            {pendingAction === "send" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
            Add Friend
          </button>
        </div>
      )}

      {!isMe && status === "PENDING_OUT" && (
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => run("reject", () => rejectOrCancel(user.id))}
            disabled={actionDisabled}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-error/10 text-error text-xs font-semibold hover:bg-error/20 transition-colors cursor-pointer disabled:opacity-60"
          >
            {pendingAction === "reject" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
            Cancel
          </button>
        </div>
      )}

      {!isMe && status === "PENDING_IN" && (
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => run("accept", () => accept(user.id))}
            disabled={actionDisabled}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-success/10 text-success text-xs font-semibold hover:bg-success/20 transition-colors cursor-pointer disabled:opacity-60"
          >
            {pendingAction === "accept" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Accept
          </button>
          <button
            onClick={() => run("reject", () => rejectOrCancel(user.id))}
            disabled={actionDisabled}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-error/10 text-error text-xs font-semibold hover:bg-error/20 transition-colors cursor-pointer disabled:opacity-60"
          >
            {pendingAction === "reject" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
            Decline
          </button>
        </div>
      )}

      {!isMe && status === "FRIEND" && (
        <div className="flex items-center gap-2 shrink-0">
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-success/10 text-success text-xs font-semibold">
            <UserCheck className="w-3.5 h-3.5" />
            Friends
          </span>
          <button
            onClick={() => run("unfriend", () => unfriend(user.id))}
            disabled={actionDisabled}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-error hover:bg-error/10 transition-colors cursor-pointer disabled:opacity-60"
          >
            {pendingAction === "unfriend" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserMinus className="w-3.5 h-3.5" />}
            Unfriend
          </button>
        </div>
      )}

      {!isMe && status === "BLOCKED" && (
        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-error/10 text-error text-xs font-medium shrink-0">
          Blocked
        </span>
      )}
    </li>
  );
}

function UserProfileModal({
  userId,
  open,
  onClose,
}: {
  userId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: user, isLoading } = useUserById(userId ?? undefined);
  const status = usePresenceStore((s) => (userId ? (s.presenceMap[userId] ?? "offline") : "offline"));
  const lastSeen = usePresenceStore((s) => (userId ? s.lastSeenMap[userId] : undefined));

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-surface rounded-2xl shadow-xl border border-border">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-sm font-bold text-primary">User Profile</h2>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-primary hover:bg-border/60 transition-colors cursor-pointer"
              aria-label="Close profile"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-5 py-5">
            {isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading profile...
              </div>
            )}

            {!isLoading && user && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <UserAvatar
                    userId={user.id}
                    name={[user.firstName, user.lastName].filter(Boolean).join(" ") || user.username}
                    avatarUrl={user.avatarUrl}
                    size="lg"
                    showPresence
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text truncate">
                      {[user.firstName, user.lastName].filter(Boolean).join(" ") || user.username}
                    </p>
                    <p className="text-xs text-muted truncate">@{user.username}</p>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted">Email</span>
                    <span className="text-secondary truncate">{user.email}</span>
                  </div>
                  {user.phone && (
                    <div className="flex justify-between gap-3">
                      <span className="text-muted">Phone</span>
                      <span className="text-secondary">{user.phone}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <span className="text-muted">Status</span>
                    <span className={cn("font-medium", status === "online" ? "text-online" : "text-muted")}>
                      {status === "online"
                        ? "Online"
                        : lastSeen
                          ? `Offline · seen ${formatSeenAgo(lastSeen)}`
                          : "Offline"}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function ListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="p-4 space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <div className="w-10 h-10 rounded-full bg-border animate-pulse shrink-0" />
          <div className="space-y-2 flex-1">
            <div className="h-3 bg-border animate-pulse rounded w-2/5" />
            <div className="h-2.5 bg-border animate-pulse rounded w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 px-6 text-center">
      {icon}
      <p className="text-sm font-semibold text-secondary">{title}</p>
      <p className="text-xs text-muted max-w-xs">{description}</p>
    </div>
  );
}
