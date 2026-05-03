"use client";

import type { Message } from "@/lib/api/messages";
import { formatTime } from "@/lib/utils/date";

interface Props {
  message: Message;
}

function buildSystemText(
  action: NonNullable<Message["metadata"]>["action"],
  metadata: Message["metadata"],
): string | null {
  if (!action) return null;

  // Names are pre-populated by message-store — no store lookup needed.
  const actor = metadata?.actorName ?? "Someone";
  const actorId = metadata?.actorId;
  const targetIds = metadata?.targetIds ?? [];
  const targetNames = metadata?.targetNames ?? [];
  const joinSource = metadata?.joinSource;
  const isSelfMemberAdd = targetIds.length === 1 && actorId === targetIds[0];
  const targetList =
    targetNames.length === 0
      ? isSelfMemberAdd
        ? actor
        : "someone"
      : targetNames.length === 1
        ? targetNames[0]
        : targetNames.slice(0, -1).join(", ") + " and " + targetNames[targetNames.length - 1];

  switch (action) {
    case "MEMBER_ADDED":
      if (joinSource === "invite_link") {
        return `${targetList} joined the group via invite link`;
      }
      if (joinSource === "join_request") {
        return `${actor} approved ${targetList} to join the group`;
      }
      if (isSelfMemberAdd) {
        return `${targetList} joined the group via invite link`;
      }
      return `${actor} added ${targetList} to the group`;

    case "MEMBER_LEFT":
      return metadata?.ownershipTransferredTo
        ? `${actor} transferred ownership and left the group`
        : `${actor} left the group`;

    case "MEMBER_REMOVED":
      return `${actor} removed ${targetList} from the group`;

    case "MEMBER_KICKED":
      return `${actor} kicked ${targetList} from the group`;

    case "ROLE_CHANGED": {
      const role = metadata?.newRole ?? "member";
      const roleFmt = role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
      return `${actor} đã bổ nhiệm ${targetList} làm ${roleFmt}`;
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
  const action = message.metadata?.action;
  const text = buildSystemText(action, message.metadata);

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
