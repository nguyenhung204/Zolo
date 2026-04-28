"use client";

import { useRef } from "react";
import { PhoneMissed, Users } from "lucide-react";
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

  const calleeIds = (outgoingCall.participants ?? [])
    .filter((p) => p.role === "CALLEE")
    .map((p) => p.userId);

  // Fall back to stored calleeIds if participants haven't populated yet
  const resolvedCalleeIds =
    calleeIds.length > 0 ? calleeIds : (outgoingCall.calleeIds ?? []);

  const isGroup = resolvedCalleeIds.length > 1;

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
        {isGroup ? (
          <GroupCalleeAvatars calleeIds={resolvedCalleeIds} profileMap={profileMap} />
        ) : (
          <SingleCalleeAvatar
            calleeId={resolvedCalleeIds[0] ?? ""}
            profileMap={profileMap}
          />
        )}
        <div className="text-center">
          <p className="text-lg font-semibold text-white">
            {isGroup
              ? `Group Call (${resolvedCalleeIds.length} people)`
              : resolveDisplayName(resolvedCalleeIds[0] ?? "", profileMap)}
          </p>
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

function SingleCalleeAvatar({
  calleeId,
  profileMap,
}: {
  calleeId: string;
  profileMap: ReturnType<typeof usePresenceStore.getState>["profileMap"];
}) {
  return (
    <div className="relative">
      <UserAvatar
        userId={calleeId}
        name={resolveDisplayName(calleeId, profileMap)}
        avatarUrl={resolveAvatarUrl(calleeId, profileMap)}
        size="lg"
        showPresence={false}
      />
      <span className="absolute inset-0 rounded-full animate-ping bg-white/20" />
    </div>
  );
}

const MAX_VISIBLE = 3;

function GroupCalleeAvatars({
  calleeIds,
  profileMap,
}: {
  calleeIds: string[];
  profileMap: ReturnType<typeof usePresenceStore.getState>["profileMap"];
}) {
  const visible = calleeIds.slice(0, MAX_VISIBLE);
  const overflow = calleeIds.length - MAX_VISIBLE;

  return (
    <div className="relative flex items-center justify-center">
      <div className="flex -space-x-3">
        {visible.map((id) => (
          <div key={id} className="relative ring-2 ring-[#0F172A] rounded-full">
            <UserAvatar
              userId={id}
              name={resolveDisplayName(id, profileMap)}
              avatarUrl={resolveAvatarUrl(id, profileMap)}
              size="md"
              showPresence={false}
            />
          </div>
        ))}
        {overflow > 0 && (
          <div
            className="w-10 h-10 rounded-full ring-2 ring-[#0F172A] bg-white/10 flex items-center justify-center"
          >
            <span className="text-xs font-semibold text-white/70">+{overflow}</span>
          </div>
        )}
      </div>
      <Users className="absolute -bottom-1 -right-1 w-4 h-4 text-white/50 bg-[#0F172A] rounded-full p-0.5" />
    </div>
  );
}
