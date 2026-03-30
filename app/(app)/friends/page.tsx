"use client";

import { useState } from "react";
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
import { Search, UserPlus, Check, X, UserMinus } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = "friends" | "requests" | "search";

export default function FriendsPage() {
  const [tab, setTab] = useState<Tab>("friends");
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="border-b border-border px-6 pt-5 pb-0 bg-surface shrink-0">
        <h1 className="text-lg font-bold text-primary mb-4">Friends</h1>
        <div className="flex gap-1">
          {(["friends", "requests", "search"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors cursor-pointer capitalize",
                tab === t
                  ? "border-cta text-cta"
                  : "border-transparent text-muted hover:text-secondary"
              )}
            >
              {t === "requests" ? "Requests" : t === "search" ? "Add People" : "Friends"}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
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
  const { mutate: unfriend } = useUnfriend();

  if (isLoading) return <ListSkeleton />;
  if (friends.length === 0)
    return <EmptyState message="You have no friends yet. Use 'Add People' to connect." />;

  return (
    <ul className="space-y-2">
      {friends.map((f) => (
        <li
          key={f.id}
          className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-border/30 transition"
        >
          <UserAvatar userId={f.friendId} name={f.friendId} size="md" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-text truncate">{f.friendId}</p>
            <p className="text-xs text-muted">Friend</p>
          </div>
          <button
            onClick={() => unfriend(f.friendId)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-error hover:bg-error/10 transition cursor-pointer"
            title="Unfriend"
          >
            <UserMinus className="w-3.5 h-3.5" />
            Unfriend
          </button>
        </li>
      ))}
    </ul>
  );
}

// ─── Incoming Requests ───────────────────────────────────────────────────────

function RequestList() {
  const { data: requests = [], isLoading } = useFriendRequests();
  const { mutate: accept } = useAcceptFriendRequest();
  const { mutate: reject } = useRejectFriendRequest();

  if (isLoading) return <ListSkeleton />;
  if (requests.length === 0)
    return <EmptyState message="No pending friend requests." />;

  return (
    <ul className="space-y-2">
      {requests.map((r) => (
        <li
          key={r.id}
          className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-border/30 transition"
        >
          <UserAvatar userId={r.fromUserId} name={r.fromUserId} size="md" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-text truncate">{r.fromUserId}</p>
            <p className="text-xs text-muted">
              Sent {new Date(r.createdAt).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => accept(r.fromUserId)}
              className="w-8 h-8 rounded-lg bg-success/10 text-success hover:bg-success/20 flex items-center justify-center transition cursor-pointer"
              title="Accept"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={() => reject(r.fromUserId)}
              className="w-8 h-8 rounded-lg bg-error/10 text-error hover:bg-error/20 flex items-center justify-center transition cursor-pointer"
              title="Reject"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Search ───────────────────────────────────────────────────────────────────

function SearchPeople({ query, onQueryChange }: { query: string; onQueryChange: (q: string) => void }) {
  const { data: results = [], isLoading } = useUserSearch(query);
  const { mutate: sendRequest, isPending } = useSendFriendRequest();

  return (
    <div className="space-y-4 max-w-lg">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
        <input
          type="search"
          placeholder="Search by name or email…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-bg text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10 transition placeholder:text-muted"
          autoFocus
        />
      </div>

      {isLoading && <ListSkeleton />}

      {!isLoading && query.trim().length < 2 && (
        <p className="text-sm text-muted text-center py-8">
          Type at least 2 characters to search for people.
        </p>
      )}

      {!isLoading && results.length > 0 && (
        <ul className="space-y-2">
          {results.map((u) => (
            <li
              key={u.id}
              className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-border/30 transition"
            >
              <UserAvatar userId={u.id} name={`${u.firstName} ${u.lastName}`} avatarUrl={u.avatarUrl} size="md" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text truncate">
                  {u.firstName} {u.lastName}
                </p>
                <p className="text-xs text-muted truncate">{u.email}</p>
              </div>
              {u.friendship === "NONE" && (
                <button
                  onClick={() => sendRequest(u.id)}
                  disabled={isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cta text-white text-xs font-semibold hover:opacity-90 transition cursor-pointer disabled:opacity-50"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  Add
                </button>
              )}
              {u.friendship === "PENDING_OUT" && (
                <span className="text-xs text-muted px-3 py-1.5 rounded-lg bg-border/50">Pending</span>
              )}
              {u.friendship === "FRIEND" && (
                <span className="text-xs text-success px-3 py-1.5 rounded-lg bg-success/10">Friends</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {!isLoading && query.trim().length >= 2 && results.length === 0 && (
        <EmptyState message="No users found." />
      )}
    </div>
  );
}

// ─── Shared ───────────────────────────────────────────────────────────────────

function ListSkeleton() {
  return (
    <ul className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="w-10 h-10 rounded-full bg-border animate-pulse shrink-0" />
          <div className="space-y-1.5 flex-1">
            <div className="h-3 bg-border animate-pulse rounded w-1/3" />
            <div className="h-2.5 bg-border animate-pulse rounded w-1/5" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-16 text-center text-sm text-muted">{message}</div>
  );
}
