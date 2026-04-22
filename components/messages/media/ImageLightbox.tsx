"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  RotateCcw, RotateCw, ZoomIn, ZoomOut, Crop, Download, X as XIcon, Loader2, Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getMediaUrl } from "@/lib/api/media";
import { blobDownload } from "./shared";
import { toast } from "sonner";

interface Props {
  src: string;
  mediaId?: string;
  conversationId?: string;
  filename?: string;
  onClose: () => void;
}

// ── Filename helper ────────────────────────────────────────────────────────────

function buildFilename(raw: string | undefined, suffix: string): string {
  const name = raw?.trim() || "image";
  const lastDot = name.lastIndexOf(".");
  const base = lastDot > 0 ? name.slice(0, lastDot) : name;
  const ext = lastDot > 0 ? name.slice(lastDot + 1) : "jpg";
  if (!suffix) return `${base}.${ext}`;
  return `${base}-${suffix}.png`;
}

// ── Canvas helpers ─────────────────────────────────────────────────────────────

/** Fetch URL as a blob-backed Image to avoid canvas CORS taint. */
async function fetchAsImage(url: string): Promise<{ img: HTMLImageElement; revoke: () => void }> {
  const res = await fetch(url);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ img, revoke: () => URL.revokeObjectURL(blobUrl) });
    img.onerror = () => { URL.revokeObjectURL(blobUrl); reject(new Error("load failed")); };
    img.src = blobUrl;
  });
}

/** Render image with rotation baked in at natural resolution. */
function buildRotatedCanvas(img: HTMLImageElement, rotation: number): HTMLCanvasElement {
  const nW = img.naturalWidth;
  const nH = img.naturalHeight;
  const norm = ((rotation % 360) + 360) % 360;
  const swapped = norm === 90 || norm === 270;
  const outW = swapped ? nH : nW;
  const outH = swapped ? nW : nH;
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, -nW / 2, -nH / 2, nW, nH);
  return canvas;
}

/**
 * Crop from a rotated canvas using cropRect coordinates relative to the
 * image container div. Uses getBoundingClientRect of the displayed img
 * element (which accounts for CSS transform) for accurate mapping.
 */
function buildCropCanvas(
  rotated: HTMLCanvasElement,
  cropRect: { x: number; y: number; w: number; h: number },
  imgEl: HTMLImageElement,
  containerEl: HTMLDivElement,
): HTMLCanvasElement | null {
  const rW = rotated.width;
  const rH = rotated.height;
  const cb = containerEl.getBoundingClientRect();
  const ib = imgEl.getBoundingClientRect();
  // Scale: rotated natural px per screen px
  const sx = rW / ib.width;
  const sy = rH / ib.height;
  // Offset: img top-left relative to container
  const imgLeft = ib.left - cb.left;
  const imgTop = ib.top - cb.top;
  const cx = Math.max(0, Math.round((cropRect.x - imgLeft) * sx));
  const cy = Math.max(0, Math.round((cropRect.y - imgTop) * sy));
  const cw = Math.min(rW - cx, Math.round(cropRect.w * sx));
  const ch = Math.min(rH - cy, Math.round(cropRect.h * sy));
  if (cw <= 1 || ch <= 1) return null;
  const out = document.createElement("canvas");
  out.width = cw;
  out.height = ch;
  out.getContext("2d")!.drawImage(rotated, cx, cy, cw, ch, 0, 0, cw, ch);
  return out;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob null"))), "image/png")
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ImageLightbox({ src, mediaId, conversationId, filename, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [isCropping, setIsCropping] = useState(false);
  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(null);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [cropPreviewUrl, setCropPreviewUrl] = useState<string | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [displaySrc, setDisplaySrc] = useState(src);
  const imgElRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); return () => setMounted(false); }, []);

  // Load ORIGINAL quality
  useEffect(() => {
    if (!mediaId) return;
    getMediaUrl(mediaId, "ORIGINAL", conversationId)
      .then((entity) => {
        const url = (entity as unknown as { url?: string }).url;
        if (url) setDisplaySrc(url);
      })
      .catch(() => {});
  }, [mediaId, conversationId]);

  // Revoke crop preview blob URL when it changes or component unmounts
  useEffect(() => {
    return () => { if (cropPreviewUrl) URL.revokeObjectURL(cropPreviewUrl); };
  }, [cropPreviewUrl]);

  // Escape: step out of states one at a time
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (cropPreviewUrl) { setCropPreviewUrl(null); setCropRect(null); }
      else if (isCropping) { setIsCropping(false); setCropRect(null); }
      else { onClose(); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, cropPreviewUrl, isCropping]);

  const clearCrop = useCallback(() => {
    setCropPreviewUrl(null);
    setCropRect(null);
  }, []);

  // ── Generate crop preview ──────────────────────────────────────────────────
  const generatePreview = useCallback(async () => {
    if (!cropRect || !imgElRef.current || !containerRef.current) return;
    if (!imgElRef.current.complete) { toast.error("The image is still loading."); return; }
    setIsGeneratingPreview(true);
    try {
      const { img, revoke } = await fetchAsImage(displaySrc);
      try {
        const rotated = buildRotatedCanvas(img, rotation);
        const cropped = buildCropCanvas(rotated, cropRect, imgElRef.current, containerRef.current);
        if (!cropped) { toast.error("Invalid crop area."); return; }
        const blob = await canvasToBlob(cropped);
        setCropPreviewUrl(URL.createObjectURL(blob));
      } finally {
        revoke();
      }
    } catch {
      toast.error("Could not generate the preview.");
    } finally {
      setIsGeneratingPreview(false);
    }
  }, [cropRect, displaySrc, rotation]);

  // ── Download original (with rotation baked in if needed) ──────────────────
  const handleDownloadOriginal = useCallback(async () => {
    setIsDownloading(true);
    try {
      if (rotation === 0) {
        await blobDownload(displaySrc, buildFilename(filename, ""));
      } else {
        const { img, revoke } = await fetchAsImage(displaySrc);
        try {
          const rotated = buildRotatedCanvas(img, rotation);
          const blob = await canvasToBlob(rotated);
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = buildFilename(filename, "rotated");
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
        } finally {
          revoke();
        }
      }
    } catch {
      toast.error("Could not download the image.");
    } finally {
      setIsDownloading(false);
    }
  }, [displaySrc, rotation]);

  // ── Download crop ──────────────────────────────────────────────────────────
  const handleDownloadCrop = useCallback(() => {
    if (!cropPreviewUrl) return;
    const a = document.createElement("a");
    a.href = cropPreviewUrl;
    a.download = buildFilename(filename, "cropped");
    a.click();
  }, [cropPreviewUrl, filename]);

  // ── Pointer events for crop selection ─────────────────────────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isCropping || cropPreviewUrl) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setCropStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setCropRect(null);
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }, [isCropping, cropPreviewUrl]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isCropping || !cropStart || cropPreviewUrl) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x2 = e.clientX - rect.left;
    const y2 = e.clientY - rect.top;
    const x = Math.min(cropStart.x, x2);
    const y = Math.min(cropStart.y, y2);
    const w = Math.abs(x2 - cropStart.x);
    const h = Math.abs(y2 - cropStart.y);
    if (w > 4 && h > 4) setCropRect({ x, y, w, h });
  }, [isCropping, cropStart, cropPreviewUrl]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/92 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex flex-col bg-black rounded-2xl overflow-hidden shadow-2xl"
        style={{ width: "80vw", height: "80vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Toolbar ── */}
        <div className="flex items-center justify-between px-4 py-3 shrink-0 border-b border-white/10">
          {cropPreviewUrl ? (
            // Crop review mode
            <>  
              <span className="text-white/60 text-sm select-none">Crop preview</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={clearCrop}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm transition-colors cursor-pointer"
                >
                  <Undo2 className="w-4 h-4" />
                  <span>Back</span>
                </button>
                <button
                  onClick={handleDownloadCrop}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cta hover:bg-cta/90 text-white text-sm font-medium transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Download cropped</span>
                </button>
                <button onClick={onClose} className="w-9 h-9 rounded-lg flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer" title="Close">
                  <XIcon className="w-5 h-5" />
                </button>
              </div>
            </>
          ) : (
            // Normal / crop-draw mode
            <>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setRotation((r) => r - 90)} className="w-9 h-9 rounded-lg flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer" title="Rotate left">
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button onClick={() => setRotation((r) => r + 90)} className="w-9 h-9 rounded-lg flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer" title="Rotate right">
                  <RotateCw className="w-4 h-4" />
                </button>
                <button onClick={() => setZoom((z) => Math.min(z + 0.25, 3))} className="w-9 h-9 rounded-lg flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer" title="Zoom in">
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button onClick={() => setZoom((z) => Math.max(z - 0.25, 0.25))} className="w-9 h-9 rounded-lg flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer" title="Zoom out">
                  <ZoomOut className="w-4 h-4" />
                </button>
                <div className="w-px h-5 bg-white/20 mx-0.5" />
                <button
                  onClick={() => { setIsCropping((c) => !c); clearCrop(); }}
                  className={cn("w-9 h-9 rounded-lg flex items-center justify-center transition-colors cursor-pointer", isCropping ? "bg-cta text-white" : "text-white/70 hover:text-white hover:bg-white/10")}
                  title="Crop"
                >
                  <Crop className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                {isCropping && cropRect && (
                  <button
                    onClick={generatePreview}
                    disabled={isGeneratingPreview}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-sm transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isGeneratingPreview
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Crop className="w-3.5 h-3.5" />}
                    <span>Preview crop</span>
                  </button>
                )}
                <button
                  onClick={handleDownloadOriginal}
                  disabled={isDownloading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  <span className="hidden sm:inline">
                    {rotation !== 0 ? "Download (rotated)" : "Download"}
                  </span>
                </button>
                <button onClick={onClose} className="w-9 h-9 rounded-lg flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer" title="Close (Esc)">
                  <XIcon className="w-5 h-5" />
                </button>
              </div>
            </>
          )}
        </div>

        {/* ── Image area ── */}
        {cropPreviewUrl ? (
          <div className="flex-1 flex items-center justify-center bg-[#111] overflow-hidden">
            <img
              src={cropPreviewUrl}
              alt="Xem trước vùng cắt"
              className="object-contain select-none"
              style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto" }}
              draggable={false}
            />
          </div>
        ) : (
          <div
            ref={containerRef}
            className={cn(
              "flex-1 flex items-center justify-center overflow-hidden relative",
              isCropping ? "cursor-crosshair" : "cursor-default"
            )}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={() => setCropStart(null)}
          >
            <img
              ref={imgElRef}
              src={displaySrc}
              alt=""
              className="object-contain select-none pointer-events-none"
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                width: "auto",
                height: "auto",
                transform: `rotate(${rotation}deg) scale(${zoom})`,
                transition: "transform 0.2s ease",
              }}
              draggable={false}
            />
            {isCropping && cropRect && (
              <div
                className="absolute pointer-events-none"
                style={{
                  left: cropRect.x,
                  top: cropRect.y,
                  width: cropRect.w,
                  height: cropRect.h,
                  border: "2px solid white",
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                }}
              />
            )}
          </div>
        )}

        {/* ── Crop hint bar ── */}
        {isCropping && !cropPreviewUrl && (
          <div className="text-center text-white/50 text-xs py-2 shrink-0 select-none border-t border-white/10">
            {cropRect
              ? 'Selection ready · click "Preview crop" to review before downloading'
              : "Drag to select a region"}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
