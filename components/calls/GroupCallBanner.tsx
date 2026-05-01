"use client";

import { useRef, useState } from "react";
import { Phone, PhoneCall, Users } from "lucide-react";
import { toast } from "sonner";
import { useCallStore } from "@/stores/callStore";
import { usePresenceStore } from "@/stores/presenceStore";
import { useAuthStore } from "@/stores/authStore";
import { UserAvatar } from "@/components/presence/UserAvatar";
import { acceptInstantCall, getInstantCallById, getInstantCallToken } from "@/lib/api/calls";
import { getCallSocket } from "@/lib/socket/socket";

interface GroupCallBannerProps {
  conversationId: string;
}

const MAX_VISIBLE_AVATARS = 5;

/**
 * Centered system-message card shown when a group call is active.
 * Styled like a chat system event (e.g. Telegram/Messenger call card).
 * Hidden when the current user is already in the call.
 */
export function GroupCallBanner({ conversationId }: GroupCallBannerProps) {
  const groupCall = useCallStore((s) => s.groupCallsByConversation[conversationId]);
  const activeCall = useCallStore((s) => s.activeCall);
  const { setActiveCall, setLiveKitCredentials, setGroupCall, setDeclinedGroupCall } =
    useCallStore();
  const profileMap = usePresenceStore((s) => s.profileMap);
  const myId = useAuthStore((s) => s.user?.id);
  const isBusyRef = useRef(false);
  const [joining, setJoining] = useState(false);

  if (!groupCall) return null;
  if (groupCall.status !== "ACTIVE") return null;

  // Don't show the banner if the user is already in this call
  if (activeCall?.id === groupCall.callId) return null;

  const participantIds = groupCall.participantIds;
  const visible = participantIds.slice(0, MAX_VISIBLE_AVATARS);
  const overflow = participantIds.length - MAX_VISIBLE_AVATARS;

  const handleJoin = async () => {
    if (isBusyRef.current) return;
    isBusyRef.current = true;
    setJoining(true);
    try {
      const call = await getInstantCallById(groupCall.callId);
      if (!call || (call.status !== "ACTIVE" && call.status !== "RINGING")) {
        toast.info("The call has already ended.");
        setGroupCall(conversationId, null);
        return;
      }
      getCallSocket().emit("call:join_room", { callId: call.id });
      setDeclinedGroupCall(null);

      if (call.status === "ACTIVE") {
        const creds = await getInstantCallToken(call.id);
        setActiveCall(call);
        setLiveKitCredentials(creds);
      } else {
        const res = await acceptInstantCall(call.id);
        setActiveCall(res.call);
        setLiveKitCredentials({
          token: res.token,
          roomName: res.roomName,
          livekitUrl: res.livekitUrl,
        });
      }
    } catch {
      toast.error("Could not join the call.");
    } finally {
      isBusyRef.current = false;
      setJoining(false);
    }
  };

  const statusLabel = "Cuộc gọi nhóm đang diễn ra";
  const participantCount = participantIds.length;

  return (
    /* Outer wrapper: full-width row so the card can be centered */
    <div className="flex justify-center px-4 py-3 pointer-events-none">
      <div
        className="pointer-events-auto flex flex-col items-center gap-3 w-full max-w-[320px] rounded-2xl px-5 py-4 select-none"
        style={{
          background: "var(--color-surface, #1e2535)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 2px 16px rgba(0,0,0,0.18)",
        }}
      >
        {/* Icon + status */}
        <div className="flex flex-col items-center gap-1.5">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: "rgba(34,197,94,0.15)" }}
          >
            <PhoneCall
              className="w-5 h-5"
              style={{ color: "#22c55e" }}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="relative flex h-2 w-2 shrink-0"
            >
              <span
                className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
                style={{ background: "#22c55e" }}
              />
              <span
                className="relative inline-flex rounded-full h-2 w-2"
                style={{ background: "#22c55e" }}
              />
            </span>
            <span
              className="text-xs font-semibold"
              style={{ color: "#86efac" }}
            >
              {statusLabel}
            </span>
          </div>
        </div>

        {/* Participant avatars */}
        {participantCount > 0 && (
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center">
              {visible.map((uid, i) => {
                const profile = profileMap[uid];
                return (
                  <div
                    key={uid}
                    className="shrink-0 rounded-full"
                    style={{
                      marginLeft: i === 0 ? 0 : -10,
                      zIndex: visible.length - i,
                      outline: "2px solid var(--color-surface, #1e2535)",
                      lineHeight: 0,
                    }}
                    title={profile?.displayName ?? uid}
                  >
                    <UserAvatar
                      userId={uid}
                      name={profile?.displayName ?? ""}
                      avatarUrl={profile?.avatarUrl}
                      size="sm"
                      showPresence={false}
                    />
                  </div>
                );
              })}
              {overflow > 0 && (
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[11px] font-semibold text-white/60"
                  style={{
                    marginLeft: -10,
                    background: "rgba(255,255,255,0.08)",
                    outline: "2px solid var(--color-surface, #1e2535)",
                  }}
                >
                  +{overflow}
                </div>
              )}
            </div>
            <p className="text-[11px] text-white/40">
              {participantCount === 1
                ? (profileMap[participantIds[0]]?.displayName ?? "1 người") + " đang trong cuộc gọi"
                : `${participantCount} người đang trong cuộc gọi`}
            </p>
          </div>
        )}

        {/* Join button */}
        <button
          onClick={handleJoin}
          disabled={joining}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm text-white transition-all duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          style={{
            background: joining
              ? "rgba(34,197,94,0.35)"
              : "linear-gradient(135deg, #16a34a 0%, #15803d 100%)",
            boxShadow: joining ? "none" : "0 2px 10px rgba(34,197,94,0.3)",
          }}
        >
          <Phone className="w-4 h-4" />
          {joining ? "Đang tham gia…" : "Tham gia cuộc gọi"}
        </button>
      </div>
    </div>
  );
}
