"use client";

import { useState, useCallback } from "react";
import {
  X,
  PhoneOutgoing,
  PhoneIncoming,
  PhoneMissed,
  ChevronDown,
  ChevronUp,
  Phone,
  Loader2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDistanceToNowStrict } from "@/lib/utils/date";
import {
  getCallHistory,
  getCallSummary,
  startInstantCall,
  type CallDto,
  type CallSummaryDto,
} from "@/lib/api/calls";
import { useCallStore } from "@/stores/callStore";
import { useAuthStore } from "@/stores/authStore";
import { usePresenceStore } from "@/stores/presenceStore";
import { getCallSocket } from "@/lib/socket/socket";
import { queryKeys } from "@/lib/query/keys";

// ─── Duration formatter ────────────────────────────────────────────────────────

function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return "No answer";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

// ─── End reason labels ────────────────────────────────────────────────────────

const END_REASON_LABEL: Record<string, string> = {
  user_ended: "Ended by participant",
  declined: "Declined",
  caller_cancelled: "Cancelled by caller",
  ringing_timeout: "No answer",
  ghost_call_cleanup: "Cleaned up",
  stale_call_cleanup: "Expired",
  membership_revoked: "Membership revoked",
};

// ─── Single call row ──────────────────────────────────────────────────────────

function CallRow({
  call,
  myId,
  conversationId,
}: {
  call: CallDto;
  myId: string;
  conversationId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [recalling, setRecalling] = useState(false);
  const profileMap = usePresenceStore((s) => s.profileMap);
  const { setOutgoingCall } = useCallStore();

  const { data: summary, isLoading: summaryLoading } = useQuery<CallSummaryDto | null>({
    queryKey: queryKeys.calls.summary(call.id),
    queryFn: () => getCallSummary(call.id),
    enabled: expanded,
    staleTime: Infinity,
  });

  const isOutgoing = call.callerId === myId;
  const isMissed = call.status === "MISSED" || call.status === "REJECTED";

  const callerProfile = profileMap[call.callerId];
  const callerName = callerProfile?.displayName ?? call.callerId.slice(0, 8);

  const Icon = isMissed ? PhoneMissed : isOutgoing ? PhoneOutgoing : PhoneIncoming;
  const iconColor = isMissed ? "text-error" : isOutgoing ? "text-cta" : "text-success";

  const statusLabel = isMissed
    ? "Missed"
    : call.status === "ENDED"
    ? "Ended"
    : call.status;

  const otherParticipantIds = call.participants
    .map((p) => p.userId)
    .filter((id) => id !== myId);

  const handleRecall = useCallback(async () => {
    if (recalling) return;
    setRecalling(true);
    try {
      const callDto = await startInstantCall({
        conversationId,
        calleeIds: otherParticipantIds,
      });
      setOutgoingCall(callDto);
      getCallSocket().emit("call:join_room", { callId: callDto.id });
    } catch {
      toast.error("Could not start the call.");
    } finally {
      setRecalling(false);
    }
  }, [recalling, conversationId, otherParticipantIds, setOutgoingCall]);

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Main row */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className={cn("shrink-0", iconColor)}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text truncate">
            {isOutgoing ? "Outgoing" : `From ${callerName}`}
          </p>
          <p className="text-xs text-muted">
            {statusLabel} · {formatDistanceToNowStrict(call.createdAt)} ago
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isMissed && (
            <span className="text-xs text-muted">
              {formatDuration(summary?.durationMs)}
            </span>
          )}
          <button
            onClick={handleRecall}
            disabled={recalling}
            title="Call back"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-cta hover:bg-cta/10 transition cursor-pointer disabled:opacity-40"
          >
            {recalling ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Phone className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-primary hover:bg-border/50 transition cursor-pointer"
          >
            {expanded ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded summary */}
      {expanded && (
        <div className="border-t border-border px-3 py-2.5 bg-bg space-y-1.5">
          {summaryLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading summary…
            </div>
          ) : summary ? (
            <>
              <SummaryRow label="Duration" value={formatDuration(summary.durationMs)} />
              <SummaryRow
                label="End reason"
                value={END_REASON_LABEL[summary.endReason] ?? summary.endReason}
              />
              <SummaryRow label="Participants" value={String(summary.participantCount)} />
              {summary.endedAt && (
                <SummaryRow
                  label="Ended at"
                  value={new Date(summary.endedAt).toLocaleTimeString()}
                />
              )}
            </>
          ) : (
            <p className="text-xs text-muted">No summary available.</p>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-xs font-medium text-text">{value}</span>
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

interface CallHistoryPanelProps {
  conversationId: string;
  open: boolean;
  onClose: () => void;
}

export function CallHistoryPanel({ conversationId, open, onClose }: CallHistoryPanelProps) {
  const myId = useAuthStore((s) => s.user?.id ?? "");

  const { data: calls = [], isLoading } = useQuery<CallDto[]>({
    queryKey: queryKeys.calls.history(conversationId),
    queryFn: () => getCallHistory(conversationId, 1, 30),
    enabled: open,
    staleTime: 1000 * 60,
  });

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 bottom-0 z-50 w-80 bg-surface flex flex-col shadow-2xl border-l border-border"
        style={{ animation: "slideInFromRight 0.25s ease-out" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-bold text-primary">Call History</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-primary hover:bg-border/50 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 text-muted animate-spin" />
            </div>
          ) : calls.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <PhoneMissed className="w-8 h-8 text-border" />
              <p className="text-sm text-muted">No calls yet</p>
            </div>
          ) : (
            calls.map((call) => (
              <CallRow
                key={call.id}
                call={call}
                myId={myId}
                conversationId={conversationId}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}
