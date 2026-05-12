import type { Message } from "@/lib/api/messages";
import { GROUP_GAP_MS } from "../constants";

export interface MessageGrouping {
  isGroupStart: boolean;
  isGroupEnd: boolean;
}

const NON_GROUP_TYPES = new Set(["system", "call_summary"]);

function isGroupable(type: string | undefined): boolean {
  return !NON_GROUP_TYPES.has(type ?? "");
}

function withinGroupGap(earlier: string, later: string): boolean {
  return new Date(later).getTime() - new Date(earlier).getTime() < GROUP_GAP_MS;
}

/** Derive the visual grouping state for a message relative to its neighbors. */
export function getMessageGrouping(
  msg: Message,
  prev: Message | null,
  next: Message | null,
): MessageGrouping {
  const canGroupWithPrev =
    prev !== null &&
    isGroupable(msg.type) &&
    isGroupable(prev.type) &&
    prev.senderId === msg.senderId &&
    withinGroupGap(prev.createdAt, msg.createdAt);

  const canGroupWithNext =
    next !== null &&
    isGroupable(msg.type) &&
    isGroupable(next.type) &&
    next.senderId === msg.senderId &&
    withinGroupGap(msg.createdAt, next.createdAt);

  return { isGroupStart: !canGroupWithPrev, isGroupEnd: !canGroupWithNext };
}
