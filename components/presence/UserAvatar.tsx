"use client";

import { usePresenceStore } from "@/stores/presenceStore";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  showPresence?: boolean;
}

const sizeMap = {
  xs: { avatar: "w-6 h-6 text-[10px]", dot: "w-2 h-2 border", offset: "-bottom-0.5 -right-0.5" },
  sm: { avatar: "w-8 h-8 text-xs", dot: "w-2.5 h-2.5 border", offset: "-bottom-0.5 -right-0.5" },
  md: { avatar: "w-10 h-10 text-sm", dot: "w-3 h-3 border-2", offset: "-bottom-0.5 -right-0.5" },
  lg: { avatar: "w-12 h-12 text-base", dot: "w-3.5 h-3.5 border-2", offset: "bottom-0 right-0" },
};

export function UserAvatar({
  userId,
  name,
  avatarUrl,
  size = "md",
  showPresence = true,
}: UserAvatarProps) {
  const status = usePresenceStore((s) => s.presenceMap[userId] ?? "offline");
  const { avatar, dot, offset } = sizeMap[size];

  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="relative inline-flex shrink-0">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt={name}
          className={cn("rounded-full object-cover bg-border", avatar)}
        />
      ) : (
        <div
          className={cn(
            "rounded-full bg-secondary/20 flex items-center justify-center font-semibold text-secondary select-none",
            avatar
          )}
        >
          {initials}
        </div>
      )}

      {showPresence && (
        <span
          className={cn(
            "absolute rounded-full border-white",
            dot,
            offset,
            status === "online" ? "bg-online" : "bg-offline"
          )}
        />
      )}
    </div>
  );
}
