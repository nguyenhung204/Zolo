"use client";

/**
 * React Query hooks for the Group Management module.
 *
 * Covers:
 *   - Polls   : usePolls, useCreatePoll, useVotePoll, useClosePoll
 *   - Appointments: useAppointments, useCreateAppointment, useUpdateAppointment, useDeleteAppointment
 *   - Invite  : useJoinByInvite
 *
 * Cache strategies follow FE_INTEGRATION_GUIDE §4:
 *   - Polls list  → staleTime=Infinity (socket events drive updates via useGroupSocketEvents)
 *   - Poll detail → staleTime=Infinity (same reason)
 *   - Appointments → invalidated on every mutation + socket events
 *   - Optimistic vote follows §4.2
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/authStore";
import { queryKeys } from "@/lib/query/keys";
import {
  getPolls,
  getPoll,
  createPoll,
  votePoll,
  closePoll,
  getAppointments,
  createAppointment,
  updateAppointment,
  deleteAppointment,
  joinByInvite,
  leaveGroup,
  deleteConversationForMe,
  getJoinRequests,
  reviewJoinRequest,
  type LeaveGroupPayload,
  type Poll,
  type CreatePollPayload,
  type Appointment,
  type CreateAppointmentPayload,
  type UpdateAppointmentPayload,
  type JoinRequest,
  type JoinByInvitePayload,
  type JoinByInviteResult,
} from "@/lib/api/group";
import type { Conversation } from "@/lib/api/conversations";
import type { ApiError } from "@/lib/api/errors";

// ─── Polls ────────────────────────────────────────────────────────────────────

/** List all polls for a conversation. Cache is kept live by useGroupSocketEvents. */
export function usePolls(conversationId: string, enabled = true) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery<Poll[]>({
    queryKey: queryKeys.polls.list(conversationId),
    queryFn: () => getPolls(conversationId),
    enabled: enabled && isAuthenticated && !!conversationId,
    staleTime: Infinity, // socket poll.created / poll.voted / poll.closed drive updates
  });
}

/** Single poll detail. Seeded from the list cache via initialData when available. */
export function usePoll(pollId: string, initialData?: Poll) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery<Poll>({
    queryKey: queryKeys.polls.detail(pollId),
    queryFn: () => getPoll(pollId),
    enabled: isAuthenticated && !!pollId,
    staleTime: Infinity,
    initialData,
  });
}

/** Create a poll — prepends to the polls list cache on success. */
export function useCreatePoll(conversationId: string) {
  const qc = useQueryClient();
  return useMutation<Poll, ApiError, CreatePollPayload>({
    mutationFn: (payload) => createPoll(conversationId, payload),
    onSuccess: (newPoll) => {
      // Prepend into the list cache (server broadcasts poll.created to other clients)
      qc.setQueryData<Poll[]>(
        queryKeys.polls.list(conversationId),
        (old) => {
          const list = old ?? [];
          if (list.some((poll) => poll.id === newPoll.id)) return list;
          return [newPoll, ...list];
        },
      );
      qc.setQueryData<Poll>(queryKeys.polls.detail(newPoll.id), newPoll);
    },
    onError: (err) => {
      if (err.status === 403) {
        toast.error("You don't have permission to create polls in this group.");
      } else if (err.status === 400) {
        toast.error(err.message ?? "Invalid poll data.");
      } else {
        toast.error("Failed to create poll.");
      }
    },
  });
}

interface VoteArgs {
  pollId: string;
  optionIds: string[];
}

/**
 * Vote on a poll with an optimistic update (§4.2).
 * Skips server round-trip for UI feedback; reconciles on settled.
 */
export function useVotePoll() {
  const qc = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id);

  return useMutation<Poll, ApiError, VoteArgs>({
    mutationFn: ({ pollId, optionIds }) => votePoll(pollId, optionIds),

    onMutate: async ({ pollId, optionIds }) => {
      await qc.cancelQueries({ queryKey: queryKeys.polls.detail(pollId) });
      const snapshot = qc.getQueryData<Poll>(queryKeys.polls.detail(pollId));

      if (snapshot && myId) {
        const voteSet = new Set(optionIds);
        qc.setQueryData<Poll>(queryKeys.polls.detail(pollId), {
          ...snapshot,
          options: snapshot.options.map((opt) => {
            const voters = opt.voterIds.filter((id) => id !== myId);
            return { ...opt, voterIds: voteSet.has(opt.id) ? [...voters, myId] : voters };
          }),
        });
      }

      return { snapshot };
    },

    onError: (err, { pollId }, ctx) => {
      const context = ctx as { snapshot?: Poll } | undefined;
      if (context?.snapshot) {
        qc.setQueryData(queryKeys.polls.detail(pollId), context.snapshot);
      }
      if (err.status === 403) {
        toast.error("You don't have permission to vote in this group.");
      } else if (err.status === 400) {
        toast.error(err.message ?? "Invalid vote.");
      } else {
        toast.error("Failed to record vote.");
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
}

/** Close a poll — merges isClosed + finalOptions into the detail cache. */
export function useClosePoll() {
  const qc = useQueryClient();
  return useMutation<Poll, ApiError, string>({
    mutationFn: (pollId) => closePoll(pollId),
    onSuccess: (updated) => {
      qc.setQueryData<Poll>(queryKeys.polls.detail(updated.id), updated);
      // Mirror into list cache so closed badge renders immediately
      qc.setQueryData<Poll[]>(
        queryKeys.polls.list(updated.conversationId),
        (old) => old?.map((p) => (p.id === updated.id ? updated : p)),
      );
    },
    onError: (err) => {
      if (err.status === 403) {
        toast.error("Only the poll creator or an admin can close this poll.");
      } else {
        toast.error("Failed to close poll.");
      }
    },
  });
}

// ─── Appointments ─────────────────────────────────────────────────────────────

/** List all appointments for a conversation. Invalidated by socket events. */
export function useAppointments(conversationId: string) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery<Appointment[]>({
    queryKey: queryKeys.appointments.list(conversationId),
    queryFn: () => getAppointments(conversationId),
    enabled: isAuthenticated && !!conversationId,
    staleTime: 30_000,
  });
}

/** Create an appointment. Server schedules BullMQ reminder T-15min (§2.5). */
export function useCreateAppointment(conversationId: string) {
  const qc = useQueryClient();
  return useMutation<Appointment, ApiError, CreateAppointmentPayload>({
    mutationFn: (payload) => createAppointment(conversationId, payload),
    onSuccess: () => {
      // Invalidate — BullMQ scheduling must complete first, server state is authoritative (§4.1)
      qc.invalidateQueries({ queryKey: queryKeys.appointments.list(conversationId) });
    },
    onError: (err) => {
      if (err.status === 400) {
        toast.error(err.message ?? "Invalid appointment data (scheduledAt must be in the future).");
      } else if (err.status === 403) {
        toast.error("You don't have permission to create appointments.");
      } else {
        toast.error("Failed to create appointment.");
      }
    },
  });
}

/** Update an appointment. BullMQ reminder is rescheduled automatically (§2.5). */
export function useUpdateAppointment(conversationId: string) {
  const qc = useQueryClient();
  return useMutation<
    Appointment,
    ApiError,
    { appointmentId: string } & UpdateAppointmentPayload
  >({
    mutationFn: ({ appointmentId, ...payload }) => updateAppointment(appointmentId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.appointments.list(conversationId) });
    },
    onError: (err) => {
      if (err.status === 400) {
        toast.error(err.message ?? "Invalid update data.");
      } else {
        toast.error("Failed to update appointment.");
      }
    },
  });
}

/** Soft-delete an appointment. BullMQ reminder is cancelled (§2.5). */
export function useDeleteAppointment(conversationId: string) {
  const qc = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (appointmentId) => deleteAppointment(appointmentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.appointments.list(conversationId) });
    },
    onError: () => toast.error("Failed to delete appointment."),
  });
}

// ─── Invite Link ──────────────────────────────────────────────────────────────

/**
 * Join a group via an invite token (POST /conversations/join).
 * Returns { requiresApproval, conversationId | requestId }.
 */
export function useJoinByInvite() {
  const qc = useQueryClient();
  return useMutation<JoinByInviteResult, ApiError, JoinByInvitePayload>({
    mutationFn: (payload) => joinByInvite(payload),
    onSuccess: (result) => {
      if (!result.requiresApproval) {
        // Joined directly — refresh the conversations list so the new one appears.
        qc.invalidateQueries({ queryKey: queryKeys.conversations.list() });
      }
      // If approval required, the caller handles showing the pending state.
    },
    onError: (err) => {
      if (err.status === 401) {
        toast.error("This invite link has expired.");
      } else if (err.status === 403) {
        toast.error("This invite link has been revoked.");
      } else if (err.status === 404) {
        toast.error("This group no longer exists.");
      } else if (err.status === 400) {
        toast.error(err.message ?? "You are already a member or have a pending request.");
      } else {
        toast.error("Failed to join group.");
      }
    },
  });
}

function evictConversationCaches(qc: ReturnType<typeof useQueryClient>, conversationId: string) {
  qc.removeQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
  qc.removeQueries({ queryKey: queryKeys.conversations.members(conversationId) });
  qc.removeQueries({ queryKey: queryKeys.messages.list(conversationId) });
  qc.removeQueries({ queryKey: queryKeys.polls.list(conversationId) });
  qc.removeQueries({ queryKey: queryKeys.appointments.list(conversationId) });
  qc.removeQueries({ queryKey: queryKeys.inviteLink.detail(conversationId) });
  qc.setQueryData<Conversation[]>(
    queryKeys.conversations.list(),
    (old) => old?.filter((c) => c.id !== conversationId),
  );
}

/** Leave a group (POST /conversations/:id/leave). Owner must transfer ownership. */
export function useLeaveGroup() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation<void, ApiError, { conversationId: string } & LeaveGroupPayload>({
    mutationFn: ({ conversationId, ...payload }) => leaveGroup(conversationId, payload),
    onSuccess: (_data, { conversationId }) => {
      evictConversationCaches(qc, conversationId);
      router.push("/conversations");
    },
    onError: (err) => {
      if (err.status === 403) {
        toast.error("Owner must transfer ownership before leaving.");
      } else {
        toast.error("Failed to leave the group.");
      }
    },
  });
}

/** Delete/hide a conversation for the current user only. */
export function useDeleteConversationForMe() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation<{ deletedUntil: number }, ApiError, string>({
    mutationFn: deleteConversationForMe,
    onSuccess: (_data, conversationId) => {
      evictConversationCaches(qc, conversationId);
      toast.success("Conversation deleted for you.");
      router.push("/conversations");
    },
    onError: (err) => {
      if (err.status === 403) {
        toast.error("You are not a member of this conversation.");
      } else {
        toast.error("Failed to delete the conversation.");
      }
    },
  });
}

/** List pending join requests (GET /conversations/:id/join-requests). OWNER/ADMIN only. */
export function useJoinRequests(conversationId: string, enabled = true) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery<JoinRequest[]>({
    queryKey: queryKeys.joinRequests.list(conversationId),
    queryFn: () => getJoinRequests(conversationId),
    enabled: isAuthenticated && !!conversationId && enabled,
    staleTime: 30_000,
  });
}

/** Approve or reject a join request (PATCH /conversations/:id/join-requests/:requestId). */
export function useReviewJoinRequest(conversationId: string) {
  const qc = useQueryClient();
  return useMutation<void, ApiError, { requestId: string; action: "approve" | "reject" }>({
    mutationFn: ({ requestId, action }) =>
      reviewJoinRequest(conversationId, requestId, action),
    onSuccess: (_data, { requestId, action }) => {
      // Optimistically remove the request from the pending list.
      qc.setQueryData<JoinRequest[]>(
        queryKeys.joinRequests.list(conversationId),
        (old) => old?.filter((r) => r.id !== requestId),
      );
      if (action === "approve") {
        // Refresh members list — the new member was added server-side.
        qc.invalidateQueries({ queryKey: queryKeys.conversations.members(conversationId) });
        qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
      }
      toast.success(action === "approve" ? "Request approved." : "Request rejected.");
    },
    onError: (err) => {
      if (err.status === 400) {
        toast.error("This request has already been processed.");
      } else if (err.status === 403) {
        toast.error("You need to be an admin to review join requests.");
      } else {
        toast.error("Failed to process the request.");
      }
    },
  });
}
