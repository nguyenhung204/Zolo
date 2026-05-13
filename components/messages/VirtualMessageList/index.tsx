"use client";

import { useMemo, memo } from "react";
import { List, type RowComponentProps } from "react-window";
import type { Message } from "@/lib/api/messages";
import type { ConversationMember } from "@/lib/api/conversations";
import { useConversationStore } from "@/stores/conversationStore";
import { ForwardModal } from "@/components/messages/ForwardModal";
import { MessageDetailsModal } from "@/components/messages/MessageDetailsModal";
import { ScrollToBottomFab } from "@/components/messages/ScrollToBottomFab";
import { MessageRow } from "@/components/messages/MessageRow";

import type { ListItem, RowData } from "./types";
import { useMessageTimeline } from "./hooks/useMessageTimeline";
import { useMessageActions } from "./hooks/useMessageActions";
import { useVirtualScroll } from "./hooks/useVirtualScroll";
import { usePresenceHydration } from "./hooks/usePresenceHydration";
import { EmptyState } from "./components/EmptyState";
import { LoadingState, FetchingOverlay } from "./components/LoadingOverlay";
import { MessageDivider } from "./components/MessageDivider";
import { PollRow } from "./components/PollRow";
import { getMessageGrouping } from "./utils/grouping";

// ─── Props ────────────────────────────────────────────────────────────────────

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

// ─── Row renderer (must live outside the parent for stable ref) ───────────────

const MessageRowComponent = memo(function MessageRowComponent({
  index,
  style,
  items,
  userId,
  messageById,
  memberMap,
  otherMembers,
  myRole,
  canPinMessages,
  allowMemberMessage,
  setReplyTo,
  onEdit,
  onDelete,
  onRevoke,
  onForward,
  onPin,
  onViewDetails,
  onRetry,
  highlightMessageId,
}: RowComponentProps<RowData>) {
  const item = items[index];
  if (!item) return null;

  if (item.kind === "padding") {
    return <div style={style} className="h-4" />;
  }

  if (item.kind === "divider") {
    return <MessageDivider label={item.label} style={style} />;
  }

  if (item.kind === "poll") {
    return (
      <PollRow
        poll={item.poll}
        style={style}
        myRole={myRole}
        allowMemberMessage={allowMemberMessage}
      />
    );
  }

  // item.kind === "message"
  const { msg, prev, next } = item;
  const isMine = msg._mine || msg.senderId === userId;
  const { isGroupStart, isGroupEnd } = getMessageGrouping(msg, prev, next);
  const member = memberMap.get(msg.senderId);
  const senderName = member?.displayName ?? member?.username ?? "";
  const replyMsg = msg.replyToMessageId ? messageById.get(msg.replyToMessageId) ?? null : null;
  const mentionLabels = (msg.metadata?.mentions ?? [])
    .map((uid) => {
      const m = memberMap.get(uid);
      const label = m?.displayName ?? m?.username;
      return label ? `@${label}` : "";
    })
    .filter(Boolean);

  return (
    <div
      data-message-id={msg.messageId}
      style={style}
      className={
        highlightMessageId === msg.messageId
          ? "bg-warning/20 transition-colors duration-700"
          : undefined
      }
    >
      <MessageRow
        message={msg}
        isMine={isMine}
        isGroupStart={isGroupStart}
        isGroupEnd={isGroupEnd}
        replyMsg={replyMsg}
        senderName={senderName}
        senderAvatarUrl={member?.avatarUrl ?? undefined}
        otherMembers={otherMembers}
        mentionLabels={mentionLabels}
        onReply={(m) =>
          setReplyTo({
            messageId: m.messageId,
            senderId: m.senderId,
            senderName,
            content: m.content,
            type: m.type,
            metadata: m.metadata,
          })
        }
        onEdit={onEdit}
        onDelete={onDelete}
        onRevoke={onRevoke}
        onForward={onForward}
        onPin={onPin}
        canPin={canPinMessages}
        onViewDetails={onViewDetails}
        onRetry={
          msg.clientMessageId
            ? (m) => onRetry(m.conversationId, m.clientMessageId!)
            : undefined
        }
      />
    </div>
  );
});

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
  const setReplyTo = useConversationStore((s) => s.setReplyTo);

  // ── Data layer ────────────────────────────────────────────────────────────
  const timeline = useMessageTimeline(conversationId, members);

  // ── Scroll engine ─────────────────────────────────────────────────────────
  const scroll = useVirtualScroll({
    conversationId,
    items: timeline.items,
    userId: timeline.userId,
    stableTimelineCount: timeline.stableTimelineCount,
    targetOffset,
    data: timeline.data,
    fetchNextPage: timeline.fetchNextPage,
    hasNextPage: timeline.hasNextPage ?? false,
    isFetchingNextPage: timeline.isFetchingNextPage,
    refetch: timeline.refetch,
    onScrollChange,
  });

  // ── Actions ───────────────────────────────────────────────────────────────
  const actions = useMessageActions(conversationId);

  const handleViewDetails = (msg: Message) => {
    if (externalViewDetails) externalViewDetails(msg);
    else actions.setInternalDetailsTarget(msg);
  };
  const detailsTarget =
    externalDetailsTarget !== undefined
      ? externalDetailsTarget
      : actions.internalDetailsTarget;

  // ── Presence hydration ────────────────────────────────────────────────────
  usePresenceHydration(conversationId, timeline.messages, timeline.memberMap);

  // ── Stable row props (prevents re-rendering every row on unrelated state) ─
  const rowProps: RowData = useMemo(
    () => ({
      items: timeline.items,
      userId: timeline.userId,
      messageById: timeline.messageById,
      memberMap: timeline.memberMap,
      otherMembers: timeline.otherMembers,
      myRole: timeline.myRole,
      canPinMessages: timeline.canPinMessages,
      allowMemberMessage: timeline.allowMemberMessage,
      setReplyTo,
      onEdit: actions.handleEdit,
      onDelete: actions.handleDelete,
      onRevoke: actions.handleRevoke,
      onForward: actions.handleForward,
      onPin: actions.handlePin,
      onViewDetails: handleViewDetails,
      onRetry: actions.handleRetry,
      highlightMessageId: scroll.highlightMessageId,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      timeline.items,
      timeline.userId,
      timeline.messageById,
      timeline.memberMap,
      timeline.otherMembers,
      timeline.myRole,
      timeline.canPinMessages,
      timeline.allowMemberMessage,
      setReplyTo,
      actions.handleEdit,
      actions.handleDelete,
      actions.handleRevoke,
      actions.handleForward,
      actions.handlePin,
      actions.handleRetry,
      scroll.highlightMessageId,
    ],
  );

  // ── Render ────────────────────────────────────────────────────────────────
  if (timeline.isLoading) return <LoadingState />;
  if (timeline.isEmpty) return <EmptyState />;

  return (
    <div className="flex-1 min-h-0 overflow-hidden relative">
      <FetchingOverlay visible={timeline.isFetchingNextPage || scroll.isFetchingAfter} />

      <List
        listRef={scroll.listRef}
        style={{ height: "100%", width: "100%", overflowAnchor: "none" } as React.CSSProperties}
        rowCount={timeline.items.length}
        rowHeight={scroll.rowHeight}
        rowComponent={MessageRowComponent}
        rowProps={rowProps}
        onRowsRendered={scroll.handleRowsRendered}
        onScroll={scroll.handleScroll}
        overscanCount={scroll.messageMode === "JUMPED" ? 50 : 30}
      />

      <ScrollToBottomFab
        show={
          scroll.showFab ||
          (scroll.messageMode === "JUMPED" && scroll.pendingJumpedCount > 0)
        }
        unreadCount={scroll.messageMode === "JUMPED" ? scroll.pendingJumpedCount : 0}
        onClick={scroll.scrollToBottom}
      />

      {actions.forwardTarget && (
        <ForwardModal
          message={actions.forwardTarget}
          onClose={() => actions.setForwardTarget(null)}
        />
      )}

      {detailsTarget && (
        <MessageDetailsModal
          message={detailsTarget}
          memberMap={timeline.memberMap}
          messageById={timeline.messageById}
          otherMembers={timeline.otherMembers}
          onClose={() => {
            if (onCloseDetails) onCloseDetails();
            else actions.setInternalDetailsTarget(null);
          }}
        />
      )}
    </div>
  );
}
