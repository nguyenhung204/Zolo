"use client";

import { ReplyPreview } from "./ReplyPreview";
import EmojiPicker, { EmojiStyle } from "emoji-picker-react";
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
import { Send, Paperclip, X, Smile, Loader2, Pencil, Mic, FileText, Film, Contact, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Sticker } from "@/lib/api/stickers";
import { toast } from "sonner";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useConversation, useConversationMembers, useMyConversationRole } from "@/hooks/useConversations";
import { useAuthStore } from "@/stores/authStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { MentionPicker, type MentionMember } from "./MentionPicker";
import { useFriendProfiles } from "@/hooks/useFriendProfiles";
import { hasMinRole } from "@/lib/api/group";
import type { UserProfile } from "@/lib/api/users";
import { ShieldOff, Users as UsersIcon } from "lucide-react";

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

// Videos under this size are grouped with images into one media message
const LARGE_VIDEO_THRESHOLD = 20 * 1024 * 1024; // 20 MB

// ─── Staged attachment ────────────────────────────────────────────────────────

type AttachmentMediaType = "image" | "video" | "audio" | "file";

interface StagedFile {
  id: string;
  file: File;
  previewUrl?: string;      // blob URL for image/video preview chip
  thumbPreviewUrl?: string; // local blob URL of captured frame — chip display only, NOT sent
  mediaType: AttachmentMediaType;
  width?: number;
  height?: number;
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

const MAX_CONTENT_LENGTH = 10_000;

async function getImageSize(file: File): Promise<{ width: number; height: number } | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    const loaded = new Promise<{ width: number; height: number }>((resolve, reject) => {
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("Image load failed"));
    });
    img.src = url;
    const size = await loaded;
    return size.width && size.height ? size : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function splitContent(content: string): string[] {
  if (content.length <= MAX_CONTENT_LENGTH) return [content];
  const chunks: string[] = [];
  for (let i = 0; i < content.length; i += MAX_CONTENT_LENGTH) {
    chunks.push(content.slice(i, i + MAX_CONTENT_LENGTH));
  }
  return chunks;
}

interface MessageComposerProps {
  conversationId: string;
  disabled?: boolean;
  placeholder?: string;
}

// Subset of UserProfile we need to render a contact card row.
type ContactPickUser = Pick<
  UserProfile,
  "id" | "username" | "firstName" | "lastName" | "avatarUrl"
>;

// Filter the friend list locally by name / username. Excludes self.
function useFriendList(
  friends: UserProfile[],
  query: string,
  myId: string,
): ContactPickUser[] {
  const q = query.trim().toLowerCase();
  return friends
    .filter((u) => u.id !== myId)
    .filter((u) => {
      if (!q) return true;
      const fullName = `${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase();
      return (
        u.username.toLowerCase().includes(q) ||
        fullName.includes(q) ||
        (u.email ?? "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const an = `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim() || a.username;
      const bn = `${b.firstName ?? ""} ${b.lastName ?? ""}`.trim() || b.username;
      return an.localeCompare(bn);
    });
}

export function MessageComposer({
  conversationId,
  disabled,
  placeholder = "Type a message…",
}: MessageComposerProps) {
  const [text, setText] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [contactQuery, setContactQuery] = useState("");
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const { send } = useSendMessage();
  const { onKeystroke, stopTyping } = useTyping(conversationId);
  const replyTo = useConversationStore((s) => s.replyToMessage);
  const setReplyTo = useConversationStore((s) => s.setReplyTo);
  const editingMessage = useConversationStore((s) => s.editingMessage);
  const setEditingMessage = useConversationStore((s) => s.setEditingMessage);
  const enterToSend = usePreferencesStore((s) => s.enterToSend);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ─── Mention state ────────────────────────────────────────────────────────
  const myId = useAuthStore((s) => s.user?.id ?? "");
  const { data: conversation } = useConversation(conversationId);
  const { data: rawMembers = [] } = useConversationMembers(conversationId);
  const isMentionSupported =
    conversation?.kind === "group" || conversation?.kind === "community";
  // My role in this conversation
  const myRoleFromMembers = rawMembers.find((m) => m.userId === myId)?.role;
  const myRoleFromHook = useMyConversationRole(conversationId);
  const myRole = myRoleFromMembers ?? myRoleFromHook;
  const canMentionAll = !!myRole;

  // ── Permission gate ──────────────────────────────────────────────────────
  // When the group setting `allowMemberMessage=false` is on, only OWNER/ADMIN
  // can post. For direct chats / when the flag is undefined we treat as
  // allowed. The composer is replaced with a notice for restricted members.
  const allowMemberMessage = conversation?.allowMemberMessage ?? true;
  const isMessagingRestricted =
    conversation?.kind !== "direct" &&
    !allowMemberMessage &&
    !hasMinRole(myRole ?? "member", "admin");
  // Members eligible for explicit mention (exclude self)
  const mentionableMembers: MentionMember[] = rawMembers
    .filter((m) => m.userId !== myId)
    .map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      username: m.username,
      avatarUrl: m.avatarUrl,
      role: m.role,
    }));
  // Accumulated explicit mentions array
  const [mentions, setMentions] = useState<string[]>([]);
  const [mentionAll, setMentionAll] = useState(false);
  // null = picker hidden; string = current query after '@'
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  // Caret position where the '@' was typed (start of @-token)
  const mentionStartRef = useRef<number>(-1);
  const composerWrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Prevents double-send when macOS IME/autocomplete fires multiple keydown events
  const isSendingRef = useRef(false);
  // Refs for outside-click dismiss of emoji / sticker popovers
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const emojiTriggerRef = useRef<HTMLButtonElement>(null);
  const stickerPickerRef = useRef<HTMLDivElement>(null);
  const stickerTriggerRef = useRef<HTMLButtonElement>(null);
  const contactPickerRef = useRef<HTMLDivElement>(null);
  const contactTriggerRef = useRef<HTMLButtonElement>(null);
  // Contact picker pulls from the user's friend list (per requirement) and
  // filters in-memory by name/username. The list is cached across opens.
  const { profiles: friendProfiles, isLoading: friendsLoading } = useFriendProfiles();
  const filteredFriends = useFriendList(friendProfiles, contactQuery, myId);

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
      const content = editingMessage.content;
      setText(content);
      const frame = requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.selectionStart = content.length;
        el.selectionEnd = content.length;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [editingMessage]);

  // Outside-click dismiss for emoji picker
  useEffect(() => {
    if (!showEmojiPicker) return;
    const handler = (e: MouseEvent) => {
      if (
        !emojiPickerRef.current?.contains(e.target as Node) &&
        !emojiTriggerRef.current?.contains(e.target as Node)
      ) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showEmojiPicker]);

  // Outside-click dismiss for sticker picker
  useEffect(() => {
    if (!showStickers) return;
    const handler = (e: MouseEvent) => {
      if (
        !stickerPickerRef.current?.contains(e.target as Node) &&
        !stickerTriggerRef.current?.contains(e.target as Node)
      ) {
        setShowStickers(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showStickers]);

  useEffect(() => {
    if (!showContactPicker) return;
    const handler = (e: MouseEvent) => {
      if (
        !contactPickerRef.current?.contains(e.target as Node) &&
        !contactTriggerRef.current?.contains(e.target as Node)
      ) {
        setShowContactPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showContactPicker]);

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
      toast.error("Could not send the voice message.");
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

    // ── @ mention detection ──────────────────────────────────────────────
    if (!isMentionSupported) return;
    const cursor = el?.selectionStart ?? value.length;
    // Walk left from the cursor to find the last '@' on this line
    const before = value.slice(0, cursor);
    const atIdx = before.lastIndexOf("@");
    if (atIdx !== -1) {
      const between = before.slice(atIdx + 1);
      // Only show picker if there's no whitespace between '@' and cursor
      if (!/\s/.test(between)) {
        mentionStartRef.current = atIdx;
        setMentionQuery(between);
        return;
      }
    }
    setMentionQuery(null);
  };

  /** Called when user selects a member or "all" from the MentionPicker. */
  const handleMentionSelect = useCallback(
    (selected: MentionMember | "all") => {
      const el = textareaRef.current;
      const start = mentionStartRef.current;
      if (start === -1) return;

      if (selected === "all") {
        const label = "@All ";
        const next = text.slice(0, start) + label + text.slice(el?.selectionStart ?? text.length);
        setText(next);
        setMentionAll(true);
        setMentionQuery(null);
        mentionStartRef.current = -1;
        requestAnimationFrame(() => {
          if (!el) return;
          const pos = start + label.length;
          el.focus();
          el.selectionStart = pos;
          el.selectionEnd = pos;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
        });
        return;
      }

      const label = `@${selected.displayName || selected.username || selected.userId} `;
      const next = text.slice(0, start) + label + text.slice(el?.selectionStart ?? text.length);
      setText(next);
      setMentions((prev) =>
        prev.includes(selected.userId) ? prev : [...prev, selected.userId]
      );
      setMentionQuery(null);
      mentionStartRef.current = -1;
      requestAnimationFrame(() => {
        if (!el) return;
        const pos = start + label.length;
        el.focus();
        el.selectionStart = pos;
        el.selectionEnd = pos;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
      });
    },
    [text]
  );

  const handleEmojiInsert = useCallback((emojiData: { emoji: string }) => {    const emoji = emojiData.emoji;
    const el = textareaRef.current;
    const selectionStart = el?.selectionStart ?? text.length;
    const selectionEnd = el?.selectionEnd ?? text.length;
    const nextValue = `${text.slice(0, selectionStart)}${emoji}${text.slice(selectionEnd)}`;

    setText(nextValue);
    onKeystroke();
    setShowEmojiPicker(false);

    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const nextCursor = selectionStart + emoji.length;
      el.selectionStart = nextCursor;
      el.selectionEnd = nextCursor;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    });
  }, [onKeystroke, text]);

  // ─── File staging ─────────────────────────────────────────────────────────
  
  /**
   * Validate and stage files from File[] array.
   * Reused by both file input change and paste events.
   */
  const stageFilesFromList = useCallback(async (files: File[]) => {
    const toProcess = files.slice(0, 50);
    if (toProcess.length === 0) return;

    // Validate each file's MIME type
    const allowed: File[] = [];
    const rejected: string[] = [];
    for (const file of toProcess) {
      if (ALL_ALLOWED_TYPES.includes(file.type)) {
        allowed.push(file);
      } else {
        rejected.push(file.name);
      }
    }
    if (rejected.length > 0) {
      toast.error(
        `Unsupported format: ${rejected.join(", ")}. Only images, videos, PDF, Office files, and archives are allowed.`,
        { duration: 5000 }
      );
    }
    if (allowed.length === 0) return;

    const newStaged: StagedFile[] = await Promise.all(
      allowed.map(async (file) => {
        const mediaType = detectMediaType(file.type);
        const previewUrl =
          mediaType === "image" || mediaType === "video"
            ? URL.createObjectURL(file)
            : undefined;
        const imageSize = mediaType === "image" ? await getImageSize(file) : null;
        return {
          id: crypto.randomUUID(),
          file,
          previewUrl,
          mediaType,
          width: imageSize?.width,
          height: imageSize?.height,
        };
      })
    );
    setStagedFiles((prev) => [...prev, ...newStaged].slice(0, 50));

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

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    stageFilesFromList(files);
  }, [stageFilesFromList]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items);
    const files: File[] = [];
    
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    
    if (files.length > 0) {
      e.preventDefault();
      stageFilesFromList(files);
    }
  }, [stageFilesFromList]);

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
    if (!canSend || isSendingRef.current) return;
    isSendingRef.current = true;
    setShowEmojiPicker(false);
    setShowStickers(false);

    // Edit mode: text only
    if (editingMessage) {
      if (!text.trim()) { isSendingRef.current = false; return; }
      // Strip only leading/trailing blank lines, preserve internal formatting
      const editedContent = text.replace(/^\n+|\n+$/g, "");
      try {
        await editMessage(editingMessage.messageId, editedContent);
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
                    ? { ...m, content: editedContent, editedAt: new Date().toISOString() }
                    : m
                ),
              })),
            };
          }
        );
      } catch (err) {
        if ((err as { response?: { status?: number } }).response?.status === 403) {
          toast.error("The allowed time window for this action has expired.");
        }
      }
      setText("");
      stopTyping();
      setEditingMessage(null);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      isSendingRef.current = false;
      return;
    }

    // Files staged → keep caption and attachment in one logical message
    if (stagedFiles.length > 0) {
      const queuedFiles = [...stagedFiles];
      const caption = text.trim();
      const replyTarget = replyTo?.messageId;

      setStagedFiles([]);
      setText("");
      stopTyping();
      setReplyTo(null);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      isSendingRef.current = false;

      if (queuedFiles.length === 1 && queuedFiles[0].mediaType !== "image") {
        const stagedFile = queuedFiles[0];
        const fileName = stagedFile.file.name;
        const type = stagedFile.mediaType;

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
          content: caption,
          type,
          replyToMessageId: replyTarget,
          localPreviewUrl: stagedFile.previewUrl,
          metadata: {
            ...(thumbMediaId ? { thumbMediaId } : {}),
            ...(stagedFile.width && stagedFile.height
              ? { width: stagedFile.width, height: stagedFile.height }
              : {}),
            fileSize: stagedFile.file.size,
            filename: fileName,
          },
          uploadFile: (onProgress) => uploadFileDirect(stagedFile.file, conversationId, onProgress),
        }).catch(() => {
          toast.error(`Could not send ${fileName}.`);
        });

        return;
      }

      try {
        // ── Split files ───────────────────────────────────────────────────
        // groupable: images + videos under 20 MB  → sent as one "media" album message
        // separateFiles: large videos + other files → each sent as individual messages
        const groupableFiles = queuedFiles.filter(
          (sf) =>
            sf.mediaType === "image" ||
            (sf.mediaType === "video" && sf.file.size < LARGE_VIDEO_THRESHOLD)
        );
        const separateFiles = queuedFiles.filter(
          (sf) =>
            sf.mediaType !== "image" &&
            !(sf.mediaType === "video" && sf.file.size < LARGE_VIDEO_THRESHOLD)
        );

        if (groupableFiles.length > 0) {
          // Resolve any pre-running thumb uploads for group videos
          const groupUploadItems = await Promise.all(
            groupableFiles.map(async (sf) => {
              let thumbMediaId: string | undefined;
              if (sf.mediaType === "video") {
                const thumbPromise = thumbUploadPromises.current.get(sf.id);
                if (thumbPromise) thumbMediaId = (await thumbPromise) ?? undefined;
                thumbUploadPromises.current.delete(sf.id);
              }
              return {
                uploadFn: (onProgress?: (p: number) => void) =>
                  uploadFileDirect(sf.file, conversationId, onProgress),
                mediaType: sf.mediaType as "image" | "video",
                filename: sf.file.name,
                localPreviewUrl: sf.previewUrl,
                thumbPreviewUrl: sf.thumbPreviewUrl,
                width: sf.width,
                height: sf.height,
                thumbMediaId,
              };
            })
          );

          send({
            conversationId,
            content: caption,
            type: "media",
            replyToMessageId: replyTarget,
            uploadFileItems: groupUploadItems,
          }).catch(() => toast.error("Could not send media."));
        } else if (caption) {
          // No groupable files and there is a caption → send caption as text first
          const captionChunks = splitContent(caption);
          captionChunks.forEach((chunk, i) => {
            send({
              conversationId,
              content: chunk,
              type: "text",
              replyToMessageId: i === 0 ? replyTarget : undefined,
            }).catch(() => toast.error("Could not send message."));
          });
        }

        // Send non-groupable files individually
        for (let i = 0; i < separateFiles.length; i++) {
          const sf = separateFiles[i];
          const fileName = sf.file.name;
          const type = sf.mediaType;

          let thumbMediaId: string | undefined;
          if (type === "video") {
            const thumbPromise = thumbUploadPromises.current.get(sf.id);
            if (thumbPromise) thumbMediaId = (await thumbPromise) ?? undefined;
            thumbUploadPromises.current.delete(sf.id);
          }

          // Only the first separate file gets the reply context when there are no groupable files and no caption
          const replyToMessageId =
            groupableFiles.length === 0 && !caption && i === 0 ? replyTarget : undefined;

          send({
            conversationId,
            content: "",
            type,
            replyToMessageId,
            localPreviewUrl: sf.previewUrl,
            metadata: {
              ...(thumbMediaId ? { thumbMediaId } : {}),
              ...(sf.width && sf.height ? { width: sf.width, height: sf.height } : {}),
              fileSize: sf.file.size,
              filename: fileName,
            },
            uploadFile: (onProgress) => uploadFileDirect(sf.file, conversationId, onProgress),
          }).catch(() => toast.error(`Could not send ${fileName}.`));
        }
      } catch {
        toast.error("Could not send the files.");
      }

      return;
    }

    // Text only — split into MAX_CONTENT_LENGTH chunks if needed
    // Trim only leading/trailing blank lines (not internal spacing) so the user's
    // intentional blank lines within the message body are preserved.
    const trimmed = text.replace(/^\n+|\n+$/g, "");
    const pendingMentions = mentions.slice();
    const pendingMentionAll = mentionAll;
    setText("");
    stopTyping();
    setReplyTo(null);
    setMentions([]);
    setMentionAll(false);
    setMentionQuery(null);
    mentionStartRef.current = -1;
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    isSendingRef.current = false;
    const chunks = splitContent(trimmed);
    chunks.forEach((chunk, i) => {
      send({
        conversationId,
        content: chunk,
        type: "text",
        replyToMessageId: i === 0 ? replyTo?.messageId : undefined,
        // Only attach mentions to the first chunk
        ...(i === 0 && pendingMentions.length > 0 ? { mentions: pendingMentions } : {}),
        ...(i === 0 && pendingMentionAll ? { mentionAll: true } : {}),
      });
    });
    return;
  };

  const handleSendSticker = (sticker: Sticker) => {
    send({ conversationId, type: "sticker", metadata: { url: sticker.url } });
    setShowStickers(false);
    setShowEmojiPicker(false);
  };

  const handleSendContact = (user: ContactPickUser) => {
    const caption = text.trim();
    const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username;
    send({
      conversationId,
      type: "contact_card",
      content: caption,
      replyToMessageId: replyTo?.messageId,
      metadata: {
        contactUserId: user.id,
        contactUsername: displayName,
      },
    }).catch(() => toast.error("Could not send contact card."));
    setText("");
    setReplyTo(null);
    setShowContactPicker(false);
    setContactQuery("");
    stopTyping();
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Close mention picker on Escape without sending
    if (e.key === "Escape" && mentionQuery !== null) {
      e.preventDefault();
      setMentionQuery(null);
      mentionStartRef.current = -1;
      return;
    }
    // enterToSend=true (default): Enter sends, Shift+Enter = newline
    // enterToSend=false:          Ctrl+Enter sends, Enter = newline
    const shouldSend = enterToSend
      ? e.key === "Enter" && !e.shiftKey
      : e.key === "Enter" && (e.ctrlKey || e.metaKey);
    if (shouldSend) {
      // keyCode 229 is the legacy indicator for IME composition on some browsers.
      // e.nativeEvent.isComposing covers macOS autocomplete / CJK input methods.
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      void handleSend();
    }
  };

  // ── Restricted: render notice instead of composer ───────────────────────
  if (isMessagingRestricted) {
    return (
      <div
        ref={composerWrapRef}
        className="relative shrink-0 border-t border-border bg-surface px-4 py-3"
      >
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface-secondary px-4 py-3">
          <div className="w-9 h-9 shrink-0 rounded-full bg-cta/10 text-cta flex items-center justify-center">
            <ShieldOff className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text">
              Members can&apos;t send messages
            </p>
            <p className="text-xs text-muted">
              Only the owner and admins can post in this group.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={composerWrapRef} className="relative shrink-0 border-t border-border bg-surface px-4 py-3">
      {/* Edit mode banner */}
      {editingMessage && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-lg bg-border/30">
          <Pencil className="w-3 h-3 text-cta shrink-0" />
          <span className="flex-1 text-xs text-muted">Editing message</span>
          <button type="button" onClick={() => { setEditingMessage(null); setText(""); if (textareaRef.current) textareaRef.current.style.height = "auto"; }}
            className="text-muted hover:text-text cursor-pointer" title="Cancel">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Reply preview strip */}
      {replyTo && (
        <ReplyPreview
          content={replyTo.content}
          type={replyTo.type}
          metadata={replyTo.metadata}
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
            {stagedFiles.length < 50 && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-20 h-20 shrink-0 rounded-2xl border-2 border-dashed border-border flex items-center justify-center text-muted hover:text-secondary hover:border-secondary transition-colors cursor-pointer"
                title="Add file"
              >
                <Paperclip className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Emoji picker popover */}
      {showEmojiPicker && (
        <div ref={emojiPickerRef} className="absolute bottom-[72px] left-4 z-50">
          <EmojiPicker
            onEmojiClick={handleEmojiInsert}
            lazyLoadEmojis={true}
            height={350}
            width={320}
            emojiStyle={EmojiStyle.APPLE}
          />
        </div>
      )}

      {/* Sticker picker popover */}
      {showStickers && (
        <div ref={stickerPickerRef} className="absolute bottom-[72px] left-16 z-50">
          <StickerPicker onSelect={handleSendSticker} />
        </div>
      )}

      {showContactPicker && (
        <div
          ref={contactPickerRef}
          className="absolute bottom-[72px] left-28 z-50 w-80 rounded-2xl border border-border bg-surface shadow-xl p-3 max-w-[calc(100vw-2rem)]"
        >
          <div className="flex items-center gap-2 mb-2 px-1">
            <UsersIcon className="w-4 h-4 text-cta shrink-0" />
            <p className="text-xs font-bold text-secondary tracking-wide">
              Share a friend
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" />
            <input
              value={contactQuery}
              onChange={(e) => setContactQuery(e.target.value)}
              placeholder="Search friends…"
              autoFocus
              className="w-full pl-9 pr-3 py-2 text-sm rounded-xl bg-bg border border-border focus:outline-none transition"
            />
          </div>
          <div className="mt-2 max-h-72 overflow-y-auto scrollbar-thin">
            {friendsLoading && filteredFriends.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted">Loading friends…</p>
            ) : filteredFriends.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted">
                {contactQuery.trim()
                  ? "No friends match that search."
                  : "You have no friends yet — add some first!"}
              </p>
            ) : (
              filteredFriends.slice(0, 30).map((user) => {
                const displayName =
                  [user.firstName, user.lastName].filter(Boolean).join(" ") ||
                  user.username;
                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => handleSendContact(user)}
                    className="w-full flex items-center gap-3 px-2 py-2 rounded-xl text-left hover:bg-border/40 transition cursor-pointer"
                  >
                    {user.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={user.avatarUrl}
                        alt=""
                        className="w-9 h-9 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-cta/10 text-cta flex items-center justify-center shrink-0">
                        <Contact className="w-4 h-4" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text truncate">{displayName}</p>
                      <p className="text-xs text-muted truncate">@{user.username}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Mention picker — shown above the input row when user types @ */}
      {isMentionSupported && mentionQuery !== null && (
        <MentionPicker
          members={mentionableMembers}
          query={mentionQuery}
          showMentionAll={canMentionAll}
          onSelect={handleMentionSelect}
          onDismiss={() => { setMentionQuery(null); mentionStartRef.current = -1; }}
          anchorRef={composerWrapRef}
        />
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
            title="Cancel"
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
            title="Stop and send"
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
          title="Attach file"
        >
          <Paperclip className="w-4 h-4" />
        </button>

        {/* Emoji */}
        <button
          ref={emojiTriggerRef}
          type="button"
          disabled={disabled}
          onClick={() => {
            setShowEmojiPicker((v) => !v);
            setShowStickers(false);
            setShowContactPicker(false);
          }}
          className={cn(
            "w-8 h-8 shrink-0 flex items-center justify-center rounded-lg transition-colors cursor-pointer mb-0.5",
            showEmojiPicker
              ? "text-primary bg-primary/10"
              : "text-muted hover:text-secondary hover:bg-border/50"
          )}
          title="Emoji"
        >
          <Smile className="w-4 h-4" />
        </button>

        {/* Sticker */}
        <button
          ref={stickerTriggerRef}
          type="button"
          disabled={disabled}
          onClick={() => {
            setShowStickers((v) => !v);
            setShowEmojiPicker(false);
            setShowContactPicker(false);
          }}
          className={cn(
            "h-8 px-2 shrink-0 flex items-center justify-center rounded-lg transition-colors cursor-pointer mb-0.5 text-[11px] font-semibold tracking-[0.08em]",
            showStickers
              ? "text-primary bg-primary/10"
              : "text-muted hover:text-secondary hover:bg-border/50"
          )}
          title="Stickers"
        >
          ST
        </button>

        {/* Contact card */}
        <button
          ref={contactTriggerRef}
          type="button"
          disabled={disabled || !!editingMessage || stagedFiles.length > 0}
          onClick={() => {
            setShowContactPicker((v) => !v);
            setShowEmojiPicker(false);
            setShowStickers(false);
          }}
          className={cn(
            "w-8 h-8 shrink-0 flex items-center justify-center rounded-lg transition-colors cursor-pointer mb-0.5",
            showContactPicker
              ? "text-primary bg-primary/10"
              : "text-muted hover:text-secondary hover:bg-border/50",
            (editingMessage || stagedFiles.length > 0) && "opacity-50 cursor-not-allowed",
          )}
          title="Send contact card"
        >
          <Contact className="w-4 h-4" />
        </button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={stagedFiles.length > 0 ? "Add a caption…" : placeholder}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          className="flex-1 min-w-0 resize-none bg-transparent text-sm text-text placeholder:text-muted outline-none leading-relaxed max-h-[200px] overflow-y-auto py-1"
          style={{ fontFamily: "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', inherit" }}
        />

        {/* Mic — only when no text, no staged files, not editing */}
        {!text.trim() && !editingMessage && stagedFiles.length === 0 && (
          <button
            type="button"
            onClick={startRec}
            disabled={disabled}
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-muted hover:text-secondary hover:bg-border/50 transition-colors cursor-pointer mb-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Voice message"
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
          title="Send (Enter)"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
      )}

      <p className="text-[10px] text-muted mt-1 ml-1">
        {enterToSend ? (
          <><kbd className="font-mono">Enter</kbd> to send · <kbd className="font-mono">Shift+Enter</kbd> for new line · <kbd className="font-mono">Ctrl+V</kbd> to paste files</>
        ) : (
          <><kbd className="font-mono">Ctrl+Enter</kbd> to send · <kbd className="font-mono">Enter</kbd> for new line · <kbd className="font-mono">Ctrl+V</kbd> to paste files</>
        )}
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
          title="Remove"
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
