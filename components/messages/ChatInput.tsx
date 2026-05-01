"use client";

import { useState, useRef, useCallback, type KeyboardEvent } from "react";
import { Send, Loader2, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { useConversation, useMyConversationRole } from "@/hooks/useConversations";
import { hasMinRole } from "@/lib/api/group";
import { apiClient } from "@/lib/api/client";
import type { ApiError } from "@/lib/api/errors";

// ─── Props ────────────────────────────────────────────────────────────────────

interface ChatInputProps {
  conversationId: string;
  /** Called after a message is successfully sent (e.g. to scroll to bottom). */
  onMessageSent?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Role-aware chat input.
 *
 * Implements Section 4.3 & 4.5 guardrails from FE_INTEGRATION_GUIDE.md:
 *
 * 1. PROACTIVE DISABLE — reads `conversation.allowMemberMessage` and the
 *    current user's role from cache. If the user is a plain member in a group
 *    where only admins can post, the textarea and send button are disabled
 *    before any server round-trip occurs. This covers the common path.
 *
 * 2. DEFENSIVE 403 HANDLING — the `allowMemberMessage` flag can change while
 *    the user has the page open (a `group.settings_updated` socket event
 *    updates the cache, but there is a race window). If the send API returns
 *    403 the input rolls back, the error is surfaced, and any optimistic
 *    message is discarded.
 *
 */
export function ChatInput({ conversationId, onMessageSent }: ChatInputProps) {
  const myId = useAuthStore((s) => s.user?.id);
  const { data: conversation } = useConversation(conversationId);
  const myRole = useMyConversationRole(conversationId);

  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Permission check (§4.3) ────────────────────────────────────────────────
  // For non-group conversations the flag is undefined → treat as allowed.
  const allowMemberMessage = conversation?.allowMemberMessage ?? true;
  const canInteract =
    allowMemberMessage || hasMinRole(myRole ?? "member", "admin");

  const isDisabled = !canInteract || isSending || !conversation;

  // ── Send handler ───────────────────────────────────────────────────────────
  const send = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || isDisabled || !myId) return;

    setIsSending(true);
    try {
      await apiClient.post(`/conversations/${conversationId}/messages`, {
        content: trimmed,
        type: "text",
      });
      setText("");
      textareaRef.current?.focus();
      onMessageSent?.();
    } catch (err) {
      const apiErr = err as ApiError;
      // Defensive 403 guard: the settings may have changed mid-session between
      // the proactive check and the API call. Show a clear, non-disruptive error.
      if (apiErr.status === 403) {
        toast.error("Only admins can post in this group.", { id: "group-send-403" });
      } else {
        toast.error(apiErr.message ?? "Failed to send message.");
      }
    } finally {
      setIsSending(false);
    }
  }, [text, isDisabled, myId, conversationId, onMessageSent]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-1">
      {/* Guardrail banner — visible when the user lacks posting permission */}
      {!canInteract && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/10 border border-border text-xs text-muted">
          <ShieldOff className="w-3.5 h-3.5 flex-shrink-0 text-muted" />
          <span>Only admins can post in this group.</span>
        </div>
      )}

      {/* Input row */}
      <div
        className={cn(
          "flex items-end gap-2 rounded-xl border px-3 py-2 transition-colors",
          isDisabled
            ? "border-border bg-surface-secondary opacity-60 cursor-not-allowed"
            : "border-border bg-surface focus-within:border-cta/50",
        )}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isDisabled}
          rows={1}
          placeholder={
            canInteract
              ? "Type a message…"
              : "Messaging is restricted in this group."
          }
          aria-disabled={isDisabled}
          className={cn(
            "flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted",
            "focus:outline-none max-h-32 leading-relaxed",
            "disabled:cursor-not-allowed",
          )}
        />

        <button
          onClick={send}
          disabled={isDisabled || !text.trim()}
          aria-label="Send message"
          className={cn(
            "flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isDisabled || !text.trim()
              ? "text-muted cursor-not-allowed"
              : "text-cta hover:bg-cta/10 cursor-pointer",
          )}
        >
          {isSending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}
