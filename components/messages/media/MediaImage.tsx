"use client";

import { useState, useRef, useEffect, memo } from "react";
import { Loader2 } from "lucide-react";
import type { Message } from "@/lib/api/messages";
import { fetchDisplayUrl } from "./shared";
import { UploadOverlay } from "./UploadProgress";
import { ImageLightbox } from "./ImageLightbox";

interface Props {
  message: Message;
  isMine: boolean;
}

const MAX_CHAT_IMAGE_WIDTH = 360;

export const MediaImage = memo(function MediaImage({ message, isMine }: Props) {
  const isUploading = typeof message._uploadProgress === "number" && message._uploadProgress < 100;
  const isMediaReady = !message.mediaStatus || message.mediaStatus === "ready";
  const imageAttachment = message.attachments?.find((attachment) => {
    const type = attachment.type ?? attachment.kind;
    return type === "image" || type == null;
  });
  const seededWidth = message.metadata?.width ?? imageAttachment?.width ?? null;
  const seededHeight = message.metadata?.height ?? imageAttachment?.height ?? null;
  const seededRatio =
    seededWidth && seededHeight
      ? seededWidth / seededHeight
      : null;
  const [imageSrc, setImageSrc] = useState<string | null>(
    isMine ? (message._localPreviewUrl ?? null) : null
  );
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [loadedSize, setLoadedSize] = useState<{ width: number; height: number } | null>(null);
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
      { rootMargin: "800px" }
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
  const loadedRatio = loadedSize ? loadedSize.width / loadedSize.height : null;
  const displayAspectRatio = seededRatio ?? loadedRatio;
  const effectiveWidth = seededWidth ?? loadedSize?.width ?? null;
  const displayWidth = effectiveWidth
    ? Math.min(MAX_CHAT_IMAGE_WIDTH, effectiveWidth)
    : displayAspectRatio
      ? MAX_CHAT_IMAGE_WIDTH
      : null;

  if (previewSrc) {
    return (
      <>
        <div
          ref={imgRef}
          className="relative rounded-2xl overflow-hidden bg-border/20 cursor-zoom-in inline-block"
          style={{
            aspectRatio: displayAspectRatio ?? undefined,
            width: displayWidth ? `min(${displayWidth}px, 100%)` : `min(${MAX_CHAT_IMAGE_WIDTH}px, 100%)`,
            maxWidth: `min(${MAX_CHAT_IMAGE_WIDTH}px, 100%)`,
            maxHeight: "70vh",
            minHeight: displayAspectRatio ? undefined : "120px",
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
            onLoad={(e) => {
              const t = e.currentTarget;
              if (t.naturalWidth && t.naturalHeight) {
                setLoadedSize({ width: t.naturalWidth, height: t.naturalHeight });
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
    <div ref={imgRef} className="max-w-[360px] w-full aspect-video rounded-2xl bg-black/10 flex items-center justify-center">
      <Loader2 className="w-5 h-5 animate-spin text-muted/60" />
    </div>
  );
});
