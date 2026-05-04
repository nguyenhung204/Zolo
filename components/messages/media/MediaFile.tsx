"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { FileText, FileType2, FileSpreadsheet, Download, Eye, Loader2, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Message, AttachmentRef, LocalAttachmentPreview } from "@/lib/api/messages";
import { getMediaUrl } from "@/lib/api/media";
import { blobDownload, fetchDisplayUrl, formatBytes } from "./shared";
import { FilePreviewModal, canPreviewFile } from "./FilePreviewModal";
import { UploadProgressBar } from "./UploadProgress";
import { ImageLightbox } from "./ImageLightbox";
import { MediaVideo } from "./MediaVideo";
import { toast } from "sonner";

function fileExtIcon(filename: string): { icon: React.ReactNode; color: string } {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf")
    return {
      icon: <FileText className="w-5 h-5" />,
      color: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
    };
  if (["doc", "docx"].includes(ext))
    return {
      icon: <FileType2 className="w-5 h-5" />,
      color: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
    };
  if (["xls", "xlsx", "csv"].includes(ext))
    return {
      icon: <FileSpreadsheet className="w-5 h-5" />,
      color: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
    };
  if (["ppt", "pptx"].includes(ext))
    return {
      icon: <FileText className="w-5 h-5" />,
      color: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
    };
  if (["zip", "rar", "7z"].includes(ext))
    return {
      icon: <FileText className="w-5 h-5" />,
      color: "bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400",
    };
  return { icon: <FileText className="w-5 h-5" />, color: "bg-border/60 text-muted" };
}

interface MediaFileProps {
  message?: Message;
  mediaId?: string;
  filename?: string;
  isMine: boolean;
  conversationId?: string;
}

export function MediaFile({ message, mediaId, filename, isMine, conversationId }: MediaFileProps) {
  const resolvedFilename = message?.metadata?.filename || message?.content || filename || "File";
  const resolvedMediaId = message?.mediaId ?? mediaId;
  const resolvedConversationId = message?.conversationId ?? conversationId;
  const fileSize = message?.metadata?.fileSize;
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const previewType = canPreviewFile(resolvedFilename);
  const { icon, color } = fileExtIcon(resolvedFilename);
  const isUploading =
    typeof message?._uploadProgress === "number" && message._uploadProgress < 100;

  const fetchUrl = useCallback(async (): Promise<string | null> => {
    if (fileUrl) return fileUrl;
    if (!resolvedMediaId || isLoadingUrl) return null;
    setIsLoadingUrl(true);
    try {
      const entity = await getMediaUrl(resolvedMediaId, "ORIGINAL", resolvedConversationId);
      const url = (entity as unknown as { url?: string }).url ?? null;
      if (url) setFileUrl(url);
      return url;
    } catch {
      toast.error("Could not load the file.");
      return null;
    } finally {
      setIsLoadingUrl(false);
    }
  }, [fileUrl, resolvedMediaId, resolvedConversationId, isLoadingUrl]);

  const handleDownload = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      const url = await fetchUrl();
      if (!url) return;
      try {
        await blobDownload(url, resolvedFilename);
      } catch {
        toast.error("Could not download the file.");
      }
    },
    [fetchUrl, resolvedFilename]
  );

  const handlePreview = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      const url = await fetchUrl();
      if (url) setShowPreview(true);
    },
    [fetchUrl]
  );

  return (
    <>
      <div className="min-w-[280px] max-w-[380px] px-1 py-0.5">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
              color
            )}
          >
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <p
              className={cn(
                "text-sm font-semibold truncate leading-snug",
                isMine ? "text-white" : "text-slate-800 dark:text-slate-100"
              )}
            >
              {resolvedFilename}
            </p>
            {fileSize != null && (
              <span
                className={cn(
                  "text-[11px] mt-0.5 block",
                  isMine ? "text-white/60" : "text-slate-400 dark:text-slate-500"
                )}
              >
                {formatBytes(fileSize)}
              </span>
            )}
          </div>
          {!isUploading && (
            <div className="flex items-center gap-1 shrink-0">
              {previewType && (
                <button
                  onClick={handlePreview}
                  disabled={isLoadingUrl}
                  className={cn(
                    "w-9 h-9 rounded-xl flex items-center justify-center hover:opacity-80 transition-opacity cursor-pointer disabled:opacity-40",
                    isMine
                      ? "bg-white/20 text-white"
                      : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                  )}
                  title="Xem trước"
                >
                  {isLoadingUrl ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              )}
              <button
                onClick={handleDownload}
                disabled={isLoadingUrl && !fileUrl}
                className={cn(
                  "w-9 h-9 rounded-xl flex items-center justify-center hover:opacity-80 transition-opacity cursor-pointer disabled:opacity-40",
                  isMine
                    ? "bg-white/20 text-white"
                    : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                )}
                title="Tải về"
              >
                {isLoadingUrl && !fileUrl ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
              </button>
            </div>
          )}
        </div>
        {isUploading && (
          <UploadProgressBar isMine={isMine} progress={message?._uploadProgress} />
        )}
      </div>

      {showPreview && fileUrl && (
        <FilePreviewModal
          url={fileUrl}
          filename={resolvedFilename}
          onClose={() => setShowPreview(false)}
        />
      )}
    </>
  );
}

// ─── AttachmentGrid ───────────────────────────────────────────────────────────

export function AttachmentGrid({
  attachments,
  isMine,
  conversationId,
  localAttachments,
  uploadProgress,
}: {
  attachments: AttachmentRef[];
  isMine: boolean;
  conversationId?: string;
  localAttachments?: LocalAttachmentPreview[];
  uploadProgress?: number;
}) {
  const isUploading = typeof uploadProgress === "number" && uploadProgress < 100;
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxMediaId, setLightboxMediaId] = useState<string | undefined>(undefined);
  const [videoAttachment, setVideoAttachment] = useState<AttachmentRef | null>(null);

  // During upload: show local previews
  if (isUploading && localAttachments && localAttachments.length > 0) {
    const cols =
      localAttachments.length === 1
        ? "grid-cols-1"
        : localAttachments.length === 2
        ? "grid-cols-2"
        : localAttachments.length === 4
        ? "grid-cols-2"
        : "grid-cols-3";
    return (
      <div className={cn("grid gap-0.5", cols)}>
        {localAttachments.map((item, idx) => (
          <div key={idx} className="aspect-square relative bg-black/30">
            {item.mediaType === "image" && item.previewUrl ? (
              <img src={item.previewUrl} alt="" className="w-full h-full object-cover" />
            ) : item.mediaType === "video" && (item.thumbPreviewUrl || item.previewUrl) ? (
              <>
                <img
                  src={item.thumbPreviewUrl ?? item.previewUrl}
                  alt=""
                  className="w-full h-full object-cover opacity-70"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-9 h-9 rounded-full bg-black/50 flex items-center justify-center">
                    <Play className="w-4 h-4 text-white ml-0.5" />
                  </div>
                </div>
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-white/60 animate-spin" />
              </div>
            )}
            {/* Upload progress overlay */}
            <div className="absolute inset-0 bg-black/30 flex items-end">
              <div className="w-full h-1 bg-white/20">
                <div
                  className="h-full bg-white/70 transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Real attachments (after upload / received messages)
  const mediaItems = attachments.filter(
    (a) => a.type === "image" || a.type === "video" || a.type == null
  );
  const fileItems = attachments.filter(
    (a) => a.type === "file" || a.type === "audio"
  );

  const colsClass =
    mediaItems.length === 1
      ? "grid-cols-1"
      : mediaItems.length === 2
      ? "grid-cols-2"
      : mediaItems.length === 4
      ? "grid-cols-2"
      : "grid-cols-3";

  return (
    <>
      <div className="space-y-0.5">
        {mediaItems.length > 0 && (
          <div className={cn("grid gap-0.5", colsClass)}>
            {mediaItems.map((a, idx) =>
              a.type === "video" ? (
                <AttachmentVideoThumb
                  key={a.mediaId}
                  attachment={a}
                  conversationId={conversationId}
                  onPlay={() => setVideoAttachment(a)}
                />
              ) : (
                <AttachmentImageThumb
                  key={a.mediaId}
                  attachment={a}
                  conversationId={conversationId}
                  localPreviewUrl={localAttachments?.[idx]?.previewUrl}
                  onOpen={(src) => { setLightboxSrc(src); setLightboxMediaId(a.mediaId); }}
                />
              )
            )}
          </div>
        )}
        {fileItems.map((a) => (
          <MediaFile
            key={a.mediaId}
            mediaId={a.mediaId}
            filename={a.filename}
            isMine={isMine}
            conversationId={conversationId}
          />
        ))}
      </div>

      {/* Image lightbox */}
      {lightboxSrc && (
        <ImageLightbox
          src={lightboxSrc}
          mediaId={lightboxMediaId}
          onClose={() => { setLightboxSrc(null); setLightboxMediaId(undefined); }}
          conversationId={conversationId}
        />
      )}

      {/* Video viewer overlay */}
      {videoAttachment && (
        <GridVideoViewer
          attachment={videoAttachment}
          conversationId={conversationId}
          onClose={() => setVideoAttachment(null)}
        />
      )}
    </>
  );
}

// ─── AttachmentImageThumb ─────────────────────────────────────────────────────

function AttachmentImageThumb({
  attachment,
  conversationId,
  localPreviewUrl,
  onOpen,
}: {
  attachment: AttachmentRef;
  conversationId?: string;
  localPreviewUrl?: string;
  onOpen: (src: string) => void;
}) {
  // cdnUrl: server URL once loaded. localPreviewUrl is shown as fallback until then.
  const [cdnUrl, setCdnUrl] = useState<string | null>(null);
  const displayUrl = cdnUrl ?? localPreviewUrl ?? null;
  const isLoadingRef = useRef(false);
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (cdnUrl) return; // already have CDN URL
    const node = divRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingRef.current) {
          isLoadingRef.current = true;
          fetchDisplayUrl(attachment.mediaId, conversationId)
            .then((url) => { if (url) setCdnUrl(url); })
            .catch(() => {})
            .finally(() => { isLoadingRef.current = false; });
        }
      },
      { rootMargin: "50px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [attachment.mediaId, conversationId, cdnUrl]);

  if (displayUrl) {
    return (
      <div
        ref={divRef}
        className="aspect-square overflow-hidden bg-border/20 cursor-zoom-in"
        role="button"
        onClick={() => onOpen(cdnUrl ?? displayUrl)}
        aria-label="View image"
      >
        <img src={displayUrl} alt="" className="w-full h-full object-cover" />
      </div>
    );
  }
  return (
    <div
      ref={divRef}
      className="aspect-square bg-border/20 flex items-center justify-center"
    >
      <Loader2 className="w-4 h-4 animate-spin text-muted/60" />
    </div>
  );
}

// ─── AttachmentVideoThumb ─────────────────────────────────────────────────────

function AttachmentVideoThumb({
  attachment,
  conversationId,
  onPlay,
}: {
  attachment: AttachmentRef;
  conversationId?: string;
  onPlay: () => void;
}) {
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!attachment.thumbMediaId) return;
    getMediaUrl(attachment.thumbMediaId, "ORIGINAL", conversationId)
      .then((entity) => {
        const url = (entity as unknown as { url?: string }).url;
        if (url) setPosterUrl(url);
      })
      .catch(() => {});
  }, [attachment.thumbMediaId, conversationId]);

  return (
    <div
      ref={divRef}
      className="aspect-square relative bg-black overflow-hidden cursor-pointer"
      role="button"
      onClick={onPlay}
      aria-label="Play video"
    >
      {posterUrl ? (
        <img src={posterUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <div className="w-full h-full bg-black/60" />
      )}
      <div className="absolute inset-0 flex items-center justify-center bg-black/20">
        <div className="w-10 h-10 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/20">
          <Play className="w-5 h-5 text-white ml-0.5" />
        </div>
      </div>
    </div>
  );
}

// ─── GridVideoViewer ──────────────────────────────────────────────────────────

function GridVideoViewer({
  attachment,
  conversationId,
  onClose,
}: {
  attachment: AttachmentRef;
  conversationId?: string;
  onClose: () => void;
}) {
  // Build a synthetic Message so we can reuse MediaVideo
  const syntheticMsg: Message = {
    messageId: attachment.mediaId,
    conversationId: conversationId ?? "",
    senderId: "",
    content: "",
    type: "video",
    offset: -1,
    mediaId: attachment.mediaId,
    metadata: {
      filename: attachment.filename,
      thumbMediaId: attachment.thumbMediaId,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Close on backdrop click
  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/85 flex items-center justify-center"
      onClick={handleBackdrop}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white z-10 cursor-pointer"
        aria-label="Close"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="max-w-[90vw] max-h-[90vh] w-full" onClick={(e) => e.stopPropagation()}>
        <MediaVideo message={syntheticMsg} isMine={false} />
      </div>
    </div>
  );
}
