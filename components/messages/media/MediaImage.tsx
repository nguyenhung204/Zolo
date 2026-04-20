"use client";

import { useState, useRef, useEffect } from "react";
import { Loader2 } from "lucide-react";
import type { Message } from "@/lib/api/messages";
import { getPlayInfo } from "@/lib/api/media";
import { fetchPlayableUrl } from "./shared";
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
          fetchPlayableUrl(message.mediaId!, message.conversationId)
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

  // Upgrade to optimized URL once READY
  useEffect(() => {
    if (!isMediaReady || !message.mediaId) return;
    if (hasOptimizedRef.current) return;
    if (!imageSrc) {
      if (isLoadingRef.current) return;
      isLoadingRef.current = true;
      fetchPlayableUrl(message.mediaId, message.conversationId)
        .then((url) => { if (url) setImageSrc(url); })
        .catch(() => {})
        .finally(() => { isLoadingRef.current = false; });
      return;
    }
    hasOptimizedRef.current = true;
    getPlayInfo(message.mediaId, message.conversationId)
      .then((playInfo) => setImageSrc(playInfo.url))
      .catch(() => {});
  }, [isMediaReady, message.mediaId, message.conversationId, imageSrc]);

  const previewSrc = imageSrc ?? (isMine ? message._localPreviewUrl : undefined);

  if (previewSrc) {
    return (
      <>
        <div
          ref={imgRef}
          className="relative rounded-2xl overflow-hidden max-w-[500px] w-full bg-border/20 cursor-zoom-in"
          onClick={() => !isUploading && setLightboxSrc(previewSrc)}
          role="button"
          aria-label="Xem ảnh"
        >
          <img
            src={previewSrc}
            alt=""
            className="w-full object-cover block"
            style={{ maxHeight: "540px", objectFit: "cover", aspectRatio: "auto" }}
            loading="lazy"
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
    <div ref={imgRef} className="w-[360px] aspect-video rounded-2xl bg-black/10 flex items-center justify-center">
      <Loader2 className="w-5 h-5 animate-spin text-muted/60" />
    </div>
  );
}
