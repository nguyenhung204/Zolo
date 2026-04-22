import { getPlayInfo, getMediaUrl } from "@/lib/api/media";

/**
 * Module-level cache so the same mediaId is never fetched more than once
 * per session — survives component mount/unmount cycles (react-window).
 */
const _playUrlCache = new Map<string, string>();
const _playInflight = new Map<string, Promise<string | null>>();
const _displayUrlCache = new Map<string, string>();
const _displayInflight = new Map<string, Promise<string | null>>();

export function bustMediaUrlCache(mediaId: string) {
  _playUrlCache.delete(mediaId);
  _playInflight.delete(mediaId);
  for (const key of _displayUrlCache.keys()) {
    if (key.endsWith(`:${mediaId}`)) {
      _displayUrlCache.delete(key);
    }
  }
  for (const key of _displayInflight.keys()) {
    if (key.endsWith(`:${mediaId}`)) {
      _displayInflight.delete(key);
    }
  }
}

/** Resolve a playable URL: try play-info first, fall back to ORIGINAL. */
export function fetchPlayableUrl(
  mediaId: string,
  conversationId?: string
): Promise<string | null> {
  const cached = _playUrlCache.get(mediaId);
  if (cached) return Promise.resolve(cached);

  const existing = _playInflight.get(mediaId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const info = await getPlayInfo(mediaId, conversationId);
      const url = info.url ?? null;
      if (url) _playUrlCache.set(mediaId, url);
      return url;
    } catch {
      try {
        const entity = await getMediaUrl(mediaId, "ORIGINAL", conversationId);
        const url = (entity as unknown as { url?: string }).url ?? null;
        if (url) _playUrlCache.set(mediaId, url);
        return url;
      } catch {
        return null;
      }
    } finally {
      _playInflight.delete(mediaId);
    }
  })();

  _playInflight.set(mediaId, promise);
  return promise;
}

/** Resolve a display URL for images/thumbnails without using play-info. */
export function fetchDisplayUrl(
  mediaId: string,
  conversationId?: string,
  prefer: "ORIGINAL" | "OPTIMIZED" = "OPTIMIZED"
): Promise<string | null> {
  const cacheKey = `${prefer}:${conversationId ?? ""}:${mediaId}`;
  const cached = _displayUrlCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);

  const existing = _displayInflight.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const entity = await getMediaUrl(mediaId, prefer, conversationId);
      const url = (entity as unknown as { url?: string }).url ?? null;
      if (url) _displayUrlCache.set(cacheKey, url);
      return url;
    } catch {
      return null;
    } finally {
      _displayInflight.delete(cacheKey);
    }
  })();

  _displayInflight.set(cacheKey, promise);
  return promise;
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
