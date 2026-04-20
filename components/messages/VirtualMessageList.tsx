"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import {
  List,
  useDynamicRowHeight,
  type ListImperativeAPI,
  type RowComponentProps,
} from "react-window";
import { useMessages } from "@/hooks/useMessages";
import { useSeenCursor } from "@/hooks/useSeenCursor";
import { useSendMessage } from "@/hooks/useSendMessage";
import { MessageRow } from "./MessageRow";
import { useAuthStore } from "@/stores/authStore";
import { useConversationStore } from "@/stores/conversationStore";
import { getQueryClient } from "@/lib/query/queryClient";
import { queryKeys } from "@/lib/query/keys";
import type { Message } from "@/lib/api/messages";
import { deleteMessageForMe, revokeMessage, pinMessage } from "@/lib/api/messages";
import { ForwardModal } from "./ForwardModal";
import { MessageDetailsModal } from "./MessageDetailsModal";
import type { ConversationMember } from "@/lib/api/conversations";
import type { ReplyTarget, EditTarget } from "@/stores/conversationStore";
import { formatDateDivider } from "@/lib/utils/date";
import { Loader2, MessageSquare } from "lucide-react";
import type { MessagesInfiniteData } from "@/hooks/useMessages";
import { toast } from "sonner";

interface VirtualMessageListProps {
  conversationId: string;
  members: ConversationMember[];
  onScrollChange?: (atBottom: boolean, unreadBelow: number) => void;
  /** External details target (set from pinned banner). If provided, overrides internal state. */
  onViewDetails?: (msg: Message) => void;
  detailsTarget?: Message | null;
  onCloseDetails?: () => void;
}

// ─── List item types ──────────────────────────────────────────────────────────

type ListItem =
  | { kind: "message"; msg: Message; prev: Message | null; next: Message | null }
  | { kind: "divider"; label: string }
  | { kind: "padding" };

function buildItems(messages: Message[]): ListItem[] {
  if (messages.length === 0) return [];
  const items: ListItem[] = [{ kind: "padding" }]; // top spacer
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const prev = messages[i - 1] ?? null;
    // Insert date divider when date changes
    if (
      !prev ||
      new Date(prev.createdAt).toDateString() !== new Date(msg.createdAt).toDateString()
    ) {
      items.push({ kind: "divider", label: formatDateDivider(msg.createdAt) });
    }
    items.push({ kind: "message", msg, prev, next: messages[i + 1] ?? null });
  }
  items.push({ kind: "padding" }); // bottom spacer
  return items;
}

// ─── Row props ────────────────────────────────────────────────────────────────

interface RowData {
  items: ListItem[];
  userId: string;
  messageById: Map<string, Message>;
  memberMap: Map<string, ConversationMember & { displayName?: string; username?: string; avatarUrl?: string | null }>;
  otherMembers: Array<{ userId: string; lastSeenOffset: number; lastDeliveredOffset: number; avatarUrl?: string | null; displayName?: string; username?: string }>;
  setReplyTo: (msg: ReplyTarget | null) => void;
  observeRowElements: (els: Element[] | NodeListOf<Element>) => () => void;
  onEdit: (msg: Message) => void;
  onDelete: (msg: Message) => void;
  onRevoke: (msg: Message) => void;
  onForward: (msg: Message) => void;
  onPin: (msg: Message) => void;
  onViewDetails: (msg: Message) => void;
  onRetry: (conversationId: string, clientMessageId: string) => void;
}

// rowComponent MUST be defined outside the parent to keep a stable reference
function MessageRowComponent({
  index,
  style,
  items,
  userId,
  messageById,
  memberMap,
  otherMembers,
  setReplyTo,
  observeRowElements,
  onEdit,
  onDelete,
  onRevoke,
  onForward,
  onPin,
  onViewDetails,
  onRetry,
}: RowComponentProps<RowData>) {
  const item = items[index];
  if (!item) return null;

  if (item.kind === "padding") {
    return <div style={style} className="h-4" />;
  }

  if (item.kind === "divider") {
    return (
      <div
        style={style}
        ref={(el) => { if (el) observeRowElements([el]); }}
        className="flex items-center gap-3 px-6 py-3"
      >
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-muted font-medium select-none shrink-0">
          {item.label}
        </span>
        <div className="flex-1 h-px bg-border" />
      </div>
    );
  }

  // item.kind === "message"
  const { msg, prev, next } = item;
  const isMine = msg.senderId === userId;
  const samePrev = prev?.senderId === msg.senderId && prev?.type !== "system";
  const sameNext = next?.senderId === msg.senderId && next?.type !== "system";
  const member = memberMap.get(msg.senderId);
  // Prefer a human-readable name: displayName > username > short userId
  const senderName = member?.displayName ?? member?.username ?? msg.senderId.slice(0, 8);
  const replyMsg = msg.replyToMessageId ? messageById.get(msg.replyToMessageId) ?? null : null;
  const replySenderName = replyMsg
    ? (memberMap.get(replyMsg.senderId)?.displayName ?? memberMap.get(replyMsg.senderId)?.username ?? (replyMsg.senderId === userId ? "Bạn" : replyMsg.senderId.slice(0, 8)))
    : undefined;

  return (
    <div style={style} ref={(el) => { if (el) observeRowElements([el]); }}>
      <MessageRow
        message={msg}
        isMine={isMine}
        isGroupStart={!samePrev}
        isGroupEnd={!sameNext}
        replyMsg={replyMsg}
        senderName={senderName}
        senderAvatarUrl={member?.avatarUrl ?? undefined}
        replySenderName={replySenderName}
        otherMembers={otherMembers}
        onReply={(m) => setReplyTo({ messageId: m.messageId, senderId: m.senderId, senderName, content: m.content, type: m.type })}
        onEdit={onEdit}
        onDelete={onDelete}
        onRevoke={onRevoke}
        onForward={onForward}
        onPin={onPin}
        onViewDetails={onViewDetails}
        onRetry={msg.clientMessageId ? (m) => onRetry(m.conversationId, m.clientMessageId!) : undefined}
      />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function VirtualMessageList({
  conversationId,
  members,
  onScrollChange,
  onViewDetails: externalViewDetails,
  detailsTarget: externalDetailsTarget,
  onCloseDetails,
}: VirtualMessageListProps) {
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const setReplyTo = useConversationStore((s) => s.setReplyTo);
  const setEditingMessage = useConversationStore((s) => s.setEditingMessage);
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useMessages(conversationId);

  // ─── Seen cursor tracking ────────────────────────────────────────────────
  const [lastVisibleOffset, setLastVisibleOffset] = useState<number | null>(null);
  useSeenCursor(conversationId, lastVisibleOffset);

  // ─── Message action handlers ──────────────────────────────────────────────
  const { send: _send, retryMessage } = useSendMessage();

  const handleRetry = useCallback((convId: string, clientMessageId: string) => {
    retryMessage(convId, clientMessageId);
  }, [retryMessage]);

  const handleEdit = useCallback((msg: Message) => {
    setEditingMessage({ messageId: msg.messageId, content: msg.content ?? "" });
  }, [setEditingMessage]);

  const handleDelete = useCallback(async (msg: Message) => {
    try {
      await deleteMessageForMe(msg.messageId, conversationId);
      const qc = getQueryClient();
      qc.setQueryData(
        queryKeys.messages.list(conversationId),
        (old: MessagesInfiniteData | undefined) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((p) => ({
              ...p,
              data: p.data.filter((m) => m.messageId !== msg.messageId),
            })),
          };
        }
      );
    } catch {
      // noop
    }
  }, [conversationId]);

  const handleRevoke = useCallback(async (msg: Message) => {
    try {
      await revokeMessage(msg.messageId, conversationId);
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
                m.messageId === msg.messageId ? { ...m, isRevoked: true, content: "" } : m
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
  }, [conversationId]);

  const [forwardTarget, setForwardTarget] = useState<Message | null>(null);
  const handleForward = useCallback((msg: Message) => {
    setForwardTarget(msg);
  }, []);

  const [internalDetailsTarget, setInternalDetailsTarget] = useState<Message | null>(null);
  const detailsTarget = externalDetailsTarget !== undefined ? externalDetailsTarget : internalDetailsTarget;
  const handleViewDetails = useCallback((msg: Message) => {
    if (externalViewDetails) {
      externalViewDetails(msg);
    } else {
      setInternalDetailsTarget(msg);
    }
  }, [externalViewDetails]);

  const handlePin = useCallback(async (msg: Message) => {
    try {
      await pinMessage(msg.messageId, conversationId);
      const qc = getQueryClient();
      qc.setQueryData(
        queryKeys.messages.pinned(conversationId),
        (old: Message[] | undefined) => {
          const list = old ?? [];
          if (list.some((m) => m.messageId === msg.messageId)) return list;
          return [...list, msg];
        }
      );
    } catch {
      alert("Tối đa 3 tin nhắn ghim trong một cuộc trò chuyện.");
    }
  }, [conversationId]);

  const listRef = useRef<ListImperativeAPI>(null!);
  const rowHeight = useDynamicRowHeight({ defaultRowHeight: 56, key: conversationId });

  const atBottomRef = useRef(true);
  const prevCountRef = useRef(0);
  // Snapshot before history fetch for scroll restoration
  const scrollSnapRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null);
  // Whether initial scroll-to-bottom has been done for this conversation
  const initialScrollDoneRef = useRef(false);
  // always up-to-date items.length without stale-closure issues in callbacks
  const itemsLengthRef = useRef(0);
  // Refs so the scroll listener always sees fresh values without re-registering
  const hasNextPageRef = useRef(hasNextPage);
  const isFetchingNextPageRef = useRef(isFetchingNextPage);
  const fetchNextPageRef = useRef(fetchNextPage);
  hasNextPageRef.current = hasNextPage;
  isFetchingNextPageRef.current = isFetchingNextPage;
  fetchNextPageRef.current = fetchNextPage;
  // Tracks previous scrollTop to derive scroll direction in handleScroll
  const prevScrollTopRef = useRef(0);

  // Flatten pages — oldest first
  const messages: Message[] = data?.pages
    ? [...data.pages].reverse().flatMap((p) => p.data)
    : [];

  const items = buildItems(messages);
  itemsLengthRef.current = items.length;
  const messageById = new Map(messages.map((m) => [m.messageId, m]));

  const memberMap = new Map(members.map((m) => [m.userId, m as ConversationMember & { displayName?: string; username?: string; avatarUrl?: string | null }]));

  const otherMembers = members
    .filter((m) => m.userId !== userId)
    .map((m) => ({
      userId: m.userId,
      lastSeenOffset: m.lastSeenOffset,
      lastDeliveredOffset: m.lastDeliveredOffset,
      avatarUrl: (m as { avatarUrl?: string | null }).avatarUrl ?? null,
      displayName: (m as { displayName?: string }).displayName,
      username: (m as { username?: string }).username,
    }));

  // Reset on conversation switch
  useEffect(() => {
    prevCountRef.current = 0;
    scrollSnapRef.current = null;
    atBottomRef.current = true;
    initialScrollDoneRef.current = false;
    setLastVisibleOffset(null);
  }, [conversationId]);

  // Scroll to bottom once when first page of messages arrives (double-scroll technique)
  useEffect(() => {
    if (initialScrollDoneRef.current) return;
    if (messages.length === 0) return;
    if (!listRef.current) return;
    // First scroll — lands close to bottom immediately
    listRef.current.scrollToRow({ index: itemsLengthRef.current - 1, align: "end" });
    initialScrollDoneRef.current = true;
    atBottomRef.current = true;
    prevCountRef.current = messages.length;
    // Secondary scroll fires after dynamic heights have been calculated and painted,
    // correcting any residual offset caused by rows whose heights weren't yet known.
    const timer = setTimeout(() => {
      listRef.current?.scrollToRow({ index: itemsLengthRef.current - 1, align: "end" });
    }, 50);
    return () => clearTimeout(timer);
  // conversationId ensures this re-runs when switching conversations even if cache already has messages
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, messages.length]);

  // Handle new messages arriving + history prepend scroll restoration
  useEffect(() => {
    if (!initialScrollDoneRef.current) return;
    const newCount = messages.length;
    const oldCount = prevCountRef.current;
    if (newCount === oldCount) return;

    const snap = scrollSnapRef.current;
    if (snap !== null && newCount > oldCount) {
      // History prepended — restore by pixel delta.
      // Wrap in two rAF frames so ResizeObserver settles before we read scrollHeight.
      scrollSnapRef.current = null;
      const el = listRef.current?.element;
      if (el) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            el.scrollTop = snap.scrollTop + (el.scrollHeight - snap.scrollHeight);
          });
        });
      }
    } else if (newCount > oldCount) {
      // New message arrived — auto-scroll if user is at bottom OR it's their own message
      const lastMsg = messages[messages.length - 1];
      const isMine = lastMsg?.senderId === userId;
      if (atBottomRef.current || isMine) {
        listRef.current?.scrollToRow({ index: itemsLengthRef.current - 1, align: "end" });
      }
    }

    prevCountRef.current = newCount;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, messages.length, userId]);
  // Native scroll handler — drives atBottom tracking and reverse-infinite-scroll trigger.
  // Using react-window's onScroll pass-through (HTMLAttributes spread) gives us a single,
  // reliable event source without manual addEventListener/removeEventListener.
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      const scrollTop = target.scrollTop;
      const scrollHeight = target.scrollHeight;
      const clientHeight = target.clientHeight;
      const scrollDirection = scrollTop < prevScrollTopRef.current ? "backward" : "forward";
      prevScrollTopRef.current = scrollTop;

      // Keep atBottom ref accurate for new-message auto-scroll
      atBottomRef.current = scrollHeight - scrollTop - clientHeight < 80;
      onScrollChange?.(atBottomRef.current, 0);

      // Trigger history load when scrolling backward near the top
      if (
        initialScrollDoneRef.current &&
        scrollDirection === "backward" &&
        scrollTop < 200 &&
        hasNextPageRef.current &&
        !isFetchingNextPageRef.current
      ) {
        // Snapshot before fetch so we can restore position after prepend
        if (scrollSnapRef.current === null) {
          scrollSnapRef.current = { scrollTop, scrollHeight };
        }
        fetchNextPageRef.current();
      }
    },
    [onScrollChange]
  );

  const handleRowsRendered = useCallback(
    ({ startIndex, stopIndex }: { startIndex: number; stopIndex: number }) => {
      // Seen-cursor tracking only — scroll/fetch logic lives in handleScroll
      let maxOffset = -1;
      for (let i = stopIndex; i >= startIndex; i--) {
        const item = items[i];
        if (item?.kind === "message" && item.msg.senderId !== userId && item.msg.offset > 0) {
          maxOffset = item.msg.offset;
          break;
        }
      }
      if (maxOffset > 0) {
        setLastVisibleOffset((prev) => (prev === null || maxOffset > prev) ? maxOffset : prev);
      }
    },
    [items, userId]
  );

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!isLoading && messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center select-none">
        <div className="w-12 h-12 rounded-2xl bg-border/60 flex items-center justify-center">
          <MessageSquare className="w-6 h-6 text-muted" />
        </div>
        <div>
          <p className="text-sm font-medium text-secondary">No messages yet</p>
          <p className="text-xs text-muted mt-0.5">Be the first to say something!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-hidden relative">
      {isFetchingNextPage && (
        <div className="flex justify-center py-2 absolute top-0 left-0 right-0 z-10 pointer-events-none">
          <Loader2 className="w-4 h-4 animate-spin text-muted" />
        </div>
      )}
      <List
        listRef={listRef}
        style={{ height: "100%", width: "100%" }}
        rowCount={items.length}
        rowHeight={rowHeight}
        rowComponent={MessageRowComponent}
        rowProps={{ items, userId, messageById, memberMap, otherMembers, setReplyTo, observeRowElements: rowHeight.observeRowElements, onEdit: handleEdit, onDelete: handleDelete, onRevoke: handleRevoke, onForward: handleForward, onPin: handlePin, onViewDetails: handleViewDetails, onRetry: handleRetry }}
        onRowsRendered={handleRowsRendered}
        onScroll={handleScroll}
        overscanCount={8}
      />
      {forwardTarget && (
        <ForwardModal message={forwardTarget} onClose={() => setForwardTarget(null)} />
      )}
      {detailsTarget && (
        <MessageDetailsModal
          message={detailsTarget}
          memberMap={memberMap}
          messageById={messageById}
          otherMembers={otherMembers}
          onClose={() => {
            if (onCloseDetails) { onCloseDetails(); }
            else { setInternalDetailsTarget(null); }
          }}
        />
      )}
    </div>
  );
}

