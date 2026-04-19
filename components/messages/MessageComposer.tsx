"use client";

import { ReplyPreview } from "./ReplyPreview";
import { StickerPicker } from "./StickerPicker";
import { useTyping } from "@/hooks/useTyping";
import { useSendMessage } from "@/hooks/useSendMessage";
import { uploadFileDirect } from "@/hooks/useMediaUpload";
import { captureVideoFrame, uploadVideoThumbnail } from "@/lib/utils/videoThumbnail";
import { useConversationStore } from "@/stores/conversationStore";
import { editMessage } from "@/lib/api/messages";
import { getQueryClient } from "@/lib/query/queryClient";
import { queryKeys } from "@/lib/query/keys";
import type { MessagesInfiniteData } from "@/hooks/useMessages";
import { useRef, useState, useCallback, useEffect, type KeyboardEvent } from "react";
import { Send, Paperclip, X, Smile, Loader2, Pencil, Mic, FileText, Film } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Sticker } from "@/lib/api/stickers";
import { toast } from "sonner";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp", "image/tiff",
];
const ALLOWED_VIDEO_TYPES = [
  "video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/x-matroska",
];
const ALLOWED_FILE_TYPES = [
  "application/pdf",
  "application/zip", "application/x-zip", "application/x-zip-compressed",
  "application/x-rar-compressed",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain", "text/csv",
];

const ALL_ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES, ...ALLOWED_FILE_TYPES];
const ACCEPTED_MIME = ALL_ALLOWED_TYPES.join(",");

// ─── Staged attachment ────────────────────────────────────────────────────────

type AttachmentMediaType = "image" | "video" | "audio" | "file";

interface StagedFile {
  id: string;
  file: File;
  previewUrl?: string;      // blob URL for image/video preview chip
  thumbPreviewUrl?: string; // local blob URL of captured frame — chip display only, NOT sent
  mediaType: AttachmentMediaType;
}

function detectMediaType(mimeType: string): AttachmentMediaType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

interface MessageComposerProps {
  conversationId: string;
  disabled?: boolean;
  placeholder?: string;
}

export function MessageComposer({
  conversationId,
  disabled,
  placeholder = "Type a message…",
}: MessageComposerProps) {
  const [text, setText] = useState("");
  const [showStickers, setShowStickers] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const { send } = useSendMessage();
  const { onKeystroke, stopTyping } = useTyping(conversationId);
  const replyTo = useConversationStore((s) => s.replyToMessage);
  const setReplyTo = useConversationStore((s) => s.setReplyTo);
  const editingMessage = useConversationStore((s) => s.editingMessage);
  const setEditingMessage = useConversationStore((s) => s.setEditingMessage);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tracks ongoing thumbnail upload promises keyed by staged-file id.
  const thumbUploadPromises = useRef<Map<string, Promise<string | null>>>(new Map());

  // Track current staged files for unmount cleanup
  const stagedFilesRef = useRef(stagedFiles);
  useEffect(() => { stagedFilesRef.current = stagedFiles; }, [stagedFiles]);
  useEffect(() => {
    return () => {
      stagedFilesRef.current.forEach((sf) => {
        if (sf.previewUrl) URL.revokeObjectURL(sf.previewUrl);
        if (sf.thumbPreviewUrl) URL.revokeObjectURL(sf.thumbPreviewUrl);
      });
    };
  }, []);

  // Pre-fill textarea when edit mode is activated
  useEffect(() => {
    if (editingMessage) {
      setText(editingMessage.content);
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [editingMessage]);

  const canSend =
    (text.trim().length > 0 || stagedFiles.length > 0) && !disabled;

  // ─── Voice recording ──────────────────────────────────────────────────────
  const {
    state: recState, durationMs, volumeHistory, audioBlob, mimeType: recMimeType,
    start: startRec, stop: stopRec, cancel: cancelRec, reset: resetRec,
  } = useVoiceRecorder();
  const [voiceUploading, setVoiceUploading] = useState(false);
  const pendingSendRef = useRef(false);

  /**
   * Decode the audio blob locally to extract precise duration + waveform.
   * Returns { durationMs, waveform } where waveform is a 0–1 normalized array.
   */
  const analyzeAudioBlob = useCallback(async (blob: Blob): Promise<{ durationMs: number; waveform: number[] }> => {
    const WAVEFORM_BARS = 64;
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const audioCtx = new AudioContext();
      const decoded = await audioCtx.decodeAudioData(arrayBuffer);
      const durationMs = Math.round(decoded.duration * 1000);
      const channelData = decoded.getChannelData(0); // mono / first channel
      const samplesPerBar = Math.floor(channelData.length / WAVEFORM_BARS);
      const waveform: number[] = [];
      let peak = 0;
      const rawAmplitudes: number[] = [];
      for (let i = 0; i < WAVEFORM_BARS; i++) {
        let sum = 0;
        const start = i * samplesPerBar;
        for (let j = start; j < start + samplesPerBar && j < channelData.length; j++) {
          sum += Math.abs(channelData[j]);
        }
        const avg = sum / samplesPerBar;
        rawAmplitudes.push(avg);
        if (avg > peak) peak = avg;
      }
      // Normalize 0–1
      for (const amp of rawAmplitudes) {
        waveform.push(peak > 0 ? Number((amp / peak).toFixed(3)) : 0);
      }
      await audioCtx.close();
      return { durationMs, waveform };
    } catch {
      return {
        durationMs,
        waveform: volumeHistory.length > 0
          ? volumeHistory.map((v) => Number(v.toFixed(3)))
          : [],
      };
    }
  }, [durationMs, volumeHistory]);

  const sendVoiceBlob = useCallback(async (blob: Blob, mimeType: string) => {
    setVoiceUploading(true);
    try {
      const normalizedMime = mimeType.split(";")[0].trim();
      const extension = normalizedMime.includes("ogg") ? "ogg" : "webm";
      const uploadBlob = new Blob([blob], { type: normalizedMime });
      const localPreviewUrl = URL.createObjectURL(uploadBlob);

      // Decode actual audio for precise waveform + duration
      const { durationMs: realDuration, waveform } = await analyzeAudioBlob(blob);

      send({
        conversationId,
        type: "audio",
        content: "",
        replyToMessageId: replyTo?.messageId,
        localPreviewUrl,
        metadata: {
          durationMs: realDuration,
          waveform,
        },
        uploadFile: async (onProgress) => uploadFileDirect(
          new File([uploadBlob], `voice.${extension}`, { type: normalizedMime }),
          conversationId,
          onProgress
        ),
      });
      setReplyTo(null);
    } catch {
      toast.error("Không thể gửi tin nhắn thoại");
    } finally {
      setVoiceUploading(false);
      resetRec();
    }
  }, [send, conversationId, replyTo, setReplyTo, resetRec, analyzeAudioBlob]);

  useEffect(() => {
    if (recState !== "recorded" || !audioBlob || !pendingSendRef.current) return;
    pendingSendRef.current = false;
    sendVoiceBlob(audioBlob, recMimeType);
  }, [recState, audioBlob, recMimeType, sendVoiceBlob]);

  const handleStopAndSend = useCallback(() => {
    pendingSendRef.current = true;
    stopRec();
  }, [stopRec]);

  const fmtRecDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  const handleInput = (value: string) => {
    setText(value);
    onKeystroke();
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  };

  // ─── File staging ─────────────────────────────────────────────────────────
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, 30);
    e.target.value = "";
    if (files.length === 0) return;

    // Validate each file's MIME type
    const allowed: File[] = [];
    const rejected: string[] = [];
    for (const file of files) {
      if (ALL_ALLOWED_TYPES.includes(file.type)) {
        allowed.push(file);
      } else {
        rejected.push(file.name);
      }
    }
    if (rejected.length > 0) {
      toast.error(
        `Định dạng không được hỗ trợ: ${rejected.join(", ")}. Chỉ chấp nhận ảnh, video, PDF, Office và file nén.`,
        { duration: 5000 }
      );
    }
    if (allowed.length === 0) return;

    const newStaged: StagedFile[] = allowed.map((file) => {
      const mediaType = detectMediaType(file.type);
      const previewUrl =
        mediaType === "image" || mediaType === "video"
          ? URL.createObjectURL(file)
          : undefined;
      return { id: crypto.randomUUID(), file, previewUrl, mediaType };
    });
    setStagedFiles((prev) => [...prev, ...newStaged].slice(0, 30));

    // For video files: capture frame immediately for the chip preview,
    // then upload the blob to MinIO in background so thumbMediaId is ready by send time.
    newStaged
      .filter((sf) => sf.mediaType === "video")
      .forEach((sf) => {
        const uploadPromise = captureVideoFrame(sf.file).then((blob) => {
          if (!blob) return null;
          // Show local preview in chip while upload runs
          const localUrl = URL.createObjectURL(blob);
          setStagedFiles((prev) =>
            prev.map((f) => (f.id === sf.id ? { ...f, thumbPreviewUrl: localUrl } : f))
          );
          return uploadVideoThumbnail(blob);
        });
        thumbUploadPromises.current.set(sf.id, uploadPromise);
      });
  }, []);

  const removeStagedFile = useCallback((id: string) => {
    setStagedFiles((prev) => {
      const sf = prev.find((f) => f.id === id);
      if (sf?.previewUrl) URL.revokeObjectURL(sf.previewUrl);
      if (sf?.thumbPreviewUrl) URL.revokeObjectURL(sf.thumbPreviewUrl);
      thumbUploadPromises.current.delete(id);
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  // ─── Send ─────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!canSend) return;

    // Edit mode: text only
    if (editingMessage) {
      if (!text.trim()) return;
      try {
        await editMessage(editingMessage.messageId, text.trim());
        const qc = getQueryClient();
        qc.setQueryData(
          queryKeys.messages.list(conversationId),
          (old: MessagesInfiniteData | undefined) => {
            if (!old) return old;
            return {
              ...old,
              pages: old.pages.map((p) => ({
                ...p,
                data: p.data.map((m) =>
                  m.messageId === editingMessage.messageId
                    ? { ...m, content: text.trim(), editedAt: new Date().toISOString() }
                    : m
                ),
              })),
            };
          }
        );
      } catch (err) {
        if ((err as { response?: { status?: number } }).response?.status === 403) {
          toast.error("Đã quá thời gian cho phép thực hiện thao tác");
        }
      }
      setText("");
      stopTyping();
      setEditingMessage(null);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      return;
    }

    // Files staged → upload THEN send
    if (stagedFiles.length > 0) {
      const queuedFiles = [...stagedFiles];
      const caption = text.trim();
      const replyTarget = replyTo?.messageId;

      setStagedFiles([]);
      setText("");
      stopTyping();
      setReplyTo(null);
      if (textareaRef.current) textareaRef.current.style.height = "auto";

      if (caption) {
        send({
          conversationId,
          content: caption,
          type: "text",
          replyToMessageId: replyTarget,
        });
      }

      for (let index = 0; index < queuedFiles.length; index++) {
        const stagedFile = queuedFiles[index];
        const fileName = stagedFile.file.name;
        const type = stagedFile.mediaType;

        // For video files: await the thumbnail upload (started at staging time).
        // Typically done by now since the user has had time to review; worst case <500ms wait.
        let thumbMediaId: string | undefined;
        if (type === "video") {
          const thumbPromise = thumbUploadPromises.current.get(stagedFile.id);
          if (thumbPromise) {
            thumbMediaId = (await thumbPromise) ?? undefined;
          }
          thumbUploadPromises.current.delete(stagedFile.id);
        }

        send({
          conversationId,
          content: fileName,
          type,
          replyToMessageId: !caption && index === 0 ? replyTarget : undefined,
          localPreviewUrl: stagedFile.previewUrl,
          metadata: {
            ...(thumbMediaId ? { thumbMediaId } : {}),
            fileSize: stagedFile.file.size,
          },
          uploadFile: (onProgress) => uploadFileDirect(stagedFile.file, conversationId, onProgress),
        }).catch(() => {
          toast.error(`Không thể gửi ${fileName}`);
        });
      }

      return;
    }

    // Text only
    send({
      conversationId,
      content: text.trim(),
      type: "text",
      replyToMessageId: replyTo?.messageId,
    });
    setText("");
    stopTyping();
    setReplyTo(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleSendSticker = (sticker: Sticker) => {
    send({ conversationId, type: "sticker", metadata: { url: sticker.url } });
    setShowStickers(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="relative shrink-0 border-t border-border bg-surface px-4 py-3">
      {/* Edit mode banner */}
      {editingMessage && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-lg bg-border/30">
          <Pencil className="w-3 h-3 text-cta shrink-0" />
          <span className="flex-1 text-xs text-muted">Đang chỉnh sửa</span>
          <button type="button" onClick={() => { setEditingMessage(null); setText(""); }}
            className="text-muted hover:text-text cursor-pointer" title="Hủy">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Reply preview strip */}
      {replyTo && (
        <ReplyPreview
          content={replyTo.content}
          senderName={replyTo.senderName ?? replyTo.senderId}
          type={replyTo.type}
          onClose={() => setReplyTo(null)}
        />
      )}

      {/* Staged file previews */}
      {stagedFiles.length > 0 && (
        <div className="mb-2">
          <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-none">
            {stagedFiles.map((sf) => (
              <StagedFileCard
                key={sf.id}
                sf={sf}
                onRemove={removeStagedFile}
                sending={false}
              />
            ))}
            {stagedFiles.length < 30 && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-20 h-20 shrink-0 rounded-2xl border-2 border-dashed border-border flex items-center justify-center text-muted hover:text-secondary hover:border-secondary transition-colors cursor-pointer"
                title="Thêm file"
              >
                <Paperclip className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sticker picker popover */}
      {showStickers && (
        <div className="absolute bottom-[72px] left-4 z-50">
          <StickerPicker onSelect={handleSendSticker} />
        </div>
      )}

      {/* ── Recording mode ──────────────────────────────────────────────── */}
      {(recState !== "idle" || voiceUploading) ? (
        <div className="flex items-center gap-2 rounded-xl border border-error/50 bg-error/5 px-3 py-2 min-h-[44px]">
          {/* Cancel */}
          <button
            type="button"
            onClick={cancelRec}
            disabled={voiceUploading}
            className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-muted hover:bg-border/60 transition-colors cursor-pointer disabled:opacity-40"
            title="Hủy"
          >
            <X className="w-3.5 h-3.5" />
          </button>

          {/* Live amplitude bars */}
          <div className="flex-1 flex items-center gap-px h-8 overflow-hidden">
            {Array.from({ length: 40 }, (_, i) => {
              const vol = volumeHistory[Math.max(0, volumeHistory.length - 40 + i)] ?? 0;
              return (
                <div
                  key={i}
                  style={{ height: `${Math.max(8, vol * 100)}%` }}
                  className="w-1 rounded-full bg-error/60 transition-[height] duration-75 shrink-0"
                />
              );
            })}
          </div>

          {/* Timer */}
          <span className="text-xs text-muted tabular-nums font-mono shrink-0 min-w-[32px] text-right">
            {fmtRecDuration(durationMs)}
          </span>

          {/* Stop + Send */}
          <button
            type="button"
            onClick={handleStopAndSend}
            disabled={voiceUploading || recState !== "recording"}
            className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center bg-cta text-white hover:opacity-90 transition-colors cursor-pointer disabled:opacity-50"
            title="Dừng và gửi"
          >
            {voiceUploading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Send className="w-3.5 h-3.5" />}
          </button>
        </div>
      ) : (
      <div className={cn(
        "flex items-end gap-2 rounded-xl border border-border bg-bg px-3 py-2 transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10",
        disabled && "opacity-50"
      )}>
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_MIME}
          className="sr-only"
          onChange={handleFileChange}
          aria-hidden="true"
        />

        {/* Attach file button */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-muted hover:text-secondary hover:bg-border/50 transition-colors cursor-pointer mb-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Đính kèm file"
        >
          <Paperclip className="w-4 h-4" />
        </button>

        {/* Sticker */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setShowStickers((v) => !v)}
          className={cn(
            "w-8 h-8 shrink-0 flex items-center justify-center rounded-lg transition-colors cursor-pointer mb-0.5",
            showStickers
              ? "text-primary bg-primary/10"
              : "text-muted hover:text-secondary hover:bg-border/50"
          )}
          title="Stickers"
        >
          <Smile className="w-4 h-4" />
        </button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={stagedFiles.length > 0 ? "Thêm nội dung kèm theo…" : placeholder}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 min-w-0 resize-none bg-transparent text-sm text-text placeholder:text-muted outline-none leading-relaxed max-h-[200px] overflow-y-auto py-1"
        />

        {/* Mic — only when no text, no staged files, not editing */}
        {!text.trim() && !editingMessage && stagedFiles.length === 0 && (
          <button
            type="button"
            onClick={startRec}
            disabled={disabled}
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-muted hover:text-secondary hover:bg-border/50 transition-colors cursor-pointer mb-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Tin nhắn thoại"
          >
            <Mic className="w-4 h-4" />
          </button>
        )}

        {/* Send */}
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className={cn(
            "w-8 h-8 shrink-0 flex items-center justify-center rounded-lg transition-all cursor-pointer mb-0.5",
            canSend
              ? "bg-cta text-white hover:opacity-90"
              : "bg-border text-muted cursor-not-allowed"
          )}
          title="Gửi (Enter)"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
      )}

      <p className="text-[10px] text-muted mt-1 ml-1">
        <kbd className="font-mono">Enter</kbd> to send · <kbd className="font-mono">Shift+Enter</kbd> for new line
      </p>
    </div>
  );
}

// ─── Staged file preview card ─────────────────────────────────────────────────

function StagedFileCard({
  sf,
  onRemove,
  sending,
}: {
  sf: StagedFile;
  onRemove: (id: string) => void;
  sending: boolean;
}) {
  return (
    <div className="relative shrink-0 group">
      {sf.mediaType === "image" && sf.previewUrl ? (
        <div className="w-[88px] h-[88px] rounded-2xl overflow-hidden bg-border/40 ring-1 ring-border/60">
          <img src={sf.previewUrl} alt={sf.file.name} className="w-full h-full object-cover" />
        </div>
      ) : sf.mediaType === "video" ? (
        <div className="w-[88px] h-[88px] rounded-2xl overflow-hidden bg-black/30 relative flex items-center justify-center ring-1 ring-border/60">
          {sf.thumbPreviewUrl ? (
            <img src={sf.thumbPreviewUrl} alt={sf.file.name} className="w-full h-full object-cover" />
          ) : (
            <video
              src={sf.previewUrl}
              className="w-full h-full object-cover opacity-60"
              muted
              preload="metadata"
            />
          )}
          <Film className="absolute w-6 h-6 text-white drop-shadow pointer-events-none" />
        </div>
      ) : (
        <div className="w-52 h-[68px] rounded-2xl bg-border/25 border border-border/50 flex items-center gap-3 px-3.5 overflow-hidden">
          <div className="w-10 h-10 rounded-xl bg-border/60 flex items-center justify-center shrink-0">
            <FileText className="w-4.5 h-4.5 text-secondary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text truncate leading-tight">{sf.file.name}</p>
            <p className="text-[11px] text-muted mt-0.5">{formatBytes(sf.file.size)}</p>
          </div>
        </div>
      )}

      {!sending && (
        <button
          type="button"
          onClick={() => onRemove(sf.id)}
          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-surface border border-border/80 flex items-center justify-center text-muted hover:text-error hover:bg-error/10 transition-colors cursor-pointer shadow-sm opacity-0 group-hover:opacity-100"
          title="Xóa"
        >
          <X className="w-3 h-3" />
        </button>
      )}

      {(sf.mediaType === "image" || sf.mediaType === "video") && (
        <div className="absolute bottom-0 left-0 right-0 rounded-b-xl bg-black/50 px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <p className="text-[9px] text-white truncate">{sf.file.name}</p>
        </div>
      )}
    </div>
  );
}
