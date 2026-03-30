"use client";

import { use, useEffect } from "react";
import { useCall } from "@/hooks/useCall";
import { useCallStore } from "@/stores/callStore";
import { Loader2, PhoneOff, Mic, MicOff, Video, VideoOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/authStore";

interface Props {
  params: Promise<{ id: string }>;
}

export default function CallPage({ params }: Props) {
  const { id: meetingId } = use(params);
  const router = useRouter();
  const { fetchToken, leave, isConnecting, approve } = useCall();
  const { livekitToken, myMedia, updateMyMedia, waitingParticipants } = useCallStore();
  const userId = useAuthStore((s) => s.user?.id ?? "");

  useEffect(() => {
    fetchToken(meetingId);
  }, [meetingId, fetchToken]);

  const handleLeave = async () => {
    await leave();
    router.back();
  };

  if (isConnecting || !livekitToken) {
    return (
      <div className="flex h-full items-center justify-center flex-col gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-muted" />
        <p className="text-sm text-muted">Connecting to call…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-primary text-white">
      {/* Waiting room banner */}
      {waitingParticipants.length > 0 && (
        <div className="bg-warning/20 border-b border-warning/30 px-6 py-3 flex items-center justify-between shrink-0">
          <span className="text-sm font-medium text-warning">
            {waitingParticipants.length} participant{waitingParticipants.length > 1 ? "s" : ""} waiting
          </span>
          <div className="flex gap-2">
            {waitingParticipants.map((uid) => (
              <button
                key={uid}
                onClick={() => approve(uid)}
                className="px-3 py-1 rounded-lg bg-warning text-primary text-xs font-semibold hover:opacity-90 cursor-pointer"
              >
                Admit {uid}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Video grid placeholder (LiveKit embed would go here) */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center mx-auto">
            <Video className="w-10 h-10 text-white/60" />
          </div>
          <p className="text-sm text-white/60">
            LiveKit room: {meetingId}
          </p>
          <p className="text-xs text-white/40">
            Token ready — connect @livekit/components-react here
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="shrink-0 flex items-center justify-center gap-4 py-6 border-t border-white/10">
        <ControlButton
          active={myMedia.micOn}
          onIcon={<Mic className="w-5 h-5" />}
          offIcon={<MicOff className="w-5 h-5" />}
          onClick={() => updateMyMedia({ micOn: !myMedia.micOn })}
          title={myMedia.micOn ? "Mute" : "Unmute"}
        />
        <ControlButton
          active={myMedia.cameraOn}
          onIcon={<Video className="w-5 h-5" />}
          offIcon={<VideoOff className="w-5 h-5" />}
          onClick={() => updateMyMedia({ cameraOn: !myMedia.cameraOn })}
          title={myMedia.cameraOn ? "Camera off" : "Camera on"}
        />
        <button
          onClick={handleLeave}
          className="w-12 h-12 rounded-full bg-error flex items-center justify-center text-white hover:opacity-90 transition cursor-pointer"
          title="Leave call"
        >
          <PhoneOff className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

function ControlButton({
  active,
  onIcon,
  offIcon,
  onClick,
  title,
}: {
  active: boolean;
  onIcon: React.ReactNode;
  offIcon: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-12 h-12 rounded-full flex items-center justify-center transition cursor-pointer ${
        active ? "bg-white/20 hover:bg-white/30" : "bg-white/10 hover:bg-white/15"
      }`}
    >
      {active ? onIcon : offIcon}
    </button>
  );
}
