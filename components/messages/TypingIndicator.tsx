"use client";

import { useTypingStore } from "@/stores/typingStore";
import { useAuthStore } from "@/stores/authStore";

interface TypingIndicatorProps {
  conversationId: string;
  /** Map of userId → display name, used to show names */
  memberNames: Record<string, string>;
}

export function TypingIndicator({ conversationId, memberNames }: TypingIndicatorProps) {
  const myUserId = useAuthStore((s) => s.user?.id ?? "");
  const typingSet = useTypingStore((s) => s.typingMap[conversationId]);

  const typingUsers = [...(typingSet ?? [])].filter((id) => id !== myUserId);

  if (typingUsers.length === 0) return null;

  const names = typingUsers
    .map((id) => memberNames[id] ?? "Someone")
    .slice(0, 3);

  const label =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
      ? `${names[0]} and ${names[1]} are typing`
      : `${names[0]}, ${names[1]} and ${typingUsers.length - 2} more are typing`;

  return (
    <div className="flex items-center gap-2 px-5 py-1.5 text-xs text-muted select-none">
      <Dots />
      <span>{label}</span>
    </div>
  );
}

function Dots() {
  return (
    <span className="flex items-end gap-0.5 h-3.5">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="w-1 h-1 rounded-full bg-muted animate-bounce"
          style={{ animationDelay: `${delay}ms`, animationDuration: "900ms" }}
        />
      ))}
    </span>
  );
}
