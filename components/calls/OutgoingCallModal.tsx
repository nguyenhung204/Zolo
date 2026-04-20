"use client";

import { useRef } from "react";
import { PhoneMissed } from "lucide-react";
import { toast } from "sonner";
import { useCallStore } from "@/stores/callStore";
import { usePresenceStore } from "@/stores/presenceStore";
import { UserAvatar } from "@/components/presence/UserAvatar";
import { endInstantCall } from "@/lib/api/calls";
import { getCallSocket } from "@/lib/socket/socket";
import { resolveDisplayName, resolveAvatarUrl, is409 } from "./call-utils";

export function OutgoingCallModal() {
  const { outgoingCall, clearCallState } = useCallStore();
  const profileMap = usePresenceStore((s) => s.profileMap);
  const isBusyRef = useRef(false);

  if (!outgoingCall) return null;

  const calleeId =
    (outgoingCall.participants ?? []).find((p) => p.role === "CALLEE")?.userId ?? "";
  const calleeName = resolveDisplayName(calleeId, profileMap);
  const calleeAvatar = resolveAvatarUrl(calleeId, profileMap);

  const handleCancel = () => {
    if (isBusyRef.current) return;
    isBusyRef.current = true;

    // Optimistic: immediately close the modal — don't block on the network.
    const callId = outgoingCall.id;
    getCallSocket().emit("call:leave_room", { callId });
    clearCallState();

    // Fire-and-forget: inform the server in the background.
    endInstantCall(callId).catch((err) => {
      if (!is409(err)) toast.error("Failed to cancel.");
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
        aria-label="Outgoing call"
        aria-modal="true"
      >
        <div className="relative">
          <UserAvatar
            userId={calleeId}
            name={calleeName}
            avatarUrl={calleeAvatar}
            size="lg"
            showPresence={false}
          />
          <span className="absolute inset-0 rounded-full animate-ping bg-white/20" />
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-white">{calleeName}</p>
          <p className="mt-1 text-sm text-white/50 animate-pulse">Calling…</p>
        </div>
        <button
          onClick={handleCancel}
          aria-label="Cancel call"
          className="mt-2 w-14 h-14 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer hover:brightness-90"
          style={{ background: "#DC2626" }}
        >
          <PhoneMissed className="w-6 h-6 text-white" />
        </button>
      </div>
    </div>
  );
}
