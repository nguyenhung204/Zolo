"use client";

import { useRef } from "react";
import { Phone, PhoneOff } from "lucide-react";
import { toast } from "sonner";
import { useCallStore } from "@/stores/callStore";
import { usePresenceStore } from "@/stores/presenceStore";
import { UserAvatar } from "@/components/presence/UserAvatar";
import { acceptInstantCall, declineInstantCall } from "@/lib/api/calls";
import { getCallSocket } from "@/lib/socket/socket";
import { resolveDisplayName, resolveAvatarUrl, is409, get409Code } from "./call-utils";

export function IncomingCallModal() {
  const { incomingCall, setActiveCall, setLiveKitCredentials, clearCallState } =
    useCallStore();
  const profileMap = usePresenceStore((s) => s.profileMap);
  const isBusyRef = useRef(false);

  if (!incomingCall) return null;

  const callerName = resolveDisplayName(incomingCall.callerId, profileMap);
  const callerAvatar = resolveAvatarUrl(incomingCall.callerId, profileMap);

  const handleAccept = async () => {
    if (isBusyRef.current) return;
    isBusyRef.current = true;

    // Optimistic: immediately transition to "connecting" UI and stop the
    // ringtone *before* awaiting the network round-trip.
    const callId = incomingCall.id;
    const optimisticCall = { ...incomingCall, status: "ACTIVE" as const };
    useCallStore.setState({ incomingCall: null, activeCall: optimisticCall });

    try {
      const res = await acceptInstantCall(callId);
      setActiveCall(res.call);
      setLiveKitCredentials({
        token: res.token,
        roomName: res.roomName,
        livekitUrl: res.livekitUrl,
      });
    } catch (err) {
      toast.error(
        is409(err) && get409Code(err) === "CALL_NO_LONGER_RINGING"
          ? "The call is no longer available."
          : "Could not accept the call."
      );
      clearCallState();
    } finally {
      isBusyRef.current = false;
    }
  };

  const handleDecline = () => {
    if (isBusyRef.current) return;
    isBusyRef.current = true;

    // Optimistic: immediately close the modal — don't wait for the network.
    const callId = incomingCall.id;
    getCallSocket().emit("call:leave_room", { callId });
    clearCallState();

    // Fire-and-forget: inform the server in the background.
    declineInstantCall(callId).catch((err) => {
      if (!is409(err)) toast.error("Failed to decline.");
    });

    isBusyRef.current = false;
  };

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center pointer-events-none">
      <div
        className="pointer-events-auto flex flex-col items-center gap-6 px-8 py-10"
        style={{
          width: 300,
          background: "#0F172A",
          borderRadius: 16,
          boxShadow: "0 10px 15px rgba(0,0,0,0.25)",
          fontFamily: "var(--font-jakarta, 'Plus Jakarta Sans', sans-serif)",
        }}
        role="dialog"
        aria-label="Incoming call"
        aria-modal="true"
      >
        <div className="relative">
          <UserAvatar
            userId={incomingCall.callerId}
            name={callerName}
            avatarUrl={callerAvatar}
            size="lg"
            showPresence={false}
          />
          <span className="absolute inset-0 rounded-full animate-ping bg-white/20" />
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-white">{callerName}</p>
          <p className="mt-1 text-sm text-white/50 animate-pulse">Incoming call…</p>
        </div>
        <div className="flex items-center gap-8 mt-2">
          <button
            onClick={handleDecline}
            aria-label="Decline"
            className="w-14 h-14 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer hover:brightness-90"
            style={{ background: "#DC2626" }}
          >
            <PhoneOff className="w-6 h-6 text-white" />
          </button>
          <button
            onClick={handleAccept}
            aria-label="Accept"
            className="w-14 h-14 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer hover:brightness-90"
            style={{ background: "#0369A1" }}
          >
            <Phone className="w-6 h-6 text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}
