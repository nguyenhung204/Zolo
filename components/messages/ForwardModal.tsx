"use client";

import { useState, useMemo } from "react";
import { X, Search, Send, Hash, Megaphone, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/presence/UserAvatar";
import { useConversationSearch, useConversations } from "@/hooks/useConversations";
import { forwardMessage } from "@/lib/api/messages";
import { useAuthStore } from "@/stores/authStore";
import type { Message } from "@/lib/api/messages";
import { toast } from "sonner";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { Conversation } from "@/lib/api/conversations";

interface ForwardModalProps {
  message: Message;
  onClose: () => void;
}

export function ForwardModal({ message, onClose }: ForwardModalProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedConversations, setSelectedConversations] = useState<Record<string, Conversation>>({});
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const { data: conversations = [] } = useConversations();
  const debouncedQuery = useDebouncedValue(query, 300);
  const q = debouncedQuery.trim();
  const isSearching = q.length > 0;
  const { data: searchData, isFetching: isSearchFetching } =
    useConversationSearch(q, isSearching);
  const myId = useAuthStore((s) => s.user?.id ?? "");

  const filtered = useMemo(() => {
    if (!isSearching) return conversations;
    const needle = q.toLowerCase();
    const directMatches = conversations.filter((c) => {
      if (c.kind === "direct") {
        const other = c.otherUser ?? c.participants?.find((p) => p.userId !== myId);
        const name = (other as { displayName?: string; username?: string } | undefined)?.displayName
          ?? (other as { username?: string } | undefined)?.username ?? "";
        return name.toLowerCase().includes(needle);
      }
      return false;
    });
    const seen = new Set(directMatches.map((c) => c.id));
    const groupMatches = (searchData?.conversations ?? []).filter((c) => {
      if (c.kind === "direct" || seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
    return [...directMatches, ...groupMatches];
  }, [conversations, isSearching, myId, q, searchData?.conversations]);

  const toggle = (conversation: Conversation) => {
    const next = new Set(selected);
    if (next.has(conversation.id)) {
      next.delete(conversation.id);
      setSelected(next);
      setSelectedConversations((current) => {
        const rest = { ...current };
        delete rest[conversation.id];
        return rest;
      });
      return;
    }
    if (next.size >= 10) {
      toast.warning("You can forward to up to 10 conversations.");
      return;
    }
    next.add(conversation.id);
    setSelected(next);
    setSelectedConversations((current) => ({ ...current, [conversation.id]: conversation }));
  };

  const handleSend = async () => {
    if (selected.size === 0 || loading) return;
    setLoading(true);
    try {
      await forwardMessage({
        sourceMessageId: message.messageId,
        sourceConversationId: message.conversationId,
        targetConversationIds: Array.from(selected),
        includeCaption: true,
      });
      setDone(true);
      toast.success("Message forwarded successfully");
      setTimeout(onClose, 900);
    } catch {
      toast.error("Could not forward the message");
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface rounded-2xl border border-border shadow-2xl w-full max-w-md mx-4 flex flex-col overflow-hidden" style={{ maxHeight: "80vh" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-base font-semibold text-text">Forward message</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-muted hover:bg-border/60 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-border/50 shrink-0">
          <div className="flex items-center gap-2 bg-bg rounded-xl px-3 py-2 border border-border/60 focus-within:border-cta focus-within:ring-2 focus-within:ring-cta/10">
            <Search className="w-4 h-4 text-muted shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations…"
              className="flex-1 bg-transparent text-sm text-text placeholder:text-muted outline-none"
            />
          </div>
        </div>

        {/* Selected chips */}
        {selected.size > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-border/40 shrink-0">
            {Array.from(selected).map((id) => {
              const c = selectedConversations[id] ?? conversations.find((x) => x.id === id);
              if (!c) return null;
              const label = c.kind === "direct"
                ? (c.otherUser?.displayName ?? c.otherUser?.username ?? "Direct")
                : (c.name ?? "Group");
              return (
                <button key={id} onClick={() => toggle(c)}
                  className="flex items-center gap-1 bg-cta/10 text-cta text-xs font-medium px-2.5 py-1 rounded-full hover:bg-cta/20 cursor-pointer">
                  {label}
                  <X className="w-3 h-3" />
                </button>
              );
            })}
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto py-1 min-h-0">
          {isSearching && isSearchFetching && !searchData ? (
            <p className="text-center text-sm text-muted py-8">Searching…</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-muted py-8">No conversations found</p>
          ) : (
            filtered.map((c) => {
              const isDirect = c.kind === "direct";
              const other = isDirect
                ? (c.otherUser ?? c.participants?.find((p) => p.userId !== myId))
                : null;
              const name = isDirect
                ? ((other as { displayName?: string } | null | undefined)?.displayName ?? (other as { username?: string } | null | undefined)?.username ?? "Direct")
                : (c.name ?? "Unnamed");
              const avatarUrl = isDirect
                ? (other as { avatarUrl?: string | null } | null | undefined)?.avatarUrl ?? undefined
                : c.avatarUrl ?? undefined;
              const userId = isDirect
                ? (other as { id?: string; userId?: string } | null | undefined)?.id
                  ?? (other as { userId?: string } | null | undefined)?.userId ?? c.id
                : c.id;

              const isSelected = selected.has(c.id);

              return (
                <button key={c.id} onClick={() => toggle(c)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left cursor-pointer",
                    isSelected ? "bg-cta/8" : "hover:bg-border/40"
                  )}>
                  {isDirect ? (
                    <UserAvatar userId={userId} name={name} avatarUrl={avatarUrl} size="sm" showPresence={false} />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-cta/10 flex items-center justify-center shrink-0">
                      {c.kind === "community"
                        ? <Megaphone className="w-4 h-4 text-cta" />
                        : <Hash className="w-4 h-4 text-cta" />}
                    </div>
                  )}
                  <span className="flex-1 text-sm text-text truncate">{name}</span>
                  <div className={cn(
                    "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                    isSelected ? "border-cta bg-cta text-white" : "border-border"
                  )}>
                    {isSelected && <Check className="w-3 h-3" />}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border shrink-0 flex items-center justify-between gap-3">
          <span className="text-xs text-muted">
            {selected.size > 0 ? `${selected.size} conversations selected` : "Choose recipients"}
          </span>
          <button
            onClick={handleSend}
            disabled={selected.size === 0 || loading}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer",
              selected.size > 0 && !loading && !done
                ? "bg-cta text-white hover:opacity-90"
                : done
                  ? "bg-success/20 text-success"
                  : "bg-border text-muted cursor-not-allowed"
            )}
          >
            {done ? (
              <><Check className="w-4 h-4" /> Sent</>
            ) : loading ? (
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <><Send className="w-4 h-4" /> Send</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
