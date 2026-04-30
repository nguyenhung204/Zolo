"use client";

import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock, Clock, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query/keys";
import { useAuthStore } from "@/stores/authStore";
import { votePoll, getPoll, hasMinRole } from "@/lib/api/group";
import type { Poll, PollOption } from "@/lib/api/group";
import type { MemberRole } from "@/lib/api/conversations";
import type { ApiError } from "@/lib/api/errors";

// ─── Props ────────────────────────────────────────────────────────────────────

interface PollUIProps {
  pollId: string;
  /** Caller's resolved role in this conversation. */
  myRole: MemberRole | null;
  /** Reflects the conversation's allowMemberMessage setting. */
  allowMemberMessage: boolean;
  /** Seed data to populate the cache before the query fires (avoids flash). */
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
  // Use the ISO timestamp directly — never compare with Date.now() to avoid
  // local clock skew. The deadline itself is an ISO 8601 UTC string from the server.
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

/**
 * Renders an interactive poll with optimistic voting.
 *
 * Optimistic update pattern follows Section 4.2 of FE_INTEGRATION_GUIDE.md:
 *  1. Cancel in-flight refetches to prevent overwrites.
 *  2. Snapshot the previous state for rollback.
 *  3. Apply the vote locally before the server responds.
 *  4. Roll back on error (403 → closed poll or muted group).
 *  5. Invalidate on settled to reconcile with the server state.
 *
 * Socket.IO `poll.voted` events from OTHER users are handled in
 * useGroupSocketEvents and replace the options array directly.
 * Our own `poll.voted` events are skipped there since the optimistic
 * update already applied the change.
 */
export function PollUI({
  pollId,
  myRole,
  allowMemberMessage,
  initialData,
}: PollUIProps) {
  const qc = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id);

  // ── Poll query ─────────────────────────────────────────────────────────────
  const { data: poll, isLoading } = useQuery<Poll>({
    queryKey: queryKeys.polls.detail(pollId),
    queryFn: () => getPoll(pollId),
    initialData,
    staleTime: Infinity, // Socket events (`poll.voted`, `poll.closed`) handle updates.
  });

  // ── Permission guard ───────────────────────────────────────────────────────
  // A member with a role below moderator cannot vote when allowMemberMessage is off.
  // Proactively disable the UI before any round-trip (§4.3).
  const canVote =
    !!myId &&
    !!poll &&
    !poll.isClosed &&
    !isPollExpired(poll.deadline) &&
    (allowMemberMessage || hasMinRole(myRole ?? "member", "admin"));

  // ── Vote mutation ──────────────────────────────────────────────────────────
  const voteMutation = useMutation<Poll, ApiError, VoteArgs>({
    mutationFn: ({ pollId: id, optionIds }) => votePoll(id, optionIds),

    onMutate: async ({ pollId: id, optionIds }) => {
      // 1. Cancel any in-flight refetches so they don't overwrite our optimistic update.
      await qc.cancelQueries({ queryKey: queryKeys.polls.detail(id) });

      // 2. Snapshot the current state for rollback.
      const snapshot = qc.getQueryData<Poll>(queryKeys.polls.detail(id));

      // 3. Apply optimistic update immediately.
      qc.setQueryData<Poll>(queryKeys.polls.detail(id), (old) => {
        if (!old || !myId) return old;
        const voteSet = new Set(optionIds);
        return {
          ...old,
          options: (old.options ?? []).map((opt) => {
            // Strip existing vote for this user, then add back if selected.
            let voters = (opt.voterIds ?? []).filter((id) => id !== myId);
            if (voteSet.has(opt.id)) voters = [...voters, myId];
            return { ...opt, voterIds: voters };
          }),
        };
      });

      return { snapshot };
    },

    onError: (err, { pollId: id }, ctx) => {
      // Roll back to the snapshot so the UI reflects the pre-vote state.
      const context = ctx as { snapshot?: Poll } | undefined;
      if (context?.snapshot) {
        qc.setQueryData(queryKeys.polls.detail(id), context.snapshot);
      }
      // Surface role/deadline 403 errors with a clear, non-disruptive message.
      if (err.status === 403) {
        toast.error("You cannot vote — the poll is closed or you lack permission.");
      } else {
        toast.error(err.message ?? "Failed to record your vote.");
      }
    },

    onSettled: (_, __, { pollId: id }) => {
      // Always reconcile with the server after mutation to stay authoritative (§4.2).
      qc.invalidateQueries({ queryKey: queryKeys.polls.detail(id) });
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
      // Toggle the selected option in the set.
      const next = new Set(myVotes);
      next.has(optionId) ? next.delete(optionId) : next.add(optionId);
      nextVotes = [...next];
    } else {
      // Single choice — selecting the same option deselects it.
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

  return (
    <div className="rounded-xl border border-border bg-surface p-4 space-y-3 max-w-sm w-full">
      {/* Header */}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground leading-snug">
          {poll.question}
        </p>
        <div className="flex items-center gap-2 text-xs text-muted flex-wrap">
          {poll.multipleChoice && (
            <span className="px-1.5 py-0.5 rounded bg-muted/20 text-muted-foreground">
              Multiple choice
            </span>
          )}
          {isClosed && (
            <span className="flex items-center gap-1 text-warning">
              <Lock className="w-3 h-3" />
              Closed
            </span>
          )}
          {!isClosed && isExpired && (
            <span className="flex items-center gap-1 text-destructive">
              <Clock className="w-3 h-3" />
              Expired
            </span>
          )}
          {!isClosed && !isExpired && poll.deadline && (
            <span className="flex items-center gap-1 text-muted">
              <Clock className="w-3 h-3" />
              Closes {formatDeadline(poll.deadline)}
            </span>
          )}
        </div>
      </div>

      {/* Options */}
      <div className="space-y-2">
        {options.map((option, index) => {
          const pct = optionPercent(option, total);
          const isSelected = myVotes.has(option.id);
          const isInteractive = canVote && !isPending;
          const voterCount = option.voterIds?.length ?? 0;

          return (
            <button
              key={option.id || `${option.text}-${index}`}
              onClick={() => handleOptionClick(option.id)}
              disabled={!isInteractive}
              className={cn(
                "relative w-full text-left rounded-lg border overflow-hidden transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isInteractive
                  ? "cursor-pointer hover:border-cta/60"
                  : "cursor-default",
                isSelected
                  ? "border-cta bg-cta/5"
                  : "border-border bg-surface-secondary",
              )}
            >
              {/* Progress fill — renders behind the label */}
              <div
                className={cn(
                  "absolute inset-y-0 left-0 transition-all duration-300",
                  isSelected ? "bg-cta/15" : "bg-muted/10",
                )}
                style={{ width: `${pct}%` }}
                aria-hidden="true"
              />

              {/* Content row */}
              <div className="relative flex items-center justify-between px-3 py-2 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {isSelected && (
                    <CheckCircle2 className="w-4 h-4 text-cta flex-shrink-0" />
                  )}
                  <span className="text-sm text-foreground truncate">
                    {option.text}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0 text-xs text-muted">
                  {isPending && isSelected && (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  )}
                  <span>{pct}%</span>
                  <span className="text-muted/60">({voterCount})</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1">
        <p className="text-xs text-muted">
          {total} {total === 1 ? "vote" : "votes"}
        </p>
        {!canVote && !isClosed && !isExpired && (
          <p className="text-xs text-muted italic">
            Only admins can vote in this group.
          </p>
        )}
      </div>
    </div>
  );
}
