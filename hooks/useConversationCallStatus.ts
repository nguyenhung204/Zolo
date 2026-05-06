"use client";

import { useEffect, useRef } from "react";
import { useCallStore } from "@/stores/callStore";
import { getInstantCallById, isGroupInstantCall } from "@/lib/api/calls";
import { getCallSocket } from "@/lib/socket/socket";

/**
 * Mount inside a conversation page.
 *
 * On mount:
 * 1. If there's a persisted groupCallsByConversation entry for this conversation,
 *    validate it via GET /calls/:callId.
 *    - Still RINGING/ACTIVE → re-join the WS call room (so we receive call:ended)
 *    - Terminal / 404 → clear the stale entry
 * 2. Same check for declinedGroupCall (in case the user reloaded after declining).
 *
 * This ensures:
 * - Banner shows correctly after page reload
 * - Banner auto-clears if the call ended while the user was away
 * - The user can always re-join a still-active group call
 */
export function useConversationCallStatus(conversationId: string): void {
  const hasValidatedRef = useRef(false);

  useEffect(() => {
    if (hasValidatedRef.current) return;
    hasValidatedRef.current = true;

    const { groupCallsByConversation, declinedGroupCall, setGroupCall, setDeclinedGroupCall } =
      useCallStore.getState();

    const entry = groupCallsByConversation[conversationId];
    const declined =
      declinedGroupCall?.conversationId === conversationId ? declinedGroupCall : null;

    // Determine which callId to validate (prefer the richer `entry`)
    const callIdToCheck = entry?.callId ?? declined?.callId;
    if (!callIdToCheck) return;

    getInstantCallById(callIdToCheck)
      .then((call) => {
        if (
          !call ||
          !isGroupInstantCall(call) ||
          call.status === "ENDED" ||
          call.status === "REJECTED" ||
          call.status === "MISSED"
        ) {
          // Call is over — clear stale state
          if (entry) setGroupCall(conversationId, null);
          if (declined) setDeclinedGroupCall(null);
          return;
        }

        // Call is still live (RINGING or ACTIVE).
        // If we have a group call entry, ensure it's up-to-date with the latest status.
        if (entry) {
          // Refresh participant list from the call record
          const participantIds = call.participants
            .filter((p) => p.joinedAt !== null)
            .map((p) => p.userId);
          // Always include callerId (they're always "in" from the start)
          const merged = Array.from(new Set([call.callerId, ...participantIds]));
          setGroupCall(conversationId, {
            ...entry,
            status: call.status as "RINGING" | "ACTIVE",
            participantIds: merged,
          });
        } else if (declined) {
          // Persisted declinedGroupCall but no banner entry (e.g. banner was
          // never seeded or was cleared). Re-create a minimal entry so the
          // banner shows again.
          const participantIds = call.participants
            .filter((p) => p.joinedAt !== null)
            .map((p) => p.userId);
          const merged = Array.from(new Set([call.callerId, ...participantIds]));
          setGroupCall(conversationId, {
            callId: call.id,
            conversationId,
            callerId: call.callerId,
            status: call.status as "RINGING" | "ACTIVE",
            participantIds: merged,
            startedAt: call.startedAt,
          });
        }

        // Re-subscribe to the call WS room so call:ended clears the banner.
        // This is safe to call even if already subscribed — idempotent on server.
        const socket = getCallSocket();
        if (socket.connected) {
          socket.emit("call:join_room", { callId: callIdToCheck });
        } else {
          socket.once("connect", () => {
            socket.emit("call:join_room", { callId: callIdToCheck });
          });
        }
      })
      .catch(() => {
        // Network error or 404 — clear stale state to avoid a ghost banner.
        if (entry) setGroupCall(conversationId, null);
        if (declined) setDeclinedGroupCall(null);
      });

    // Re-run if the conversationId changes (user navigates to a different conversation).
    // Reset the guard so the new conversation is also validated.
    return () => {
      hasValidatedRef.current = false;
    };
  }, [conversationId]);
}
