"use client";

import { useCallStore } from "@/stores/callStore";
import { ActiveCallModal } from "./ActiveCallModal";
import { IncomingCallModal } from "./IncomingCallModal";
import { OutgoingCallModal } from "./OutgoingCallModal";

export function DraggableCallModal() {
  const incomingCall = useCallStore((s) => s.incomingCall);
  const outgoingCall = useCallStore((s) => s.outgoingCall);
  const activeCall = useCallStore((s) => s.activeCall);

  if (!incomingCall && !outgoingCall && !activeCall) return null;

  return (
    <>
      {activeCall && <ActiveCallModal />}
      {outgoingCall && !activeCall && <OutgoingCallModal />}
      {incomingCall && !activeCall && <IncomingCallModal />}
    </>
  );
}
