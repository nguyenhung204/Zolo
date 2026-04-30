import { apiClient } from "@/lib/api/client";
import type { Conversation, MemberRole } from "@/lib/api/conversations";

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface GroupSettingsPayload {
  allowMemberMessage?: boolean;
  isPublic?: boolean;
  joinApprovalRequired?: boolean;
}

export interface PollOption {
  id: string;
  text: string;
  voterIds: string[];
}

export interface Poll {
  id: string;
  conversationId: string;
  creatorId: string;
  question: string;
  options: PollOption[];
  multipleChoice: boolean;
  deadline?: string;
  isClosed: boolean;
  createdAt: string;
}

export interface CreatePollPayload {
  question: string;
  options: string[];
  multipleChoice?: boolean;
  deadline?: string;
}

export interface Appointment {
  id: string;
  conversationId: string;
  title: string;
  description?: string;
  scheduledAt: string;
  location?: string;
  createdAt: string;
}

export interface CreateAppointmentPayload {
  title: string;
  description?: string;
  scheduledAt: string;
  location?: string;
}

export interface UpdateAppointmentPayload {
  title?: string;
  description?: string;
  scheduledAt?: string;
  location?: string;
}

export interface InviteLink {
  url: string;
  expiresAt: string;
}

// ─── Socket event payload types ───────────────────────────────────────────────

export interface GroupSettingsUpdatedEvent {
  conversationId: string;
  updatedBy: string;
  updatedByName?: string;
  changes: {
    allowMemberMessage?: boolean;
    isPublic?: boolean;
    joinApprovalRequired?: boolean;
    /** Present when group name is changed */
    name?: string;
    /** Present when group avatar is changed */
    avatarChanged?: boolean;
  };
  timestamp: string;
}

export interface GroupMemberRoleChangedEvent {
  conversationId: string;
  userId: string;
  userName?: string;
  newRole: MemberRole;
  changedBy?: string;
  changedByName?: string;
  timestamp: string;
}

export interface GroupMemberKickedEvent {
  conversationId: string;
  userId: string;
  userName?: string;
  kickedBy: string;
  kickedByName?: string;
  timestamp: string;
}

export interface GroupDisbandedEvent {
  conversationId: string;
  disbandedBy: string;
  disbandedByName?: string;
  timestamp: string;
}

export interface GroupInviteLinkResetEvent {
  conversationId: string;
  resetBy: string;
  timestamp: string;
}

export interface PollCreatedEvent {
  conversationId: string;
  poll: Poll;
  createdBy: string;
  createdByName: string;
  timestamp: string;
}

export interface PollVotedEvent {
  conversationId: string;
  pollId: string;
  voterId: string;
  voterName: string;
  optionIds: string[];
  options: PollOption[];
  timestamp: string;
}

export interface PollClosedEvent {
  conversationId: string;
  pollId: string;
  closedBy: string;
  closedByName: string;
  options: PollOption[];
  timestamp: string;
}

type RawPollOption = string | {
  id?: string;
  optionId?: string;
  text?: string;
  label?: string;
  optionText?: string;
  voterIds?: unknown;
  voters?: unknown;
};

type RawPoll = Partial<Omit<Poll, "options">> & {
  id?: string;
  pollId?: string;
  _id?: string;
  conversationId?: string;
  conversation_id?: string;
  creatorId?: string;
  creator_id?: string;
  options?: RawPollOption[];
  pollOptions?: RawPollOption[];
  choices?: RawPollOption[];
  multipleChoice?: boolean;
  multiple_choice?: boolean;
  isClosed?: boolean;
  is_closed?: boolean;
  deadline?: string | null;
  createdAt?: string;
  created_at?: string;
};

function normalizePollOption(option: RawPollOption, index: number): PollOption {
  if (typeof option === "string") {
    return { id: option, text: option, voterIds: [] };
  }
  const rawVoters = option.voterIds ?? option.voters;
  return {
    id: option.id ?? option.optionId ?? `option-${index}`,
    text: option.text ?? option.label ?? option.optionText ?? `Option ${index + 1}`,
    voterIds: Array.isArray(rawVoters) ? rawVoters.filter((id): id is string => typeof id === "string") : [],
  };
}

export function normalizePoll(raw: RawPoll): Poll {
  const options = raw.options ?? raw.pollOptions ?? raw.choices ?? [];
  return {
    id: raw.id ?? raw.pollId ?? raw._id ?? "",
    conversationId: raw.conversationId ?? raw.conversation_id ?? "",
    creatorId: raw.creatorId ?? raw.creator_id ?? "",
    question: raw.question ?? "",
    options: options.map(normalizePollOption),
    multipleChoice: raw.multipleChoice ?? raw.multiple_choice ?? false,
    deadline: raw.deadline ?? undefined,
    isClosed: raw.isClosed ?? raw.is_closed ?? false,
    createdAt: raw.createdAt ?? raw.created_at ?? new Date(0).toISOString(),
  };
}

export interface AppointmentEvent {
  appointmentId: string;
  conversationId: string;
  title?: string;
  scheduledAt?: string;
  location?: string;
  deletedBy?: string;
  timestamp: string;
}

export interface AppointmentReminderEvent {
  appointmentId: string;
  conversationId: string;
  title: string;
  scheduledAt: string;
  timestamp: string;
}

export interface JoinRequestUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface JoinRequest {
  id: string;
  conversationId: string;
  userId: string;
  requestMessage: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  user: JoinRequestUser;
}

export type JoinByInviteResult =
  | { requiresApproval: false; conversationId: string }
  | { requiresApproval: true; requestId: string };

export interface GroupJoinRequestedEvent {
  conversationId: string;
  userId: string;
  userName?: string;
  requestId: string;
  requestMessage: string | null;
  source?: "invite_link" | "request";
  timestamp: string;
}

export interface GroupJoinApprovedEvent {
  conversationId: string;
  userId?: string;
  userName?: string;
  requestId: string;
  reviewedBy: string;
  reviewedByName?: string;
  timestamp: string;
}

export interface GroupJoinRejectedEvent {
  conversationId: string;
  userId?: string;
  userName?: string;
  requestId: string;
  reviewedBy: string;
  reviewedByName?: string;
  timestamp: string;
}

// ─── Role helpers ─────────────────────────────────────────────────────────────

export const ROLE_INDEX: Record<string, number> = {
  member: 0,
  admin: 1,
  owner: 2,
};

/** Returns true if `userRole` is at least `minRole` in the hierarchy. */
export function hasMinRole(userRole: string, minRole: string): boolean {
  return (ROLE_INDEX[userRole?.toLowerCase()] ?? -1) >= (ROLE_INDEX[minRole?.toLowerCase()] ?? Infinity);
}

// ─── Group Settings ───────────────────────────────────────────────────────────

export async function updateGroupSettings(
  conversationId: string,
  payload: GroupSettingsPayload,
): Promise<Conversation> {
  const res = await apiClient.patch(`/conversations/${conversationId}/settings`, payload);
  return res.data.data ?? res.data;
}

// ─── Member Management ────────────────────────────────────────────────────────

export async function setMemberRole(
  conversationId: string,
  userId: string,
  role: MemberRole,
): Promise<void> {
  await apiClient.patch(`/conversations/${conversationId}/members/${userId}/role`, { role });
}

export async function kickMember(conversationId: string, userId: string): Promise<void> {
  await apiClient.delete(`/conversations/${conversationId}/members/${userId}`);
}

export async function disbandGroup(conversationId: string): Promise<void> {
  await apiClient.delete(`/conversations/${conversationId}`);
}

export interface LeaveGroupPayload {
  transferOwnershipTo?: string;
  silent?: boolean;
}

export interface DeleteConversationForMeResult {
  deletedUntil: number;
}

// ─── Invite Links ─────────────────────────────────────────────────────────────

export async function generateInviteLink(conversationId: string): Promise<InviteLink> {
  const res = await apiClient.post(`/conversations/${conversationId}/invite-link`);
  return res.data.data ?? res.data;
}

export async function resetInviteLink(conversationId: string): Promise<void> {
  await apiClient.delete(`/conversations/${conversationId}/invite-link`);
}

export interface JoinByInvitePayload {
  token: string;
  requestMessage?: string;
}

export async function joinByInvite(payload: JoinByInvitePayload): Promise<JoinByInviteResult> {
  const res = await apiClient.post(`/conversations/join`, payload);
  return res.data.data ?? res.data;
}

// ─── Polls ────────────────────────────────────────────────────────────────────

/** GET /conversations/:id/polls — list all polls for a conversation */
export async function getPolls(conversationId: string): Promise<Poll[]> {
  const res = await apiClient.get(`/conversations/${conversationId}/polls`);
  const d = res.data?.data?.polls ?? res.data?.data;
  return Array.isArray(d) ? d.map((poll) => normalizePoll(poll as RawPoll)) : [];
}

export async function getPoll(conversationId: string, pollId: string): Promise<Poll> {
  const res = await apiClient.get(`/conversations/${conversationId}/polls/${pollId}`);
  return normalizePoll((res.data.data ?? res.data) as RawPoll);
}

export async function createPoll(
  conversationId: string,
  payload: CreatePollPayload,
): Promise<Poll> {
  const res = await apiClient.post(`/conversations/${conversationId}/polls`, payload);
  // Server response can come back in several shapes:
  //   { data: { ...poll } }
  //   { data: { poll: { ...poll } } }
  //   { ...poll }                          (legacy)
  //   { poll: { ...poll } }                (legacy)
  // Walk through them and pick the first one that has an id.
  const body = res.data ?? {};
  const candidates: unknown[] = [
    body?.data?.poll,
    body?.data,
    body?.poll,
    body,
  ];
  let raw: RawPoll = {};
  for (const c of candidates) {
    if (c && typeof c === "object") {
      const r = c as RawPoll;
      if (r.id ?? r.pollId ?? r._id) {
        raw = r;
        break;
      }
      // Fall back to the first non-empty object even if no id found, so we at
      // least surface the poll details. The id check below will catch a truly
      // empty payload.
      if (Object.keys(r).length > 0 && Object.keys(raw).length === 0) raw = r;
    }
  }
  const pollId = raw.id ?? raw.pollId ?? raw._id;
  return normalizePoll({
    ...payload,
    ...raw,
    id: pollId,
    conversationId: raw.conversationId ?? raw.conversation_id ?? conversationId,
    options: raw.options ?? raw.pollOptions ?? raw.choices ?? payload.options,
    createdAt: raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
  });
}

export async function votePoll(
  conversationId: string,
  pollId: string,
  optionIds: string[],
): Promise<Poll> {
  const res = await apiClient.post(
    `/conversations/${conversationId}/polls/${pollId}/votes`,
    { optionIds },
  );
  return normalizePoll((res.data.data ?? res.data) as RawPoll);
}

export async function closePoll(conversationId: string, pollId: string): Promise<Poll> {
  const res = await apiClient.post(`/conversations/${conversationId}/polls/${pollId}/close`);
  return normalizePoll((res.data.data ?? res.data) as RawPoll);
}

// ─── Appointments ─────────────────────────────────────────────────────────────

/** GET /conversations/:id/appointments — list all appointments for a conversation */
export async function getAppointments(conversationId: string): Promise<Appointment[]> {
  const res = await apiClient.get(`/conversations/${conversationId}/appointments`);
  const d = res.data?.data;
  return Array.isArray(d) ? d : [];
}

export async function createAppointment(
  conversationId: string,
  payload: CreateAppointmentPayload,
): Promise<Appointment> {
  const res = await apiClient.post(`/conversations/${conversationId}/appointments`, payload);
  return res.data.data ?? res.data;
}

export async function updateAppointment(
  appointmentId: string,
  payload: UpdateAppointmentPayload,
): Promise<Appointment> {
  const res = await apiClient.patch(`/appointments/${appointmentId}`, payload);
  return res.data.data ?? res.data;
}

export async function deleteAppointment(appointmentId: string): Promise<void> {
  await apiClient.delete(`/appointments/${appointmentId}`);
}

// ─── Leave Group ─────────────────────────────────────────────────────────────

export async function leaveGroup(
  conversationId: string,
  payload: LeaveGroupPayload = {},
): Promise<void> {
  await apiClient.post(`/conversations/${conversationId}/leave`, payload);
}

export async function deleteConversationForMe(
  conversationId: string,
): Promise<DeleteConversationForMeResult> {
  const res = await apiClient.delete(`/conversations/${conversationId}/for-me`);
  return res.data.data ?? res.data;
}

// ─── Join Requests ────────────────────────────────────────────────────────────

export async function requestToJoin(
  conversationId: string,
  requestMessage?: string,
): Promise<JoinRequest> {
  const res = await apiClient.post(`/conversations/${conversationId}/join-requests`, {
    requestMessage,
  });
  return res.data.data ?? res.data;
}

export async function getJoinRequests(conversationId: string): Promise<JoinRequest[]> {
  const res = await apiClient.get(`/conversations/${conversationId}/join-requests`);
  const d = res.data?.data;
  return Array.isArray(d) ? d : [];
}

export async function reviewJoinRequest(
  conversationId: string,
  requestId: string,
  action: "approve" | "reject",
): Promise<void> {
  await apiClient.patch(`/conversations/${conversationId}/join-requests/${requestId}`, {
    action,
  });
}
