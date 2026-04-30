"use client";

import { useMemo, useState } from "react";
import { X, Search, Send, Hash, Megaphone, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { v4 as uuid } from "uuid";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/presence/UserAvatar";
import { useConversations } from "@/hooks/useConversations";
import { sendMessage } from "@/lib/api/messages";
import { useAuthStore } from "@/stores/authStore";

interface ShareInviteModalProps {
  url: string;
  groupName: string;
  onClose: () => void;
}

/**
 * Picker that forwards an invite link as a plain text message into other
 * conversations. Recipients see the link and the message renderer auto-detects
 * `/join/<token>` URLs to render an inline join card.
 */
export function ShareInviteModal({ url, groupName, onClose }: ShareInviteModalProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const { data: conversations = [] } = useConversations();
  const myId = useAuthStore((s) => s.user?.id ?? "");

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return conversations.filter((c) => {
      if (!q) return true;
      if (c.kind === "direct") {
        const other = c.otherUser ?? c.participants?.find((p) => p.userId !== myId);
        const name =
          (other as { displayName?: string; username?: string } | undefined)?.displayName ??
          (other as { username?: string } | undefined)?.username ??
          "";
        return name.toLowerCase().includes(q);
      }
      return (c.name ?? "").toLowerCase().includes(q);
    });
  }, [conversations, query, myId]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const body = `Join "${groupName}" on Zolo:\n${url}`;

  const handleSend = async () => {
    if (selected.size === 0 || pending) return;
    setPending(true);
    try {
      await Promise.all(
        Array.from(selected).map((conversationId) =>
          sendMessage({
            clientMessageId: uuid(),
            conversationId,
            type: "text",
            content: body,
          }),
        ),
      );
      setDone(true);
      toast.success(
        selected.size === 1
          ? "Invite link shared."
          : `Invite link shared with ${selected.size} chats.`,
      );
      setTimeout(onClose, 800);
    } catch {
      toast.error("Could not share the invite link.");
      setPending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 backdrop-blur-sm px-4 py-8"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div
        className="bg-surface rounded-2xl border border-border shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
        style={{ maxHeight: "80vh" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-base font-semibold text-text">Share invite link</h2>
            <p className="text-xs text-muted mt-0.5 truncate">{groupName}</p>
          </div>
          <button
            onClick={onClose}
            disabled={pending}
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted hover:bg-border/60 cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-border/50 shrink-0">
          <div className="flex items-center gap-2 bg-bg rounded-xl px-3 py-2 border border-border/60 focus-within:border-cta focus-within:ring-2 focus-within:ring-cta/10">
            <Search className="w-4 h-4 text-muted shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats and groups…"
              className="flex-1 bg-transparent text-sm text-text placeholder:text-muted outline-none"
            />
          </div>
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-border/40 shrink-0">
            {Array.from(selected).map((id) => {
              const c = conversations.find((x) => x.id === id);
              if (!c) return null;
              const label =
                c.kind === "direct"
                  ? c.otherUser?.displayName ?? c.otherUser?.username ?? "Direct"
                  : c.name ?? "Group";
              return (
                <button
                  key={id}
                  onClick={() => toggle(id)}
                  className="flex items-center gap-1 bg-cta/10 text-cta text-xs font-medium px-2.5 py-1 rounded-full hover:bg-cta/20 cursor-pointer"
                >
                  {label}
                  <X className="w-3 h-3" />
                </button>
              );
            })}
          </div>
        )}

        <div className="flex-1 overflow-y-auto py-1 min-h-0">
          {filtered.length === 0 ? (
            <p className="text-center text-sm text-muted py-8">No chats found</p>
          ) : (
            filtered.map((c) => {
              const isDirect = c.kind === "direct";
              const other = isDirect
                ? c.otherUser ?? c.participants?.find((p) => p.userId !== myId)
                : null;
              const isSelected = selected.has(c.id);
              const subtitleParts: string[] = [];
              if (isDirect) {
                const u = other as { username?: string } | undefined;
                if (u?.username) subtitleParts.push(`@${u.username}`);
              } else if (c.memberCount) {
                subtitleParts.push(`${c.memberCount} members`);
              }
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggle(c.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-secondary transition cursor-pointer",
                    isSelected && "bg-cta/5",
                  )}
                >
                  {isDirect ? (
                    <UserAvatar
                      userId={(other as { id?: string } | undefined)?.id ?? c.id}
                      name={
                        (other as { displayName?: string } | undefined)?.displayName ??
                        (other as { username?: string } | undefined)?.username ??
                        "?"
                      }
                      avatarUrl={(other as { avatarUrl?: string } | undefined)?.avatarUrl}
                      size="sm"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-cta/10 text-cta flex items-center justify-center shrink-0">
                      {c.kind === "community" ? (
                        <Megaphone className="w-4 h-4" />
                      ) : (
                        <Hash className="w-4 h-4" />
                      )}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text truncate">
                      {isDirect
                        ? (other as { displayName?: string } | undefined)?.displayName ??
                          (other as { username?: string } | undefined)?.username ??
                          "Direct"
                        : c.name ?? "Untitled"}
                    </p>
                    {subtitleParts.length > 0 && (
                      <p className="text-xs text-muted truncate">
                        {subtitleParts.join(" · ")}
                      </p>
                    )}
                  </div>
                  <div
                    className={cn(
                      "w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition",
                      isSelected
                        ? "bg-cta border-cta text-white"
                        : "border-border text-transparent",
                    )}
                  >
                    <Check className="w-3 h-3" />
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-surface-secondary">
          <button
            onClick={onClose}
            disabled={pending}
            className="rounded-lg px-4 py-2 text-sm font-medium text-text hover:bg-border/40 transition cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={selected.size === 0 || pending || done}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold bg-cta text-white hover:bg-cta-hover transition cursor-pointer disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : done ? (
              <Check className="w-4 h-4" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {done ? "Sent" : `Share${selected.size ? ` (${selected.size})` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
