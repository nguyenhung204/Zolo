/**
 * Singleton Web Worker manager for sticker fetching.
 *
 * Routing API fetches through a Worker thread keeps JSON parsing
 * off the main thread, preventing jank during large payload decoding.
 *
 * Falls back to regular fetch() when Worker is unavailable (SSR / old browsers).
 */

type PendingEntry = {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
};

class StickerFetcherManager {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingEntry>();
  private cache = new Map<string, unknown>();
  private inFlight = new Map<string, Promise<unknown>>();

  private getWorker(): Worker | null {
    if (typeof window === "undefined" || typeof Worker === "undefined") return null;

    if (!this.worker) {
      // Webpack 5 will bundle this as a separate chunk automatically
      this.worker = new Worker(
        new URL("../../workers/stickerFetch.worker.ts", import.meta.url)
      );

      this.worker.onmessage = (
        e: MessageEvent<{ id: string; data?: unknown; error?: string }>
      ) => {
        const { id, data, error } = e.data;
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        if (error) entry.reject(new Error(error));
        else entry.resolve(data);
      };

      this.worker.onerror = (e) => {
        // On unhandled worker error, reject all pending
        for (const [, entry] of this.pending) {
          entry.reject(new Error(e.message ?? "Worker error"));
        }
        this.pending.clear();
        this.worker = null; // allow re-init on next request
      };
    }

    return this.worker;
  }

  async fetch(url: string, token: string, params: Record<string, string>): Promise<unknown> {
    const cacheKey = `${token}::${url}?${new URLSearchParams(params).toString()}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing;

    const worker = this.getWorker();

    if (!worker) {
      // SSR or no Worker support — plain fetch fallback
      const qs = new URLSearchParams(params).toString();
      const request = (async () => {
        const res = await globalThis.fetch(qs ? `${url}?${qs}` : url, {
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Client-Platform": "web",
          },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.cache.set(cacheKey, data);
        return data;
      })();
      this.inFlight.set(cacheKey, request);
      try {
        return await request;
      } finally {
        this.inFlight.delete(cacheKey);
      }
    }

    const request = new Promise<unknown>((resolve, reject) => {
      const id = crypto.randomUUID();
      this.pending.set(id, {
        resolve: (data) => {
          this.cache.set(cacheKey, data);
          resolve(data);
        },
        reject,
      });
      worker.postMessage({ id, url, token, params });
    });

    this.inFlight.set(cacheKey, request);
    try {
      return await request;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
    this.inFlight.clear();
    this.cache.clear();
  }
}

// Module-level singleton — one worker for the entire app lifetime
export const stickerFetcher = new StickerFetcherManager();
