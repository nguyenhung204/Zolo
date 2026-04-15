import { apiClient } from "@/lib/api/client";
import { stickerFetcher } from "@/lib/workers/stickerFetcher";
import { useAuthStore } from "@/stores/authStore";

const API_BASE_URL =
  (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");

export interface StickerPackage {
  id: string;
  name: string;
  thumbnailUrl: string;
  isFree: boolean;
  createdAt: string;
}

export interface Sticker {
  id: string;
  url: string;
}

function extractArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    // { data: { items: [...] } }
    if (r.data && typeof r.data === "object") {
      const d = r.data as Record<string, unknown>;
      if (Array.isArray(d.items)) return d.items;
      if (Array.isArray(d.data)) return d.data;
    }
    // { data: [...] }
    if (Array.isArray(r.data)) return r.data;
    // { items: [...] }
    if (Array.isArray(r.items)) return r.items;
  }
  return [];
}

export interface StickersPage {
  items: Sticker[];
  hasMore: boolean;
}

function extractStickersPage(raw: unknown, limit: number, offset: number): StickersPage {
  if (Array.isArray(raw)) {
    return { items: raw as Sticker[], hasMore: raw.length === limit };
  }
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (r.data && typeof r.data === "object") {
      const d = r.data as Record<string, unknown>;
      if (Array.isArray(d.items)) {
        const total = typeof d.total === "number" ? d.total : null;
        const items = d.items as Sticker[];
        const hasMore = total !== null ? offset + items.length < total : items.length === limit;
        return { items, hasMore };
      }
    }
    if (Array.isArray(r.data)) {
      const items = r.data as Sticker[];
      return { items, hasMore: items.length === limit };
    }
  }
  return { items: [], hasMore: false };
}

export async function getStickerPackages(): Promise<StickerPackage[]> {
  const res = await apiClient.get("/stickers/packages");
  return extractArray(res.data) as StickerPackage[];
}

/**
 * Fetch stickers via the Web Worker thread so JSON parsing stays off the main thread.
 */
export async function getStickers(
  packageId: string,
  limit = 50,
  offset = 0
): Promise<StickersPage> {
  const token = useAuthStore.getState().token ?? "";
  const url = `${API_BASE_URL}/stickers/packages/${encodeURIComponent(packageId)}/stickers`;
  const raw = await stickerFetcher.fetch(url, token, {
    limit: String(limit),
    offset: String(offset),
  });
  return extractStickersPage(raw, limit, offset);
}
