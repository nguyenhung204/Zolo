import type { ListItem } from "../types";
import { GROUP_GAP_MS } from "../constants";
import { isActivePoll } from "./buildItems";

/**
 * Returns the index of the last item that should be visible at the bottom of
 * the list. Active polls are preferred over the trailing padding row.
 */
export function getBottomTargetIndex(items: ListItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.kind === "poll" && isActivePoll(item.poll)) return i;
  }
  return Math.max(0, items.length - 1);
}

/**
 * Estimates the rendered height of a list item before it has been measured.
 * Used during the first jump-to-message pass to pre-position the scroll
 * container without waiting for react-window to measure every row.
 */
export function estimateRowHeight(item: ListItem | undefined): number {
  if (!item) return 56;
  if (item.kind === "padding") return 16;
  if (item.kind === "divider") return 36;
  if (item.kind === "poll") return 260;
  if (item.kind === "message") {
    const { msg, prev } = item;
    if (msg.type === "system") return 36;
    if (msg.type === "call_summary") return 64;
    if (msg.type === "contact_card") return 240;
    const isGroupStart =
      !prev ||
      prev.senderId !== msg.senderId ||
      prev.type === "system" ||
      prev.type === "call_summary" ||
      new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() >= GROUP_GAP_MS;
    return isGroupStart ? 64 : 40;
  }
  return 56;
}
