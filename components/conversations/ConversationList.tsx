"use client";

import { useConversations } from "@/hooks/useConversations";
import { useConversationStore } from "@/stores/conversationStore";
import { ConversationItem } from "./ConversationItem";
import { CreateConversationModal } from "./CreateConversationModal";
import { useRouter } from "next/navigation";
import { MessageSquarePlus, Search } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function ConversationList() {
  const { data: conversations = [], isLoading } = useConversations();
  const activeId = useConversationStore((s) => s.activeConversationId);
  const setActive = useConversationStore((s) => s.setActiveConversation);
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = conversations.filter((c) => {
    if (!searchQuery) return true;
    const name =
      c.kind === "DIRECT"
        ? (c.otherUser?.displayName ?? c.otherUser?.username ?? "Direct Message")
        : (c.name ?? "Unnamed");
    return name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <aside className="flex flex-col h-full w-72 bg-surface border-r border-border shrink-0">
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
            className="w-full pl-8 pr-3 py-2 text-sm rounded-lg bg-bg border border-border focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
        {isLoading &&
          Array.from({ length: 6 }).map((_, i) => (
            <ConversationSkeleton key={i} />
          ))}

        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-12 text-sm text-muted">
            {searchQuery ? "No conversations found" : "No conversations yet"}
          </div>
        )}

        {!isLoading &&
          filtered.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              isActive={conv.id === activeId}
              onClick={() => {
                setActive(conv.id);
                router.push(`/conversations/${conv.id}`);
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
