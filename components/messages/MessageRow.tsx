"use client";

import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/presence/UserAvatar";
import { formatTime } from "@/lib/utils/date";
import type { Message } from "@/lib/api/messages";
import {
  Check, Clock, AlertCircle, Reply, MoreHorizontal, CornerUpLeft, Ban, RotateCcw,
  Contact, MessageCircle, UserPlus, UserCheck, Loader2, Mail,
} from "lucide-react";
import { AnimatedSticker } from "@/components/messages/AnimatedSticker";
import { useState, useRef, useCallback, useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";
import { addReaction } from "@/lib/api/messages";
import type { ReactionMap } from "@/lib/api/messages";
import { toast } from "sonner";
import { MessageContextMenu } from "./MessageContextMenu";
import { MessageReactions } from "./MessageReactions";
import { replyLabel } from "./ReplyPreview";
import { MediaImage } from "./media/MediaImage";
import { MediaVideo } from "./media/MediaVideo";
import { VoiceMessage } from "./media/VoiceMessage";
import { MediaFile, AttachmentGrid } from "./media/MediaFile";
import { MarkdownMessage } from "./MarkdownMessage";
import { CallSummaryBubble } from "./CallSummaryBubble";
import { SystemMessageChip } from "./SystemMessageChip";
import { CallSystemMessage } from "./CallSystemMessage";
import { GroupInviteCard } from "./GroupInviteCard";
import { LinkPreview, extractFirstUrl } from "./LinkPreview";
import { messageDeliveryLabel, resolveMessageDeliveryStatus } from "./messageStatus";

const INVITE_LINK_RE = /^Join "(.+)" on Zolo:\n(https?:\/\/\S+)$/;
import { useQuery } from "@tanstack/react-query";
import { getUserById } from "@/lib/api/users";
import { queryKeys } from "@/lib/query/keys";
import { useRouter } from "next/navigation";
import { useFriendshipStatus, useSendFriendRequest } from "@/hooks/useFriends";
import { useCreateConversation } from "@/hooks/useConversations";
import { encodeId } from "@/lib/utils/obfuscateId";
import { getMediaSignedUrl } from "@/lib/api/media";

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
  otherMembers?: OtherMember[];
  mentionLabels?: string[];
  onReply?: (msg: Message) => void;
  onEdit?: (msg: Message) => void;
  onDelete?: (msg: Message) => void;
  onRevoke?: (msg: Message) => void;
  onForward?: (msg: Message) => void;
  onPin?: (msg: Message) => void;
  canPin?: boolean;
  onViewDetails?: (msg: Message) => void;
  onRetry?: (msg: Message) => void;
}

export function MessageRow({
  message, isMine, isGroupStart, isGroupEnd,
  replyMsg,
  senderName = "", senderAvatarUrl,
  otherMembers = [], mentionLabels = [],
  onReply, onEdit, onDelete, onRevoke, onForward, onPin, canPin = true, onViewDetails, onRetry,
}: MessageRowProps) {
  const isDeleted = !!message.deletedAt;
  const isRevoked = !!message.isRevoked;
  const isSystem = message.type === "system";
  const isCallSummary = message.type === "call_summary";
  const isSticker = message.type === "sticker";
  const isContactCard = message.type === "contact_card";
  const isEdited = !!message.editedAt;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const myId = useAuthStore((s) => s.user?.id);

  // ─── Reactions ──────────────────────────────────────────────────────────
  const [localReactions, setLocalReactions] = useState<ReactionMap | null>(null);
  const reactionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mergedReactions: ReactionMap = localReactions ?? (message.reactions ?? {});

  // When the server delivers authoritative state via WS, discard our optimistic copy.
  const serverReactionsRef = useRef(message.reactions);
  useEffect(() => {
    if (message.reactions !== serverReactionsRef.current) {
      serverReactionsRef.current = message.reactions;
      const timeout = window.setTimeout(() => setLocalReactions(null), 0);
      return () => window.clearTimeout(timeout);
    }
  }, [message.reactions]);

  const handleEmojiPick = useCallback(async (emoji: string) => {
    const prev = localReactions ?? (message.reactions ?? {});
    const current = prev[emoji] ?? { count: 0, reactors: [], myReaction: false };
    const isRemoving = current.myReaction;
    const action: "add" | "remove" = isRemoving ? "remove" : "add";
    const reactors = current.reactors ?? [];

    // Optimistic: flip myReaction and adjust count/reactors immediately
    const updated = {
      count: Math.max(0, current.count + (isRemoving ? -1 : 1)),
      reactors: isRemoving
        ? reactors.filter((uid) => uid !== myId)
        : [...reactors, ...(myId ? [myId] : [])],
      myReaction: !isRemoving,
    };
    const next: ReactionMap = { ...prev, [emoji]: updated };
    // Remove the emoji entirely if count reaches 0
    if (updated.count === 0) delete next[emoji];
    setLocalReactions(next);
    setMenuOpen(false);

    if (reactionDebounceRef.current) clearTimeout(reactionDebounceRef.current);
    reactionDebounceRef.current = setTimeout(async () => {
      try {
        await addReaction(message.messageId, message.conversationId, emoji, action);
      } catch {
        setLocalReactions(null);
        toast.error(isRemoving ? "Không thể bỏ cảm xúc" : "Không thể thêm cảm xúc");
      }
    }, 350);
  }, [localReactions, message.reactions, message.messageId, message.conversationId, myId]);

  useEffect(() => {
    if (!menuOpen) return;
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [menuOpen]);

  if (isSystem) {
    if (message.metadata?.systemType === "system_call") {
      return <CallSystemMessage message={message} />;
    }
    return <SystemMessageChip message={message} />;
  }

  // Direct-conversation terminal call messages: type="text" but systemType="system_call"
  if (message.metadata?.systemType === "system_call") {
    return (
      <div
        className={cn("group flex items-end gap-2 px-3", isMine ? "flex-row-reverse" : "flex-row")}
        style={{ marginBottom: isGroupEnd ? "var(--msg-gap-end, 0.75rem)" : "var(--msg-gap-mid, 0.125rem)" }}
      >
        <div className="w-8 shrink-0 self-end">
          {!isMine && isGroupEnd && (
            <UserAvatar userId={message.senderId} name={senderName} avatarUrl={senderAvatarUrl} size="sm" showPresence={false} />
          )}
        </div>
        <CallSystemMessage message={message} isMine={isMine} />
      </div>
    );
  }

  const inviteMatch = message.type === "text" && INVITE_LINK_RE.exec(message.content.trim());
  if (inviteMatch) {
    const [, groupName, joinUrl] = inviteMatch;
    return (
      <div
        className={cn("group flex items-end gap-2 px-3", isMine ? "flex-row-reverse" : "flex-row")}
        style={{ marginBottom: isGroupEnd ? "var(--msg-gap-end, 0.75rem)" : "var(--msg-gap-mid, 0.125rem)" }}
      >
        <div className="w-8 shrink-0 self-end">
          {!isMine && isGroupEnd && (
            <UserAvatar userId={message.senderId} name={senderName} avatarUrl={senderAvatarUrl} size="sm" showPresence={false} />
          )}
        </div>
        <GroupInviteCard
          groupName={groupName}
          joinUrl={joinUrl}
          createdAt={message.createdAt}
          isMine={isMine}
        />
      </div>
    );
  }

  if (isCallSummary) {
    const otherMemberIds = otherMembers.map((m) => m.userId);
    return (
      <div className={cn("flex px-3", isMine ? "justify-end" : "justify-start")} style={{ marginBottom: "var(--msg-gap-end, 0.75rem)" }}>
        <div className={cn("flex flex-col", isMine ? "items-end" : "items-start")}>
          <CallSummaryBubble
            message={message}
            isMine={isMine}
            otherMemberIds={otherMemberIds}
          />
          <span className="text-[10px] text-muted mt-1 select-none tabular-nums px-1">
            {formatTime(message.createdAt)}
          </span>
        </div>
      </div>
    );
  }

  const bubbleShape = cn(
    "rounded-[18px]",
    !isGroupStart && !isGroupEnd && (isMine ? "rounded-tr-[4px] rounded-br-[4px]" : "rounded-tl-[4px] rounded-bl-[4px]"),
    isGroupStart && !isGroupEnd && (isMine ? "rounded-tr-[4px]" : "rounded-tl-[4px]"),
    !isGroupStart && isGroupEnd && (isMine ? "rounded-br-[4px]" : "rounded-bl-[4px]"),
  );

  const hasCaption = message.content.trim().length > 0;
  const isPureMedia = (message.type === "image" || message.type === "video") && !replyMsg && !hasCaption;
  const isSingleImage = isPureMedia && message.type === "image";
  const isMediaGroup = message.type === "media" && !isRevoked && !isDeleted;

  return (
    <div
      className={cn("group flex items-end gap-2 px-3", isMine ? "flex-row-reverse" : "flex-row")}
      style={{ marginBottom: isGroupEnd ? "var(--msg-gap-end, 0.75rem)" : "var(--msg-gap-mid, 0.125rem)" }}
    >
      <div className="w-8 shrink-0 self-end">
        {!isMine && isGroupEnd && (
          <UserAvatar userId={message.senderId} name={senderName} avatarUrl={senderAvatarUrl} size="sm" showPresence={false} />
        )}
      </div>

      <div className={cn("flex flex-col max-w-[78%] min-w-0", isMine ? "items-end" : "items-start")}>
        {!isMine && isGroupStart && (
          <span className="text-[11px] font-semibold text-cta ml-1 mb-0.5 select-none">{senderName}</span>
        )}

        <div
          className={cn(
            "flex items-center gap-1",
            isMine ? "flex-row-reverse" : "flex-row",
            isSingleImage && "max-w-full min-w-0"
          )}
        >
          {/* ── Message bubble ── */}
          {isMediaGroup ? (
            /* ── Media album: no outer bubble border ── */
            <div className={cn(bubbleShape, "overflow-hidden max-w-[360px] w-full flex flex-col")}>
              {/* Reply preview strip (with bg so it's readable) */}
              {replyMsg && (() => {
                const replyBg = isMine ? "bg-cta/90 px-3 pt-2 pb-1" : "bg-surface px-3 pt-2 pb-1";
                if (replyMsg.isRevoked) {
                  return (
                    <div className={replyBg}>
                      <div className={cn("flex items-start gap-2 rounded-xl px-2.5 py-1.5 text-xs border-l-[3px]",
                        isMine ? "bg-white/15 border-white/50" : "bg-border/30 border-cta")}>
                        <CornerUpLeft className={cn("w-3 h-3 shrink-0 mt-0.5", isMine ? "text-white/70" : "text-cta")} />
                        <p className={cn("truncate text-[11px] leading-tight", isMine ? "text-white/60" : "text-muted")}>Message revoked</p>
                      </div>
                    </div>
                  );
                }
                const { icon, label } = replyLabel(replyMsg.type, replyMsg.content, replyMsg.metadata);
                return (
                  <div className={replyBg}>
                    <div className={cn("flex items-start gap-2 rounded-xl px-2.5 py-1.5 text-xs border-l-[3px] cursor-pointer",
                      isMine ? "bg-white/15 border-white/50 hover:bg-white/20" : "bg-border/30 border-cta hover:bg-border/50")}>
                      <CornerUpLeft className={cn("w-3 h-3 shrink-0 mt-0.5", isMine ? "text-white/70" : "text-cta")} />
                      <p className={cn("truncate text-[11px] leading-tight flex items-center gap-1", isMine ? "text-white/60" : "text-muted")}>
                        {icon}{label}
                      </p>
                    </div>
                  </div>
                );
              })()}
              {/* Borderless attachment grid */}
              <AttachmentGrid
                attachments={message.attachments ?? []}
                isMine={isMine}
                conversationId={message.conversationId}
                localAttachments={message._localAttachments}
                uploadProgress={message._uploadProgress}
              />
              {/* Caption section */}
              {hasCaption && (
                <div className={cn("px-3.5 py-2 text-sm leading-relaxed break-words",
                  isMine ? "bg-cta text-white" : "bg-surface text-text")}>
                  <MarkdownMessage
                    content={message.content}
                    isMine={isMine}
                    mentions={message.metadata?.mentions}
                    mentionLabels={mentionLabels}
                    mentionAll={message.metadata?.mentionAll}
                  />
                </div>
              )}
              {isEdited && (
                <div className={cn("px-3.5 pb-1 text-[10px] italic select-none",
                  isMine ? "bg-cta text-white/50" : "bg-surface text-muted")}>
                  Edited
                </div>
              )}
            </div>
          ) : isRevoked ? (
            <div className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-[18px] border border-border/50 text-muted text-xs italic select-none">
              <Ban className="w-3 h-3 shrink-0" />
              Message revoked
            </div>
          ) : isDeleted ? (
            <div className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-[18px] border border-border/50 text-muted text-xs italic select-none">
              Deleted
            </div>
          ) : isSticker ? (
            <div className="p-0.5">
              <AnimatedSticker url={message.metadata?.url ?? ""} size={130} alt="sticker" />
            </div>
          ) : (
            <div className={cn(
              bubbleShape,
              "text-sm leading-relaxed break-words [overflow-wrap:anywhere] max-w-full min-w-0",
              isPureMedia
                ? "overflow-hidden flex"
                : isContactCard
                  ? "p-0 bg-transparent border-0 shadow-none"
                : isMine
                  ? "bg-cta text-white px-3.5 py-2.5"
                  : "bg-surface border border-border/60 text-text px-3.5 py-2.5 shadow-sm"
            )}>
              {replyMsg && (() => {
                if (replyMsg.isRevoked) {
                  return (
                    <div className={cn("flex items-start gap-2 rounded-xl px-2.5 py-1.5 mb-2 text-xs border-l-[3px]",
                      isMine ? "bg-white/15 border-white/50" : "bg-border/30 border-cta")}>
                      <CornerUpLeft className={cn("w-3 h-3 shrink-0 mt-0.5", isMine ? "text-white/70" : "text-cta")} />
                      <p className={cn("truncate text-[11px] leading-tight", isMine ? "text-white/60" : "text-muted")}>
                        Message revoked
                      </p>
                    </div>
                  );
                }
                const { icon, label } = replyLabel(replyMsg.type, replyMsg.content, replyMsg.metadata);
                return (
                  <div className={cn("flex items-start gap-2 rounded-xl px-2.5 py-1.5 mb-2 text-xs border-l-[3px] cursor-pointer",
                    isMine ? "bg-white/15 border-white/50 hover:bg-white/20" : "bg-border/30 border-cta hover:bg-border/50")}>
                    <CornerUpLeft className={cn("w-3 h-3 shrink-0 mt-0.5", isMine ? "text-white/70" : "text-cta")} />
                    <p className={cn("truncate text-[11px] leading-tight flex items-center gap-1", isMine ? "text-white/60" : "text-muted")}>
                      {icon}
                      {label}
                    </p>
                  </div>
                );
              })()}
              <MessageContent message={message} isMine={isMine} mentionLabels={mentionLabels} />
              {isEdited && (
                <span className={cn("block text-[10px] mt-1 italic select-none", isMine ? "text-white/50" : "text-muted")}>Edited</span>
              )}
            </div>
          )}

          {/* ── Action buttons ── */}
          {!isRevoked && !isDeleted && (
            <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              {!isSticker && (
                <button
                  onClick={() => onReply?.(message)}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-muted hover:text-secondary hover:bg-border/60 transition-colors cursor-pointer"
                  title="Reply"
                >
                  <Reply className="w-3.5 h-3.5" />
                </button>
              )}
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-muted hover:text-secondary hover:bg-border/60 transition-colors cursor-pointer"
                  title="Thêm"
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
                {menuOpen && (
                  <MessageContextMenu
                    isMine={isMine}
                    message={message}
                    onEmojiPick={handleEmojiPick}
                    onReply={onReply ? () => { onReply(message); setMenuOpen(false); } : undefined}
                    onEdit={onEdit ? () => { onEdit(message); setMenuOpen(false); } : undefined}
                    onDelete={onDelete ? () => { onDelete(message); setMenuOpen(false); } : undefined}
                    onRevoke={onRevoke ? () => { onRevoke(message); setMenuOpen(false); } : undefined}
                    onForward={onForward ? () => { onForward(message); setMenuOpen(false); } : undefined}
                    onPin={onPin ? () => { onPin(message); setMenuOpen(false); } : undefined}
                    canPin={canPin}
                    onViewDetails={onViewDetails ? () => { onViewDetails(message); setMenuOpen(false); } : undefined}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Reactions ── */}
        {!isRevoked && !isDeleted && (
          <MessageReactions reactions={mergedReactions} isMine={isMine} onEmojiPick={handleEmojiPick} />
        )}

        {/* ── Timestamp + status ── */}
        {(isGroupEnd || (message as Message & { _failed?: boolean })._failed) && (
          <div className={cn("flex items-center gap-1 mt-1 select-none", isMine ? "flex-row-reverse pr-1" : "flex-row pl-1")}>
            <span className="text-[10px] text-muted tabular-nums">
              {formatTime(message.createdAt)}
            </span>
            {isMine && !isRevoked && (
              <MessageStatusIcon message={message} otherMembers={otherMembers} onRetry={onRetry ? () => onRetry(message) : undefined} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MessageContent ───────────────────────────────────────────────────────────

function MessageContent({
  message,
  isMine,
  mentionLabels,
}: {
  message: Message;
  isMine: boolean;
  mentionLabels: string[];
}) {
  const caption = message.content.trim();
  const renderCaptioned = (body: React.ReactNode) => {
    if (!caption) return body;
    return (
      <div className="space-y-2">
        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{caption}</p>
        {body}
      </div>
    );
  };

  switch (message.type) {
    case "sticker":
      return message.metadata?.url
        ? <AnimatedSticker url={message.metadata.url} size={130} alt="sticker" />
        : null;
    case "text": {
      const firstUrl = extractFirstUrl(message.content);
      return (
        <>
          <MarkdownMessage
            content={message.content}
            isMine={isMine}
            mentions={message.metadata?.mentions}
            mentionLabels={mentionLabels}
            mentionAll={message.metadata?.mentionAll}
          />
          {firstUrl && <LinkPreview url={firstUrl} isMine={isMine} />}
        </>
      );
    }
    case "image":
    case "video": {
      const fname = message.metadata?.filename;
      // Hide caption when it's empty, matches the filename, or looks like an
      // auto-populated filename (common media extension, no line-breaks).
      const isAutoCaption =
        !caption ||
        caption === fname ||
        /^[^\n\r]{1,255}\.(jpe?g|png|gif|webp|heic|avif|bmp|svg|mp4|mov|avi|mkv|webm)$/i.test(caption);
      const mediaCaption = isAutoCaption ? null : caption;
      const mediaNode =
        message.type === "image"
          ? <MediaImage message={message} isMine={isMine} />
          : <MediaVideo message={message} isMine={isMine} />;
      return mediaCaption ? (
        <div className="space-y-1.5">
          {mediaNode}
          <MarkdownMessage
            content={mediaCaption}
            isMine={isMine}
            mentions={message.metadata?.mentions}
            mentionLabels={mentionLabels}
            mentionAll={message.metadata?.mentionAll}
          />
        </div>
      ) : mediaNode;
    }
    case "audio":
      return <VoiceMessage message={message} isMine={isMine} />;
    case "file": {
      const fileCaption = caption && message.metadata?.filename && caption !== message.metadata.filename
        ? caption
        : null;
      return fileCaption ? (
        <div className="space-y-2">
          <MarkdownMessage
            content={fileCaption}
            isMine={isMine}
            mentions={message.metadata?.mentions}
            mentionLabels={mentionLabels}
            mentionAll={message.metadata?.mentionAll}
          />
          <MediaFile message={message} isMine={isMine} />
        </div>
      ) : (
        <MediaFile message={message} isMine={isMine} />
      );
    }
    case "contact_card":
      return <ContactCardContent message={message} isMine={isMine} />;
    case "media":
      return (
        <div className="space-y-1.5">
          {caption && (
            <MarkdownMessage
              content={caption}
              isMine={isMine}
              mentions={message.metadata?.mentions}
              mentionLabels={mentionLabels}
              mentionAll={message.metadata?.mentionAll}
            />
          )}
          <AttachmentGrid
            attachments={message.attachments ?? []}
            isMine={isMine}
            conversationId={message.conversationId}
          />
        </div>
      );
    default:
      return (
        <MarkdownMessage
          content={message.content}
          isMine={isMine}
          mentions={message.metadata?.mentions}
          mentionLabels={mentionLabels}
          mentionAll={message.metadata?.mentionAll}
        />
      );
  }
}

function ContactCardContent({ message, isMine }: { message: Message; isMine: boolean }) {
  return (
    <ContactCardInner
      contactUserId={message.metadata?.contactUserId}
      metadata={message.metadata}
      content={message.content}
      isMine={isMine}
    />
  );
}

function ContactCardInner({
  contactUserId,
  metadata,
  content,
  isMine,
}: {
  contactUserId: string | undefined;
  metadata?: Message["metadata"];
  content: string;
  isMine: boolean;
}) {
  const myId = useAuthStore((s) => s.user?.id);
  const router = useRouter();
  const hasSnapshot = !!(metadata?.contactUsername || metadata?.contactEmail || metadata?.contactAvatarId);
  const { data: user } = useQuery({
    queryKey: queryKeys.users.detail(contactUserId ?? ""),
    queryFn: () => getUserById(contactUserId!),
    enabled: !!contactUserId && !hasSnapshot,
    staleTime: 5 * 60_000,
  });
  const { data: avatarUrl } = useQuery({
    queryKey: queryKeys.media.detail(metadata?.contactAvatarId ?? ""),
    queryFn: () => getMediaSignedUrl(metadata!.contactAvatarId!, "OPTIMIZED"),
    enabled: !!metadata?.contactAvatarId,
    staleTime: 30 * 60_000,
  });
  const isSelf = !!contactUserId && contactUserId === myId;
  const { data: friendship } = useFriendshipStatus(
    !isSelf ? contactUserId : undefined,
  );
  const sendRequest = useSendFriendRequest();
  const createConv = useCreateConversation();
  const [opening, setOpening] = useState(false);

  const name = metadata?.contactUsername || (user
    ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username
    : "Contact");
  const email = metadata?.contactEmail ?? user?.email;
  const username = user?.username ?? metadata?.contactUsername ?? contactUserId ?? "unknown";
  const displayAvatarUrl = avatarUrl ?? user?.avatarUrl;

  const handleMessage = useCallback(async () => {
    if (!contactUserId || isSelf) return;
    setOpening(true);
    try {
      const conv = await createConv.mutateAsync({
        kind: "direct",
        memberIds: [contactUserId],
      });
      router.push(`/conversations/${encodeId(conv.id)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open chat");
    } finally {
      setOpening(false);
    }
  }, [contactUserId, isSelf, createConv, router]);

  const handleAdd = useCallback(async () => {
    if (!contactUserId) return;
    try {
      await sendRequest.mutateAsync(contactUserId);
      toast.success("Friend request sent");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send request");
    }
  }, [contactUserId, sendRequest]);

  // ── Friendship CTA state ──
  const status = friendship?.status;
  const isFriend = status === "FRIEND";
  const requestPending = status === "PENDING_OUT";
  const requestIncoming = status === "PENDING_IN";

  return (
    <div className="space-y-2 min-w-64 max-w-80">
      {content.trim() && (
        <p className={cn("whitespace-pre-wrap break-words px-1", isMine ? "text-white" : "text-text")}>{content.trim()}</p>
      )}
      <div
        className={cn(
          "overflow-hidden rounded-2xl border shadow-sm",
          isMine ? "bg-white text-primary border-white/20" : "bg-surface border-border/70",
        )}
      >
        <div className="h-1.5 bg-gradient-to-r from-cta via-secondary to-success" />
        <div className="p-3.5 space-y-3">
          <div className="flex items-center gap-3">
            {displayAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={displayAvatarUrl}
                alt={name}
                className="w-12 h-12 rounded-2xl object-cover shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded-2xl bg-cta/10 text-cta flex items-center justify-center shrink-0">
                <Contact className="w-5 h-5" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-semibold truncate text-primary">{name}</p>
              <p className="text-xs truncate text-muted">@{username}</p>
              {email && (
                <p className="text-xs truncate text-muted flex items-center gap-1 mt-0.5">
                  <Mail className="w-3 h-3 shrink-0" />
                  {email}
                </p>
              )}
            </div>
          </div>

          {!isSelf && contactUserId && (
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleMessage}
                disabled={opening}
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs font-semibold transition cursor-pointer disabled:opacity-60 bg-cta text-white hover:bg-cta-hover"
              >
                {opening ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <MessageCircle className="w-3.5 h-3.5" />
                )}
                <span>Message</span>
              </button>
              {isFriend ? (
                <span
                  className="inline-flex items-center justify-center gap-1 h-8 px-3 rounded-lg text-xs font-medium text-success"
                  title="Already friends"
                >
                  <UserCheck className="w-3.5 h-3.5" /> Friend
                </span>
              ) : requestPending ? (
                <span
                  className="inline-flex items-center justify-center gap-1 h-8 px-3 rounded-lg text-xs font-medium text-muted"
                  title="Friend request pending"
                >
                  <Clock className="w-3.5 h-3.5" /> Pending
                </span>
              ) : requestIncoming ? (
                <span
                  className="inline-flex items-center justify-center gap-1 h-8 px-3 rounded-lg text-xs font-medium text-cta"
                  title="They sent you a friend request — open their profile to accept"
                >
                  <UserPlus className="w-3.5 h-3.5" /> Respond
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={sendRequest.isPending}
                  className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold border border-border text-text hover:bg-surface-secondary transition cursor-pointer disabled:opacity-60"
                >
                  {sendRequest.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <UserPlus className="w-3.5 h-3.5" />
                  )}
                  <span>Add</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── MessageStatusIcon ────────────────────────────────────────────────────────

function MessageStatusIcon({
  message,
  otherMembers,
  onRetry,
}: {
  message: Message & { _pending?: boolean; _failed?: boolean };
  otherMembers: OtherMember[];
  onRetry?: () => void;
}) {
  const status = resolveMessageDeliveryStatus(message, otherMembers);
  const label = messageDeliveryLabel(status);

  if (message._failed) return (
    <div className="flex items-center gap-1" title={label}>
      <AlertCircle className="w-3 h-3 text-error shrink-0" />
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-0.5 text-[10px] text-error hover:text-error/80 font-medium cursor-pointer leading-none"
          title="Retry sending"
        >
          <RotateCcw className="w-2.5 h-2.5" />
          Retry
        </button>
      )}
    </div>
  );
  if (message._pending || message.offset == null || message.offset < 0)
    return (
      <span title={messageDeliveryLabel("sending")} aria-label={messageDeliveryLabel("sending")}>
        <Clock className="w-3 h-3 text-muted shrink-0" />
      </span>
    );

  const offset = message.offset;
  const seenBy = otherMembers.filter((m) => offset > 0 && m.lastSeenOffset >= offset);
  if (seenBy.length > 0) {
    return (
      <div className="flex items-center -space-x-0.5 shrink-0" title={label} aria-label={label}>
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

  if (status === "read" || status === "delivered") return null;

  return (
    <span title={label} aria-label={label}>
      <Check className="w-3 h-3 text-muted shrink-0" />
    </span>
  );
}