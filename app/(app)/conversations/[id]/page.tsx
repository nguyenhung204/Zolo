"use client";

import { use, useState, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ConversationHeader } from "@/components/conversations/ConversationHeader";
import { VirtualMessageList } from "@/components/messages/VirtualMessageList";
import { MessageComposer } from "@/components/messages/MessageComposer";
import { TypingIndicator } from "@/components/messages/TypingIndicator";
import { PinnedMessageBanner } from "@/components/messages/PinnedMessageBanner";
import { AddFriendBanner } from "@/components/conversations/AddFriendBanner";
import { GroupCallBanner } from "@/components/calls/GroupCallBanner";
import { MemberList } from "@/components/conversations/MemberList";
import { useConversationMembers, useConversation } from "@/hooks/useConversations";
import { useGroupSocketEvents } from "@/hooks/useGroupSocketEvents";
import { useConversationCallStatus } from "@/hooks/useConversationCallStatus";
import { useConversationStore } from "@/stores/conversationStore";
import { getChatSocket } from "@/lib/socket/socket";
import { useMessages } from "@/hooks/useMessages";
import { useAuthStore } from "@/stores/authStore";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { decodeId } from "@/lib/utils/obfuscateId";
import type { Conversation } from "@/lib/api/conversations";
import type { Message } from "@/lib/api/messages";

interface Props {
  params: Promise<{ id: string }>;
}

export default function ConversationPage({ params }: Props) {
  const { id: slug } = use(params);
  // Decode the opaque URL slug back to the real UUID. All hooks and API calls
  // use `id` (the real UUID); `slug` only appears in the URL.
  const id = useMemo(() => decodeId(slug), [slug]);
  const router = useRouter();
  const setActive = useConversationStore((s) => s.setActiveConversation);
  const targetOffset = useConversationStore((s) => s.targetOffset);
  const { data: members = [] } = useConversationMembers(id);
  const myId = useAuthStore((s) => s.user?.id);
  const qc = useQueryClient();

  // Membership guard: redirect when the user is not a member (403) or the
  // conversation doesn't exist (404).
  const { error: convError } = useConversation(id);
  useEffect(() => {
    const status = (convError as { status?: number } | null)?.status;
    if (status === 403 || status === 404) {
      router.replace("/conversations");
    }
  }, [convError, router]);

  const [membersOpen, setMembersOpen] = useState(false);
  const [detailsTarget, setDetailsTarget] = useState<Message | null>(null);

  // Mount all group management socket listeners for this conversation
  useGroupSocketEvents(id);

  // Validate any persisted group call state and restore the banner if the call
  // is still live (survives page reloads and navigate-away scenarios).
  useConversationCallStatus(id);

  // Join the WS room when this conversation is opened
  useEffect(() => {
    setActive(id);
    const socket = getChatSocket();
    socket.emit("conversation:join", { conversationId: id });
    // Clear stale cache so fresh messages load — prevents wrong scroll position
    // when returning to a conversation that received messages while away.
    qc.removeQueries({ queryKey: queryKeys.messages.list(id) });

    // Clear mention badge when viewing the conversation
    const { useMentionStore } = require("@/stores/mentionStore");
    useMentionStore.getState().clearMention(id);

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
      "",
    ])
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <ConversationHeader
        conversationId={id}
        onMembersClick={() => setMembersOpen(true)}
      />
      <AddFriendBanner conversationId={id} />
      <PinnedMessageBanner
        conversationId={id}
        onViewDetails={setDetailsTarget}
      />
      <GroupCallBanner conversationId={id} />

      {/* Message area */}
      <div className="relative flex-1 flex flex-col min-h-0">
        <VirtualMessageList
          conversationId={id}
          members={members}
          onViewDetails={setDetailsTarget}
          detailsTarget={detailsTarget}
          onCloseDetails={() => setDetailsTarget(null)}
          targetOffset={targetOffset}
        />
        <TypingIndicator conversationId={id} memberNames={memberNames} />
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
