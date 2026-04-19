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
  const prevTopOffsetRef = useRef<number | null>(null);
  // true while we still need to pin the view to the bottom (initial load / conversation switch)
  const needsScrollBottomRef = useRef(true);
  // always up-to-date items.length without stale-closure issues in callbacks
  const itemsLengthRef = useRef(0);

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

  // Reset scroll tracking whenever the user navigates to a different conversation
  useEffect(() => {
    prevCountRef.current = 0;
    prevTopOffsetRef.current = null;
    atBottomRef.current = true;
    needsScrollBottomRef.current = true;
    setLastVisibleOffset(null);
  }, [conversationId]);

  // Keep atBottomRef in sync with the user's actual scroll position
  useEffect(() => {
    const el = listRef.current?.element;
    if (!el) return;
    const onScroll = () => {
      atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }); // intentionally runs every render so it always binds to the latest element

  // Handle new messages and history prepend — skipped during initial scroll phase
  useEffect(() => {
    if (needsScrollBottomRef.current) return;
    const newCount = messages.length;
    const oldCount = prevCountRef.current;
    if (newCount === oldCount) return;

    if (prevTopOffsetRef.current !== null && newCount > oldCount) {
      // Pages were prepended — jump to the item that was visible at the top before
      const addedRows = newCount - oldCount;
      listRef.current?.scrollToRow({ index: addedRows + 1, align: "start" });
      prevTopOffsetRef.current = null;
    } else if (atBottomRef.current) {
      // New message while user is at the bottom — follow it
      listRef.current?.scrollToRow({ index: items.length - 1, align: "end" });
    }

    prevCountRef.current = newCount;
  }, [conversationId, messages.length, items.length]);

  // Snapshot message count before a history fetch so we can restore scroll after prepend
  useEffect(() => {
    if (isFetchingNextPage && prevCountRef.current > 0) {
      prevTopOffsetRef.current = prevCountRef.current;
    }
  }, [isFetchingNextPage]);

  // Initial scroll-to-bottom is driven from onRowsRendered (not useEffect) because
  // useDynamicRowHeight re-measures rows after first render, which grows scrollHeight and
  // resets a useEffect-based scrollTop back toward the top.
  // By setting el.scrollTop = el.scrollHeight on every render pass we stay pinned to the
  // bottom until the last row is actually rendered and measured.
  const handleRowsRendered = useCallback(
    ({ startIndex, stopIndex }: { startIndex: number; stopIndex: number }) => {
      if (needsScrollBottomRef.current) {
        const el = listRef.current?.element;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
        // Exit initial-scroll phase once the last row is rendered
        if (stopIndex >= itemsLengthRef.current - 2) {
          needsScrollBottomRef.current = false;
          prevCountRef.current = itemsLengthRef.current;
          atBottomRef.current = true;
        }
        return; // don't trigger load-more while scrolling to bottom
      }
      if (startIndex <= 5 && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
      // Track the highest visible message offset for the seen cursor
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
    [hasNextPage, isFetchingNextPage, fetchNextPage, items, userId]
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
        rowProps={{ items, userId, messageById, memberMap, otherMembers, setReplyTo, observeRowElements: rowHeight.observeRowElements, onEdit: handleEdit, onDelete: handleDelete, onRevoke: handleRevoke, onForward: handleForward, onPin: handlePin, onViewDetails: handleViewDetails }}
        onRowsRendered={handleRowsRendered}
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

