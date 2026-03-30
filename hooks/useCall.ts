"use client";

import { useCallback, useState } from "react";
import { getLivekitToken, leaveCall, endCall, approveParticipant } from "@/lib/api/calls";
import { useCallStore } from "@/stores/callStore";

export function useCall() {
  const [isConnecting, setIsConnecting] = useState(false);
  const { setLivekitCredentials, endCall: clearCall } = useCallStore();
  const activeMeetingId = useCallStore((s) => s.activeMeetingId);

  const fetchToken = useCallback(async (meetingId: string) => {
    setIsConnecting(true);
    try {
      const { token, livekitUrl } = await getLivekitToken(meetingId);
      setLivekitCredentials(token, livekitUrl);
      return { token, livekitUrl };
    } finally {
      setIsConnecting(false);
    }
  }, [setLivekitCredentials]);

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

  const approve = useCallback(async (userId: string) => {
    if (!activeMeetingId) return;
    await approveParticipant(activeMeetingId, userId);
  }, [activeMeetingId]);

  return { fetchToken, leave, end, approve, isConnecting };
}
