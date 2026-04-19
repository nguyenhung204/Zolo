"use client";

import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/presence/UserAvatar";
import { formatTime } from "@/lib/utils/date";
import type { Message, AttachmentRef } from "@/lib/api/messages";
import {
  CheckCheck, Check, Clock, AlertCircle, FileText, Play, Pause, CloudUpload, Loader2,
  Reply, Ban, Download, MoreHorizontal, Pencil, Trash2, Share2, CornerUpLeft, Pin, Info,
  Volume2, VolumeX, Maximize2, RotateCcw, RotateCw, Crop, X as XIcon, ZoomIn, ZoomOut,
  Eye, FileSpreadsheet, FileType2,
} from "lucide-react";
import { AnimatedSticker } from "@/components/messages/AnimatedSticker";
import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";
import { getPlayInfo, getMediaUrl } from "@/lib/api/media";
import { addReaction } from "@/lib/api/messages";
import { toast } from "sonner";

interface OtherMember {
  userId: string;
  lastSeenOffset: number;
  lastDeliveredOffset: number;
  avatarUrl?: string | null;
  displayName?: string;
  username?: string;
}

interface MessageRowProps {
  message: Message;
  isMine: boolean;
  isGroupStart: boolean;
  isGroupEnd: boolean;
  replyMsg?: Message | null;
  senderName?: string;
  senderAvatarUrl?: string;
  replySenderName?: string;
  otherMembers?: OtherMember[];
  onReply?: (msg: Message) => void;
  onEdit?: (msg: Message) => void;
  onDelete?: (msg: Message) => void;
  onRevoke?: (msg: Message) => void;
  onForward?: (msg: Message) => void;
  onPin?: (msg: Message) => void;
  onViewDetails?: (msg: Message) => void;
}

export function MessageRow({
  message, isMine, isGroupStart, isGroupEnd,
  replyMsg,
  senderName = "", senderAvatarUrl, replySenderName,
  otherMembers = [],
  onReply, onEdit, onDelete, onRevoke, onForward, onPin, onViewDetails,
}: MessageRowProps) {
  const isDeleted = !!message.deletedAt;
  const isRevoked = !!message.isRevoked;
  const isSystem = message.type === "system";
  const isSticker = message.type === "sticker";
  const isEdited = !!message.editedAt;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const myId = useAuthStore((s) => s.user?.id);

  // ─── Reactions ────────────────────────────────────────────────────────────
  const [localReactions, setLocalReactions] = useState<Record<string, number> | null>(null);
  const reactionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mergedReactions = localReactions ?? (message.reactions ?? {});

  // Clear local optimistic override once server state arrives via WS
  const serverReactionsRef = useRef(message.reactions);
  useEffect(() => {
    if (message.reactions !== serverReactionsRef.current) {
      serverReactionsRef.current = message.reactions;
      setLocalReactions(null);
    }
  }, [message.reactions]);

  const handleEmojiPick = useCallback(async (emoji: string) => {
    // Optimistic update: increment count locally
    const prev = localReactions ?? (message.reactions ?? {});
    const next = { ...prev, [emoji]: (prev[emoji] ?? 0) + 1 };
    setLocalReactions(next);
    setMenuOpen(false);
    // Debounce the API call
    if (reactionDebounceRef.current) clearTimeout(reactionDebounceRef.current);
    reactionDebounceRef.current = setTimeout(async () => {
      try {
        await addReaction(message.messageId, emoji);
        // Don't clear here — let the useEffect sync when WS reaction_updated arrives
      } catch {
        // Rollback on failure
        setLocalReactions(null);
        toast.error("Không thể thêm cảm xúc");
      }
    }, 350);
  }, [localReactions, message.reactions, message.messageId]);

  useEffect(() => {
    if (!menuOpen) return;
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [menuOpen]);

  if (isSystem) {
    return (
      <div className="flex justify-center py-1.5 px-4">
        <span className="text-[11px] text-muted bg-border/40 rounded-full px-3 py-0.5 select-none">
          {message.content}
        </span>
      </div>
    );
  }

  const bubbleShape = cn(
    "rounded-[18px]",
    !isGroupStart && !isGroupEnd && (isMine ? "rounded-tr-[4px] rounded-br-[4px]" : "rounded-tl-[4px] rounded-bl-[4px]"),
    isGroupStart && !isGroupEnd && (isMine ? "rounded-tr-[4px]" : "rounded-tl-[4px]"),
    !isGroupStart && isGroupEnd && (isMine ? "rounded-br-[4px]" : "rounded-bl-[4px]"),
  );

  return (
    <div className={cn("group flex items-end gap-2 px-3", isMine ? "flex-row-reverse" : "flex-row", isGroupEnd ? "mb-3" : "mb-0.5")}>
      <div className="w-8 shrink-0 self-end">
        {!isMine && isGroupEnd && (
          <UserAvatar userId={message.senderId} name={senderName} avatarUrl={senderAvatarUrl} size="sm" showPresence={false} />
        )}
      </div>

      <div className={cn("flex flex-col max-w-[78%]", isMine ? "items-end" : "items-start")}>
        {!isMine && isGroupStart && (
          <span className="text-[11px] font-semibold text-cta ml-1 mb-0.5 select-none">{senderName}</span>
        )}

        <div className={cn("flex items-center gap-1", isMine ? "flex-row-reverse" : "flex-row")}>
          {isSticker ? (
            <div className="p-0.5">
              <AnimatedSticker url={message.metadata?.url ?? ""} size={130} alt="sticker" />
            </div>
          ) : isRevoked ? (
            <div className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-[18px] border border-border/50 text-muted text-xs italic select-none">
              <Ban className="w-3 h-3 shrink-0" />
              Tin nhắn đã thu hồi
            </div>
          ) : isDeleted ? (
            <div className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-[18px] border border-border/50 text-muted text-xs italic select-none">
              Đã xóa
            </div>
          ) : (
            (() => {
              // Pure media messages (image/video with no reply) get no bubble chrome
              const isPureMedia = (message.type === "image" || message.type === "video") && !replyMsg;
              return (
                <div className={cn(
                  bubbleShape,
                  "text-sm leading-relaxed break-words max-w-full",
                  isPureMedia
                    ? "overflow-hidden"
                    : isMine
                      ? "bg-cta text-white px-3.5 py-2.5"
                      : "bg-surface border border-border/60 text-text px-3.5 py-2.5 shadow-sm"
                )}>
                  {replyMsg && (
                    <div className={cn("flex items-start gap-2 rounded-xl px-2.5 py-1.5 mb-2 text-xs border-l-[3px] cursor-pointer",
                      isMine ? "bg-white/15 border-white/50 hover:bg-white/20" : "bg-border/30 border-cta hover:bg-border/50")}>
                      <CornerUpLeft className={cn("w-3 h-3 shrink-0 mt-0.5", isMine ? "text-white/70" : "text-cta")} />
                      <div className="min-w-0">
                        <p className={cn("font-semibold truncate text-[11px] leading-tight mb-0.5", isMine ? "text-white/80" : "text-cta")}>
                          {replySenderName ?? (replyMsg.senderId === myId ? "Bạn" : senderName)}
                        </p>
                        <p className={cn("truncate text-[11px] leading-tight", isMine ? "text-white/60" : "text-muted")}>
                          {replyMsg.isRevoked ? "Tin nhắn đã thu hồi" : (replyMsg.content || "[" + replyMsg.type + "]")}
                        </p>
                      </div>
                    </div>
                  )}
                  <MessageContent message={message} isMine={isMine} />
                  {isEdited && (
                    <span className={cn("block text-[10px] mt-1 italic select-none", isMine ? "text-white/50" : "text-muted")}>Đã chỉnh sửa</span>
                  )}
                </div>
              );
            })()
          )}

          {!isRevoked && !isDeleted && (
            <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              {!isSticker && (
                <button onClick={() => onReply?.(message)}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-muted hover:text-secondary hover:bg-border/60 transition-colors cursor-pointer"
                  title="Trả lời">
                  <Reply className="w-3.5 h-3.5" />
                </button>
              )}
              <div className="relative" ref={menuRef}>
                <button onClick={() => setMenuOpen((v) => !v)}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-muted hover:text-secondary hover:bg-border/60 transition-colors cursor-pointer"
                  title="Thêm">
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
                {menuOpen && (
                  <ContextMenu isMine={isMine} message={message}
                    onEmojiPick={handleEmojiPick}
                    onReply={onReply ? () => { onReply(message); setMenuOpen(false); } : undefined}
                    onEdit={onEdit ? () => { onEdit(message); setMenuOpen(false); } : undefined}
                    onDelete={onDelete ? () => { onDelete(message); setMenuOpen(false); } : undefined}
                    onRevoke={onRevoke ? () => { onRevoke(message); setMenuOpen(false); } : undefined}
                    onForward={onForward ? () => { onForward(message); setMenuOpen(false); } : undefined}
                    onPin={onPin ? () => { onPin(message); setMenuOpen(false); } : undefined}
                    onViewDetails={onViewDetails ? () => { onViewDetails(message); setMenuOpen(false); } : undefined}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Reaction bubbles */}
        {Object.entries(mergedReactions).filter(([, c]) => c > 0).length > 0 && !isRevoked && !isDeleted && (
          <div className={cn("flex flex-wrap gap-1 mt-0.5", isMine ? "justify-end" : "justify-start")}>
            {Object.entries(mergedReactions)
              .filter(([, c]) => c > 0)
              .slice(0, 6)
              .map(([emoji, count]) => (
                <button
                  key={emoji}
                  onClick={() => handleEmojiPick(emoji)}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border border-border bg-surface hover:bg-border/60 transition-colors cursor-pointer"
                >
                  <span>{emoji}</span>
                  <span className="text-muted text-[11px] font-medium">{count}</span>
                </button>
              ))}
          </div>
        )}

        {isGroupEnd && (
          <div className={cn("flex items-center gap-1 mt-1 select-none", isMine ? "flex-row-reverse pr-1" : "flex-row pl-1")}>
            <span className="text-[10px] text-muted tabular-nums">
              {formatTime(message.createdAt)}
            </span>
            {isMine && !isRevoked && <MessageStatusIcon message={message} otherMembers={otherMembers} />}
          </div>
        )}
      </div>
    </div>
  );
}

function ContextMenu({ isMine, message, onEmojiPick, onReply, onEdit, onDelete, onRevoke, onForward, onPin, onViewDetails }: {
  isMine: boolean; message: Message;
  onEmojiPick?: (emoji: string) => void;
  onReply?: () => void; onEdit?: () => void; onDelete?: () => void; onRevoke?: () => void; onForward?: () => void; onPin?: () => void; onViewDetails?: () => void;
}) {
  const now = Date.now();
  const createdAt = new Date(message.createdAt).getTime();
  const ageMs = now - createdAt;
  const canEdit = isMine && message.type === "text" && ageMs < 1 * 60 * 60 * 1000;
  const canRevoke = isMine && ageMs < 24 * 60 * 60 * 1000;
  const canDelete = isMine;

  return (
    <div className={cn("absolute z-[9999] bottom-full mb-2 bg-surface rounded-2xl border border-border/80 shadow-xl overflow-hidden min-w-[180px]",
      isMine ? "right-0" : "left-0")}>
      <div className="flex items-center px-2 py-2 gap-0.5 border-b border-border/60">
        {["❤️", "😂", "👍", "😮", "😢"].map((e) => (
          <button key={e} onClick={() => onEmojiPick?.(e)} className="w-8 h-8 rounded-full flex items-center justify-center text-base transition-transform hover:scale-125 cursor-pointer hover:bg-border/40">{e}</button>
        ))}
      </div>
      <div className="py-1">
        {onReply && <CtxItem icon={<Reply className="w-3.5 h-3.5" />} label="Trả lời" onClick={onReply} />}
        {onForward && <CtxItem icon={<Share2 className="w-3.5 h-3.5" />} label="Chuyển tiếp" onClick={onForward} />}
        {onPin && <CtxItem icon={<Pin className="w-3.5 h-3.5" />} label="Ghim tin nhắn" onClick={onPin} />}
        {onViewDetails && <CtxItem icon={<Info className="w-3.5 h-3.5" />} label="Xem chi tiết" onClick={onViewDetails} />}
        {canEdit && onEdit && <CtxItem icon={<Pencil className="w-3.5 h-3.5" />} label="Chỉnh sửa" onClick={onEdit} />}
        {canRevoke && onRevoke && <CtxItem icon={<Ban className="w-3.5 h-3.5" />} label="Thu hồi" onClick={onRevoke} danger />}
        {canDelete && onDelete && <CtxItem icon={<Trash2 className="w-3.5 h-3.5" />} label="Xóa" onClick={onDelete} danger />}
      </div>
    </div>
  );
}

function CtxItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick}
      className={cn("w-full flex items-center gap-2.5 px-3.5 py-2 text-sm transition-colors cursor-pointer text-left",
        danger ? "text-error hover:bg-error/8" : "text-text hover:bg-border/40")}>
      <span className="opacity-60 shrink-0">{icon}</span>{label}
    </button>
  );
}

function MessageContent({ message, isMine }: { message: Message; isMine: boolean }) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  switch (message.type) {
    case "sticker":
      return message.metadata?.url ? <AnimatedSticker url={message.metadata.url} size={130} alt="sticker" /> : null;
    case "text":
      return <p className="whitespace-pre-wrap">{message.content}</p>;
    case "image":
      return (
        <>
          <MediaImage message={message} isMine={isMine} onOpenLightbox={setLightboxSrc} />
          {lightboxSrc && (
            <ImageLightbox
              src={lightboxSrc}
              mediaId={message.mediaId}
              conversationId={message.conversationId}
              onClose={() => setLightboxSrc(null)}
            />
          )}
        </>
      );
    case "video":
      return <MediaVideo message={message} isMine={isMine} />;
    case "audio":
      return <VoiceMessage message={message} isMine={isMine} />;
    case "file":
      return <MediaFile message={message} isMine={isMine} />;
    case "media":
      return (
        <div className="space-y-1.5">
          {message.content && <p className="whitespace-pre-wrap text-sm">{message.content}</p>}
          <AttachmentGrid attachments={message.attachments ?? []} isMine={isMine} conversationId={message.conversationId} />
        </div>
      );
    default:
      return <p className="whitespace-pre-wrap">{message.content}</p>;
  }
}

function MediaImage({ message, isMine, onOpenLightbox }: { message: Message; isMine: boolean; onOpenLightbox: (src: string) => void }) {
  const isUploading = typeof message._uploadProgress === "number" && message._uploadProgress < 100;
  const isMediaReady = !message.mediaStatus || message.mediaStatus === "ready";
  const [imageSrc, setImageSrc] = useState<string | null>(
    isMine ? message._localPreviewUrl ?? null : null
  );
  const isLoadingRef = useRef(false);
  const hasOptimizedRef = useRef(false);
  const imgRef = useRef<HTMLDivElement>(null);

  // Lazy-load via IntersectionObserver; try optimized first, fall back to ORIGINAL.
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

  // Upgrade to optimized URL once READY.
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
      <div
        ref={imgRef}
        className="relative rounded-2xl overflow-hidden max-w-[340px] bg-border/20 cursor-zoom-in"
        onClick={() => !isUploading && onOpenLightbox(previewSrc)}
        role="button"
        aria-label="Xem ảnh"
      >
        <img src={previewSrc} alt="" className="w-full max-h-[380px] object-cover block" loading="lazy" />
        {isUploading && <UploadOverlay isMine={isMine} progress={message._uploadProgress} />}
      </div>
    );
  }

  return (
    <div ref={imgRef} className="w-[260px] aspect-video rounded-2xl bg-black/10 flex items-center justify-center">
      <Loader2 className="w-5 h-5 animate-spin text-muted/60" />
    </div>
  );
}

// ─── Image Lightbox ────────────────────────────────────────────────────────────

function ImageLightbox({
  src,
  mediaId,
  conversationId,
  onClose,
}: {
  src: string;
  mediaId?: string;
  conversationId?: string;
  onClose: () => void;
}) {
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [isCropping, setIsCropping] = useState(false);
  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(null);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgElRef = useRef<HTMLImageElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleDownload = useCallback(async () => {
    setIsDownloading(true);
    try {
      // Fetch ORIGINAL URL for the best quality download
      let downloadUrl = src;
      if (mediaId) {
        try {
          const entity = await getMediaUrl(mediaId, "ORIGINAL", conversationId);
          downloadUrl = (entity as unknown as { url?: string }).url ?? src;
        } catch {
          // fall back to the displayed src
        }
      }

      if (cropRect && imgElRef.current) {
        // Download cropped region using canvas
        const img = imgElRef.current;
        const naturalW = img.naturalWidth;
        const naturalH = img.naturalHeight;
        const displayW = img.clientWidth;
        const displayH = img.clientHeight;
        const scaleX = naturalW / displayW;
        const scaleY = naturalH / displayH;

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(cropRect.w * scaleX);
        canvas.height = Math.round(cropRect.h * scaleY);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(
            img,
            cropRect.x * scaleX, cropRect.y * scaleY,
            cropRect.w * scaleX, cropRect.h * scaleY,
            0, 0, canvas.width, canvas.height
          );
          canvas.toBlob((blob) => {
            if (!blob) return;
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "cropped-image.png";
            a.click();
            URL.revokeObjectURL(a.href);
          }, "image/png");
        }
      } else {
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = "image";
        a.target = "_blank";
        a.click();
      }
    } catch {
      toast.error("Không thể tải ảnh");
    } finally {
      setIsDownloading(false);
    }
  }, [src, mediaId, conversationId, cropRect]);

  // Crop pointer handlers
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isCropping) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setCropStart({ x, y });
    setCropRect(null);
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }, [isCropping]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isCropping || !cropStart) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x2 = e.clientX - rect.left;
    const y2 = e.clientY - rect.top;
    const x = Math.min(cropStart.x, x2);
    const y = Math.min(cropStart.y, y2);
    const w = Math.abs(x2 - cropStart.x);
    const h = Math.abs(y2 - cropStart.y);
    if (w > 4 && h > 4) setCropRect({ x, y, w, h });
  }, [isCropping, cropStart]);

  const handlePointerUp = useCallback(() => {
    setCropStart(null);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/92 flex flex-col"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setRotation((r) => r - 90)}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Xoay trái"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setRotation((r) => r + 90)}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Xoay phải"
          >
            <RotateCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setZoom((z) => Math.min(z + 0.25, 3))}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Phóng to"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(z - 0.25, 0.25))}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Thu nhỏ"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-white/20 mx-0.5" />
          <button
            onClick={() => { setIsCropping((c) => !c); setCropRect(null); }}
            className={cn(
              "w-9 h-9 rounded-lg flex items-center justify-center transition-colors cursor-pointer",
              isCropping ? "bg-cta text-white" : "text-white/70 hover:text-white hover:bg-white/10"
            )}
            title="Cắt ảnh"
          >
            <Crop className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleDownload}
            disabled={isDownloading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm transition-colors cursor-pointer disabled:opacity-50"
            title="Tải xuống"
          >
            {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            <span className="hidden sm:inline">{cropRect ? "Tải vùng cắt" : "Tải xuống"}</span>
          </button>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Đóng (Esc)"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Image area */}
      <div
        ref={containerRef}
        className={cn(
          "flex-1 flex items-center justify-center overflow-hidden relative",
          isCropping ? "cursor-crosshair" : "cursor-default"
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <img
          ref={imgElRef}
          src={src}
          alt=""
          className="max-w-full max-h-full object-contain select-none pointer-events-none"
          style={{
            transform: `rotate(${rotation}deg) scale(${zoom})`,
            transition: "transform 0.2s ease",
          }}
          draggable={false}
        />

        {/* Crop selection overlay */}
        {isCropping && cropRect && (
          <div
            className="absolute border-2 border-white/80 bg-white/10 pointer-events-none"
            style={{
              left: cropRect.x,
              top: cropRect.y,
              width: cropRect.w,
              height: cropRect.h,
            }}
          />
        )}
      </div>

      {isCropping && (
        <div className="text-center text-white/50 text-xs pb-2 shrink-0 select-none">
          Kéo để chọn vùng cắt{cropRect ? " · nhấn Tải xuống để lưu" : ""}
        </div>
      )}
    </div>
  );
}

/** Resolve a playable URL: try play-info first, fall back to ORIGINAL. */
async function fetchPlayableUrl(mediaId: string, conversationId?: string): Promise<string | null> {
  try {
    const info = await getPlayInfo(mediaId, conversationId);
    return info.url ?? null;
  } catch {
    try {
      const entity = await getMediaUrl(mediaId, "ORIGINAL", conversationId);
      return (entity as unknown as { url?: string }).url ?? null;
    } catch {
      return null;
    }
  }
}

function MediaVideo({ message, isMine }: { message: Message; isMine: boolean }) {
  const isUploading = typeof message._uploadProgress === "number" && message._uploadProgress < 100;

  const [videoSrc, setVideoSrc] = useState<string | null>(
    isMine ? message._localPreviewUrl ?? null : null
  );
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isDownloadingVideo, setIsDownloadingVideo] = useState(false);
  const [thumbPosterUrl, setThumbPosterUrl] = useState<string | undefined>(undefined);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isPlayingRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const shouldAutoPlayRef = useRef(false);

  const thumbMediaId = message.metadata?.thumbMediaId;
  const fileName = message.content || "Video";
  const fileSize = message.metadata?.fileSize;

  useEffect(() => {
    if (!thumbMediaId) return;
    getMediaUrl(thumbMediaId, "ORIGINAL")
      .then((entity) => { if ((entity as unknown as { url?: string }).url) setThumbPosterUrl((entity as unknown as { url: string }).url); })
      .catch(() => {});
  }, [thumbMediaId]);

  useEffect(() => {
    if (message.mediaStatus?.toUpperCase() !== "READY") return;
    if (!videoSrc) return;
    if (isPlayingRef.current) { pendingRefreshRef.current = true; }
    else { setVideoSrc(null); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.mediaStatus]);

  useEffect(() => {
    if (!videoSrc || !shouldAutoPlayRef.current) return;
    shouldAutoPlayRef.current = false;
    videoRef.current?.play().catch(() => {});
  }, [videoSrc]);

  const loadAndPlay = useCallback(async () => {
    if (videoSrc || isLoadingUrl || !message.mediaId) return;
    setIsLoadingUrl(true);
    shouldAutoPlayRef.current = true;
    const url = await fetchPlayableUrl(message.mediaId, message.conversationId);
    setIsLoadingUrl(false);
    if (url) { setVideoSrc(url); }
    else { shouldAutoPlayRef.current = false; toast.error("Không thể tải video"); }
  }, [videoSrc, isLoadingUrl, message.mediaId, message.conversationId]);

  const showControlsBriefly = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 2500);
  }, []);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) { el.play().catch(() => {}); }
    else { el.pause(); }
    showControlsBriefly();
  }, [showControlsBriefly]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = videoRef.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    el.currentTime = Math.max(0, Math.min(((e.clientX - rect.left) / rect.width) * duration, duration));
    showControlsBriefly();
  }, [duration, showControlsBriefly]);

  const handleVideoPlay = useCallback(() => {
    setPlaying(true); isPlayingRef.current = true; showControlsBriefly();
  }, [showControlsBriefly]);

  const handleVideoPauseOrEnd = useCallback((ended = false) => {
    setPlaying(false); isPlayingRef.current = false; setShowControls(true);
    if (ended) setCurrentTime(0);
    if (pendingRefreshRef.current) { pendingRefreshRef.current = false; setVideoSrc(null); }
  }, []);

  const handleVideoDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!message.mediaId || isDownloadingVideo) return;
    setIsDownloadingVideo(true);
    try {
      const entity = await getMediaUrl(message.mediaId, "ORIGINAL", message.conversationId);
      const url = (entity as unknown as { url?: string }).url;
      if (url) {
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.target = "_blank";
        a.click();
      }
    } catch {
      toast.error("Không thể tải video");
    } finally {
      setIsDownloadingVideo(false);
    }
  }, [message.mediaId, message.conversationId, fileName, isDownloadingVideo]);

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const fmtTime = (s: number) => {
    if (!s || !Number.isFinite(s)) return "0:00";
    const sec = Math.floor(s);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  };

  const isReady = !message.mediaId || (message.mediaStatus?.toUpperCase() === "READY" || message.mediaStatus == null);

  // ── Uploading state ──────────────────────────────────────────────────────
  if (isUploading) {
    return (
      <div className="relative w-[360px] max-w-full rounded-2xl overflow-hidden bg-black/60">
        <div className="aspect-video flex items-center justify-center">
          {videoSrc
            ? <video src={videoSrc} className="absolute inset-0 w-full h-full object-cover opacity-40" muted preload="metadata" />
            : <Loader2 className="w-8 h-8 text-white/60 animate-spin" />}
        </div>
        {/* Bottom info bar */}
        <div className="flex items-center gap-2 px-3 py-2 bg-black/70">
          <div className="flex-1 min-w-0">
            <p className="text-white text-[11px] font-medium truncate leading-tight">{fileName}</p>
            {fileSize && <p className="text-white/50 text-[10px]">{formatBytes(fileSize)}</p>}
          </div>
        </div>
        <UploadOverlay isMine={isMine} progress={message._uploadProgress} />
      </div>
    );
  }

  // ── Poster (not yet loaded) ──────────────────────────────────────────────
  if (!videoSrc) {
    return (
      <div className="relative w-[360px] max-w-full rounded-2xl overflow-hidden bg-black select-none">
        <div
          className="aspect-video cursor-pointer relative"
          onClick={loadAndPlay}
          role="button"
          aria-label="Phát video"
        >
          {thumbPosterUrl && (
            <img src={thumbPosterUrl} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
          )}
          <div className={cn("absolute inset-0 flex items-center justify-center", thumbPosterUrl ? "bg-black/35" : "bg-black/80")}>
            {isLoadingUrl
              ? <Loader2 className="w-10 h-10 text-white animate-spin" />
              : (
                <div className="w-14 h-14 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center ring-2 ring-white/20 hover:bg-black/75 transition-colors">
                  <Play className="w-6 h-6 text-white ml-0.5" />
                </div>
              )}
          </div>
          {!!message.metadata?.durationMs && !isLoadingUrl && (
            <span className="absolute top-2 right-2.5 text-[11px] font-mono text-white bg-black/60 rounded px-1.5 py-0.5 select-none">
              {fmtTime(message.metadata.durationMs / 1000)}
            </span>
          )}
        </div>
        {/* Zalo-style bottom info bar */}
        <div className="flex items-center gap-2 px-3 py-2 bg-black/80">
          <div className="flex-1 min-w-0">
            <p className="text-white text-[11px] font-medium truncate leading-tight">{fileName}</p>
            {fileSize && <p className="text-white/50 text-[10px]">{formatBytes(fileSize)}</p>}
          </div>
          {isReady && (
            <button
              type="button"
              onClick={handleVideoDownload}
              disabled={isDownloadingVideo}
              className="w-7 h-7 shrink-0 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center text-white transition-colors cursor-pointer disabled:opacity-50"
              title="Tải xuống"
            >
              {isDownloadingVideo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Active player ────────────────────────────────────────────────────────
  return (
    <div
      className="relative w-[360px] max-w-full rounded-2xl overflow-hidden bg-black select-none"
      onMouseMove={showControlsBriefly}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => { if (playing) setShowControls(false); }}
    >
      <video
        ref={videoRef}
        src={videoSrc ?? undefined}
        poster={thumbPosterUrl}
        className="w-full max-h-[280px] block cursor-pointer"
        preload="metadata"
        playsInline
        onPlay={handleVideoPlay}
        onPause={() => handleVideoPauseOrEnd(false)}
        onEnded={() => handleVideoPauseOrEnd(true)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onClick={togglePlay}
      />

      {/* Play/pause + seek controls overlay */}
      <div className={cn("absolute inset-0 flex flex-col justify-end pointer-events-none transition-opacity duration-200", showControls ? "opacity-100" : "opacity-0")}>
        {!playing && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-auto" onClick={togglePlay}>
            <div className="w-14 h-14 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center ring-2 ring-white/20">
              <Play className="w-6 h-6 text-white ml-0.5" />
            </div>
          </div>
        )}
        <div className="pointer-events-auto bg-gradient-to-t from-black/80 via-black/20 to-transparent px-3 pt-6 pb-0">
          <div
            className="w-full h-1 rounded-full bg-white/30 mb-2 cursor-pointer relative group/seek"
            onClick={handleSeek}
          >
            <div className="h-full rounded-full bg-white transition-none" style={{ width: `${progressPct}%` }} />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow opacity-0 group-hover/seek:opacity-100 transition-opacity"
              style={{ left: `calc(${progressPct}% - 6px)` }}
            />
          </div>
          <div className="flex items-center gap-2 pb-0">
            <button type="button" onClick={togglePlay} className="w-7 h-7 flex items-center justify-center text-white hover:opacity-75 cursor-pointer shrink-0">
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>
            <span className="text-white text-[11px] font-mono tabular-nums shrink-0">
              {fmtTime(currentTime)}<span className="opacity-50 mx-0.5">/</span>{fmtTime(duration)}
            </span>
            <div className="flex-1" />
            <button type="button"
              onClick={() => { if (videoRef.current) { videoRef.current.muted = !muted; setMuted((m) => !m); } }}
              className="w-7 h-7 flex items-center justify-center text-white hover:opacity-75 cursor-pointer shrink-0">
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <button type="button" onClick={() => videoRef.current?.requestFullscreen?.()}
              className="w-7 h-7 flex items-center justify-center text-white hover:opacity-75 cursor-pointer shrink-0">
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Zalo-style bottom info bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-black/80">
        <div className="flex-1 min-w-0">
          <p className="text-white text-[11px] font-medium truncate leading-tight">{fileName}</p>
          {fileSize && <p className="text-white/50 text-[10px]">{formatBytes(fileSize)}</p>}
        </div>
        {isReady && (
          <button
            type="button"
            onClick={handleVideoDownload}
            disabled={isDownloadingVideo}
            className="w-7 h-7 shrink-0 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center text-white transition-colors cursor-pointer disabled:opacity-50"
            title="Tải xuống"
          >
            {isDownloadingVideo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

function VoiceMessage({ message, isMine }: { message: Message; isMine: boolean }) {
  const isUploading = typeof message._uploadProgress === "number" && message._uploadProgress < 100;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlayed, setIsPlayed] = useState(false);
  const [audioSrc, setAudioSrc] = useState<string | null>(
    isMine ? message._localPreviewUrl ?? null : null
  );
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);
  
  const fallbackDuration = (message.metadata?.durationMs ?? 0) / 1000;
  const effectiveDuration = normalizeMediaTime(duration) || normalizeMediaTime(fallbackDuration);

  const waveformData = message.metadata?.waveform;
  const BAR_COUNT = 40;
  const bars = useMemo(() => {
    const raw = waveformData ?? [];
    return Array.from({ length: BAR_COUNT }, (_, i) => {
      if (raw.length === 0) return 0.35;
      const idx = Math.floor((i / BAR_COUNT) * raw.length);
      const v = raw[idx] ?? 0;
      return Math.min(1, v > 1 ? v / 255 : v);
    });
  }, [waveformData]);

  const progressRatio = effectiveDuration > 0 ? currentTime / effectiveDuration : 0;

  const togglePlay = useCallback(async () => {
    const el = audioRef.current;
    
    // If we don't have a source yet and not uploading, fetch it
    if (!audioSrc && !isUploading && message.mediaId && !isLoadingUrl) {
      setIsLoadingUrl(true);
      const url = await fetchPlayableUrl(message.mediaId, message.conversationId);
      setIsLoadingUrl(false);
      if (url) {
        setAudioSrc(url);
        // Auto-play handled by didAutoPlayRef effect below
      } else {
        toast.error("Không thể tải âm thanh");
      }
      return;
    }
    
    if (!el || !audioSrc) return;
    
    if (playing) {
      el.pause();
    } else {
      el.play().catch(() => {});
      if (!isPlayed) {
        setIsPlayed(true);
      }
    }
  }, [playing, audioSrc, isPlayed, message.messageId, message.mediaId, message.conversationId, isUploading, isLoadingUrl]);

  // Auto-play once after the URL is first loaded. Use a ref so this never
  // re-fires when `playing` or `isPlayed` change — otherwise pausing would
  // immediately restart playback and create an infinite loop.
  const didAutoPlayRef = useRef(false);
  useEffect(() => {
    if (audioSrc && audioRef.current && !didAutoPlayRef.current) {
      didAutoPlayRef.current = true;
      audioRef.current.play().catch(() => {});
    }
  }, [audioSrc]);

  const handleSeek = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const el = audioRef.current;
    if (!el || !effectiveDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    el.currentTime = ((e.clientX - rect.left) / rect.width) * effectiveDuration;
  }, [effectiveDuration]);

  // Only show loading state when the sender is actively uploading — not for received messages
  if (!audioSrc && isUploading) {
    return (
      <div className="flex items-center gap-2.5 min-w-[220px] max-w-[300px] rounded-2xl border border-border/50 bg-black/5 px-3 py-2.5">
        <CloudUpload className="w-4 h-4 shrink-0 opacity-80" />
        <div className="flex-1 min-w-0">
          <p className={cn("text-xs font-medium", isMine ? "text-white/80" : "text-text")}>Đang tải lên…</p>
          {typeof message._uploadProgress === "number" && (
            <p className={cn("text-[11px] mt-0.5", isMine ? "text-white/60" : "text-muted")}>{message._uploadProgress}%</p>
          )}
        </div>
      </div>
    );
  }


  return (
    <div className="relative flex items-center gap-2.5 min-w-[240px] max-w-[320px] rounded-2xl border border-border/40 bg-black/5 px-3 py-2.5">
      {audioSrc && (
        <audio
          ref={audioRef}
          src={audioSrc}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setCurrentTime(0); }}
          onTimeUpdate={(e) => setCurrentTime(normalizeMediaTime(e.currentTarget.currentTime))}
          onLoadedMetadata={(e) => setDuration(normalizeMediaTime(e.currentTarget.duration))}
          onDurationChange={(e) => setDuration(normalizeMediaTime(e.currentTarget.duration))}
        />
      )}

      {/* Play / Pause */}
      <button
        type="button"
        onClick={togglePlay}
        disabled={isLoadingUrl}
        className={cn(
          "w-8 h-8 shrink-0 rounded-full flex items-center justify-center transition-colors cursor-pointer",
          "bg-border/60 hover:bg-border/80 text-text",
          isLoadingUrl && "opacity-50 cursor-wait"
        )}
      >
        {isLoadingUrl ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : playing ? (
          <Pause className="w-3.5 h-3.5" />
        ) : (
          <Play className="w-3.5 h-3.5 ml-0.5" />
        )}
      </button>

      {/* Waveform + timer */}
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <svg
          viewBox="0 0 100 24"
          className="w-full h-6 cursor-pointer overflow-visible"
          onClick={handleSeek}
        >
          {bars.map((amp, i) => {
            const barH = Math.max(2, amp * 20);
            const x = (i + 0.5) * (100 / BAR_COUNT);
            const filled = i < Math.round(progressRatio * BAR_COUNT);
            const fillColor = filled
              ? isMine ? "rgba(255,255,255,0.9)" : "var(--color-cta)"
              : isMine ? "rgba(255,255,255,0.3)" : "var(--color-border)";
            return (
              <rect
                key={i}
                x={x - 0.9}
                y={12 - barH / 2}
                width={1.8}
                height={barH}
                rx={0.9}
                style={{ fill: fillColor }}
              />
            );
          })}
        </svg>

        <div className="flex items-center gap-1">
          <span className={cn("text-[10px] tabular-nums font-mono", isMine ? "text-white/60" : "text-muted")}>
            {formatVoiceDuration(playing || currentTime > 0 ? currentTime : effectiveDuration)}
          </span>
          {isUploading && typeof message._uploadProgress === "number" && (
            <span className={cn("text-[10px]", isMine ? "text-white/60" : "text-muted")}>{message._uploadProgress}%</span>
          )}
          {/* Blue dot: receiver hasn't listened yet */}
          {!isMine && !isPlayed && (
            <div className="w-1.5 h-1.5 rounded-full bg-cta shrink-0" title="Chưa nghe" />
          )}
        </div>
      </div>

      {isUploading && (
        <div className="absolute inset-x-3 bottom-1.5">
          <UploadProgressBar isMine={isMine} progress={message._uploadProgress} compact />
        </div>
      )}
    </div>
  );
}

function normalizeMediaTime(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

function formatVoiceDuration(s: number): string {
  if (!s || !Number.isFinite(s)) return "0:00";
  const sec = Math.floor(s);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

// ─── File type helpers ────────────────────────────────────────────────────────

function fileExtIcon(filename: string): { icon: React.ReactNode; color: string; label: string } {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["pdf"].includes(ext))
    return { icon: <FileText className="w-5 h-5" />, color: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400", label: "PDF" };
  if (["doc", "docx"].includes(ext))
    return { icon: <FileType2 className="w-5 h-5" />, color: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400", label: "Word" };
  if (["xls", "xlsx", "csv"].includes(ext))
    return { icon: <FileSpreadsheet className="w-5 h-5" />, color: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400", label: "Excel" };
  if (["ppt", "pptx"].includes(ext))
    return { icon: <FileText className="w-5 h-5" />, color: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400", label: "PPT" };
  if (["zip", "rar", "7z"].includes(ext))
    return { icon: <FileText className="w-5 h-5" />, color: "bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400", label: "Archive" };
  if (["txt"].includes(ext))
    return { icon: <FileText className="w-5 h-5" />, color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400", label: "Text" };
  return { icon: <FileText className="w-5 h-5" />, color: "bg-border/60 text-muted", label: ext.toUpperCase() || "File" };
}

function canPreviewFile(filename: string): "pdf" | "office" | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (["doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext)) return "office";
  return null;
}

// ─── File Preview Modal ───────────────────────────────────────────────────────

function FilePreviewModal({ url, filename, onClose }: { url: string; filename: string; onClose: () => void }) {
  const previewType = canPreviewFile(filename);
  const officeUrl = previewType === "office"
    ? `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(url)}`
    : null;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 flex flex-col" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex items-center justify-between px-4 py-3 bg-surface border-b border-border shrink-0">
        <p className="text-sm font-medium text-text truncate max-w-[60%]">{filename}</p>
        <div className="flex items-center gap-2">
          <a
            href={url}
            download={filename}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cta/10 text-cta text-sm hover:bg-cta/20 transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Tải xuống</span>
          </a>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-text hover:bg-border/60 cursor-pointer">
            <XIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {previewType === "pdf" && (
          <iframe
            src={`${url}#toolbar=0`}
            className="w-full h-full border-0"
            title={filename}
          />
        )}
        {previewType === "office" && officeUrl && (
          <iframe
            src={officeUrl}
            className="w-full h-full border-0"
            title={filename}
          />
        )}
      </div>
    </div>
  );
}

// ─── MediaFile ────────────────────────────────────────────────────────────────

function MediaFile({
  message,
  mediaId,
  filename,
  status,
  isMine,
  conversationId,
}: {
  message?: Message;
  mediaId?: string;
  filename?: string;
  status?: string;
  isMine: boolean;
  conversationId?: string;
}) {
  const resolvedFilename = message?.content || filename || "File";
  const resolvedStatus = message?.mediaStatus ?? status;
  const resolvedMediaId = message?.mediaId ?? mediaId;
  const resolvedConversationId = message?.conversationId ?? conversationId;
  const isReady = !resolvedStatus || resolvedStatus?.toUpperCase() === "READY";
  const fileSize = message?.metadata?.fileSize;
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const previewType = canPreviewFile(resolvedFilename);
  const { icon, color } = fileExtIcon(resolvedFilename);

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

  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    const url = await fetchUrl();
    if (url) window.open(url, "_blank");
  }, [fetchUrl]);

  const handlePreview = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    const url = await fetchUrl();
    if (url) setShowPreview(true);
  }, [fetchUrl]);

  return (
    <>
      <div className={cn(
        "min-w-[280px] max-w-[380px] rounded-2xl px-4 py-3.5",
        isMine
          ? "bg-white/15 border border-white/20"
          : "bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60"
      )}>
        <div className="flex items-center gap-3">
          {/* File type icon */}
          <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-base font-bold", color)}>
            {icon}
          </div>
          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className={cn("text-sm font-semibold truncate leading-snug", isMine ? "text-white" : "text-slate-800 dark:text-slate-100")}>
              {resolvedFilename}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {fileSize && (
                <span className={cn("text-[11px]", isMine ? "text-white/60" : "text-slate-400 dark:text-slate-500")}>
                  {formatBytes(fileSize)}
                </span>
              )}
              {fileSize && <span className={cn("text-[10px]", isMine ? "text-white/30" : "text-slate-300")}>{" · "}</span>}
              <span className={cn("text-[11px]", isMine ? "text-white/60" : "text-slate-400 dark:text-slate-500")}>
                {mediaStatusLabel(resolvedStatus)}
              </span>
            </div>
          </div>
          {/* Action buttons */}
          {isReady && (
            <div className="flex items-center gap-1 shrink-0">
              {previewType && (
                <button
                  onClick={handlePreview}
                  disabled={isLoadingUrl}
                  className={cn(
                    "w-9 h-9 rounded-xl flex items-center justify-center hover:opacity-80 transition-opacity cursor-pointer disabled:opacity-40",
                    isMine ? "bg-white/20 text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                  )}
                  title="Xem trước"
                >
                  {isLoadingUrl ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                </button>
              )}
              <button
                onClick={handleDownload}
                disabled={isLoadingUrl && !fileUrl}
                className={cn(
                  "w-9 h-9 rounded-xl flex items-center justify-center hover:opacity-80 transition-opacity cursor-pointer disabled:opacity-40",
                  isMine ? "bg-white/20 text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                )}
                title="Tải về"
              >
                {isLoadingUrl && !fileUrl ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              </button>
            </div>
          )}
        </div>
        {!isReady && <UploadProgressBar isMine={isMine} progress={message?._uploadProgress} />}
      </div>

      {showPreview && fileUrl && (
        <FilePreviewModal url={fileUrl} filename={resolvedFilename} onClose={() => setShowPreview(false)} />
      )}
    </>
  );
}

function AttachmentGrid({ attachments, isMine, conversationId }: { attachments: AttachmentRef[]; isMine: boolean; conversationId?: string }) {
  const images = attachments.filter((a) => a.type === "image" || a.type == null);
  const others = attachments.filter((a) => a.type != null && a.type !== "image");
  return (
    <div className="space-y-1">
      {images.length > 0 && (
        <div className={cn("grid gap-1", images.length === 1 ? "grid-cols-1" : images.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
          {images.map((a) => <AttachmentThumb key={a.mediaId} attachment={a} conversationId={conversationId} />)}
        </div>
      )}
      {others.map((a) => <MediaFile key={a.mediaId} mediaId={a.mediaId} filename={a.filename} status="READY" isMine={isMine} conversationId={conversationId} />)}
    </div>
  );
}

function AttachmentThumb({ attachment, conversationId }: { attachment: AttachmentRef; conversationId?: string }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Ref-based guard prevents the IntersectionObserver from firing a second
  // fetch when `isLoading` state change causes the effect to run again.
  const isLoadingRef = useRef(false);
  const thumbRef = useRef<HTMLDivElement>(null);
  
  // Lazy load on intersection
  useEffect(() => {
    if (!attachment.mediaId || thumbUrl) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !thumbUrl && !isLoadingRef.current) {
          isLoadingRef.current = true;
          setIsLoading(true);
          getPlayInfo(attachment.mediaId, conversationId)
            .then((playInfo) => setThumbUrl(playInfo.url))
            .catch(() => {})
            .finally(() => { isLoadingRef.current = false; setIsLoading(false); });
        }
      },
      { rootMargin: "50px" }
    );
    
    if (thumbRef.current) observer.observe(thumbRef.current);
    return () => observer.disconnect();
  }, [attachment.mediaId, conversationId, thumbUrl]);
  
  if (thumbUrl) {
    return (
      <div ref={thumbRef} className="rounded-lg overflow-hidden aspect-square bg-border/20">
        <img src={thumbUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
      </div>
    );
  }
  return (
    <div ref={thumbRef} className="rounded-lg aspect-square bg-border/20 flex items-center justify-center">
      <span className="text-[10px] text-muted">{isLoading ? "..." : "…"}</span>
    </div>
  );
}

function UploadOverlay({ isMine, progress }: { isMine: boolean; progress?: number }) {
  return (
    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 via-black/25 to-transparent px-3 py-2.5">
      <div className="flex items-center justify-end gap-3 text-[11px] text-white/90">
        {typeof progress === "number" && progress < 100 && <span>{progress}%</span>}
      </div>
      <UploadProgressBar isMine={isMine} progress={progress} compact />
    </div>
  );
}

function UploadProgressBar({
  isMine,
  progress,
  compact = false,
}: {
  isMine: boolean;
  progress?: number;
  compact?: boolean;
}) {
  const value = Math.max(0, Math.min(progress ?? 0, 100));
  return (
    <div className={cn("mt-2 overflow-hidden rounded-full", compact ? "h-1" : "h-1.5", isMine ? "bg-white/15" : "bg-border/70")}>
      <div
        className={cn("h-full rounded-full transition-all duration-200", isMine ? "bg-white/85" : "bg-cta")}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function mediaStatusLabel(status?: string) {
  switch (status?.toUpperCase()) {
    case "READY":      return "Sẵn sàng";
    case "PROCESSING": return "Đang xử lý…";
    case "UPLOADED":   return "Đang tải lên…";
    case "FAILED":     return "Thất bại";
    default:           return "Đang chờ…";
  }
}

function MessageStatusIcon({ message, otherMembers }: { message: Message & { _pending?: boolean; _failed?: boolean }; otherMembers: OtherMember[] }) {
  if (message._failed) return <AlertCircle className="w-3 h-3 text-error shrink-0" />;
  if (message._pending || message.offset == null || message.offset < 0) return <Clock className="w-3 h-3 text-muted shrink-0" />;

  const offset = message.offset;
  const seenBy = otherMembers.filter((m) => offset > 0 && m.lastSeenOffset >= offset);

  if (seenBy.length > 0) {
    return (
      <div className="flex items-center -space-x-0.5 shrink-0">
        {seenBy.slice(0, 3).map((m) => (
          <div key={m.userId} className="w-3.5 h-3.5 rounded-full overflow-hidden ring-1 ring-surface shrink-0">
            {m.avatarUrl ? (
              <img src={m.avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-cta flex items-center justify-center text-[6px] text-white font-bold">
                {(m.displayName ?? m.username ?? "?")[0].toUpperCase()}
              </div>
            )}
          </div>
        ))}
        {seenBy.length > 3 && (
          <div className="w-3.5 h-3.5 rounded-full bg-border text-[6px] text-muted flex items-center justify-center ring-1 ring-surface shrink-0">
            +{seenBy.length - 3}
          </div>
        )}
      </div>
    );
  }

  const deliveredTo = otherMembers.filter((m) => offset > 0 && m.lastDeliveredOffset >= offset);
  if (deliveredTo.length > 0) return <CheckCheck className="w-3 h-3 text-cta shrink-0" />;
  return <Check className="w-3 h-3 text-muted shrink-0" />;
}