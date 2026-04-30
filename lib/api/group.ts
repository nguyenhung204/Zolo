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
  pollId: string;
  conversationId: string;
  creatorId: string;
  question: string;
  options: PollOption[];
  multipleChoice: boolean;
  deadline?: string;
  timestamp: string;
}

export interface PollVotedEvent {
  pollId: string;
  conversationId: string;
  userId: string;
  optionIds: string[];
  updatedOptions: PollOption[];
  timestamp: string;
}

export interface PollClosedEvent {
  pollId: string;
  conversationId: string;
  closedBy: string;
  finalOptions: PollOption[];
  timestamp: string;
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
  const d = res.data?.data;
  return Array.isArray(d) ? d : [];
}

export async function getPoll(pollId: string): Promise<Poll> {
  const res = await apiClient.get(`/polls/${pollId}`);
  return res.data.data ?? res.data;
}

export async function createPoll(
  conversationId: string,
  payload: CreatePollPayload,
): Promise<Poll> {
  const res = await apiClient.post(`/conversations/${conversationId}/polls`, payload);
  return res.data.data ?? res.data;
}

export async function votePoll(pollId: string, optionIds: string[]): Promise<Poll> {
  const res = await apiClient.post(`/polls/${pollId}/vote`, { optionIds });
  return res.data.data ?? res.data;
}

export async function closePoll(pollId: string): Promise<Poll> {
  const res = await apiClient.post(`/polls/${pollId}/close`);
  return res.data.data ?? res.data;
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
