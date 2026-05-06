"use client";

import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { BarChart3, Lock, Clock, CheckCircle2, Loader2, XCircle, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query/keys";
import { useAuthStore } from "@/stores/authStore";
import { votePoll, closePoll, hasMinRole } from "@/lib/api/group";
import type { Poll, PollOption } from "@/lib/api/group";
import type { MemberRole } from "@/lib/api/conversations";
import type { ApiError } from "@/lib/api/errors";

// ─── Props ────────────────────────────────────────────────────────────────────

interface PollUIProps {
  pollId: string;
  myRole: MemberRole | null;
  allowMemberMessage: boolean;
  initialData?: Poll;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function totalVotes(options: PollOption[]): number {
  return options.reduce((acc, opt) => acc + (opt.voterIds?.length ?? 0), 0);
}

function optionPercent(option: PollOption, total: number): number {
  if (total === 0) return 0;
  return Math.round(((option.voterIds?.length ?? 0) / total) * 100);
}

function isPollExpired(deadline?: string): boolean {
  if (!deadline) return false;
  return new Date(deadline).getTime() < Date.now();
}

function formatDeadline(deadline: string): string {
  return new Date(deadline).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Vote args ────────────────────────────────────────────────────────────────

interface VoteArgs {
  pollId: string;
  optionIds: string[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PollUI({
  pollId,
  myRole,
  allowMemberMessage,
  initialData,
}: PollUIProps) {
  const qc = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id);

  const { data: poll, isLoading } = useQuery<Poll>({
    queryKey: queryKeys.polls.detail(pollId),
    queryFn: () => Promise.resolve(
      qc.getQueryData<Poll>(queryKeys.polls.detail(pollId)) ?? initialData!,
    ),
    initialData,
    enabled: false,
    staleTime: Infinity,
  });

  const canVote =
    !!myId &&
    !!poll &&
    !poll.isClosed &&
    !isPollExpired(poll.deadline) &&
    (allowMemberMessage || hasMinRole(myRole ?? "member", "admin"));

  const canClose =
    !!myId &&
    !!poll &&
    !poll.isClosed &&
    (poll.creatorId === myId || hasMinRole(myRole ?? "member", "admin"));

  // ── Vote mutation ──────────────────────────────────────────────────────────
  const voteMutation = useMutation<Poll, ApiError, VoteArgs>({
    mutationFn: ({ pollId: id, optionIds }) => votePoll(poll!.conversationId, id, optionIds),

    onMutate: async ({ pollId: id, optionIds }) => {
      await qc.cancelQueries({ queryKey: queryKeys.polls.detail(id) });
      const snapshot = qc.getQueryData<Poll>(queryKeys.polls.detail(id));

      qc.setQueryData<Poll>(queryKeys.polls.detail(id), (old) => {
        if (!old || !myId) return old;
        const voteSet = new Set(optionIds);
        return {
          ...old,
          options: (old.options ?? []).map((opt) => {
            let voters = (opt.voterIds ?? []).filter((vid) => vid !== myId);
            if (voteSet.has(opt.id)) voters = [...voters, myId];
            return { ...opt, voterIds: voters };
          }),
        };
      });

      return { snapshot };
    },

    onError: (err, { pollId: id }, ctx) => {
      const context = ctx as { snapshot?: Poll } | undefined;
      if (context?.snapshot) {
        qc.setQueryData(queryKeys.polls.detail(id), context.snapshot);
      }
      if (err.status === 403) {
        toast.error("Voting is closed for this poll.", { id: `vote-err-${id}` });
      } else {
        toast.error(err.message ?? "Failed to record your vote.", { id: `vote-err-${id}` });
      }
    },

    onSuccess: (updated) => {
      qc.setQueryData<Poll>(queryKeys.polls.detail(updated.id), updated);
      qc.setQueryData<Poll[]>(
        queryKeys.polls.list(updated.conversationId),
        (old) => old?.map((poll) => (poll.id === updated.id ? updated : poll)),
      );
    },
  });

  // ── Close mutation ──────────────────────────────────────────────────────────
  const closeMutation = useMutation<Poll, ApiError, void>({
    mutationFn: () => closePoll(poll!.conversationId, poll!.id),
    onSuccess: (updated) => {
      qc.setQueryData<Poll>(queryKeys.polls.detail(updated.id), updated);
      qc.setQueryData<Poll[]>(
        queryKeys.polls.list(updated.conversationId),
        (old) => old?.map((p) => (p.id === updated.id ? updated : p)),
      );
    },
    onError: (err) => {
      if (err.status === 403) {
        toast.error("Only the poll creator or an admin can close this poll.", { id: `close-err-${pollId}` });
      } else {
        toast.error("Failed to close poll.", { id: `close-err-${pollId}` });
      }
    },
  });

  // ── Derived state ──────────────────────────────────────────────────────────
  const options = poll?.options ?? [];
  const myVotes = new Set(
    options
      .filter((opt) => myId && (opt.voterIds ?? []).includes(myId))
      .map((opt) => opt.id) ?? [],
  );
  const total = totalVotes(options);
  const isClosed = poll?.isClosed ?? false;
  const isExpired = poll ? isPollExpired(poll.deadline) : false;
  const isPending = voteMutation.isPending;

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleOptionClick = (optionId: string) => {
    if (!canVote || isPending || !poll) return;

    let nextVotes: string[];
    if (poll.multipleChoice) {
      const next = new Set(myVotes);
      if (next.has(optionId)) { next.delete(optionId); } else { next.add(optionId); }
      nextVotes = [...next];
    } else {
      nextVotes = myVotes.has(optionId) ? [] : [optionId];
    }

    voteMutation.mutate({ pollId, optionIds: nextVotes });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-6">
        <Loader2 className="w-5 h-5 animate-spin text-muted" />
      </div>
    );
  }

  if (!poll) return null;

  // Find the leading option (most votes)
  const maxVoterCount = Math.max(...options.map((o) => o.voterIds?.length ?? 0), 0);

  return (
    <div className="rounded-2xl bg-surface border border-border w-full max-w-[420px] overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-cta/10 text-cta flex items-center justify-center shrink-0 mt-0.5">
            <BarChart3 className="w-[18px] h-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-text leading-snug">
              {poll.question}
            </p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {poll.multipleChoice && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-cta/10 text-cta">
                  Multiple choice
                </span>
              )}
              {isClosed && (
                <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-error/10 text-error">
                  <Lock className="w-2.5 h-2.5" />
                  Closed
                </span>
              )}
              {!isClosed && isExpired && (
                <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-warning/10 text-warning">
                  <Clock className="w-2.5 h-2.5" />
                  Expired
                </span>
              )}
              {!isClosed && !isExpired && poll.deadline && (
                <span className="flex items-center gap-1 text-[10px] text-muted">
                  <Clock className="w-2.5 h-2.5" />
                  {formatDeadline(poll.deadline)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Options */}
      <div className="px-4 pb-2 space-y-1.5">
        {options.map((option, index) => {
          const pct = optionPercent(option, total);
          const isSelected = myVotes.has(option.id);
          const isInteractive = canVote && !isPending;
          const voterCount = option.voterIds?.length ?? 0;
          const isLeading = voterCount > 0 && voterCount === maxVoterCount && total > 0;

          return (
            <button
              key={`${option.id || option.text}-${index}`}
              onClick={() => handleOptionClick(option.id)}
              disabled={!isInteractive}
              className={cn(
                "relative w-full text-left rounded-xl overflow-hidden transition-all duration-200",
                "focus-visible:outline-none/40",
                isInteractive
                  ? "cursor-pointer active:scale-[0.98]"
                  : "cursor-default",
                isSelected
                  ? "ring-1 ring-cta/40"
                  : "",
              )}
            >
              {/* Background */}
              <div className={cn(
                "absolute inset-0",
                isSelected ? "bg-cta/8" : "bg-surface-secondary",
              )} />

              {/* Progress bar */}
              <div
                className={cn(
                  "absolute inset-y-0 left-0 transition-all duration-500 ease-out rounded-xl",
                  isSelected
                    ? "bg-cta/15"
                    : isLeading
                      ? "bg-cta/8"
                      : "bg-border/40",
                )}
                style={{ width: `${pct}%` }}
                aria-hidden="true"
              />

              {/* Content */}
              <div className="relative flex items-center justify-between px-3 py-2.5 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={cn(
                    "w-4.5 h-4.5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                    isSelected
                      ? "border-cta bg-cta"
                      : "border-muted/50 bg-transparent",
                  )}>
                    {isSelected && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                    )}
                  </div>
                  <span className={cn(
                    "text-sm truncate",
                    isSelected ? "font-semibold text-text" : "text-text/80",
                  )}>
                    {option.text}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {isPending && isSelected && (
                    <Loader2 className="w-3 h-3 animate-spin text-cta" />
                  )}
                  <span className={cn(
                    "text-xs font-semibold tabular-nums",
                    isSelected ? "text-cta" : "text-muted",
                  )}>
                    {pct}%
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-border/60 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <Users className="w-3 h-3" />
          <span>
            {total} {total === 1 ? "vote" : "votes"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!canVote && !isClosed && !isExpired && (
            <p className="text-[10px] text-muted italic">
              Only admins can vote
            </p>
          )}
          {canClose && (
            <button
              onClick={() => closeMutation.mutate()}
              disabled={closeMutation.isPending}
              className="flex items-center gap-1 text-[10px] font-medium text-error/80 hover:text-error transition-colors cursor-pointer"
            >
              {closeMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <XCircle className="w-3 h-3" />
              )}
              Close poll
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
