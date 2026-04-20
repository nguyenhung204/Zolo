import { getPlayInfo, getMediaUrl } from "@/lib/api/media";

/** Resolve a playable URL: try play-info first, fall back to ORIGINAL. */
export async function fetchPlayableUrl(
  mediaId: string,
  conversationId?: string
): Promise<string | null> {
  try {
    const info = await getPlayInfo(mediaId, conversationId);
    return info.url ?? null;
  } catch {
    try {
      const entity = await getMediaUrl(mediaId, "ORIGINAL", conversationId);
      return (entity as unknown as { url?: string }).url ?? null;
    } catch {
      return null;
    }
  }
}

/** Blob-based download — forces browser to save file instead of opening a new tab. */
export async function blobDownload(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function normalizeMediaTime(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

export function formatVoiceDuration(s: number): string {
  if (!s || !Number.isFinite(s)) return "0:00";
  const sec = Math.floor(s);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export function fmtTime(s: number): string {
  if (!s || !Number.isFinite(s)) return "0:00";
  const sec = Math.floor(s);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}
