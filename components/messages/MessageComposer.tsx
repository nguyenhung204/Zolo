"use client";

import { ReplyPreview } from "./ReplyPreview";
import { StickerPicker } from "./StickerPicker";
import { useTyping } from "@/hooks/useTyping";
import { useSendMessage } from "@/hooks/useSendMessage";
import { useConversationStore } from "@/stores/conversationStore";
import { useRef, useState, type KeyboardEvent } from "react";
import { Send, Paperclip, X, Smile } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Sticker } from "@/lib/api/stickers";

interface MessageComposerProps {
  conversationId: string;
  disabled?: boolean;
  placeholder?: string;
}

export function MessageComposer({
  conversationId,
  disabled,
  placeholder = "Type a message…",
}: MessageComposerProps) {
  const [text, setText] = useState("");
  const [showStickers, setShowStickers] = useState(false);
  const { send } = useSendMessage();
  const { onKeystroke, stopTyping } = useTyping(conversationId);
  const replyTo = useConversationStore((s) => s.replyToMessage);
  const setReplyTo = useConversationStore((s) => s.setReplyTo);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = text.trim().length > 0 && !disabled;

  const handleInput = (value: string) => {
    setText(value);
    onKeystroke();
    // Auto-resize textarea
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  };

  const handleSend = () => {
    if (!canSend) return;
    send({
      conversationId,
      content: text.trim(),
      type: "text",
      replyToMessageId: replyTo?.messageId,
    });
    setText("");
    stopTyping();
    setReplyTo(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleSendSticker = (sticker: Sticker) => {
    send({
      conversationId,
      content: "",
      type: "sticker",
      metadata: { url: sticker.url },
    });
    setShowStickers(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="relative shrink-0 border-t border-border bg-surface px-4 py-3">
      {/* Reply preview strip */}
      {replyTo && (
        <ReplyPreview
          content={replyTo.content}
          senderName={replyTo.senderId}
          type={replyTo.type}
          onClose={() => setReplyTo(null)}
        />
      )}

      {/* Sticker picker popover */}
      {showStickers && (
        <div className="absolute bottom-[72px] left-4 z-50">
          <StickerPicker onSelect={handleSendSticker} />
        </div>
      )}

      <div className={cn(
        "flex items-end gap-2 rounded-xl border border-border bg-bg px-3 py-2 transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10",
        disabled && "opacity-50"
      )}>
        {/* Attach file */}
        <button
          type="button"
          disabled={disabled}
          className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-muted hover:text-secondary hover:bg-border/50 transition-colors cursor-pointer mb-0.5"
          title="Attach file"
        >
          <Paperclip className="w-4 h-4" />
        </button>

        {/* Sticker */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setShowStickers((v) => !v)}
          className={cn(
            "w-8 h-8 shrink-0 flex items-center justify-center rounded-lg transition-colors cursor-pointer mb-0.5",
            showStickers
              ? "text-primary bg-primary/10"
              : "text-muted hover:text-secondary hover:bg-border/50"
          )}
          title="Stickers"
        >
          <Smile className="w-4 h-4" />
        </button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 min-w-0 resize-none bg-transparent text-sm text-text placeholder:text-muted outline-none leading-relaxed max-h-[200px] overflow-y-auto py-1"
        />

        {/* Send */}
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className={cn(
            "w-8 h-8 shrink-0 flex items-center justify-center rounded-lg transition-all cursor-pointer mb-0.5",
            canSend
              ? "bg-cta text-white hover:opacity-90"
              : "bg-border text-muted cursor-not-allowed"
          )}
          title="Send (Enter)"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      <p className="text-[10px] text-muted mt-1 ml-1">
        <kbd className="font-mono">Enter</kbd> to send · <kbd className="font-mono">Shift+Enter</kbd> for new line
      </p>
    </div>
  );
}
