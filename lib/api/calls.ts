import { apiClient } from "@/lib/api/client";
import type { ModerationAction, RecordingStatus } from "@/lib/socket/events";

// ─── Instant Call Types (Zalo/Messenger-style) ────────────────────────────────

export interface CallParticipantDto {
  userId: string;
  role: "CALLER" | "CALLEE";
  joinedAt: string | null;
  leftAt: string | null;
  createdAt: string;
}

export interface CallDto {
  id: string;
  conversationId: string;
  callerId: string;
  /** All callee user IDs — length > 1 means this is a group call. */
  calleeIds?: string[];
  status: "RINGING" | "ACTIVE" | "REJECTED" | "MISSED" | "ENDED";
  createdAt: string;
  startedAt: string;
  endedAt: string | null;
  participants: CallParticipantDto[];
}

export interface CallTokenDto {
  token: string;
  roomName: string;
  livekitUrl: string;
}

export interface CallAcceptResponseDto {
  call: CallDto;
  token: string;
  roomName: string;
  livekitUrl: string;
}

// ─── Instant Call API ─────────────────────────────────────────────────────────

export async function startInstantCall(params: {
  conversationId: string;
  calleeIds: string[];
}): Promise<CallDto> {
  const res = await apiClient.post("/calls/start", params);
  return res.data.data ?? res.data;
}

export async function acceptInstantCall(callId: string): Promise<CallAcceptResponseDto> {
  const res = await apiClient.post(`/calls/${callId}/accept`);
  return res.data.data ?? res.data;
}

export async function declineInstantCall(callId: string): Promise<CallDto> {
  const res = await apiClient.post(`/calls/${callId}/decline`);
  return res.data.data ?? res.data;
}

export async function endInstantCall(callId: string): Promise<CallDto> {
  const res = await apiClient.post(`/calls/${callId}/end`);
  return res.data.data ?? res.data;
}

export async function getInstantCallToken(callId: string): Promise<CallTokenDto> {
  const res = await apiClient.get(`/calls/${callId}/token`);
  return res.data.data ?? res.data;
}

export async function getInstantCallById(callId: string): Promise<CallDto | null> {
  const res = await apiClient.get(`/calls/${callId}`);
  return res.data.data ?? res.data ?? null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Meeting {
  meetingId: string;
  conversationId: string;
  hostId: string;
  orgId: string;
  status: "ACTIVE" | "ENDED";
  allowWaitingRoom: boolean;
  startedAt: string;
  endedAt?: string;
  participants: MeetingParticipant[];
  waitingParticipants: WaitingParticipant[];
}

export interface MeetingParticipant {
  userId: string;
  role: "HOST" | "CO_HOST" | "PARTICIPANT";
  joinedAt: string;
  leftAt?: string;
  mediaState: { micOn: boolean; cameraOn: boolean; screenSharing: boolean };
}

export interface WaitingParticipant {
  userId: string;
  requestedAt: string;
  status: "WAITING" | "APPROVED" | "REJECTED";
}

export interface JoinResult {
  status: "joined" | "waiting";
  meeting: Meeting;
}

export interface LiveKitCredentials {
  token: string;
  livekitUrl: string;
}

export interface Recording {
  id: string;
  meetingId: string;
  status: RecordingStatus;
  startedBy: string;
  startedAt: string;
  stoppedAt?: string;
  outputUrl?: string;
}

export interface MeetingSummary {
  meetingId: string;
  conversationId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  participantCount: number;
  recordingCount: number;
  endedBy: string;
}

// ─── Meeting lifecycle ────────────────────────────────────────────────────────

export async function startCall(params: {
  conversationId: string;
  orgId: string;
  allowWaitingRoom?: boolean;
}): Promise<Meeting> {
  const res = await apiClient.post("/calls/start", params);
  return res.data.data;
}

export async function getActiveMeeting(conversationId: string): Promise<Meeting | null> {
  const res = await apiClient.get(`/calls/active/${conversationId}`);
  return res.data.data ?? null;
}

export async function getMyActiveMeeting(): Promise<Meeting | null> {
  const res = await apiClient.get("/calls/me/active");
  return res.data.data ?? null;
}

export async function joinCall(meetingId: string): Promise<JoinResult> {
  const res = await apiClient.post(`/calls/${meetingId}/join`);
  return res.data.data;
}

export async function getLivekitToken(
  meetingId: string,
  params?: { participantName?: string; canPublish?: boolean; canSubscribe?: boolean }
): Promise<LiveKitCredentials> {
  const res = await apiClient.post(`/calls/${meetingId}/token`, {
    canPublish: true,
    canSubscribe: true,
    ...params,
  });
  return res.data.data;
}

export async function leaveCall(meetingId: string): Promise<void> {
  await apiClient.post(`/calls/${meetingId}/leave`);
}

export async function endCall(meetingId: string): Promise<void> {
  await apiClient.post(`/calls/${meetingId}/end`);
}

// ─── Waiting room ─────────────────────────────────────────────────────────────

export async function approveParticipant(meetingId: string, userId: string): Promise<void> {
  await apiClient.post(`/calls/${meetingId}/waiting/${userId}/approve`);
}

export async function rejectParticipant(
  meetingId: string,
  userId: string,
  reason?: string
): Promise<void> {
  await apiClient.post(`/calls/${meetingId}/waiting/${userId}/reject`, reason ? { reason } : {});
}

// ─── In-call state ────────────────────────────────────────────────────────────

export async function updateMediaState(
  meetingId: string,
  state: { micOn: boolean; cameraOn: boolean; screenSharing: boolean }
): Promise<void> {
  await apiClient.patch(`/calls/${meetingId}/media-state`, state);
}

export async function moderateParticipant(
  meetingId: string,
  userId: string,
  action: ModerationAction,
  reason?: string
): Promise<void> {
  await apiClient.post(`/calls/${meetingId}/participants/${userId}/moderate`, {
    action,
    ...(reason ? { reason } : {}),
  });
}

export async function getMeetingSnapshot(meetingId: string): Promise<Meeting> {
  const res = await apiClient.get(`/calls/${meetingId}/snapshot`);
  return res.data.data;
}

// ─── Recording ────────────────────────────────────────────────────────────────

export async function startRecording(meetingId: string): Promise<Recording> {
  const res = await apiClient.post(`/calls/${meetingId}/recording/start`);
  return res.data.data;
}

export async function pauseRecording(meetingId: string): Promise<Recording> {
  const res = await apiClient.post(`/calls/${meetingId}/recording/pause`);
  return res.data.data;
}

export async function resumeRecording(meetingId: string): Promise<Recording> {
  const res = await apiClient.post(`/calls/${meetingId}/recording/resume`);
  return res.data.data;
}

export async function stopRecording(meetingId: string): Promise<Recording> {
  const res = await apiClient.post(`/calls/${meetingId}/recording/stop`);
  return res.data.data;
}

export async function getRecordings(meetingId: string): Promise<Recording[]> {
  const res = await apiClient.get(`/calls/${meetingId}/recordings`);
  return res.data.data ?? [];
}

// ─── History ──────────────────────────────────────────────────────────────────

export async function getCallHistory(
  conversationId: string,
  page = 1,
  limit = 20
): Promise<Meeting[]> {
  const res = await apiClient.get(
    `/calls/history/${conversationId}?page=${page}&limit=${limit}`
  );
  return res.data.data ?? [];
}

export async function getMeetingSummary(meetingId: string): Promise<MeetingSummary | null> {
  const res = await apiClient.get(`/calls/${meetingId}/summary`);
  return res.data.data ?? null;
}
