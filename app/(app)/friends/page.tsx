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
} from "lucide-react";
import { UserAvatar } from "@/components/presence/UserAvatar";
import {
  useFriends,
  useFriendRequests,
  useUserSearch,
  useSendFriendRequest,
  useAcceptFriendRequest,
  useRejectFriendRequest,
  useUnfriend,
} from "@/hooks/useFriends";
import { useConversations } from "@/hooks/useConversations";
import { useUserById } from "@/hooks/useUser";
import { usePresenceStore } from "@/stores/presenceStore";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";
import type { Friendship, FriendRequest } from "@/lib/api/friends";

type Tab = "friends" | "requests" | "search";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FriendsPage() {
  const [tab, setTab] = useState<Tab>("friends");
  const [searchQuery, setSearchQuery] = useState("");
  const { data: requests = [] } = useFriendRequests();

  const tabs: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "friends", label: "Friends", icon: <Users className="w-4 h-4" /> },
    {
      id: "requests",
      label: "Requests",
      icon: <Bell className="w-4 h-4" />,
      badge: requests.length || undefined,
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
        {tab === "friends" && <FriendList />}
        {tab === "requests" && <RequestList />}
        {tab === "search" && (
          <SearchPeople query={searchQuery} onQueryChange={setSearchQuery} />
        )}
      </div>
    </div>
  );
}

// ─── Friend List ──────────────────────────────────────────────────────────────

function FriendList() {
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
          <FriendRow key={f.id} friendship={f} />
        ))}
      </ul>
    </div>
  );
}

function FriendRow({ friendship }: { friendship: Friendship }) {
  const router = useRouter();
  const { data: user, isLoading } = useUserById(friendship.friendId);
  const { mutate: unfriend, isPending } = useUnfriend();
  const { data: conversations = [] } = useConversations();
  const status = usePresenceStore((s) => s.presenceMap[friendship.friendId] ?? "offline");
  const profile = usePresenceStore((s) => s.profileMap[friendship.friendId]);

  const displayName = profile?.displayName
    ?? (user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username : null);

  const dmConversation = useMemo(
    () =>
      conversations.find(
        (c) => c.kind === "DIRECT" && c.otherUser?.id === friendship.friendId
      ),
    [conversations, friendship.friendId]
  );

  function handleMessage() {
    if (dmConversation) {
      router.push(`/conversations/${dmConversation.id}`);
    }
  }

  return (
    <li className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-border/30 transition-colors duration-150">
      <UserAvatar
        userId={friendship.friendId}
        name={displayName ?? friendship.friendId}
        avatarUrl={user?.avatarUrl}
        size="md"
        showPresence
      />
      <div className="flex-1 min-w-0">
        {isLoading && !displayName ? (
          <div className="h-3.5 bg-border animate-pulse rounded w-28 mb-1.5" />
        ) : (
          <p className="text-sm font-semibold text-text truncate">{displayName ?? friendship.friendId}</p>
        )}
        <p className={cn("text-xs font-medium", status === "online" ? "text-online" : "text-muted")}>
          {status === "online" ? "Online" : "Offline"}
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
        <button
          onClick={() => unfriend(friendship.friendId)}
          disabled={isPending}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-error hover:bg-error/10 transition-colors cursor-pointer disabled:opacity-50"
          title="Unfriend"
        >
          {isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <UserMinus className="w-3.5 h-3.5" />
          )}
          Unfriend
        </button>
      </div>
    </li>
  );
}

// ─── Incoming Requests ────────────────────────────────────────────────────────

function RequestList() {
  const { data: requests = [], isLoading } = useFriendRequests();

  if (isLoading) return <ListSkeleton count={3} />;

  if (requests.length === 0) {
    return (
      <EmptyState
        icon={<Bell className="w-10 h-10 text-muted/40" />}
        title="No pending requests"
        description="Friend requests you receive will appear here."
      />
    );
  }

  return (
    <div className="p-4">
      <p className="text-xs font-semibold text-muted uppercase tracking-wider px-2 mb-3">
        {requests.length} pending {requests.length === 1 ? "request" : "requests"}
      </p>
      <ul className="space-y-2">
        {requests.map((r) => (
          <RequestRow key={r.id} request={r} />
        ))}
      </ul>
    </div>
  );
}

function RequestRow({ request }: { request: FriendRequest }) {
  const { data: user, isLoading } = useUserById(request.fromUserId);
  const { mutate: accept, isPending: accepting } = useAcceptFriendRequest();
  const { mutate: reject, isPending: rejecting } = useRejectFriendRequest();

  const displayName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username
    : null;

  return (
    <li className="flex items-center gap-3 px-3 py-3 rounded-xl border border-border/60 bg-surface hover:border-border transition-colors duration-150">
      <UserAvatar
        userId={request.fromUserId}
        name={displayName ?? request.fromUserId}
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
            <p className="text-sm font-semibold text-text truncate">{displayName ?? request.fromUserId}</p>
            {user?.username && (
              <p className="text-xs text-muted truncate">@{user.username}</p>
            )}
          </>
        )}
      </div>
      <div className="flex flex-col items-end gap-2">
        <p className="text-[11px] text-muted flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {timeAgo(request.createdAt)}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => accept(request.fromUserId)}
            disabled={accepting || rejecting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-success/10 text-success text-xs font-semibold hover:bg-success/20 transition-colors cursor-pointer disabled:opacity-50"
          >
            {accepting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Accept
          </button>
          <button
            onClick={() => reject(request.fromUserId)}
            disabled={accepting || rejecting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-error/10 text-error text-xs font-semibold hover:bg-error/20 transition-colors cursor-pointer disabled:opacity-50"
          >
            {rejecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
            Decline
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
}: {
  query: string;
  onQueryChange: (q: string) => void;
}) {
  const { data: results = [], isLoading, isFetching } = useUserSearch(query);
  const { mutate: sendRequest, isPending: sending, variables: sendingTo } = useSendFriendRequest();
  const myId = useAuthStore((s) => s.user?.id);
  const [localPendingOut, setLocalPendingOut] = useState<string[]>([]);

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
            const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username;
            const isSendingThisOne = sending && sendingTo === u.id;
            const isMe = u.id === myId;
            const isLocallyPendingOut = localPendingOut.includes(u.id);
            const friendship = isLocallyPendingOut ? "PENDING_OUT" : (u.friendship ?? "NONE");

            const handleSendRequest = () => {
              if (isLocallyPendingOut) return;
              setLocalPendingOut((prev) => (prev.includes(u.id) ? prev : [...prev, u.id]));
              sendRequest(u.id, {
                onError: () => {
                  setLocalPendingOut((prev) => prev.filter((id) => id !== u.id));
                },
              });
            };

            return (
              <li
                key={u.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-border/30 transition-colors duration-150"
              >
                <UserAvatar
                  userId={u.id}
                  name={name}
                  avatarUrl={u.avatarUrl}
                  size="md"
                  showPresence={false}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text truncate">{name}</p>
                  <p className="text-xs text-muted truncate">@{u.username}</p>
                </div>

                {/* Status badge / action */}
                {isMe && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-border/60 text-muted text-xs font-medium shrink-0">
                    You
                  </span>
                )}
                {!isMe && friendship === "NONE" && (
                  <button
                    onClick={handleSendRequest}
                    disabled={isSendingThisOne || isLocallyPendingOut}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cta text-white text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-60 shrink-0"
                  >
                    {isSendingThisOne ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <UserPlus className="w-3.5 h-3.5" />
                    )}
                    Add Friend
                  </button>
                )}
                {!isMe && friendship === "PENDING_OUT" && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-border/60 text-muted text-xs font-medium shrink-0">
                    <Clock className="w-3.5 h-3.5" />
                    Pending
                  </span>
                )}
                {!isMe && friendship === "PENDING_IN" && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cta/10 text-cta text-xs font-medium shrink-0">
                    <Bell className="w-3.5 h-3.5" />
                    Respond
                  </span>
                )}
                {!isMe && friendship === "FRIEND" && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-success/10 text-success text-xs font-semibold shrink-0">
                    <UserCheck className="w-3.5 h-3.5" />
                    Friends
                  </span>
                )}
                {!isMe && friendship === "BLOCKED" && (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-error/10 text-error text-xs font-medium shrink-0">
                    Blocked
                  </span>
                )}
                {!isMe &&
                  friendship !== "NONE" &&
                  friendship !== "PENDING_OUT" &&
                  friendship !== "PENDING_IN" &&
                  friendship !== "FRIEND" &&
                  friendship !== "BLOCKED" && (
                    <button
                      onClick={handleSendRequest}
                      disabled={isSendingThisOne || isLocallyPendingOut}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cta text-white text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-60 shrink-0"
                    >
                      {isSendingThisOne ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <UserPlus className="w-3.5 h-3.5" />
                      )}
                      Add Friend
                    </button>
                  )}
              </li>
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
