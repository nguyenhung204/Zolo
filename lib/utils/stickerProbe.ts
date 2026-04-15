/**
 * Shared sticker sprite-sheet probing utility.
 *
 * Centralised so both the AnimatedSticker renderer and the StickerPreloader
 * read/write the SAME in-memory cache — when the preloader probes URLs before
 * the picker opens, the React components skip the probe entirely and render
 * immediately with the correct frame count.
 *
 * Cache values:
 *   0   – not yet probed (should not appear after a probe)
 *   1   – single frame (static PNG/WebP or animated WebP — let <img> handle it)
 *   N>1 – horizontal sprite sheet with N frames
 */

export const frameCache = new Map<string, number>();

// Deduplicates concurrent probes for the same URL so only one Image() is created.
const pending = new Map<string, Promise<number>>();

/**
 * Probe a single URL and return the frame count.
 * Subsequent calls for the same URL return the cached/pending result instantly.
 */
export function probeSticker(url: string): Promise<number> {
  const cached = frameCache.get(url);
  if (cached !== undefined) return Promise.resolve(cached);

  const existing = pending.get(url);
  if (existing) return existing;

  const promise = new Promise<number>((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      // width / height ≥ 1.5  →  horizontal sprite sheet
      const frames =
        h > 0 && w / h >= 1.5 ? Math.max(2, Math.round(w / h)) : 1;
      frameCache.set(url, frames);
      pending.delete(url);
      resolve(frames);
    };
    img.onerror = () => {
      // Probe failure ≠ permanently broken: fall back to 1 so StaticSticker
      // gets a chance to render and its own onError shows the error tile.
      frameCache.set(url, 1);
      pending.delete(url);
      resolve(1);
    };
    img.src = url;
  });

  pending.set(url, promise);
  return promise;
}

/**
 * Fire-and-forget batch probe.
 * Call this as soon as sticker data arrives to warm the cache before the
 * virtual grid renders (cache-warm cells skip the skeleton entirely).
 */
export function probeStickers(urls: readonly string[]): void {
  if (typeof window === "undefined") return;
  for (const url of urls) probeSticker(url);
}
