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
    const worker = this.getWorker();

    if (!worker) {
      // SSR or no Worker support — plain fetch fallback
      const qs = new URLSearchParams(params).toString();
      const res = await globalThis.fetch(qs ? `${url}?${qs}` : url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Client-Platform": "web",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }

    return new Promise<unknown>((resolve, reject) => {
      const id = crypto.randomUUID();
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, url, token, params });
    });
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}

// Module-level singleton — one worker for the entire app lifetime
export const stickerFetcher = new StickerFetcherManager();
