"use client";

import { useCallStore } from "@/stores/callStore";
import { ActiveCallModal } from "./ActiveCallModal";
import { IncomingCallModal } from "./IncomingCallModal";
import { OutgoingCallModal } from "./OutgoingCallModal";

function ConnectingOverlay() {
  return (
    <div className="fixed z-[9999] flex items-center justify-center" style={{
      bottom: 24, right: 24, width: 220, height: 64,
      background: "#0F172A", borderRadius: 14,
      boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
      fontFamily: "var(--font-jakarta, 'Plus Jakarta Sans', sans-serif)",
    }}>
      <span className="text-xs text-white/50 animate-pulse">Connecting to call…</span>
    </div>
  );
}

export function DraggableCallModal() {
  const incomingCall = useCallStore((s) => s.incomingCall);
  const outgoingCall = useCallStore((s) => s.outgoingCall);
  const activeCall = useCallStore((s) => s.activeCall);
  const hasJoinedCall = useCallStore((s) => s.hasJoinedCall);

  if (!incomingCall && !outgoingCall && !activeCall) return null;

  return (
    <>
      {activeCall && hasJoinedCall && <ActiveCallModal />}
      {activeCall && !hasJoinedCall && <ConnectingOverlay />}
      {outgoingCall && !activeCall && <OutgoingCallModal />}
      {incomingCall && !activeCall && <IncomingCallModal />}
    </>
  );
}
