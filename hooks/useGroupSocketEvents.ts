"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getChatSocket } from "@/lib/socket/socket";
import { queryKeys } from "@/lib/query/keys";
import { useAuthStore } from "@/stores/authStore";
import type { Conversation, ConversationMember } from "@/lib/api/conversations";
import type {
  Poll,
  GroupSettingsUpdatedEvent,
  GroupMemberRoleChangedEvent,
  GroupMemberKickedEvent,
  GroupDisbandedEvent,
  GroupInviteLinkResetEvent,
  GroupJoinRequestedEvent,
  GroupJoinApprovedEvent,
  GroupJoinRejectedEvent,
  PollCreatedEvent,
  PollVotedEvent,
  PollClosedEvent,
  AppointmentEvent,
  AppointmentReminderEvent,
  JoinRequest,
} from "@/lib/api/group";

// Typed extension of the socket to register group management events without
// touching the shared ServerEvents interface.
type GroupEventSocket = {
  emit(event: "conversation:join", payload: { conversationId: string }): void;
  emit(event: "conversation:leave", payload: { conversationId: string }): void;
  on(event: "group.settings_updated", handler: (p: GroupSettingsUpdatedEvent) => void): void;
  on(event: "group.member_role_changed", handler: (p: GroupMemberRoleChangedEvent) => void): void;
  on(event: "group.member_kicked", handler: (p: GroupMemberKickedEvent) => void): void;
  on(event: "group.disbanded", handler: (p: GroupDisbandedEvent) => void): void;
  on(event: "group.invite_link_reset", handler: (p: GroupInviteLinkResetEvent) => void): void;
  on(event: "group.join_requested", handler: (p: GroupJoinRequestedEvent) => void): void;
  on(event: "group.join_approved", handler: (p: GroupJoinApprovedEvent) => void): void;
  on(event: "group.join_rejected", handler: (p: GroupJoinRejectedEvent) => void): void;
  on(event: "conversation:member-added", handler: (p: {
    conversationId: string;
    addedUserIds?: string[];
    addedBy?: string;
    memberCount?: number;
    timestamp: string;
  }) => void): void;
  on(event: "poll.created", handler: (p: PollCreatedEvent) => void): void;
  on(event: "poll.voted", handler: (p: PollVotedEvent) => void): void;
  on(event: "poll.closed", handler: (p: PollClosedEvent) => void): void;
  on(event: "group.appointment_created", handler: (p: AppointmentEvent) => void): void;
  on(event: "group.appointment_updated", handler: (p: AppointmentEvent) => void): void;
  on(event: "group.appointment_deleted", handler: (p: AppointmentEvent) => void): void;
  on(event: "group.appointment_reminder", handler: (p: AppointmentReminderEvent) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
};

/**
 * Registers all Socket.IO listeners for the Group Management module.
 *
 * Mount this hook inside the conversation view for the given `conversationId`.
 * It joins the socket room on mount, attaches all group event handlers, and
 * cleans up on unmount.
 *
 * Cache manipulation strategies follow Section 4.4 of FE_INTEGRATION_GUIDE.md:
 *   - settings_updated  → merge diff (no refetch)
 *   - member_role_changed → update single member's role field
 *   - member_kicked (self) → evict all conversation caches, navigate to /conversations
 *   - member_kicked (other) → remove member from list cache
 *   - disbanded          → evict all conversation caches, navigate to /conversations
 *   - invite_link_reset  → delete inviteLink query data
 *   - poll.created       → prepend new poll to polls list cache
 *   - poll.voted         → replace options snapshot (skip own optimistic votes)
 *   - poll.closed        → merge isClosed + finalOptions into poll cache
 *   - appointment events → invalidate appointments list (server state is authoritative)
 *   - appointment_reminder → in-app toast notification
 */
export function useGroupSocketEvents(conversationId: string) {
  const qc = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id);
  const router = useRouter();

  useEffect(() => {
    if (!conversationId || !myId) return;

    // Cast to group-event-capable type without touching the shared events file.
    const socket = getChatSocket() as unknown as GroupEventSocket;

    // Join the Socket.IO room for this conversation so the gateway routes
    // group events to this client.
    socket.emit("conversation:join", { conversationId });

    // ── group.settings_updated ─────────────────────────────────────────────
    // Strategy: merge only the changed fields into the detail cache.
    // Do NOT refetch — the diff payload is already authoritative (§4.4).
    // Toast when the change affects the current user's permissions.
    const onSettingsUpdated = (payload: GroupSettingsUpdatedEvent) => {
      if (payload.conversationId !== conversationId) return;

      // Read role from cache BEFORE updating (participants don't change here).
      const conv = qc.getQueryData<Conversation>(queryKeys.conversations.detail(conversationId));
      const myRole = conv?.participants?.find((p) => p.userId === myId)?.role?.toLowerCase() ?? "member";

      qc.setQueryData<Conversation>(
        queryKeys.conversations.detail(conversationId),
        (old) => (old ? { ...old, ...payload.changes } : old),
      );

      // Notify when settings changes affect messaging or membership permissions.
      if ("allowMemberMessage" in payload.changes) {
        if (payload.changes.allowMemberMessage === false && myRole === "member") {
          toast.info("Admins have disabled messaging for members.");
        } else if (payload.changes.allowMemberMessage === true && myRole === "member") {
          toast.info("Members can now send messages in this group.");
        }
      } else if (
        "joinApprovalRequired" in payload.changes ||
        "isPublic" in payload.changes
      ) {
        // Only surface to admins/owner — regular members don't manage access.
        if (myRole === "owner" || myRole === "admin") {
          toast.info("Group settings have been updated.");
        }
      }
    };

    // ── group.member_role_changed ──────────────────────────────────────────
    // Strategy: update the role field on the matching member record in the
    // members list cache. If it's the current user, show a toast and the
    // consuming component re-evaluates UI visibility from the updated cache.
    const onMemberRoleChanged = (payload: GroupMemberRoleChangedEvent) => {
      if (payload.conversationId !== conversationId) return;
      qc.setQueryData<ConversationMember[]>(
        queryKeys.conversations.members(conversationId),
        (old) =>
          old?.map((m) =>
            m.userId === payload.userId ? { ...m, role: payload.newRole } : m,
          ),
      );
      // Also patch the participants array stored in the conversation detail so
      // role-aware hooks like useMyConversationRole read the fresh role.
      qc.setQueryData<Conversation>(
        queryKeys.conversations.detail(conversationId),
        (old) => {
          if (!old?.participants) return old;
          return {
            ...old,
            participants: old.participants.map((p) =>
              p.userId === payload.userId ? { ...p, role: payload.newRole } : p,
            ),
          };
        },
      );
      // Notify the affected user that their role has changed.
      if (payload.userId === myId) {
        const roleLabel: Record<string, string> = {
          owner: "Owner",
          admin: "Admin",
          moderator: "Moderator",
          member: "Member",
        };
        toast.info(
          `Your role in this group has been changed to ${roleLabel[payload.newRole] ?? payload.newRole}.`,
        );
      }
    };

    // ── group.member_kicked ────────────────────────────────────────────────
    // Strategy (self): evict all caches for this conversation and navigate away.
    // Strategy (other): remove the member from the members list cache (§4.4).
    const onMemberKicked = (payload: GroupMemberKickedEvent) => {
      if (payload.conversationId !== conversationId) return;

      if (payload.userId === myId) {
        toast.error("You have been removed from this group.");
        // Evict ALL query data related to this conversation.
        qc.removeQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
        qc.removeQueries({ queryKey: queryKeys.conversations.members(conversationId) });
        qc.removeQueries({ queryKey: queryKeys.messages.list(conversationId) });
        qc.removeQueries({ queryKey: queryKeys.polls.list(conversationId) });
        qc.removeQueries({ queryKey: queryKeys.appointments.list(conversationId) });
        qc.removeQueries({ queryKey: queryKeys.inviteLink.detail(conversationId) });
        // Remove this conversation from the list cache as well.
        qc.setQueryData<Conversation[]>(
          queryKeys.conversations.list(),
          (old) => old?.filter((c) => c.id !== conversationId),
        );
        router.push("/conversations");
      } else {
        qc.setQueryData<ConversationMember[]>(
          queryKeys.conversations.members(conversationId),
          (old) => old?.filter((m) => m.userId !== payload.userId),
        );
      }
    };

    // ── group.disbanded ────────────────────────────────────────────────────
    // Strategy: show toast, evict all conversation caches, navigate away (§4.4).
    const onDisbanded = (payload: GroupDisbandedEvent) => {
      if (payload.conversationId !== conversationId) return;

      toast.error("This group has been disbanded.");
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
      router.push("/conversations");
    };

    // ── group.invite_link_reset ────────────────────────────────────────────
    // Strategy: delete the cached invite URL so GroupInviteConfig shows the
    // "generate a new link" state. Do NOT display the now-invalid URL (§4.4).
    const onInviteLinkReset = (payload: GroupInviteLinkResetEvent) => {
      if (payload.conversationId !== conversationId) return;
      qc.removeQueries({ queryKey: queryKeys.inviteLink.detail(conversationId) });
    };

    // ── poll.created ───────────────────────────────────────────────────────
    // Strategy: prepend the new poll to the polls list cache (§4.4).
    const onPollCreated = (payload: PollCreatedEvent) => {
      if (payload.conversationId !== conversationId) return;
      const newPoll: Poll = {
        id: payload.pollId,
        conversationId: payload.conversationId,
        creatorId: payload.creatorId,
        question: payload.question,
        options: payload.options,
        multipleChoice: payload.multipleChoice,
        deadline: payload.deadline,
        isClosed: false,
        createdAt: payload.timestamp,
      };
      qc.setQueryData<Poll[]>(
        queryKeys.polls.list(conversationId),
        (old) => (old ? [newPoll, ...old] : [newPoll]),
      );
    };

    // ── poll.voted ─────────────────────────────────────────────────────────
    // Strategy: skip if it is our own vote (optimistic update already applied).
    // Otherwise replace the options array with the authoritative server snapshot (§4.4).
    const onPollVoted = (payload: PollVotedEvent) => {
      if (payload.conversationId !== conversationId) return;
      // The guide explicitly instructs to skip our own events so that the
      // optimistic update in useMutation is not overwritten prematurely.
      if (payload.userId === myId) return;

      qc.setQueryData<Poll>(
        queryKeys.polls.detail(payload.pollId),
        (old) => (old ? { ...old, options: payload.updatedOptions } : old),
      );
    };

    // ── poll.closed ────────────────────────────────────────────────────────
    // Strategy: merge isClosed + final options into the poll cache (§4.4).
    const onPollClosed = (payload: PollClosedEvent) => {
      if (payload.conversationId !== conversationId) return;
      qc.setQueryData<Poll>(
        queryKeys.polls.detail(payload.pollId),
        (old) =>
          old
            ? { ...old, isClosed: true, options: payload.finalOptions }
            : old,
      );
    };

    // ── appointment events ─────────────────────────────────────────────────
    // Strategy: invalidate the appointments list — the REST response has already
    // confirmed scheduling, so we reconcile with authoritative server state (§4.4).
    const onAppointmentMutated = (payload: AppointmentEvent) => {
      if (payload.conversationId !== conversationId) return;
      qc.invalidateQueries({ queryKey: queryKeys.appointments.list(conversationId) });
    };

    // ── group.appointment_reminder ─────────────────────────────────────────
    // Strategy: surface an in-app toast 15 minutes before the appointment.
    // Use payload.timestamp (Kafka time) not Date.now() per §3 Timestamp rules.
    const onAppointmentReminder = (payload: AppointmentReminderEvent) => {
      if (payload.conversationId !== conversationId) return;
      const scheduledLabel = new Date(payload.scheduledAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      toast.info(`${payload.title} starts in 15 minutes at ${scheduledLabel}.`, {
        duration: 10_000,
      });
    };

    // ── group.join_requested ───────────────────────────────────────────────
    // Strategy: prepend the incoming request into the pending list cache so
    // admins/owners see the badge update without a refetch.
    // Toast: only shown to admin/owner (spec §15).
    const onJoinRequested = (payload: GroupJoinRequestedEvent) => {
      if (payload.conversationId !== conversationId) return;
      const newRequest: JoinRequest = {
        id: payload.requestId,
        conversationId: payload.conversationId,
        userId: payload.userId,
        requestMessage: payload.requestMessage,
        status: "pending",
        createdAt: payload.timestamp,
        // Socket event doesn't carry the full profile — use a stub so the
        // panel renders immediately; the list query will reconcile on next fetch.
        user: { id: payload.userId, displayName: payload.userId, avatarUrl: null },
      };
      qc.setQueryData<JoinRequest[]>(
        queryKeys.joinRequests.list(conversationId),
        (old) => (old ? [newRequest, ...old] : [newRequest]),
      );
      // Show notification badge to admins/owner.
      const conv = qc.getQueryData<Conversation>(queryKeys.conversations.detail(conversationId));
      const myRole = conv?.participants?.find((p) => p.userId === myId)?.role?.toLowerCase();
      if (myRole === "owner" || myRole === "admin") {
        toast.info("Someone has requested to join the group.", { duration: 5_000 });
      }
    };

    // ── group.join_approved ────────────────────────────────────────────────
    // Strategy:
    //   - Self: invalidate conversations list + show success toast + navigate.
    //   - Others: invalidate member list so the new member appears.
    const onJoinApproved = (payload: GroupJoinApprovedEvent) => {
      if (payload.conversationId !== conversationId) return;
      // Remove the processed request from the pending list (admin view).
      qc.setQueryData<JoinRequest[]>(
        queryKeys.joinRequests.list(conversationId),
        (old) => old?.filter((r) => r.id !== payload.requestId),
      );
      if (payload.userId === myId) {
        // Current user's request was approved — refresh conversations list to include this group.
        qc.invalidateQueries({ queryKey: queryKeys.conversations.list() });
        toast.success("Your request to join the group has been approved!");
        router.push(`/conversations/${payload.conversationId}`);
      } else {
        // Another user was approved — refresh the member list.
        qc.invalidateQueries({ queryKey: queryKeys.conversations.members(conversationId) });
        qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
      }
    };

    // ── group.join_rejected ────────────────────────────────────────────────
    // Strategy: only self receives this event. Show an informative toast.
    const onJoinRejected = (payload: GroupJoinRejectedEvent) => {
      if (payload.conversationId !== conversationId) return;
      if (payload.userId === myId) {
        toast.error("Your request to join the group was declined.");
      }
    };

    // ── conversation:member-added ──────────────────────────────────────────
    // Global broadcast when a new member joins. Cache is updated by useSocket;
    // here we just surface the notification to current group members.
    const onMemberAdded = (payload: {
      conversationId: string;
      addedUserIds?: string[];
      addedBy?: string;
      memberCount?: number;
      timestamp: string;
    }) => {
      if (payload.conversationId !== conversationId) return;
      qc.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
      qc.invalidateQueries({ queryKey: queryKeys.conversations.members(conversationId) });
      toast.info("A new member has been added to this group.", { duration: 4_000 });
    };

    // ── Register all listeners ─────────────────────────────────────────────
    socket.on("group.settings_updated", onSettingsUpdated);
    socket.on("group.member_role_changed", onMemberRoleChanged);
    socket.on("group.member_kicked", onMemberKicked);
    socket.on("group.disbanded", onDisbanded);
    socket.on("group.invite_link_reset", onInviteLinkReset);
    socket.on("group.join_requested", onJoinRequested);
    socket.on("group.join_approved", onJoinApproved);
    socket.on("group.join_rejected", onJoinRejected);
    socket.on("conversation:member-added", onMemberAdded as (...args: unknown[]) => void);
    socket.on("poll.created", onPollCreated);
    socket.on("poll.voted", onPollVoted);
    socket.on("poll.closed", onPollClosed);
    socket.on("group.appointment_created", onAppointmentMutated);
    socket.on("group.appointment_updated", onAppointmentMutated);
    socket.on("group.appointment_deleted", onAppointmentMutated);
    socket.on("group.appointment_reminder", onAppointmentReminder);

    return () => {
      socket.emit("conversation:leave", { conversationId });
      socket.off("group.settings_updated", onSettingsUpdated as (...args: unknown[]) => void);
      socket.off("group.member_role_changed", onMemberRoleChanged as (...args: unknown[]) => void);
      socket.off("group.member_kicked", onMemberKicked as (...args: unknown[]) => void);
      socket.off("group.disbanded", onDisbanded as (...args: unknown[]) => void);
      socket.off("group.invite_link_reset", onInviteLinkReset as (...args: unknown[]) => void);
      socket.off("group.join_requested", onJoinRequested as (...args: unknown[]) => void);
      socket.off("group.join_approved", onJoinApproved as (...args: unknown[]) => void);
      socket.off("group.join_rejected", onJoinRejected as (...args: unknown[]) => void);
      socket.off("conversation:member-added", onMemberAdded as (...args: unknown[]) => void);
      socket.off("poll.created", onPollCreated as (...args: unknown[]) => void);
      socket.off("poll.voted", onPollVoted as (...args: unknown[]) => void);
      socket.off("poll.closed", onPollClosed as (...args: unknown[]) => void);
      socket.off("group.appointment_created", onAppointmentMutated as (...args: unknown[]) => void);
      socket.off("group.appointment_updated", onAppointmentMutated as (...args: unknown[]) => void);
      socket.off("group.appointment_deleted", onAppointmentMutated as (...args: unknown[]) => void);
      socket.off("group.appointment_reminder", onAppointmentReminder as (...args: unknown[]) => void);
    };
  }, [conversationId, myId, qc, router]);
}
