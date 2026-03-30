"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/authStore";
import { useCallStore } from "@/stores/callStore";
import { getCallSocket } from "@/lib/socket/socket";
import { getLivekitToken } from "@/lib/api/calls";

/**
 * Handles all /call namespace WebSocket events.
 * Mount once inside the authenticated app shell (alongside useSocket).
 */
export function useCallSocket() {
  const token = useAuthStore((s) => s.token);
  const callStore = useCallStore();
  const router = useRouter();
  // Guard to avoid double-fetch of LiveKit token on meeting:approved
  const fetchingTokenRef = useRef(false);

  const handleApproved = useCallback(
    async (meetingId: string) => {
      if (fetchingTokenRef.current) return;
      fetchingTokenRef.current = true;
      try {
        const { token: livekitToken, livekitUrl } = await getLivekitToken(meetingId);
        callStore.setLivekitCredentials(livekitToken, livekitUrl);
        callStore.setWaiting(false);
      } catch {
        // If token fetch fails, leave the call gracefully — server state is still valid
        callStore.endCall();
      } finally {
        fetchingTokenRef.current = false;
      }
    },
    [callStore]
  );

  useEffect(() => {
    if (!token) return;

    const socket = getCallSocket();

    // ─── Connection ───────────────────────────────────────────────────────────
    socket.on("connect", () => {
      socket.emit("authenticate", { token });
    });

    // ─── Meeting lifecycle ────────────────────────────────────────────────────

    socket.on("meeting:started", ({ meetingId, hostId, conversationId }) => {
      // Another member of the conversation started a call — show the call bar
      callStore.setActiveMeeting({ meetingId, conversationId, hostId });
    });

    socket.on("meeting:participant_joined", ({ meetingId, userId }) => {
      callStore.removeWaiting(userId);
      callStore.addParticipant({ userId, micOn: true, cameraOn: false, screenSharing: false });
    });

    socket.on("meeting:participant_left", ({ userId }) => {
      callStore.removeParticipant(userId);
    });

    socket.on("meeting:join_requested", ({ userId }) => {
      // The current user is host — someone entered the waiting room
      callStore.addWaiting(userId);
    });

    socket.on("meeting:approved", ({ meetingId }) => {
      // Current user was approved from the waiting room — now fetch LiveKit token
      handleApproved(meetingId);
    });

    socket.on("meeting:rejected", () => {
      // Current user was rejected — tear down and navigate back
      callStore.endCall();
      router.back();
    });

    socket.on("meeting:ended", () => {
      callStore.endCall();
      router.back();
    });

    socket.on("meeting:media_state", ({ userId, mediaState }) => {
      callStore.updateParticipantMedia(userId, mediaState);
    });

    socket.on("meeting:kicked", () => {
      // Current user was kicked by host
      callStore.endCall();
      router.back();
    });

    return () => {
      socket.removeAllListeners();
    };
  }, [token, callStore, router, handleApproved]);
}
