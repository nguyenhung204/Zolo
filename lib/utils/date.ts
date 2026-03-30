/**
 * Lightweight date formatter — avoids the full date-fns bundle.
 * Returns strings like "2m", "1h", "3d", "Jan 5"
 */
export function formatDistanceToNowStrict(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diff = Math.max(0, now - then);

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "now";

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days}d`;

  return new Date(isoString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Returns HH:mm — e.g. "09:41" */
export function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Returns "Today", "Yesterday", or "Mon, Jan 5" */
export function formatDateDivider(isoString: string): string {
  const now = new Date();
  const d = new Date(isoString);
  const diffDays = Math.floor(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86_400_000
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
