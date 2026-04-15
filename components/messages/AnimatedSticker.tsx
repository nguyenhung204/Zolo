"use client";

import { useState, useEffect } from "react";
import { frameCache, probeSticker } from "@/lib/utils/stickerProbe";

export interface AnimatedStickerProps {
  url: string;
  size?: number;
  alt?: string;
  /** In the sticker picker, pause animation until hover. In messages, always play. */
  playOnHover?: boolean;
}

// ─── Skeleton ──────────────────────────────────────────────────────────────────
function Skeleton({ size }: { size: number }) {
  return (
    <div
      style={{ width: size, height: size, borderRadius: 8, flexShrink: 0 }}
      className="bg-border/50 animate-pulse"
    />
  );
}

// ─── Error tile ────────────────────────────────────────────────────────────────
function ErrorTile({ size, alt }: { size: number; alt: string }) {
  return (
    <div
      style={{ width: size, height: size, borderRadius: 8, flexShrink: 0 }}
      className="bg-border/30 flex items-center justify-center text-muted"
      title={alt}
    >
      <svg
        viewBox="0 0 24 24"
        style={{ width: size * 0.45, height: size * 0.45 }}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M3 15l5-5 4 4 3-3 6 6" />
      </svg>
    </div>
  );
}

// ─── Static / animated-WebP renderer ──────────────────────────────────────────
// Uses <img> so the browser handles native animated WebP and preserves aspect ratio.
//
// Self-correction: if the rendered image turns out to have a wide aspect ratio
// (probe was wrong or failed), onLoad detects this and calls onSpriteDetected
// so the parent can switch to SpriteSticker. This prevents the "tiny dots" bug
// where a misclassified sprite sheet is squished by objectFit:contain.
function StaticSticker({
  url,
  size,
  alt,
  onSpriteDetected,
}: {
  url: string;
  size: number;
  alt: string;
  onSpriteDetected: (frames: number) => void;
}) {
  const [broken, setBroken] = useState(false);

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    if (h > 0 && w / h >= 1.5) {
      // The image is actually a wide sprite sheet — correct the cache and re-render.
      const frames = Math.max(2, Math.round(w / h));
      frameCache.set(url, frames);
      onSpriteDetected(frames);
    }
  };

  if (broken) return <ErrorTile size={size} alt={alt} />;
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={url}
      alt={alt}
      width={size}
      height={size}
      style={{ objectFit: "contain", flexShrink: 0, display: "block" }}
      draggable={false}
      onLoad={handleLoad}
      onError={() => setBroken(true)}
    />
  );
}

// ─── Sprite-sheet renderer ─────────────────────────────────────────────────────
// CSS background-position stepping for wide horizontal sprite sheets.
function SpriteSticker({
  url,
  size,
  alt,
  frameCount,
  playOnHover,
}: {
  url: string;
  size: number;
  alt: string;
  frameCount: number;
  playOnHover: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const playing = !playOnHover || hovered;

  return (
    <div
      role="img"
      aria-label={alt}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        backgroundImage: `url('${url}')`,
        backgroundSize: `${frameCount * 100}% 100%`,
        backgroundRepeat: "no-repeat",
        // Paused → show last frame (rest pose, avoids blank frame 0).
        backgroundPosition: playing ? "0% 0%" : "100% 0%",
        animation: playing
          ? `play-sticker 0.8s steps(${frameCount - 1}) infinite`
          : "none",
        willChange: playing ? "background-position" : "auto",
      }}
      onMouseEnter={playOnHover ? () => setHovered(true) : undefined}
      onMouseLeave={playOnHover ? () => setHovered(false) : undefined}
    />
  );
}

// ─── Public component ──────────────────────────────────────────────────────────
export function AnimatedSticker({
  url,
  size = 65,
  alt = "sticker",
  playOnHover = false,
}: AnimatedStickerProps) {
  // Read from shared frameCache synchronously — if the preloader has already
  // probed this URL, we skip the skeleton entirely.
  const [frameCount, setFrameCount] = useState<number>(
    () => frameCache.get(url) ?? 0
  );

  useEffect(() => {
    const cached = frameCache.get(url);
    if (cached !== undefined) {
      if (frameCount !== cached) setFrameCount(cached);
      return;
    }
    // probeSticker deduplicates: if the preloader already fired for this URL,
    // we share the same pending Image() and resolve together.
    let active = true;
    probeSticker(url).then((n) => {
      if (active) setFrameCount(n);
    });
    return () => {
      active = false;
    };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  if (frameCount === 0) return <Skeleton size={size} />;

  if (frameCount === 1) {
    return (
      <StaticSticker
        url={url}
        size={size}
        alt={alt}
        onSpriteDetected={(frames) => setFrameCount(frames)}
      />
    );
  }

  return (
    <SpriteSticker
      url={url}
      size={size}
      alt={alt}
      frameCount={frameCount}
      playOnHover={playOnHover}
    />
  );
}

