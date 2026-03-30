"use client";

import { useRef, useEffect, useCallback } from "react";
import {
  List,
  useDynamicRowHeight,
  type ListImperativeAPI,
  type RowComponentProps,
} from "react-window";
import { useMessages } from "@/hooks/useMessages";
import { MessageRow } from "./MessageRow";
import { useAuthStore } from "@/stores/authStore";
import type { Message } from "@/lib/api/messages";
import type { ConversationMember } from "@/lib/api/conversations";
import { Loader2 } from "lucide-react";

interface VirtualMessageListProps {
  conversationId: string;
  members: ConversationMember[];
  onScrollChange?: (atBottom: boolean, unreadBelow: number) => void;
}

// ─── Row props passed to the row component ────────────────────────────────────

interface RowData {
  messages: Message[];
  userId: string;
  memberMap: Map<string, ConversationMember>;
  observeRowElements: (els: Element[] | NodeListOf<Element>) => () => void;
}

// rowComponent MUST be defined outside the parent to keep a stable reference
function MessageRowComponent({
  index,
  style,
  messages,
  userId,
  memberMap,
  observeRowElements,
}: RowComponentProps<RowData>) {
  const msg = messages[index];
  const prev = messages[index - 1];
  if (!msg) return null;

  const isMine = msg.senderId === userId;
  const showAvatar = !isMine && (index === 0 || prev?.senderId !== msg.senderId);
  const member = memberMap.get(msg.senderId);

  return (
    <div style={style} ref={(el) => { if (el) observeRowElements([el]); }}>
      <MessageRow
        message={msg}
        isMine={isMine}
        showAvatar={showAvatar}
        senderName={member?.userId ?? msg.senderId}
        senderAvatarUrl={undefined}
      />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function VirtualMessageList({
  conversationId,
  members,
  onScrollChange,
}: VirtualMessageListProps) {
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useMessages(conversationId);

  // React 19-compatible ref; ListImperativeAPI is assigned by the List on mount
  const listRef = useRef<ListImperativeAPI>(null!);
  // react-window v2 built-in dynamic row height with ResizeObserver
  const rowHeight = useDynamicRowHeight({ defaultRowHeight: 56, key: conversationId });

  const atBottomRef = useRef(true);
  const prevCountRef = useRef(0);

  // Flatten pages — oldest first (index 0)
  const messages: Message[] = data?.pages
    ? [...data.pages].reverse().flatMap((p) => p.data)
    : [];

  const memberMap = new Map(members.map((m) => [m.userId, m]));

  // Scroll anchor: keep at bottom when new messages arrive
  useEffect(() => {
    if (!atBottomRef.current) return;
    if (messages.length !== prevCountRef.current && messages.length > 0) {
      listRef.current?.scrollToRow({ index: messages.length - 1, align: "end" });
      prevCountRef.current = messages.length;
    }
  }, [messages.length]);

  // Load more when user scrolls near the top
  const handleRowsRendered = useCallback(
    ({ startIndex }: { startIndex: number; stopIndex: number }) => {
      if (startIndex <= 3 && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage]
  );

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted" />
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
        rowCount={messages.length}
        rowHeight={rowHeight}
        rowComponent={MessageRowComponent}
        rowProps={{ messages, userId, memberMap, observeRowElements: rowHeight.observeRowElements }}
        onRowsRendered={handleRowsRendered}
        overscanCount={8}
      />
    </div>
  );
}
