"use client";

import { useEffect } from "react";
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { getStickerPackages, getStickers, type StickersPage } from "@/lib/api/stickers";
import { queryKeys } from "@/lib/query/keys";
import { useAuthStore } from "@/stores/authStore";
import { probeStickers } from "@/lib/utils/stickerProbe";

const PAGE_SIZE = 50;
const PRELOAD_SIZE = 100;

const STALE = 60 * 60 * 1000;  // 1 h
const GC    = 2  * 60 * 60 * 1000; // 2 h

export function useStickerPackages() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: queryKeys.stickers.packages(),
    queryFn: getStickerPackages,
    enabled: isAuthenticated,
    staleTime: STALE,
    gcTime: GC,
  });
}

export function useStickersInfinite(packageId: string | undefined) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.stickers.list(packageId ?? ""), "infinite"],
    queryFn: ({ pageParam = 0 }) =>
      getStickers(packageId!, PAGE_SIZE, pageParam as number),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.items.length, 0);
      return lastPage.hasMore ? loaded : undefined;
    },
    enabled: !!packageId && useAuthStore.getState().isAuthenticated,
    staleTime: STALE,
    gcTime: GC,
  });
}

/**
 * Call once at app Shell level.
 * Prefetches up to 100 stickers per package via the worker thread, then
 * immediately probes ALL loaded URLs so the frameCache is warm before the
 * picker opens. Cache-warm cells render with no skeleton flash.
 */
export function useStickerPreloader() {
  const qc = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data: packages } = useStickerPackages();

  useEffect(() => {
    if (!isAuthenticated || !packages?.length) return;

    const run = async () => {
      for (const pkg of packages) {
        const key = [...queryKeys.stickers.list(pkg.id), "infinite"];

        // Prefetch only if we don't have data yet
        const existing = qc.getQueryData(key);
        if (!existing) {
          await qc.prefetchInfiniteQuery({
            queryKey: key,
            queryFn: () => getStickers(pkg.id, PRELOAD_SIZE, 0),
            initialPageParam: 0,
            staleTime: STALE,
            gcTime: GC,
          });
        }

        // Probe ALL loaded URLs (no-op for already-cached ones)
        const data = qc.getQueryData<InfiniteData<StickersPage>>(key);
        const urls = data?.pages.flatMap((p) => p.items.map((s) => s.url)) ?? [];
        probeStickers(urls);
      }
    };

    run();
  }, [packages, isAuthenticated, qc]);
}
