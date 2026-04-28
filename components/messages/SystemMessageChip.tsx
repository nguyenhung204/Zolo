"use client";

import { usePresenceStore } from "@/stores/presenceStore";
import { useAuthStore } from "@/stores/authStore";
import type { Message, SystemMessageAction } from "@/lib/api/messages";
import { formatTime } from "@/lib/utils/date";

interface Props {
  message: Message;
}

function buildSystemText(
  action: SystemMessageAction | undefined,
  metadata: Message["metadata"],
  getName: (id: string) => string
): string | null {
  if (!action) return null;

  const actor = metadata?.actorId ? getName(metadata.actorId) : "Someone";
  const targets = (metadata?.targetIds ?? []).map(getName);
  const targetList =
    targets.length === 0
      ? "someone"
      : targets.length === 1
        ? targets[0]
        : targets.slice(0, -1).join(", ") + " and " + targets[targets.length - 1];

  switch (action) {
    case "MEMBER_ADDED":
      return `${actor} added ${targetList} to the group`;

    case "MEMBER_LEFT":
      return `${actor} left the group`;

    case "MEMBER_REMOVED":
      return `${actor} removed ${targetList} from the group`;

    case "MEMBER_KICKED":
      return `${actor} kicked ${targetList} from the group`;

    case "ROLE_CHANGED": {
      const role = metadata?.newRole ?? "member";
      const roleFmt = role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
      return `${actor} made ${targetList} ${roleFmt}`;
    }

    case "GROUP_INFO_UPDATED": {
      const changes = metadata?.changes;
      const hasName = !!changes?.name;
      const hasAvatar = !!changes?.avatarChanged;
      if (hasName && hasAvatar) return `${actor} updated the group info`;
      if (hasName) return `${actor} renamed the group to "${changes!.name}"`;
      if (hasAvatar) return `${actor} changed the group photo`;
      return `${actor} updated the group`;
    }

    default:
      return null;
  }
}

export function SystemMessageChip({ message }: Props) {
  const myId = useAuthStore((s) => s.user?.id);
  const profileMap = usePresenceStore((s) => s.profileMap);

  const getName = (userId: string): string => {
    if (userId === myId) return "You";
    return profileMap[userId]?.displayName ?? "Someone";
  };

  const action = message.metadata?.action;
  const text = buildSystemText(action, message.metadata, getName);

  if (!text) return null;

  return (
    <div className="flex flex-col items-center gap-0.5 px-6 py-1.5 select-none">
      <span className="text-[11px] text-muted bg-border/40 rounded-full px-3 py-1 text-center leading-relaxed max-w-[90%]">
        {text}
      </span>
      <span className="text-[10px] text-muted/60 tabular-nums">
        {formatTime(message.createdAt)}
      </span>
    </div>
  );
}
