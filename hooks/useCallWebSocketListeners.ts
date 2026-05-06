"use client";

import { useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/authStore";
import { useCallStore } from "@/stores/callStore";
import { getCallSocket } from "@/lib/socket/socket";
import { getInstantCallToken, getInstantCallById, isGroupInstantCall } from "@/lib/api/calls";
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
        if (!isGroupInstantCall(call)) {
          useCallStore.getState().clearCallState();
          return;
        }
        // Seed participant profiles from the enriched call response so
        // GroupVideoLayout can resolve names/avatars without extra fetches.
        const presenceStore = usePresenceStore.getState();
        for (const p of call.participants ?? []) {
          if (p.displayName || p.avatarUrl) {
            presenceStore.setUserProfile(p.userId, {
              displayName: p.displayName ?? null,
              avatarMediaId: null,
              avatarUrl: p.avatarUrl ?? null,
            });
          }
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
      caller: { id: string; name: string; avatar: string };
      calleeIds: string[];
      /** Enriched profiles for all callees — added by BE so we don't need extra fetches */
      calleeProfiles?: Array<{ id: string; name: string; avatar: string }>;
      startedAt: string;
    }) => {
      // Ignore calls we initiated ourselves
      if (data.caller.id === myId) return;

      const socket = getCallSocket();
      socket.emit("call:join_room", { callId: data.callId });

      setIncomingCall({
        id: data.callId,
        conversationId: data.conversationId,
        callerId: data.caller.id,
        calleeIds: data.calleeIds ?? [],
        status: "RINGING",
        createdAt: data.startedAt,
        startedAt: data.startedAt,
        endedAt: null,
        participants: [],
      });

      const isGroup = (data.calleeIds?.length ?? 0) > 1 || (data.calleeProfiles?.length ?? 0) > 1;
      if (isGroup) {
        setGroupCall(data.conversationId, {
          callId: data.callId,
          conversationId: data.conversationId,
          callerId: data.caller.id,
          status: "RINGING",
          participantIds: [data.caller.id],
          startedAt: data.startedAt,
        });
      } else {
        setGroupCall(data.conversationId, null);
        setDeclinedGroupCall(null);
        getInstantCallById(data.callId)
          .then((call) => {
            if (!isGroupInstantCall(call)) return;
            setGroupCall(data.conversationId, {
              callId: data.callId,
              conversationId: data.conversationId,
              callerId: data.caller.id,
              status: call?.status === "ACTIVE" ? "ACTIVE" : "RINGING",
              participantIds: Array.from(
                new Set([
                  data.caller.id,
                  ...(call?.participants ?? [])
                    .filter((p) => p.joinedAt !== null)
                    .map((p) => p.userId),
                ]),
              ),
              startedAt: data.startedAt,
            });
          })
          .catch(() => {});
      }

      const store = usePresenceStore.getState();
      // Seed caller profile from the enriched payload — no extra fetch needed.
      store.setUserProfile(data.caller.id, {
        displayName: data.caller.name,
        avatarMediaId: null,
        avatarUrl: data.caller.avatar,
      });
      // Seed all callee profiles so GroupVideoLayout can resolve names/avatars.
      for (const p of data.calleeProfiles ?? []) {
        store.setUserProfile(p.id, {
          displayName: p.name,
          avatarMediaId: null,
          avatarUrl: p.avatar,
        });
      }
    },
    [myId, setIncomingCall, setGroupCall, setDeclinedGroupCall]
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
      /** Enriched callee profile — added by BE so we don't need an extra /users fetch */
      callee?: { id: string; name: string; avatar: string };
      acceptedAt: string;
    }) => {
      stopAllAudio();
      addGroupCallParticipant(data.conversationId, data.calleeId);

      // Seed the accepting callee's profile so GroupVideoLayout shows the right name/avatar.
      if (data.callee) {
        usePresenceStore.getState().setUserProfile(data.callee.id, {
          displayName: data.callee.name,
          avatarMediaId: null,
          avatarUrl: data.callee.avatar,
        });
      }

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
    [stopAllAudio, addGroupCallParticipant, setActiveCall, setOutgoingCall, setLiveKitCredentials, clearCallState]
  );

  // ─── call:declined ───────────────────────────────────────────────────────────
  const handleDeclined = useCallback(
    (data: {
      callId: string;
      conversationId: string;
      declinedBy: string;
      finalStatus: "REJECTED" | "RINGING" | "MISSED";
      declinedAt: string;
    }) => {
      // Group call: one callee declined but others can still accept — keep state alive.
      if (data.finalStatus === "RINGING") {
        return;
      }

      // Guard: if we already cleared state optimistically (i.e. the local user
      // initiated the decline/cancel), ignore this WS echo — we don't want to
      // flash a "Call declined" toast to the person who just clicked Decline.
      const { incomingCall, outgoingCall, activeCall } = useCallStore.getState();
      const isCurrentCall =
        incomingCall?.id === data.callId ||
        outgoingCall?.id === data.callId ||
        activeCall?.id === data.callId;
      if (!isCurrentCall) return;

      stopAllAudio();

      // Clear any pending re-join opportunity since the call is now fully rejected.
      useCallStore.getState().setGroupCall(data.conversationId, null);
      useCallStore.getState().setDeclinedGroupCall(null);
      getCallSocket().emit("call:leave_room", { callId: data.callId });
      clearCallState();
      // Do not show a local toast — the backend emits a system message via
      // message:new which is the authoritative record shown in the conversation.
    },
    [stopAllAudio, clearCallState]
  );

  // ─── call:ended ──────────────────────────────────────────────────────────────
  const handleEnded = useCallback(
    (data: {
      callId: string;
      conversationId: string;
      endedBy: string;
      endReason: string;
      durationMs: number;
      endedAt: string;
    }) => {
      const state = useCallStore.getState();
      const groupEntry = Object.values(state.groupCallsByConversation)
        .find((e) => e.callId === data.callId);
      const isCurrentCall =
        state.incomingCall?.id === data.callId ||
        state.outgoingCall?.id === data.callId ||
        state.activeCall?.id === data.callId;

      // Clear the group call banner — the call is over for everyone.
      if (groupEntry) state.setGroupCall(groupEntry.conversationId, null);
      state.setGroupCall(data.conversationId, null);

      // NOTE: do NOT clear declinedGroupCall here. If the user intentionally
      // left a group call (Leave button), declinedGroupCall is their only
      // re-join anchor. They will discover the call ended when they try to
      // join and the API returns a non-active status (which clears it then).

      // Guard: if we already cleared state optimistically (i.e. the local user
      // clicked End Call), ignore this WS echo to avoid a double-toast. For a
      // remote caller cancellation while ringing, incomingCall is the matching UI.
      if (!isCurrentCall) return;

      stopAllAudio();

      const socket = getCallSocket();
      socket.emit("call:leave_room", { callId: data.callId });

      clearCallState();
      // Do not show a local toast — the backend emits a system message via
      // message:new which is the authoritative record shown in the conversation.
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
