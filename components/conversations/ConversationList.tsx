"use client";

import { useConversationSearch, useConversations } from "@/hooks/useConversations";
import { useConversationStore } from "@/stores/conversationStore";
import { ConversationItem } from "./ConversationItem";
import { CreateConversationModal } from "./CreateConversationModal";
import { useRouter } from "next/navigation";
import { MessageSquarePlus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { encodeId } from "@/lib/utils/obfuscateId";
import { useAuthStore } from "@/stores/authStore";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

export function ConversationList() {
  const { data: conversations = [], isLoading } = useConversations();
  const activeId = useConversationStore((s) => s.activeConversationId);
  const setActive = useConversationStore((s) => s.setActiveConversation);
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);
  const [createOpen, setCreateOpen] = useState(false);
  const myId = useAuthStore((s) => s.user?.id ?? "");
  const q = debouncedSearchQuery.trim();
  const isSearching = q.length > 0;
  const { data: searchData, isFetching: isSearchFetching } =
    useConversationSearch(q, isSearching);

  const filtered = useMemo(() => {
    if (!isSearching) return conversations;
    const needle = q.toLowerCase();
    const directMatches = conversations.filter((c) => {
      if (c.kind !== "direct") return false;
      const other = c.otherUser ?? c.participants?.find((p) => p.userId !== myId);
      const name = (other as { displayName?: string; username?: string } | undefined)?.displayName
        ?? (other as { username?: string } | undefined)?.username
        ?? "Direct Message";
      return name.toLowerCase().includes(needle);
    });
    const seen = new Set(directMatches.map((c) => c.id));
    const groupMatches = (searchData?.conversations ?? []).filter((c) => {
      if (c.kind === "direct" || seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
    return [...directMatches, ...groupMatches];
  }, [conversations, isSearching, myId, q, searchData?.conversations]);

  const listLoading = isSearching ? isSearchFetching && !searchData : isLoading;

  return (
    <aside className="flex flex-col h-full w-full md:w-80 lg:w-[22rem] bg-surface md:border-r border-border shrink-0 min-h-0">
      {/* Header */}
      <div className="px-4 pt-5 pb-3 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-primary">Messages</h2>
          <button
            onClick={() => setCreateOpen(true)}
            className="w-8 h-8 rounded-lg hover:bg-border/60 flex items-center justify-center text-secondary hover:text-primary transition-colors cursor-pointer"
            title="New conversation"
          >
            <MessageSquarePlus className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none" />
          <input
            type="search"
            placeholder="Search conversations…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm rounded-lg bg-bg border border-border focus:outline-none transition-all placeholder:text-muted"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
        {listLoading &&
          Array.from({ length: 6 }).map((_, i) => (
            <ConversationSkeleton key={i} />
          ))}

        {!listLoading && filtered.length === 0 && (
          <div className="text-center py-12 text-sm text-muted">
            {isSearching ? "No conversations found" : "No conversations yet"}
          </div>
        )}

        {!listLoading &&
          filtered.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              isActive={conv.id === activeId}
              onClick={() => {
                setActive(conv.id);
                router.push(`/conversations/${encodeId(conv.id)}`);
              }}
            />
          ))}
      </div>
      <CreateConversationModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </aside>
  );
}

function ConversationSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl">
      <div className="w-10 h-10 rounded-full bg-border animate-pulse shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3 bg-border animate-pulse rounded w-3/4" />
        <div className="h-2.5 bg-border animate-pulse rounded w-1/2" />
      </div>
    </div>
  );
}
