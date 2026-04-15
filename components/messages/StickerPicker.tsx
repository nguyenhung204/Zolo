"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { Grid, type CellComponentProps } from "react-window";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStickerPackages, useStickersInfinite } from "@/hooks/useStickers";
import { AnimatedSticker } from "@/components/messages/AnimatedSticker";
import type { Sticker, StickerPackage } from "@/lib/api/stickers";
import { useMemo } from "react";

const COLS = 4;
const CELL_SIZE = 90;
const GRID_WIDTH = COLS * CELL_SIZE;  // 360px
const GRID_HEIGHT = 300;

type StickerCellProps = {
  stickers: Sticker[];
  onSelect: (s: Sticker) => void;
};

function StickerCell({
  columnIndex,
  rowIndex,
  style,
  stickers,
  onSelect,
}: CellComponentProps<StickerCellProps>) {
  const index = rowIndex * COLS + columnIndex;
  const sticker = stickers[index];
  if (!sticker) return <div style={style} />;
  return (
    <div style={style} className="flex items-center justify-center">
      <button
        type="button"
        onClick={() => onSelect(sticker)}
        className="flex items-center justify-center rounded-lg hover:bg-border/60 transition-colors cursor-pointer"
        style={{ width: 65, height: 65 }}
        title={sticker.id}
      >
        <AnimatedSticker url={sticker.url} size={65} alt={sticker.id} playOnHover />
      </button>
    </div>
  );
}

// ─── Skeleton grid shown while first page loads ───────────────────────────────
const SKELETON_COUNT = COLS * Math.ceil(GRID_HEIGHT / CELL_SIZE);

function StickerSkeleton() {
  return (
    <div
      style={{
        width: GRID_WIDTH,
        height: GRID_HEIGHT,
        display: "grid",
        gridTemplateColumns: `repeat(${COLS}, ${CELL_SIZE}px)`,
        overflow: "hidden",
      }}
    >
      {Array.from({ length: SKELETON_COUNT }, (_, i) => (
        <div key={i} className="flex items-center justify-center" style={{ width: CELL_SIZE, height: CELL_SIZE }}>
          <div className="rounded-xl bg-border/50 animate-pulse" style={{ width: 65, height: 65 }} />
        </div>
      ))}
    </div>
  );
}

function PackageGrid({
  packageId,
  onSelect,
}: {
  packageId: string;
  onSelect: (s: Sticker) => void;
}) {
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } =
    useStickersInfinite(packageId);

  const stickers = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data]
  );

  const rowCount = Math.ceil(stickers.length / COLS) + (hasNextPage ? 1 : 0);

  if (isLoading) {
    return <StickerSkeleton />;
  }

  if (stickers.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-muted"
        style={{ width: GRID_WIDTH, height: GRID_HEIGHT }}
      >
        No stickers
      </div>
    );
  }

  return (
    <div style={{ width: GRID_WIDTH, height: GRID_HEIGHT }}>
      <Grid<StickerCellProps>
        columnCount={COLS}
        columnWidth={CELL_SIZE}
        rowCount={rowCount}
        rowHeight={CELL_SIZE}
        defaultWidth={GRID_WIDTH}
        defaultHeight={GRID_HEIGHT}
        cellComponent={StickerCell}
        cellProps={{ stickers, onSelect }}
        onCellsRendered={(_visible, all) => {
          if (!hasNextPage || isFetchingNextPage) return;
          // Prefetch next page when 70% of current rows are rendered
          const totalRows = Math.ceil(stickers.length / COLS);
          const threshold = Math.floor(totalRows * 0.7);
          if (all.rowStopIndex >= threshold) {
            fetchNextPage();
          }
        }}
      >
        {/* Subtle loading bar at the bottom while fetching next page */}
        {isFetchingNextPage && (
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 2,
              background: "var(--color-primary)",
              opacity: 0.4,
            }}
            className="animate-pulse"
          />
        )}
      </Grid>
    </div>
  );
}

interface StickerPickerProps {
  onSelect: (sticker: Sticker) => void;
}

export function StickerPicker({ onSelect }: StickerPickerProps) {
  const { data: packages, isLoading } = useStickerPackages();

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-border bg-surface shadow-lg"
        style={{ width: GRID_WIDTH + 2, height: GRID_HEIGHT + 60 }}
      >
        <Loader2 className="w-5 h-5 animate-spin text-muted" />
      </div>
    );
  }

  if (!packages || packages.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-border bg-surface shadow-lg text-sm text-muted"
        style={{ width: GRID_WIDTH + 2, height: GRID_HEIGHT + 60 }}
      >
        No sticker packs available
      </div>
    );
  }

  return (
    <Tabs.Root
      defaultValue={packages[0].id}
      className="flex flex-col rounded-xl border border-border bg-surface shadow-lg overflow-hidden"
      style={{ width: GRID_WIDTH + 2 }}
    >
      <Tabs.List className="flex border-b border-border bg-bg shrink-0">
        {packages.map((pkg: StickerPackage) => (
          <Tabs.Trigger
            key={pkg.id}
            value={pkg.id}
            className={cn(
              "flex-1 py-2.5 px-1 text-[11px] font-medium text-muted transition-colors cursor-pointer outline-none truncate",
              "hover:text-text hover:bg-border/30",
              "data-[state=active]:text-primary data-[state=active]:shadow-[inset_0_-2px_0] data-[state=active]:shadow-primary"
            )}
          >
            {pkg.name}
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      {packages.map((pkg: StickerPackage) => (
        <Tabs.Content key={pkg.id} value={pkg.id} className="outline-none">
          <PackageGrid packageId={pkg.id} onSelect={onSelect} />
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
