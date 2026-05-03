"use client";

import { useState } from "react";
import { BarChart3, ChevronDown, ChevronUp } from "lucide-react";
import { usePolls } from "@/hooks/useGroup";
import { useConversation, useMyConversationRole } from "@/hooks/useConversations";
import { PollUI } from "@/components/conversations/PollUI";
import type { Poll } from "@/lib/api/group";

interface ActivePollsBannerProps {
  conversationId: string;
}

function isPollExpired(deadline?: string): boolean {
  if (!deadline) return false;
  return new Date(deadline).getTime() < Date.now();
}

function isActivePoll(poll: Poll): boolean {
  return !poll.isClosed && !isPollExpired(poll.deadline);
}

export function ActivePollsBanner({ conversationId }: ActivePollsBannerProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { data: conversation } = useConversation(conversationId);
  const isGroup = conversation?.kind === "group";
  const { data: polls = [] } = usePolls(conversationId, isGroup);
  const myRole = useMyConversationRole(conversationId);
  const allowMemberMessage = conversation?.allowMemberMessage ?? true;

  const activePolls = polls.filter(isActivePoll);
  if (!isGroup || activePolls.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-border/60 bg-surface">
      {/* Header row — click to collapse/expand */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2 px-4 py-2 hover:bg-border/20 transition cursor-pointer"
      >
        <BarChart3 className="w-3.5 h-3.5 text-cta shrink-0" />
        <span className="text-xs font-semibold text-cta flex-1 text-left">
          {activePolls.length === 1
            ? "1 bình chọn đang hoạt động"
            : `${activePolls.length} bình chọn đang hoạt động`}
        </span>
        {collapsed
          ? <ChevronDown className="w-3.5 h-3.5 text-muted shrink-0" />
          : <ChevronUp className="w-3.5 h-3.5 text-muted shrink-0" />}
      </button>

      {/* Poll cards — visible by default, collapsible */}
      {!collapsed && (
        <div className="px-4 pb-3 space-y-2 max-h-[360px] overflow-y-auto">
          {activePolls.map((poll) => (
            <PollUI
              key={poll.id}
              pollId={poll.id}
              myRole={myRole}
              allowMemberMessage={allowMemberMessage}
              initialData={poll}
            />
          ))}
        </div>
      )}
    </div>
  );
}
