"use client";

import { Phone, PhoneOff, X } from "lucide-react";
import { useCallStore } from "@/stores/callStore";
import { useRouter } from "next/navigation";

export function CallBar() {
  const { activeMeetingId, livekitToken, endCall } = useCallStore();
  const router = useRouter();

  if (!activeMeetingId) return null;

  // Already in call → "Return"; not yet joined → "Join"
  const isInCall = !!livekitToken;

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-success/10 border-b border-success/20 shrink-0">
      <div className="flex items-center gap-2 text-sm text-success font-medium">
        <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
        Call in progress
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => router.push(`/calls/${activeMeetingId}`)}
          className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-success text-white text-xs font-semibold hover:opacity-90 transition cursor-pointer"
        >
          <Phone className="w-3 h-3" />
          {isInCall ? "Return" : "Join"}
        </button>
        {!isInCall && (
          <button
            onClick={endCall}
            className="w-6 h-6 rounded-lg flex items-center justify-center text-muted hover:text-error hover:bg-error/10 transition cursor-pointer"
            title="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        {isInCall && (
          <button
            onClick={endCall}
            className="w-6 h-6 rounded-lg flex items-center justify-center text-muted hover:text-error hover:bg-error/10 transition cursor-pointer"
            title="Leave call"
          >
            <PhoneOff className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
