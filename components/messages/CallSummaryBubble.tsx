"use client";

import { useState, useCallback } from "react";
import { PhoneOutgoing, PhoneIncoming, PhoneMissed } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Message } from "@/lib/api/messages";
import { startInstantCall } from "@/lib/api/calls";
import { useCallStore } from "@/stores/callStore";
import { getCallSocket } from "@/lib/socket/socket";

// ─── Duration formatting ──────────────────────────────────────────────────────

function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return "No answer";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} seconds`;
  return `${minutes} minutes ${seconds} seconds`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface CallSummaryBubbleProps {
  message: Message;
  /** True when message.senderId === currentUser.id */
  isMine: boolean;
  /** userIds of the other conversation participants (used for "Gọi lại") */
  otherMemberIds: string[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CallSummaryBubble({
  message,
  isMine,
  otherMemberIds,
}: CallSummaryBubbleProps) {
  const { status, durationMs, callId: _callId } = message.metadata ?? {};
  const [isCalling, setIsCalling] = useState(false);

  // Direction & status semantics
  const isOutgoing = isMine;
  const isMissed = status === "MISSED" || status === "REJECTED";

  // Title
  const title = isMissed
    ? "Missed call"
    : isOutgoing
      ? "Outgoing call"
      : "Incoming call";

  // Icon
  const IconComponent = isMissed
    ? PhoneMissed
    : isOutgoing
      ? PhoneOutgoing
      : PhoneIncoming;

  const durationText = isMissed ? "No answer" : formatDuration(durationMs);

  // ─── "Gọi lại" handler ──────────────────────────────────────────────────
  const handleRecall = useCallback(async () => {
    if (isCalling || !otherMemberIds.length) return;
    setIsCalling(true);
    try {
      const callDto = await startInstantCall({
        conversationId: message.conversationId,
        calleeIds: otherMemberIds,
      });
      useCallStore.getState().setOutgoingCall(callDto);
      getCallSocket().emit("call:join_room", { callId: callDto.id });
    } catch {
      toast.error("Could not start the call.");
    } finally {
      setIsCalling(false);
    }
  }, [isCalling, message.conversationId, otherMemberIds]);

  return (
    <div
      className={cn(
        "flex flex-col w-[220px]",
        "border border-slate-200 rounded-xl shadow-sm",
        "overflow-hidden select-none"
      )}
      style={{ background: "var(--color-background, #F8FAFC)" }}
    >
      {/* Top row: title */}
      <div className="px-3.5 pt-3 pb-1.5">
        <p
          className={cn(
            "text-sm font-semibold leading-snug",
            isMissed ? "text-red-500" : "text-[#0F172A]"
          )}
          style={isMissed ? undefined : { color: "var(--color-primary, #0F172A)" }}
        >
          {title}
        </p>
      </div>

      {/* Middle row: icon + duration */}
      <div className="flex items-center gap-2 px-3.5 pb-3">
        <IconComponent
          className={cn("w-4 h-4 shrink-0", isMissed ? "text-red-500" : "text-slate-500")}
        />
        <span
          className="text-xs leading-snug"
          style={{ color: "var(--color-primary, #0F172A)", opacity: 0.65 }}
        >
          {durationText}
        </span>
      </div>

      {/* Divider */}
      <hr className="border-slate-200 mx-0" />

      {/* Bottom row: "Gọi lại" button */}
      <button
        onClick={handleRecall}
        disabled={isCalling || !otherMemberIds.length}
        className={cn(
          "w-full px-3.5 py-2.5 text-sm font-medium text-center",
          "transition-colors duration-150 cursor-pointer",
          "hover:bg-slate-100 active:bg-slate-200",
          "disabled:opacity-50 disabled:cursor-not-allowed"
        )}
        style={{ color: "var(--color-cta, #0369A1)" }}
      >
        {isCalling ? "Đang gọi…" : "Gọi lại"}
      </button>
    </div>
  );
}
