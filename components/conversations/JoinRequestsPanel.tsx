"use client";

import { Check, X, Clock, Users, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useJoinRequests, useReviewJoinRequest } from "@/hooks/useGroup";
import type { JoinRequest } from "@/lib/api/group";

// ─── Props ────────────────────────────────────────────────────────────────────

interface JoinRequestsPanelProps {
  conversationId: string;
}

// ─── Single request row ───────────────────────────────────────────────────────

function RequestRow({
  request,
  onApprove,
  onReject,
  isBusy,
}: {
  request: JoinRequest;
  onApprove: () => void;
  onReject: () => void;
  isBusy: boolean;
}) {
  const displayName = request.user?.displayName ?? request.userId;
  const initials = displayName.slice(0, 2).toUpperCase();
  const formattedDate = new Date(request.createdAt).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });

  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-border last:border-0">
      {/* Avatar */}
      {request.user?.avatarUrl ? (
        <img
          src={request.user.avatarUrl}
          alt={displayName}
          className="w-9 h-9 rounded-full object-cover shrink-0 mt-0.5"
        />
      ) : (
        <div className="w-9 h-9 rounded-full bg-secondary/20 flex items-center justify-center text-xs font-semibold text-secondary shrink-0 mt-0.5">
          {initials}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-text truncate">{displayName}</p>
          <span className="text-xs text-muted shrink-0">{formattedDate}</span>
        </div>
        {request.requestMessage && (
          <p className="text-xs text-muted mt-0.5 line-clamp-2 leading-relaxed">
            &ldquo;{request.requestMessage}&rdquo;
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onApprove}
          disabled={isBusy}
          aria-label="Approve request"
          className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center transition",
            "bg-success/10 text-success hover:bg-success/20",
            "disabled:opacity-40 disabled:cursor-not-allowed",
          )}
        >
          {isBusy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Check className="w-3.5 h-3.5" />
          )}
        </button>
        <button
          onClick={onReject}
          disabled={isBusy}
          aria-label="Reject request"
          className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center transition",
            "bg-error/10 text-error hover:bg-error/20",
            "disabled:opacity-40 disabled:cursor-not-allowed",
          )}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

/**
 * Displays the pending join request queue for OWNER/ADMIN.
 * Real-time updates arrive via useGroupSocketEvents (group:join_requested).
 */
export function JoinRequestsPanel({ conversationId }: JoinRequestsPanelProps) {
  const { data: requests = [], isLoading } = useJoinRequests(conversationId);
  const reviewMutation = useReviewJoinRequest(conversationId);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-border animate-pulse shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 bg-border animate-pulse rounded w-2/3" />
              <div className="h-2.5 bg-border animate-pulse rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-3 text-muted">
        <Users className="w-8 h-8 opacity-40" />
        <p className="text-sm">No pending requests</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Clock className="w-3.5 h-3.5 text-muted" />
        <span className="text-xs font-semibold text-secondary">
          {requests.length} pending {requests.length === 1 ? "request" : "requests"}
        </span>
      </div>
      {requests.map((req) => (
        <RequestRow
          key={req.id}
          request={req}
          isBusy={reviewMutation.isPending && reviewMutation.variables?.requestId === req.id}
          onApprove={() => reviewMutation.mutate({ requestId: req.id, action: "approve" })}
          onReject={() => reviewMutation.mutate({ requestId: req.id, action: "reject" })}
        />
      ))}
    </div>
  );
}
