"use client";

import { useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/authStore";
import { useCallStore } from "@/stores/callStore";
import { getCallSocket } from "@/lib/socket/socket";
import { getInstantCallToken, getInstantCallById } from "@/lib/api/calls";
import { getUserById } from "@/lib/api/users";
import { usePresenceStore } from "@/stores/presenceStore";

// ─── Audio helpers ────────────────────────────────────────────────────────────

function createAudio(src: string, loop = true): HTMLAudioElement {
  const audio = new Audio(src);
  audio.loop = loop;
  return audio;
}

function safePlay(audio: HTMLAudioElement): void {
  audio.play().catch((err: unknown) => {
    // Autoplay blocked until user gesture — silently ignore
    if (err instanceof DOMException && err.name === "NotAllowedError") return;
    console.warn("[CallAudio] play() failed:", err);
  });
}

function safeStop(audio: HTMLAudioElement | null): void {
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Mount once inside the authenticated AppShell.
 * Handles all /call namespace WebSocket events for the Zalo/Messenger-style
 * instant call flow (RINGING → ACTIVE → ENDED/REJECTED/MISSED).
 */
export function useCallWebSocketListeners(): void {
  const token = useAuthStore((s) => s.token);
  const myId = useAuthStore((s) => s.user?.id);
  const {
    incomingCall,
    setIncomingCall,
    setOutgoingCall,
    setActiveCall,
    setLiveKitCredentials,
    setDeclinedGroupCall,
    setGroupCall,
    addGroupCallParticipant,
    clearCallState,
    outgoingCall,
  } = useCallStore();

  // Keep a stable ref to outgoingCall so callbacks don't go stale
  const outgoingCallRef = useRef(outgoingCall);
  useEffect(() => {
    outgoingCallRef.current = outgoingCall;
  }, [outgoingCall]);

  // ─── Auto-reconnect after page reload ────────────────────────────────────────
  // When the user reloads mid-call, the persisted store will have activeCall +
  // liveKitCredentials. We validate the call is still ACTIVE via the API, then
  // re-fetch a fresh LiveKit token (the old one may have expired) and restore
  // the call UI automatically — no user action required.
  const hasAutoReconnectedRef = useRef(false);
  useEffect(() => {
    // Wait until the auth token is ready; run at most once per mount.
    if (!token || hasAutoReconnectedRef.current) return;
    hasAutoReconnectedRef.current = true;

    const { activeCall, liveKitCredentials } = useCallStore.getState();
    if (!activeCall || !liveKitCredentials) return;

    getInstantCallById(activeCall.id)
      .then((call) => {
        if (!call || call.status !== "ACTIVE") {
          // Call ended while the page was loading — discard persisted state.
          useCallStore.getState().clearCallState();
          return;
        }
        // Fetch a fresh token; the persisted one may be expired.
        return getInstantCallToken(activeCall.id)
          .then((creds) => {
            useCallStore.getState().setLiveKitCredentials(creds);
            useCallStore.getState().setActiveCall({ ...activeCall, ...call });
          })
          .catch(() => {
            useCallStore.getState().clearCallState();
          });
      })
      .catch(() => {
        // If the call cannot be fetched (404, network error), clear state.
        useCallStore.getState().clearCallState();
      });
  }, [token]);

  // Ringtone audio instances — created lazily on first user interaction
  const outgoingAudioRef = useRef<HTMLAudioElement | null>(null);
  const incomingAudioRef = useRef<HTMLAudioElement | null>(null);

  const getOutgoingAudio = useCallback((): HTMLAudioElement => {
    if (!outgoingAudioRef.current) {
      outgoingAudioRef.current = createAudio("/sounds/outgoing-ringtone.mp3", true);
    }
    return outgoingAudioRef.current;
  }, []);

  const getIncomingAudio = useCallback((): HTMLAudioElement => {
    if (!incomingAudioRef.current) {
      incomingAudioRef.current = createAudio("/sounds/incoming-ringtone.mp3", true);
    }
    return incomingAudioRef.current;
  }, []);

  const stopAllAudio = useCallback((): void => {
    safeStop(outgoingAudioRef.current);
    safeStop(incomingAudioRef.current);
  }, []);

  // ─── call:ringing (callee side) ─────────────────────────────────────────────
  const handleRinging = useCallback(
    (data: {
      callId: string;
      conversationId: string;
      callerId: string;
      calleeIds: string[];
      startedAt: string;
    }) => {
      // Ignore calls we initiated ourselves
      if (data.callerId === myId) return;

      const socket = getCallSocket();
      socket.emit("call:join_room", { callId: data.callId });

      setIncomingCall({
        id: data.callId,
        conversationId: data.conversationId,
        callerId: data.callerId,
        calleeIds: data.calleeIds ?? [],
        status: "RINGING",
        createdAt: data.startedAt,
        startedAt: data.startedAt,
        endedAt: null,
        participants: [],
      });

      // Always seed group call banner — it's visible inside the conversation so
      // context determines relevance. Don't gate on calleeIds.length because
      // some server versions may omit or send an empty array.
      setGroupCall(data.conversationId, {
        callId: data.callId,
        conversationId: data.conversationId,
        callerId: data.callerId,
        status: "RINGING",
        participantIds: [data.callerId],
        startedAt: data.startedAt,
      });

      // Fetch caller profile so overlay shows name/avatar immediately
      getUserById(data.callerId)
        .then((profile) => {
          const displayName =
            [profile.firstName, profile.lastName].filter(Boolean).join(" ") ||
            profile.username ||
            null;
          usePresenceStore.getState().setUserProfile(data.callerId, {
            displayName,
            avatarMediaId: profile.avatarMediaId ?? null,
            avatarUrl: profile.avatarUrl ?? null,
          });
        })
        .catch(() => {}); // non-fatal — overlay falls back to initials
    },
    [myId, setIncomingCall, setGroupCall]
  );

  // ─── Reactive audio: play/stop in sync with call state ───────────────────────
  // This handles cases where audio must stop without a WS event (e.g. callee
  // accepts or declines via the overlay buttons, which only update store state).
  useEffect(() => {
    if (incomingCall) {
      safePlay(getIncomingAudio());
      // Cleanup: stop if the component unmounts while call is ringing
      return () => safeStop(incomingAudioRef.current);
    } else {
      safeStop(incomingAudioRef.current);
    }
  }, [incomingCall, getIncomingAudio]);

  useEffect(() => {
    if (outgoingCall) {
      safePlay(getOutgoingAudio());
      // Cleanup: stop if the component unmounts while call is ringing
      return () => safeStop(outgoingAudioRef.current);
    } else {
      safeStop(outgoingAudioRef.current);
    }
  }, [outgoingCall, getOutgoingAudio]);

  // ─── call:accepted (caller side — callee accepted, now fetch token) ──────────
  const handleAccepted = useCallback(
    async (data: {
      callId: string;
      conversationId: string;
      calleeId: string;
      acceptedAt: string;
    }) => {
      stopAllAudio();

      // Only the caller needs to fetch a token here; the callee already got one
      // from POST /calls/:callId/accept
      const current = outgoingCallRef.current;
      if (!current || current.id !== data.callId) return;

      try {
        const credentials = await getInstantCallToken(data.callId);
        setActiveCall({ ...current, status: "ACTIVE" });
        setOutgoingCall(null);
        setLiveKitCredentials(credentials);
      } catch {
        toast.error("Could not connect to the call. Please try again.");
        clearCallState();
      }
    },
    [stopAllAudio, setActiveCall, setOutgoingCall, setLiveKitCredentials, clearCallState]
  );

  // ─── call:declined ───────────────────────────────────────────────────────────
  const handleDeclined = useCallback(
    (data: { callId: string; declinedBy: string; finalStatus: "REJECTED" | "RINGING" | "MISSED"; declinedAt: string }) => {
      // Group call: one callee declined but others can still accept — keep state alive.
      if (data.finalStatus === "RINGING") {
        toast.info("A participant declined the call.");
        return;
      }

      stopAllAudio();

      // Guard: if we already cleared state optimistically (i.e. the local user
      // initiated the decline/cancel), ignore this WS echo — we don't want to
      // flash a "Call declined" toast to the person who just clicked Decline.
      const { incomingCall, outgoingCall } = useCallStore.getState();
      if (!incomingCall && !outgoingCall) return;

      // Clear any pending re-join opportunity since the call is now fully rejected.
      const { incomingCall: ic, outgoingCall: oc } = useCallStore.getState();
      const convId = ic?.conversationId ?? oc?.conversationId;
      if (convId) useCallStore.getState().setGroupCall(convId, null);
      useCallStore.getState().setDeclinedGroupCall(null);
      clearCallState();
      toast.info("Call declined");
    },
    [stopAllAudio, clearCallState]
  );

  // ─── call:ended ──────────────────────────────────────────────────────────────
  const handleEnded = useCallback(
    (data: { callId: string; endReason: string; durationMs?: number }) => {
      stopAllAudio();

      // Clear the group call banner — the call is over for everyone.
      const state = useCallStore.getState();
      const groupEntry = Object.values(state.groupCallsByConversation)
        .find((e) => e.callId === data.callId);
      if (groupEntry) state.setGroupCall(groupEntry.conversationId, null);

      // NOTE: do NOT clear declinedGroupCall here. If the user intentionally
      // left a group call (Leave button), declinedGroupCall is their only
      // re-join anchor. They will discover the call ended when they try to
      // join and the API returns a non-active status (which clears it then).

      // Guard: if we already cleared state optimistically (i.e. the local user
      // clicked End Call), ignore this WS echo to avoid a double-toast.
      const { activeCall } = useCallStore.getState();
      if (!activeCall || activeCall.id !== data.callId) return;

      const socket = getCallSocket();
      socket.emit("call:leave_room", { callId: data.callId });

      clearCallState();
      toast.info("Call ended");
    },
    [stopAllAudio, clearCallState]
  );

  // ─── Effect: attach / detach listeners ───────────────────────────────────────
  useEffect(() => {
    if (!token) return;

    const socket = getCallSocket();

    const doAuthenticate = () => {
      socket.emit("authenticate", { token });
    };

    // Register for future reconnects
    socket.on("connect", doAuthenticate);

    // If the socket is already connected (AuthProvider called connectCallSocket
    // before this hook mounted), emit authenticate immediately — the "connect"
    // event won't fire again for the current connection.
    if (socket.connected) {
      doAuthenticate();
    }

    socket.on("call:ringing", handleRinging);
    socket.on("call:accepted", handleAccepted);
    socket.on("call:declined", handleDeclined);
    socket.on("call:ended", handleEnded);

    return () => {
      socket.off("connect", doAuthenticate);
      socket.off("call:ringing", handleRinging);
      socket.off("call:accepted", handleAccepted);
      socket.off("call:declined", handleDeclined);
      socket.off("call:ended", handleEnded);
      // Stop any audio that may still be playing when this hook tears down
      safeStop(outgoingAudioRef.current);
      safeStop(incomingAudioRef.current);
    };
  }, [token, handleRinging, handleAccepted, handleDeclined, handleEnded]);
}
