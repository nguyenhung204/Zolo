import type { Message } from "@/lib/api/messages";
import type { Poll } from "@/lib/api/group";
import type { ListItem } from "../types";
import { formatDateDivider } from "@/lib/utils/date";

export function isPollExpired(deadline?: string): boolean {
  if (!deadline) return false;
  return new Date(deadline).getTime() < Date.now();
}

export function isActivePoll(poll: Poll): boolean {
  return !poll.isClosed && !isPollExpired(poll.deadline);
}

/**
 * Merges messages and polls into a flat timeline array ready for the virtual
 * list. Only active polls are shown — appended at the bottom so they are
 * always visible on open. Closed/expired polls are hidden entirely.
 */
export function buildItems(messages: Message[], polls: Poll[]): ListItem[] {
  const activePolls = polls.filter(isActivePoll);

  const timeline = messages
    .map((msg) => ({
      kind: "message" as const,
      ts: new Date(msg.createdAt).getTime(),
      dateStr: new Date(msg.createdAt).toDateString(),
      msg,
    }))
    .sort((a, b) => a.ts - b.ts);

  const items: ListItem[] = [{ kind: "padding" }]; // top spacer

  for (let i = 0; i < timeline.length; i++) {
    const item = timeline[i];
    const prev = timeline[i - 1] ?? null;

    if (!prev || prev.dateStr !== item.dateStr) {
      items.push({ kind: "divider", label: formatDateDivider(item.msg.createdAt) });
    }

    const prevMsg = prev?.kind === "message" ? prev.msg : null;
    const next = timeline[i + 1] ?? null;
    const nextMsg = next?.kind === "message" ? next.msg : null;
    items.push({ kind: "message", msg: item.msg, prev: prevMsg, next: nextMsg });
  }

  if (activePolls.length > 0) {
    const sorted = [...activePolls].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    for (const poll of sorted) {
      items.push({ kind: "poll", poll });
    }
  }

  items.push({ kind: "padding" }); // bottom spacer
  return items;
}
