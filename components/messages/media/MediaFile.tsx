"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { FileText, FileType2, FileSpreadsheet, Download, Eye, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Message, AttachmentRef } from "@/lib/api/messages";
import { getPlayInfo } from "@/lib/api/media";
import { blobDownload, fetchPlayableUrl, formatBytes } from "./shared";
import { FilePreviewModal, canPreviewFile } from "./FilePreviewModal";
import { UploadProgressBar } from "./UploadProgress";
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
      const playInfo = await getPlayInfo(resolvedMediaId, resolvedConversationId);
      setFileUrl(playInfo.url);
      return playInfo.url;
    } catch {
      toast.error("Không thể tải file");
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
        toast.error("Không thể tải file");
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
}: {
  attachments: AttachmentRef[];
  isMine: boolean;
  conversationId?: string;
}) {
  const images = attachments.filter((a) => a.type === "image" || a.type == null);
  const others = attachments.filter((a) => a.type != null && a.type !== "image");
  return (
    <div className="space-y-1">
      {images.length > 0 && (
        <div
          className={cn(
            "grid gap-1",
            images.length === 1
              ? "grid-cols-1"
              : images.length === 2
              ? "grid-cols-2"
              : "grid-cols-3"
          )}
        >
          {images.map((a) => (
            <AttachmentThumb
              key={a.mediaId}
              attachment={a}
              conversationId={conversationId}
            />
          ))}
        </div>
      )}
      {others.map((a) => (
        <MediaFile
          key={a.mediaId}
          mediaId={a.mediaId}
          filename={a.filename}
          isMine={isMine}
          conversationId={conversationId}
        />
      ))}
    </div>
  );
}

function AttachmentThumb({
  attachment,
  conversationId,
}: {
  attachment: AttachmentRef;
  conversationId?: string;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const isLoadingRef = useRef(false);
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = divRef.current;
    if (!node || thumbUrl) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !thumbUrl && !isLoadingRef.current) {
          isLoadingRef.current = true;
          setIsLoading(true);
          getPlayInfo(attachment.mediaId, conversationId)
            .then((playInfo) => setThumbUrl(playInfo.url))
            .catch(() => {})
            .finally(() => {
              isLoadingRef.current = false;
              setIsLoading(false);
            });
        }
      },
      { rootMargin: "50px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [attachment.mediaId, conversationId, thumbUrl]);

  if (thumbUrl) {
    return (
      <div className="rounded-lg overflow-hidden aspect-square bg-border/20">
        <img src={thumbUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
      </div>
    );
  }
  return (
    <div
      ref={divRef}
      className="rounded-lg aspect-square bg-border/20 flex items-center justify-center"
    >
      <span className="text-[10px] text-muted">{isLoading ? "…" : ""}</span>
    </div>
  );
}
