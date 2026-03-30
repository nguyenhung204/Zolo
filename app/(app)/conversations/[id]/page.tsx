"use client";

import { use, useState, useRef, useCallback } from "react";
import { ConversationHeader } from "@/components/conversations/ConversationHeader";
import { VirtualMessageList } from "@/components/messages/VirtualMessageList";
import { MessageComposer } from "@/components/messages/MessageComposer";
import { TypingIndicator } from "@/components/messages/TypingIndicator";
import { ScrollToBottomFab } from "@/components/messages/ScrollToBottomFab";
import { MemberList } from "@/components/conversations/MemberList";
import { useConversationMembers } from "@/hooks/useConversations";
import { useConversationStore } from "@/stores/conversationStore";
import { getChatSocket } from "@/lib/socket/socket";
import { useEffect } from "react";

interface Props {
  params: Promise<{ id: string }>;
}

export default function ConversationPage({ params }: Props) {
  const { id } = use(params);
  const setActive = useConversationStore((s) => s.setActiveConversation);
  const { data: members = [] } = useConversationMembers(id);

  const [membersOpen, setMembersOpen] = useState(false);
  const [atBottom, setAtBottom] = useState(true);

  // Join the WS room when this conversation is opened
  useEffect(() => {
    setActive(id);
    const socket = getChatSocket();
    socket.emit("conversation:join", { conversationId: id });
    return () => {
      socket.emit("conversation:leave", { conversationId: id });
      setActive(null);
    };
  }, [id, setActive]);

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

      {/* Message area */}
      <div className="relative flex-1 flex flex-col min-h-0">
        <VirtualMessageList
          conversationId={id}
          members={members}
          onScrollChange={handleScrollChange}
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
