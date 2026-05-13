"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";
import { finalize } from "rxjs";
import type { Subscription } from "rxjs";
import {
  useDynamicRowHeight,
  type ListImperativeAPI,
} from "react-window";
import type { MessagesInfiniteData } from "@/hooks/useMessages";
import { getMessages } from "@/lib/api/messages";
import { useConversationStore } from "@/stores/conversationStore";
import { getQueryClient } from "@/lib/query/queryClient";
import { queryKeys } from "@/lib/query/keys";
import { useSeenCursor } from "@/hooks/useSeenCursor";
import type { ListItem } from "../types";
import {
  createBottomScrollStream,
  createJumpScrollStream,
  createHistoryRestoreStream,
} from "../utils/rx";
import { getBottomTargetIndex, estimateRowHeight } from "../utils/scroll";
import {
  BOTTOM_THRESHOLD_PX,
  HISTORY_FETCH_THRESHOLD_PX,
  HISTORY_FETCH_VIEWPORT_MULTIPLIER,
  LOAD_AFTER_THRESHOLD_PX,
  AFTER_FETCH_LIMIT,
} from "../constants";

interface UseVirtualScrollProps {
  conversationId: string;
  items: ListItem[];
  userId: string;
  stableTimelineCount: number;
  targetOffset?: number | null;
  /** Fetching API surface from useMessageTimeline */
  data: MessagesInfiniteData | undefined;
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  refetch: () => Promise<unknown>;
  onScrollChange?: (atBottom: boolean, unreadBelow: number) => void;
}

export function useVirtualScroll({
  conversationId,
  items,
  userId,
  stableTimelineCount,
  targetOffset,
  data,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  refetch,
  onScrollChange,
}: UseVirtualScrollProps) {
  // ─── Store ────────────────────────────────────────────────────────────────
  const targetMessageId = useConversationStore((s) => s.targetMessageId);
  const setTargetMessageId = useConversationStore((s) => s.setTargetMessageId);
  const messageMode = useConversationStore((s) => s.messageMode);
  const setMessageMode = useConversationStore((s) => s.setMessageMode);
  const pendingJumpedCount = useConversationStore(
    (s) => s.pendingJumpedMessages[conversationId] ?? 0,
  );
  const clearPendingJumpedMessages = useConversationStore((s) => s.clearPendingJumpedMessages);

  // ─── Refs ─────────────────────────────────────────────────────────────────
  const listRef = useRef<ListImperativeAPI>(null!);
  const rowHeight = useDynamicRowHeight({
    defaultRowHeight: 56,
    key: `${conversationId}:${messageMode}`,
  });

  // Tracks the newestOffset of the first loaded page so we can detect when
  // maxPages eviction has dropped the newest page from the cache.
  const initialNewestOffsetRef = useRef<number | null>(null);
  const newestPageEvictedRef = useRef(false);

  // Scroll state consolidated into a single ref object (avoids ~10 individual refs)
  const scrollState = useRef({
    atBottom: true,
    prevScrollTop: 0,
    isScrollingToBottom: false,
    isJumping: false,
    isRestoring: false,
    initialScrollDone: false,
    prevCount: 0,
  });

  // Scroll anchor snapshot before a history prepend
  const scrollSnapRef = useRef<{
    messageId: string | null;
    top: number;
    scrollTop: number;
    scrollHeight: number;
  } | null>(null);

  // Always-fresh refs so event handlers never become stale
  const itemsLengthRef = useRef(items.length);
  const bottomTargetIndexRef = useRef(0);
  const hasNextPageRef = useRef(hasNextPage);
  const isFetchingNextPageRef = useRef(isFetchingNextPage);
  const fetchNextPageRef = useRef(fetchNextPage);
  const isFetchingAfterRef = useRef(false);

  itemsLengthRef.current = items.length;
  hasNextPageRef.current = hasNextPage;
  isFetchingNextPageRef.current = isFetchingNextPage;
  fetchNextPageRef.current = fetchNextPage;
  bottomTargetIndexRef.current = getBottomTargetIndex(items);

  // RxJS subscriptions
  const scrollToBottomSubRef = useRef<Subscription | null>(null);
  const jumpSubRef = useRef<Subscription | null>(null);
  const historyRestoreSubRef = useRef<Subscription | null>(null);

  // ─── UI state ─────────────────────────────────────────────────────────────
  const [showFab, setShowFab] = useState(false);
  const showFabRef = useRef(false);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const [isFetchingAfter, setIsFetchingAfter] = useState(false);

  const updateShowFab = useCallback((value: boolean) => {
    if (showFabRef.current !== value) {
      showFabRef.current = value;
      setShowFab(value);
    }
  }, []);

  // ─── Seen cursor ──────────────────────────────────────────────────────────
  const [lastVisibleOffset, setLastVisibleOffset] = useState<number | null>(null);
  useSeenCursor(conversationId, lastVisibleOffset);

  // ─── Scroll anchor helpers ────────────────────────────────────────────────
  const captureScrollAnchor = useCallback((container: HTMLDivElement) => {
    const containerRect = container.getBoundingClientRect();
    const anchor = Array.from(
      container.querySelectorAll<HTMLElement>("[data-message-id]"),
    ).find((node) => node.getBoundingClientRect().top >= containerRect.top + 24);
    const anchorRect = anchor?.getBoundingClientRect();
    scrollSnapRef.current = {
      messageId: anchor?.dataset.messageId ?? null,
      top: anchorRect ? anchorRect.top - containerRect.top : 0,
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
    };
  }, []);

  const restoreScrollAnchor = useCallback(
    (snap: NonNullable<typeof scrollSnapRef.current>) => {
      const el = listRef.current?.element;
      if (!el) return false;
      if (snap.messageId) {
        const targetEl = el.querySelector<HTMLElement>(
          `[data-message-id="${snap.messageId}"]`,
        );
        if (targetEl) {
          const containerRect = el.getBoundingClientRect();
          const targetRect = targetEl.getBoundingClientRect();
          el.scrollTop += targetRect.top - containerRect.top - snap.top;
          scrollState.current.prevScrollTop = el.scrollTop;
          return true;
        }
      }
      el.scrollTop = snap.scrollTop + (el.scrollHeight - snap.scrollHeight);
      scrollState.current.prevScrollTop = el.scrollTop;
      return true;
    },
    [],
  );

  // ─── domScrollToBottom ────────────────────────────────────────────────────
  const domScrollToBottom = useCallback(() => {
    scrollToBottomSubRef.current?.unsubscribe();
    scrollState.current.isScrollingToBottom = true;
    scrollState.current.atBottom = true;
    updateShowFab(false);

    const doScroll = () => {
      const el = listRef.current?.element;
      const targetIndex = Math.max(0, bottomTargetIndexRef.current);
      listRef.current?.scrollToRow({ index: targetIndex, align: "end" });
      if (el) {
        const targetItem = items[targetIndex];
        const targetEl =
          targetItem?.kind === "poll"
            ? Array.from(el.querySelectorAll<HTMLElement>("[data-poll-id]")).find(
                (node) => node.dataset.pollId === targetItem.poll.id,
              )
            : null;
        if (targetEl) {
          const containerRect = el.getBoundingClientRect();
          const targetRect = targetEl.getBoundingClientRect();
          el.scrollTop += targetRect.bottom - containerRect.bottom;
        } else {
          el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
        }
      }
    };

    doScroll();
    scrollToBottomSubRef.current = createBottomScrollStream({
      shouldContinue: () => scrollState.current.atBottom,
      onScroll: doScroll,
      onFinalize: () => {
        scrollState.current.isScrollingToBottom = false;
      },
    }).subscribe();
  }, [items, updateShowFab]);

  // ─── loadMoreAfter (JUMPED mode) ──────────────────────────────────────────
  const loadMoreAfter = useCallback(async () => {
    if (messageMode !== "JUMPED" || isFetchingAfterRef.current) return;
    const newestPage = data?.pages[0];
    const newestOffset = newestPage?.meta.newestOffset;
    const hasMoreAfter = newestPage?.meta.hasMoreAfter ?? newestPage?.meta.hasMore;
    if (newestOffset == null || !hasMoreAfter) return;

    isFetchingAfterRef.current = true;
    setIsFetchingAfter(true);
    try {
      const page = await getMessages({
        conversationId,
        after: newestOffset,
        limit: AFTER_FETCH_LIMIT,
      });
      const nextHasMoreAfter = page.meta.hasMoreAfter ?? page.meta.hasMore;
      if (page.data.length === 0 || !nextHasMoreAfter) {
        setMessageMode("LIVE");
        clearPendingJumpedMessages(conversationId);
        getQueryClient().removeQueries({ queryKey: queryKeys.messages.list(conversationId) });
        await refetch();
        scrollState.current.initialScrollDone = false;
        return;
      }
      getQueryClient().setQueryData<MessagesInfiniteData>(
        queryKeys.messages.list(conversationId),
        (old) => {
          if (!old) return old;
          const existingIds = new Set(
            old.pages.flatMap((p) => p.data.map((m) => m.messageId)),
          );
          const dedupedPage = {
            ...page,
            data: page.data.filter((m) => !existingIds.has(m.messageId)),
          };
          return {
            ...old,
            pages:
              dedupedPage.data.length > 0 ? [dedupedPage, ...old.pages] : old.pages,
          };
        },
      );
    } finally {
      isFetchingAfterRef.current = false;
      setIsFetchingAfter(false);
    }
  }, [messageMode, data?.pages, conversationId, setMessageMode, clearPendingJumpedMessages, refetch]);

  // ─── handleScroll ─────────────────────────────────────────────────────────
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      const scrollTop = target.scrollTop;
      const scrollHeight = target.scrollHeight;
      const clientHeight = target.clientHeight;
      const isBackward = scrollTop < scrollState.current.prevScrollTop;
      scrollState.current.prevScrollTop = scrollTop;

      // Release programmatic-scroll lock when user scrolls up
      if (isBackward && scrollState.current.isScrollingToBottom) {
        scrollState.current.isScrollingToBottom = false;
        scrollToBottomSubRef.current?.unsubscribe();
        scrollState.current.atBottom = false;
        updateShowFab(true);
        onScrollChange?.(false, 0);
      }

      if (
        !scrollState.current.isScrollingToBottom &&
        !scrollState.current.isJumping &&
        !scrollState.current.isRestoring
      ) {
        scrollState.current.atBottom =
          scrollHeight - scrollTop - clientHeight < BOTTOM_THRESHOLD_PX;
        updateShowFab(!scrollState.current.atBottom);
        onScrollChange?.(scrollState.current.atBottom, 0);
      }

      // Trigger history load when scrolling backward
      if (
        scrollState.current.initialScrollDone &&
        isBackward &&
        scrollTop < Math.max(HISTORY_FETCH_THRESHOLD_PX, clientHeight * HISTORY_FETCH_VIEWPORT_MULTIPLIER) &&
        hasNextPageRef.current &&
        !isFetchingNextPageRef.current
      ) {
        if (scrollSnapRef.current === null) captureScrollAnchor(target);
        fetchNextPageRef.current();
      }

      // Trigger load-more-after when scrolling forward in JUMPED mode
      const newestPage = data?.pages[0];
      const hasMoreAfter = newestPage?.meta.hasMoreAfter ?? newestPage?.meta.hasMore;
      if (
        messageMode === "JUMPED" &&
        !isBackward &&
        scrollHeight - scrollTop - clientHeight < LOAD_AFTER_THRESHOLD_PX &&
        hasMoreAfter &&
        !isFetchingAfterRef.current
      ) {
        void loadMoreAfter();
      }
    },
    [captureScrollAnchor, data?.pages, loadMoreAfter, messageMode, onScrollChange, updateShowFab],
  );

  // ─── handleRowsRendered ───────────────────────────────────────────────────
  const handleRowsRendered = useCallback(
    ({ startIndex, stopIndex }: { startIndex: number; stopIndex: number }) => {
      let maxOffset = -1;
      for (let i = stopIndex; i >= startIndex; i--) {
        const item = items[i];
        if (
          item?.kind === "message" &&
          item.msg.senderId !== userId &&
          item.msg.offset > 0
        ) {
          maxOffset = item.msg.offset;
          break;
        }
      }
      if (maxOffset > 0) {
        setLastVisibleOffset((prev) =>
          prev === null || maxOffset > prev ? maxOffset : prev,
        );
      }
    },
    [items, userId],
  );

  // ─── scrollToBottom (FAB click) ───────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    // In JUMPED mode OR when the newest page was evicted by maxPages, reset
    // the query and reload fresh latest messages before scrolling to bottom.
    if (messageMode === "JUMPED" || newestPageEvictedRef.current) {
      setMessageMode("LIVE");
      clearPendingJumpedMessages(conversationId);
      initialNewestOffsetRef.current = null;
      newestPageEvictedRef.current = false;
      getQueryClient().removeQueries({ queryKey: queryKeys.messages.list(conversationId) });
      scrollState.current.initialScrollDone = false;
      void refetch().finally(() => {
        requestAnimationFrame(() => {
          scrollState.current.initialScrollDone = true;
          domScrollToBottom();
        });
      });
      return;
    }
    domScrollToBottom();
  }, [
    messageMode,
    setMessageMode,
    clearPendingJumpedMessages,
    conversationId,
    refetch,
    domScrollToBottom,
  ]);

  // ─── Reset on conversation switch ────────────────────────────────────────
  useEffect(() => {
    scrollState.current = {
      atBottom: true,
      prevScrollTop: 0,
      isScrollingToBottom: false,
      isJumping: false,
      isRestoring: false,
      initialScrollDone: false,
      prevCount: 0,
    };
    scrollSnapRef.current = null;
    initialNewestOffsetRef.current = null;
    newestPageEvictedRef.current = false;
    showFabRef.current = false;
    setShowFab(false);
    setLastVisibleOffset(null);
    scrollToBottomSubRef.current?.unsubscribe();
    jumpSubRef.current?.unsubscribe();
    historyRestoreSubRef.current?.unsubscribe();
    setMessageMode("LIVE");
    clearPendingJumpedMessages(conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // ─── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      scrollToBottomSubRef.current?.unsubscribe();
      jumpSubRef.current?.unsubscribe();
      historyRestoreSubRef.current?.unsubscribe();
    };
  }, []);

  // ─── Eviction detection ───────────────────────────────────────────────────
  // React Query's maxPages evicts data.pages[0] (the newest page) when a new
  // history page is added. Track the initial newestOffset so we can detect
  // when the newest page has been silently dropped from the cache.
  useEffect(() => {
    const currentNewest = data?.pages?.[0]?.meta?.newestOffset;
    if (currentNewest == null) return;
    if (initialNewestOffsetRef.current === null) {
      initialNewestOffsetRef.current = currentNewest;
      return;
    }
    newestPageEvictedRef.current = currentNewest < initialNewestOffsetRef.current;
  }, [data]);

  // ─── History restore (useLayoutEffect) ───────────────────────────────────
  useLayoutEffect(() => {
    const snap = scrollSnapRef.current;
    if (!snap) return;

    historyRestoreSubRef.current?.unsubscribe();
    scrollState.current.isRestoring = true;
    restoreScrollAnchor(snap); // immediate pre-paint pass

    const el = listRef.current?.element;
    historyRestoreSubRef.current = createHistoryRestoreStream(el ?? null)
      .pipe(
        finalize(() => {
          restoreScrollAnchor(snap);
          scrollState.current.isRestoring = false;
        }),
      )
      .subscribe(() => restoreScrollAnchor(snap));

    scrollSnapRef.current = null;
    scrollState.current.prevCount = stableTimelineCount;

    return () => historyRestoreSubRef.current?.unsubscribe();
  }, [restoreScrollAnchor, stableTimelineCount]);

  // ─── Initial scroll to bottom ─────────────────────────────────────────────
  useEffect(() => {
    if (scrollState.current.initialScrollDone) return;
    if (targetOffset !== null && targetOffset !== undefined) return;
    if (stableTimelineCount === 0) return;
    scrollState.current.initialScrollDone = true;
    scrollState.current.prevCount = stableTimelineCount;
    domScrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, stableTimelineCount]);

  // ─── Auto-scroll on new messages ─────────────────────────────────────────
  useEffect(() => {
    if (!scrollState.current.initialScrollDone) return;
    const newCount = stableTimelineCount;
    const oldCount = scrollState.current.prevCount;
    if (newCount === oldCount) return;

    if (scrollSnapRef.current !== null && newCount > oldCount) {
      // History restore in progress — skip auto-scroll
    } else if (newCount > oldCount) {
      const lastItem = items[items.length - 2];
      const isMine =
        lastItem?.kind === "message"
          ? lastItem.msg.senderId === userId
          : lastItem?.kind === "poll"
            ? lastItem.poll.creatorId === userId
            : false;
      if (scrollState.current.atBottom || isMine) {
        domScrollToBottom();
      }
    }

    scrollState.current.prevCount = newCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, stableTimelineCount, userId, items]);

  // ─── Jump to message ──────────────────────────────────────────────────────
  useEffect(() => {
    if ((targetOffset === null || targetOffset === undefined) && !targetMessageId) return;
    if (items.length === 0) return;

    const targetIndex = items.findIndex(
      (item) =>
        item.kind === "message" &&
        (item.msg.offset === targetOffset ||
          (targetMessageId && item.msg.messageId === targetMessageId)),
    );

    if (targetIndex >= 0 && listRef.current) {
      jumpSubRef.current?.unsubscribe();
      scrollState.current.isJumping = true;

      // Pass 1: pre-position using height estimates to bypass unmeasured rows
      const containerEl = listRef.current.element;
      if (containerEl) {
        let offsetBefore = 0;
        for (let i = 0; i < targetIndex; i++) {
          const h = rowHeight.getRowHeight(i);
          offsetBefore += h !== undefined && h !== 56 ? h : estimateRowHeight(items[i]);
        }
        const targetH = estimateRowHeight(items[targetIndex]);
        const scrollTop = Math.max(
          0,
          offsetBefore + targetH / 2 - containerEl.clientHeight / 2,
        );
        containerEl.scrollTo({ top: scrollTop });
      }
      listRef.current.scrollToRow({ index: targetIndex, align: "center" });

      const targetItem = items[targetIndex];

      const centerRenderedTarget = () => {
        if (targetItem?.kind !== "message") return false;
        const container = listRef.current?.element;
        if (!container) return false;
        const targetEl = container.querySelector<HTMLElement>(
          `[data-message-id="${targetItem.msg.messageId}"]`,
        );
        if (!targetEl) return false;
        const containerRect = container.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        container.scrollTop +=
          targetRect.top -
          containerRect.top -
          (container.clientHeight - targetRect.height) / 2;
        return true;
      };

      const doScroll = () => {
        if (!centerRenderedTarget()) {
          listRef.current?.scrollToRow({ index: targetIndex, align: "center" });
        }
      };

      jumpSubRef.current = createJumpScrollStream().subscribe((pass) => {
        if (pass === 0 || pass === 3) centerRenderedTarget();
        if (pass === 1 || pass === 2) doScroll();
        if (pass === 3) {
          scrollState.current.isJumping = false;
        }
      });

      if (targetItem?.kind === "message") {
        setHighlightMessageId(targetItem.msg.messageId);
        window.setTimeout(() => setHighlightMessageId(null), 2200);
      }

      scrollState.current.initialScrollDone = true;
      scrollState.current.prevCount = stableTimelineCount;
      scrollState.current.atBottom = false;
      updateShowFab(true);

      useConversationStore.getState().setTargetOffset(null);
      setTargetMessageId(null);

      return () => {
        jumpSubRef.current?.unsubscribe();
        scrollState.current.isJumping = false;
      };
    }

    // Target not yet in items — retry when items update; failsafe clear after 5 s
    const clearTimer = window.setTimeout(() => {
      useConversationStore.getState().setTargetOffset(null);
      setTargetMessageId(null);
    }, 5000);
    return () => window.clearTimeout(clearTimer);
  }, [targetOffset, targetMessageId, items, stableTimelineCount, setTargetMessageId, rowHeight]);

  return {
    listRef,
    rowHeight,
    showFab,
    isFetchingAfter,
    highlightMessageId,
    lastVisibleOffset,
    messageMode,
    pendingJumpedCount,
    handleScroll,
    handleRowsRendered,
    scrollToBottom,
    domScrollToBottom,
  };
}
