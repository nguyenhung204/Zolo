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
