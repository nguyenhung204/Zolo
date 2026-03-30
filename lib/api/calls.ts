import { apiClient } from "@/lib/api/client";

export interface Meeting {
  meetingId: string;
  conversationId: string;
  hostId: string;
  status: "ACTIVE" | "ENDED";
  startedAt: string;
}

export interface LiveKitToken {
  token: string;
  livekitUrl: string;
}

export async function startCall(conversationId: string): Promise<Meeting> {
  const res = await apiClient.post(`/calls/${conversationId}/start`);
  return res.data.data;
}

export async function joinCall(conversationId: string): Promise<void> {
  await apiClient.post(`/calls/${conversationId}/join`);
}

export async function getLivekitToken(meetingId: string): Promise<LiveKitToken> {
  const res = await apiClient.post(`/calls/${meetingId}/token`);
  return res.data.data;
}

export async function leaveCall(meetingId: string): Promise<void> {
  await apiClient.post(`/calls/${meetingId}/leave`);
}

export async function endCall(meetingId: string): Promise<void> {
  await apiClient.post(`/calls/${meetingId}/end`);
}

export async function approveParticipant(meetingId: string, userId: string): Promise<void> {
  await apiClient.post(`/calls/${meetingId}/approve/${userId}`);
}
