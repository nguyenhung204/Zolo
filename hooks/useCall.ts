"use client";

import { useCallback, useRef, useState } from "react";
import {
  startCall,
  joinCall,
  getLivekitToken,
  leaveCall,
  endCall,
  approveParticipant,
  rejectParticipant,
  updateMediaState,
  moderateParticipant,
} from "@/lib/api/calls";
import { useCallStore } from "@/stores/callStore";
import { useAuthStore } from "@/stores/authStore";
import type { ModerationAction } from "@/lib/socket/events";

export function useCall() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const callStore = useCallStore();
  const { setLivekitCredentials, setWaiting, setActiveMeeting, endCall: clearCall } = callStore;
  const activeMeetingId = useCallStore((s) => s.activeMeetingId);
  const user = useAuthStore((s) => s.user);

  // ─── Start a new meeting (host flow) ───────────────────────────────────────
  const startMeeting = useCallback(
    async (conversationId: string, orgId: string, allowWaitingRoom = false) => {
      setIsConnecting(true);
      setError(null);
      try {
        const meeting = await startCall({ conversationId, orgId, allowWaitingRoom });
        setActiveMeeting({
          meetingId: meeting.meetingId,
          conversationId: meeting.conversationId,
          hostId: meeting.hostId,
          allowWaitingRoom: meeting.allowWaitingRoom,
        });
        // Host immediately joins without waiting room check
        await joinCall(meeting.meetingId);
        const { token, livekitUrl } = await getLivekitToken(meeting.meetingId);
        setLivekitCredentials(token, livekitUrl);
        return meeting;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to start call";
        setError(msg);
        throw err;
      } finally {
        setIsConnecting(false);
      }
    },
    [setActiveMeeting, setLivekitCredentials]
  );

  // ─── Join an existing meeting (participant flow) ────────────────────────────
  const joinMeeting = useCallback(
    async (meetingId: string) => {
      setIsConnecting(true);
      setError(null);
      try {
        const result = await joinCall(meetingId);
        if (result.status === "waiting") {
          // Waiting room — server will emit meeting:approved when host admits
          setWaiting(true);
          return { waiting: true };
        }
        // Direct join — fetch LiveKit token immediately
        const { token, livekitUrl } = await getLivekitToken(meetingId, {
          participantName: user?.name,
        });
        setLivekitCredentials(token, livekitUrl);
        return { waiting: false };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to join call";
        setError(msg);
        throw err;
      } finally {
        setIsConnecting(false);
      }
    },
    [setWaiting, setLivekitCredentials, user?.name]
  );

  // ─── Fetch / refresh LiveKit token ─────────────────────────────────────────
  const fetchToken = useCallback(
    async (meetingId: string) => {
      setIsConnecting(true);
      try {
        const { token, livekitUrl } = await getLivekitToken(meetingId, {
          participantName: user?.name,
        });
        setLivekitCredentials(token, livekitUrl);
        return { token, livekitUrl };
      } finally {
        setIsConnecting(false);
      }
    },
    [setLivekitCredentials, user?.name]
  );

  // ─── Leave / end ───────────────────────────────────────────────────────────
  const leave = useCallback(async () => {
    if (!activeMeetingId) return;
    await leaveCall(activeMeetingId).catch(() => {});
    clearCall();
  }, [activeMeetingId, clearCall]);

  const end = useCallback(async () => {
    if (!activeMeetingId) return;
    await endCall(activeMeetingId).catch(() => {});
    clearCall();
  }, [activeMeetingId, clearCall]);

  // ─── Waiting room management (host) ────────────────────────────────────────
  const approve = useCallback(
    async (userId: string) => {
      if (!activeMeetingId) return;
      await approveParticipant(activeMeetingId, userId);
      callStore.removeWaiting(userId);
    },
    [activeMeetingId, callStore]
  );

  const reject = useCallback(
    async (userId: string, reason?: string) => {
      if (!activeMeetingId) return;
      await rejectParticipant(activeMeetingId, userId, reason);
      callStore.removeWaiting(userId);
    },
    [activeMeetingId, callStore]
  );

  // ─── Media state sync ─────────────────────────────────────────────────────
  const syncMediaState = useCallback(
    (state: { micOn: boolean; cameraOn: boolean; screenSharing: boolean }) => {
      if (!activeMeetingId) return;
      callStore.updateMyMedia(state);
      // Debounce server sync — max once per 300ms to avoid rate-limit hammering
      if (mediaDebounce.current) clearTimeout(mediaDebounce.current);
      mediaDebounce.current = setTimeout(() => {
        updateMediaState(activeMeetingId, state).catch(() => {});
      }, 300);
    },
    [activeMeetingId, callStore]
  );

  // ─── Moderation (host/co-host) ────────────────────────────────────────────
  const moderate = useCallback(
    async (userId: string, action: ModerationAction, reason?: string) => {
      if (!activeMeetingId) return;
      await moderateParticipant(activeMeetingId, userId, action, reason);
    },
    [activeMeetingId]
  );

  return {
    startMeeting,
    joinMeeting,
    fetchToken,
    leave,
    end,
    approve,
    reject,
    syncMediaState,
    moderate,
    isConnecting,
    error,
  };
}
