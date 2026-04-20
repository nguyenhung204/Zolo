"use client";

import { use, useState, useRef, useCallback, useEffect } from "react";
import { ConversationHeader } from "@/components/conversations/ConversationHeader";
import { VirtualMessageList } from "@/components/messages/VirtualMessageList";
import { MessageComposer } from "@/components/messages/MessageComposer";
import { TypingIndicator } from "@/components/messages/TypingIndicator";
import { ScrollToBottomFab } from "@/components/messages/ScrollToBottomFab";
import { PinnedMessageBanner } from "@/components/messages/PinnedMessageBanner";
import { MemberList } from "@/components/conversations/MemberList";
import { useConversationMembers } from "@/hooks/useConversations";
import { useConversationStore } from "@/stores/conversationStore";
import { getChatSocket } from "@/lib/socket/socket";
import { useMessages } from "@/hooks/useMessages";
import { useAuthStore } from "@/stores/authStore";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import type { Conversation } from "@/lib/api/conversations";
import type { Message } from "@/lib/api/messages";

interface Props {
  params: Promise<{ id: string }>;
}

export default function ConversationPage({ params }: Props) {
  const { id } = use(params);
  const setActive = useConversationStore((s) => s.setActiveConversation);
  const { data: members = [] } = useConversationMembers(id);
  const myId = useAuthStore((s) => s.user?.id);
  const qc = useQueryClient();

  const [membersOpen, setMembersOpen] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [detailsTarget, setDetailsTarget] = useState<Message | null>(null);

  // Join the WS room when this conversation is opened
  useEffect(() => {
    setActive(id);
    const socket = getChatSocket();
    socket.emit("conversation:join", { conversationId: id });

    // Immediately mark all messages as seen so the unread badge clears without
    // waiting for the IntersectionObserver. Use maxOffset from the local cache —
    // it is already up-to-date because useSocket keeps it in sync via WS events.
    const convs = qc.getQueryData<Conversation[]>(queryKeys.conversations.list());
    const conv = convs?.find((c) => c.id === id);
    const latestOffset = Number(conv?.maxOffset ?? 0);
    if (latestOffset > 0) {
      socket.emit("conversation:update_seen_cursor", {
        conversationId: id,
        upToOffset: latestOffset,
      });
      qc.setQueryData<Conversation[]>(
        queryKeys.conversations.list(),
        (old) =>
          old?.map((c) =>
            c.id === id
              ? { ...c, lastSeenOffset: Math.max(c.lastSeenOffset ?? 0, latestOffset) }
              : c
          )
      );
    }

    return () => {
      socket.emit("conversation:leave", { conversationId: id });
      setActive(null);
    };
  }, [id, setActive, qc]);

  // Emit delivered cursor once when messages are first loaded
  const { data: messagesData } = useMessages(id);
  const deliveredEmittedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!messagesData || deliveredEmittedRef.current === id) return;
    const allMessages = [...(messagesData.pages ?? [])].reverse().flatMap((p) => p.data);
    const latestFromOthers = allMessages
      .filter((m) => m.senderId !== myId && (m.offset ?? 0) > 0)
      .map((m) => m.offset ?? 0);
    if (latestFromOthers.length === 0) return;
    const maxOffset = Math.max(...latestFromOthers);
    if (maxOffset <= 0) return;
    deliveredEmittedRef.current = id;
    const socket = getChatSocket();
    socket.emit("conversation:update_delivered_cursor", {
      conversationId: id,
      upToOffset: maxOffset,
    });
  }, [id, messagesData, myId]);

  const memberNames = Object.fromEntries(
    members.map((m) => [
      m.userId,
      (m as typeof m & { displayName?: string; username?: string }).displayName ??
      (m as typeof m & { username?: string }).username ??
      m.userId.slice(0, 8),
    ])
  );

  const handleScrollChange = useCallback(
    (bottom: boolean) => setAtBottom(bottom),
    []
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <ConversationHeader
        conversationId={id}
        onMembersClick={() => setMembersOpen(true)}
      />
      <PinnedMessageBanner
        conversationId={id}
        onViewDetails={setDetailsTarget}
      />

      {/* Message area */}
      <div className="relative flex-1 flex flex-col min-h-0">
        <VirtualMessageList
          conversationId={id}
          members={members}
          onScrollChange={handleScrollChange}
          onViewDetails={setDetailsTarget}
          detailsTarget={detailsTarget}
          onCloseDetails={() => setDetailsTarget(null)}
        />
        <TypingIndicator conversationId={id} memberNames={memberNames} />
        <ScrollToBottomFab
          show={!atBottom}
          unreadCount={0}
          onClick={() => {}}
        />
      </div>

      <MessageComposer conversationId={id} />

      <MemberList
        conversationId={id}
        open={membersOpen}
        onClose={() => setMembersOpen(false)}
      />
    </div>
  );
}
