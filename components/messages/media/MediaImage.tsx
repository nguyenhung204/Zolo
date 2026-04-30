"use client";

import { useState, useRef, useEffect } from "react";
import { Loader2 } from "lucide-react";
import type { Message } from "@/lib/api/messages";
import { fetchDisplayUrl } from "./shared";
import { UploadOverlay } from "./UploadProgress";
import { ImageLightbox } from "./ImageLightbox";

interface Props {
  message: Message;
  isMine: boolean;
}

export function MediaImage({ message, isMine }: Props) {
  const isUploading = typeof message._uploadProgress === "number" && message._uploadProgress < 100;
  const isMediaReady = !message.mediaStatus || message.mediaStatus === "ready";
  const [imageSrc, setImageSrc] = useState<string | null>(
    isMine ? (message._localPreviewUrl ?? null) : null
  );
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const isLoadingRef = useRef(false);
  const hasOptimizedRef = useRef(false);
  const imgRef = useRef<HTMLDivElement>(null);

  // Lazy-load via IntersectionObserver
  useEffect(() => {
    if (isUploading || !message.mediaId || imageSrc) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !imageSrc && !isLoadingRef.current) {
          isLoadingRef.current = true;
          fetchDisplayUrl(message.mediaId!, message.conversationId)
            .then((url) => { if (url) setImageSrc(url); })
            .catch(() => {})
            .finally(() => { isLoadingRef.current = false; });
        }
      },
      { rootMargin: "100px" }
    );
    if (imgRef.current) observer.observe(imgRef.current);
    return () => observer.disconnect();
  }, [isUploading, message.mediaId, message.conversationId, imageSrc]);

  // Upgrade local blob preview → CDN URL once upload is READY.
  // Only fires when imageSrc is still a blob: URL (local preview for own messages).
  // For received messages imageSrc is already a CDN URL from the observer above — skip.
  useEffect(() => {
    if (!isMediaReady || !message.mediaId) return;
    if (hasOptimizedRef.current) return;
    if (!imageSrc?.startsWith("blob:")) return; // already CDN URL or not yet set
    hasOptimizedRef.current = true;
    fetchDisplayUrl(message.mediaId, message.conversationId)
      .then((url) => { if (url) setImageSrc(url); })
      .catch(() => {});
  }, [isMediaReady, message.mediaId, message.conversationId, imageSrc]);

  const previewSrc = imageSrc ?? (isMine ? message._localPreviewUrl : undefined);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);

  if (previewSrc) {
    return (
      <>
        <div
          ref={imgRef}
          className="relative rounded-2xl overflow-hidden bg-border/20 cursor-zoom-in inline-block"
          style={{
            // Use natural aspect ratio when known so the layout doesn't jump
            // and the displayed image keeps its real proportions instead of
            // being cropped into a square.
            aspectRatio: aspectRatio ?? undefined,
            maxWidth: "min(420px, 100%)",
            maxHeight: "70vh",
          }}
          onClick={() => !isUploading && setLightboxSrc(previewSrc)}
          role="button"
          aria-label="Xem ảnh"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewSrc}
            alt=""
            className="block w-full h-full"
            style={{ objectFit: "contain" }}
            loading="lazy"
            onLoad={(e) => {
              const t = e.currentTarget;
              if (t.naturalWidth && t.naturalHeight) {
                setAspectRatio(t.naturalWidth / t.naturalHeight);
              }
            }}
          />
          {isUploading && <UploadOverlay isMine={isMine} progress={message._uploadProgress} />}
        </div>
        {lightboxSrc && (
          <ImageLightbox
            src={lightboxSrc}
            mediaId={message.mediaId}
            conversationId={message.conversationId}
            filename={message.metadata?.filename ?? undefined}
            onClose={() => setLightboxSrc(null)}
          />
        )}
      </>
    );
  }

  return (
    <div ref={imgRef} className="max-w-[420px] w-full aspect-video rounded-2xl bg-black/10 flex items-center justify-center">
      <Loader2 className="w-5 h-5 animate-spin text-muted/60" />
    </div>
  );
}
