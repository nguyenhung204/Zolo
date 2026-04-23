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
import { ScrollToBottomFab } from "./ScrollToBottomFab";
import type { ConversationMember } from "@/lib/api/conversations";
import type { ReplyTarget, EditTarget } from "@/stores/conversationStore";
import { formatDateDivider } from "@/lib/utils/date";
import { Loader2, MessageSquare } from "lucide-react";
import type { MessagesInfiniteData } from "@/hooks/useMessages";
import { toast } from "sonner";
import { getUserById } from "@/lib/api/users";
import { usePresenceStore } from "@/stores/presenceStore";
import { getMediaSignedUrl } from "@/lib/api/media";

interface VirtualMessageListProps {
  conversationId: string;
  members: ConversationMember[];
  onScrollChange?: (atBottom: boolean, unreadBelow: number) => void;
  /** External details target (set from pinned banner). If provided, overrides internal state. */
  onViewDetails?: (msg: Message) => void;
  detailsTarget?: Message | null;
  onCloseDetails?: () => void;
  /** Jump to specific offset (from notification) */
  targetOffset?: number | null;
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
  const GROUP_GAP_MS = 5 * 60 * 1000; // 5-minute gap breaks a group
  const samePrev =
    prev?.senderId === msg.senderId &&
    prev?.type !== "system" &&
    prev?.type !== "call_summary" &&
    msg.type !== "call_summary" &&
    new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_GAP_MS;
  const sameNext =
    next?.senderId === msg.senderId &&
    next?.type !== "system" &&
    next?.type !== "call_summary" &&
    msg.type !== "call_summary" &&
    new Date(next.createdAt).getTime() - new Date(msg.createdAt).getTime() < GROUP_GAP_MS;
  const member = memberMap.get(msg.senderId);
  // Prefer a human-readable name: displayName > username — never show raw IDs
  const senderName = member?.displayName ?? member?.username ?? "";
  const replyMsg = msg.replyToMessageId ? messageById.get(msg.replyToMessageId) ?? null : null;

  return (
    <div style={style}>
      <MessageRow
        message={msg}
        isMine={isMine}
        isGroupStart={!samePrev}
        isGroupEnd={!sameNext}
        replyMsg={replyMsg}
        senderName={senderName}
        senderAvatarUrl={member?.avatarUrl ?? undefined}
        otherMembers={otherMembers}
        onReply={(m) => setReplyTo({ messageId: m.messageId, senderId: m.senderId, senderName, content: m.content, type: m.type, metadata: m.metadata })}
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
  targetOffset,
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
        toast.error("The allowed time window for this action has expired.");
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
      alert("You can pin up to 3 messages in a conversation.");
    }
  }, [conversationId]);

  const listRef = useRef<ListImperativeAPI>(null!);
  const rowHeight = useDynamicRowHeight({ defaultRowHeight: 56, key: conversationId });

  const atBottomRef = useRef(true);
  const [showFab, setShowFab] = useState(false);
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
  // Programmatic scroll-to-bottom lock — prevents handleScroll from setting atBottomRef=false
  // while heights are still being measured after a virtual-coordinate scroll.
  const isScrollingToBottomRef = useRef(false);
  const scrollToBottomTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

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

  // ─── Populate profiles for message senders ────────────────────────────────
  const profileMap = usePresenceStore((s) => s.profileMap);
  const setUserProfile = usePresenceStore((s) => s.setUserProfile);

  useEffect(() => {
    if (messages.length === 0) return;

    // Collect unique sender IDs from messages
    const senderIds = new Set(messages.map((m) => m.senderId));

    // Fetch profiles for senders not yet in profileMap
    for (const senderId of senderIds) {
      if (profileMap[senderId]) continue;

      getUserById(senderId)
        .then(async (profile) => {
          let avatarUrl: string | null = null;
          if (profile.avatarMediaId) {
            try {
              avatarUrl = await getMediaSignedUrl(profile.avatarMediaId, "OPTIMIZED");
            } catch {
              // Swallow error
            }
          }
          const displayName =
            [profile.firstName, profile.lastName].filter(Boolean).join(" ") ||
            profile.username;
          setUserProfile(senderId, {
            displayName,
            avatarMediaId: profile.avatarMediaId ?? null,
            avatarUrl,
          });
        })
        .catch(() => {
          // Swallow — UI falls back to "User" placeholder
        });
    }
  }, [messages, profileMap, memberMap, setUserProfile]);

  // Scroll to the absolute DOM bottom — reliable regardless of virtual row heights.
  // Retries at 80 ms and 220 ms so positions stabilise as ResizeObserver fires.
  const domScrollToBottom = useCallback(() => {
    scrollToBottomTimersRef.current.forEach(clearTimeout);
    scrollToBottomTimersRef.current = [];
    isScrollingToBottomRef.current = true;
    atBottomRef.current = true;
    setShowFab(false);
    const doScroll = () => {
      const el = listRef.current?.element;
      if (el) {
        el.scrollTop = el.scrollHeight;
      } else {
        listRef.current?.scrollToRow({ index: itemsLengthRef.current - 1, align: "end" });
      }
    };
    doScroll();
    const t1 = setTimeout(() => { if (atBottomRef.current) doScroll(); }, 80);
    const t2 = setTimeout(() => { if (atBottomRef.current) doScroll(); }, 220);
    const t3 = setTimeout(() => { isScrollingToBottomRef.current = false; }, 320);
    scrollToBottomTimersRef.current = [t1, t2, t3];
  }, []);

  // Reset on conversation switch
  useEffect(() => {
    prevCountRef.current = 0;
    scrollSnapRef.current = null;
    atBottomRef.current = true;
    setShowFab(false);
    initialScrollDoneRef.current = false;
    setLastVisibleOffset(null);
    // Cancel any pending scroll-to-bottom retries from the previous conversation
    scrollToBottomTimersRef.current.forEach(clearTimeout);
    scrollToBottomTimersRef.current = [];
    isScrollingToBottomRef.current = false;
  }, [conversationId]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => { scrollToBottomTimersRef.current.forEach(clearTimeout); };
  }, []);
  // Jump to a specific message offset when requested (e.g. deep-link, pinned message)
  useEffect(() => {
    if (targetOffset === null || targetOffset === undefined || messages.length === 0) return;
    const targetIndex = items.findIndex(
      (item) => item.kind === "message" && item.msg.offset === targetOffset
    );
    if (targetIndex >= 0 && listRef.current) {
      listRef.current.scrollToRow({ index: targetIndex, align: "center" });
      initialScrollDoneRef.current = true;
      prevCountRef.current = messages.length;
      atBottomRef.current = false;
      setShowFab(true);
    }
    useConversationStore.getState().setTargetOffset(null);
  }, [targetOffset, items, messages.length]);

  // Scroll to bottom when the first page of messages arrives for this conversation.
  // Uses DOM-native el.scrollTop = el.scrollHeight so virtual coordinate inaccuracies
  // (from unmeasured row heights) cannot cause wrong positioning.
  useEffect(() => {
    if (initialScrollDoneRef.current) return;
    if (targetOffset !== null && targetOffset !== undefined) return;
    if (messages.length === 0) return;
    initialScrollDoneRef.current = true;
    prevCountRef.current = messages.length;
    domScrollToBottom();
  // conversationId ensures re-run when switching conversations even if cache already has data
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
        domScrollToBottom();
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

      // If the user scrolls upward while we're in a programmatic scroll-to-bottom,
      // release the lock immediately so their intent takes precedence.
      if (scrollDirection === "backward" && isScrollingToBottomRef.current) {
        isScrollingToBottomRef.current = false;
        scrollToBottomTimersRef.current.forEach(clearTimeout);
        scrollToBottomTimersRef.current = [];
        atBottomRef.current = false;
        setShowFab(true);
        onScrollChange?.(false, 0);
      }

      // Only update atBottom tracking when not in a programmatic scroll so that
      // height-measurement reflows don't incorrectly flip atBottomRef to false.
      if (!isScrollingToBottomRef.current) {
        atBottomRef.current = scrollHeight - scrollTop - clientHeight < 80;
        setShowFab(!atBottomRef.current);
        onScrollChange?.(atBottomRef.current, 0);
      }

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

  const scrollToBottom = useCallback(() => {
    domScrollToBottom();
  }, [domScrollToBottom]);

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
        rowProps={{ items, userId, messageById, memberMap, otherMembers, setReplyTo, onEdit: handleEdit, onDelete: handleDelete, onRevoke: handleRevoke, onForward: handleForward, onPin: handlePin, onViewDetails: handleViewDetails, onRetry: handleRetry }}
        onRowsRendered={handleRowsRendered}
        onScroll={handleScroll}
        overscanCount={8}
      />
      <ScrollToBottomFab
        show={showFab}
        unreadCount={0}
        onClick={scrollToBottom}
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

