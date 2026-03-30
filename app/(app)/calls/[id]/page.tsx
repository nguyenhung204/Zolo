"use client";

import { use, useEffect, useRef } from "react";
import { useCall } from "@/hooks/useCall";
import { useCallStore } from "@/stores/callStore";
import { useAuthStore } from "@/stores/authStore";
import { useRouter } from "next/navigation";
import {
  Loader2,
  PhoneOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  MonitorOff,
  Clock,
  Check,
  X,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  params: Promise<{ id: string }>;
}

export default function CallPage({ params }: Props) {
  const { id: meetingId } = use(params);
  const router = useRouter();
  const { joinMeeting, leave, end, approve, reject, syncMediaState, isConnecting, error } =
    useCall();

  const {
    livekitToken,
    livekitUrl,
    myMedia,
    participants,
    waitingParticipants,
    hostId,
    isWaiting,
    activeMeetingId,
  } = useCallStore();

  const userId = useAuthStore((s) => s.user?.id ?? "");
  const isHost = hostId === userId;

  // Join the meeting as soon as the page mounts
  const joinedRef = useRef(false);
  useEffect(() => {
    if (joinedRef.current) return;
    joinedRef.current = true;
    // If we already have a token (started the call from ConversationHeader), skip join
    if (activeMeetingId === meetingId && livekitToken) return;
    joinMeeting(meetingId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  const handleLeave = async () => {
    await leave();
    router.back();
  };

  const handleEnd = async () => {
    await end();
    router.back();
  };

  // ─── Waiting room screen ───────────────────────────────────────────────────
  if (isWaiting) {
    return (
      <div className="flex flex-col h-full bg-primary items-center justify-center gap-6 text-white">
        <Clock className="w-12 h-12 text-white/60 animate-pulse" />
        <div className="text-center space-y-2">
          <p className="text-lg font-semibold">Waiting to be admitted</p>
          <p className="text-sm text-white/60">The host will let you in soon</p>
        </div>
        <button
          onClick={handleLeave}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-medium transition cursor-pointer"
        >
          <X className="w-4 h-4" />
          Cancel
        </button>
      </div>
    );
  }

  // ─── Connecting / fetching token ───────────────────────────────────────────
  if (isConnecting || (!livekitToken && !error)) {
    return (
      <div className="flex h-full items-center justify-center flex-col gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-muted" />
        <p className="text-sm text-muted">Connecting to call…</p>
      </div>
    );
  }

  // ─── Error state ───────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex h-full items-center justify-center flex-col gap-4">
        <p className="text-sm text-error font-medium">{error}</p>
        <button
          onClick={() => router.back()}
          className="px-4 py-2 rounded-xl bg-border text-sm font-medium hover:bg-border/70 transition cursor-pointer"
        >
          Go back
        </button>
      </div>
    );
  }

  // ─── Main call UI ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-[#1a1a2e] text-white overflow-hidden">

      {/* Waiting room banner for host */}
      {isHost && waitingParticipants.length > 0 && (
        <div className="bg-warning/20 border-b border-warning/30 px-6 py-3 flex items-center justify-between shrink-0">
          <span className="text-sm font-medium text-warning">
            {waitingParticipants.length} participant
            {waitingParticipants.length > 1 ? "s" : ""} waiting to join
          </span>
          <div className="flex gap-2 flex-wrap">
            {waitingParticipants.map((uid) => (
              <div key={uid} className="flex items-center gap-1">
                <span className="text-xs text-warning/80">
                  {uid.slice(0, 8)}…
                </span>
                <button
                  onClick={() => approve(uid)}
                  className="p-1 rounded-md bg-success text-white hover:opacity-90 transition cursor-pointer"
                  title="Admit"
                >
                  <Check className="w-3 h-3" />
                </button>
                <button
                  onClick={() => reject(uid)}
                  className="p-1 rounded-md bg-error text-white hover:opacity-90 transition cursor-pointer"
                  title="Reject"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Participant grid */}
      <div className="flex-1 p-4 overflow-auto">
        <div
          className={cn(
            "grid gap-3 h-full",
            participants.length <= 1 && "grid-cols-1",
            participants.length === 2 && "grid-cols-2",
            participants.length >= 3 && "grid-cols-2 md:grid-cols-3",
          )}
        >
          {/* Self tile */}
          <ParticipantTile
            userId={userId}
            isSelf
            micOn={myMedia.micOn}
            cameraOn={myMedia.cameraOn}
            isHost={isHost}
          />
          {/* Other participants */}
          {participants
            .filter((p) => p.userId !== userId)
            .map((p) => (
              <ParticipantTile
                key={p.userId}
                userId={p.userId}
                micOn={p.micOn}
                cameraOn={p.cameraOn}
                isHost={p.userId === hostId}
              />
            ))}
        </div>
      </div>

      {/* LiveKit integration point */}
      {/* 
        When @livekit/components-react is installed:
          import { LiveKitRoom, VideoConference } from "@livekit/components-react";
          <LiveKitRoom serverUrl={livekitUrl} token={livekitToken} connect>
            <VideoConference />
          </LiveKitRoom>
        Replace the grid above with the LiveKitRoom component.
        livekitToken and livekitUrl are available from callStore.
      */}

      {/* Info bar */}
      <div className="flex items-center justify-between px-6 py-2 bg-white/5 text-xs text-white/50 shrink-0">
        <span className="flex items-center gap-1.5">
          <Users className="w-3 h-3" />
          {participants.length + 1} in call
          {livekitUrl && (
            <span className="ml-3 truncate max-w-50">
              Connected to LiveKit · room: {meetingId.slice(0, 8)}…
            </span>
          )}
        </span>
      </div>

      {/* Controls bar */}
      <div className="shrink-0 flex items-center justify-center gap-3 py-5 border-t border-white/10 bg-white/5">
        {/* Mic */}
        <ControlButton
          active={myMedia.micOn}
          onIcon={<Mic className="w-5 h-5" />}
          offIcon={<MicOff className="w-5 h-5" />}
          onClick={() => syncMediaState({ ...myMedia, micOn: !myMedia.micOn })}
          title={myMedia.micOn ? "Mute" : "Unmute"}
        />
        {/* Camera */}
        <ControlButton
          active={myMedia.cameraOn}
          onIcon={<Video className="w-5 h-5" />}
          offIcon={<VideoOff className="w-5 h-5" />}
          onClick={() => syncMediaState({ ...myMedia, cameraOn: !myMedia.cameraOn })}
          title={myMedia.cameraOn ? "Camera off" : "Camera on"}
        />
        {/* Screen share */}
        <ControlButton
          active={myMedia.screenSharing}
          onIcon={<Monitor className="w-5 h-5" />}
          offIcon={<MonitorOff className="w-5 h-5" />}
          onClick={() => syncMediaState({ ...myMedia, screenSharing: !myMedia.screenSharing })}
          title={myMedia.screenSharing ? "Stop sharing" : "Share screen"}
        />

        {/* Spacer */}
        <div className="w-px h-8 bg-white/20 mx-1" />

        {/* Leave */}
        <button
          onClick={handleLeave}
          className="w-12 h-12 rounded-full bg-error flex items-center justify-center text-white hover:opacity-90 transition cursor-pointer"
          title="Leave call"
        >
          <PhoneOff className="w-5 h-5" />
        </button>

        {/* End (host only) */}
        {isHost && (
          <button
            onClick={handleEnd}
            className="px-4 h-12 rounded-full bg-error/80 text-white text-sm font-semibold hover:bg-error transition cursor-pointer"
            title="End call for everyone"
          >
            End for all
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ParticipantTile({
  userId,
  isSelf,
  micOn,
  cameraOn,
  isHost,
}: {
  userId: string;
  isSelf?: boolean;
  micOn: boolean;
  cameraOn: boolean;
  isHost: boolean;
}) {
  return (
    <div className="relative rounded-2xl bg-white/5 border border-white/10 overflow-hidden flex flex-col items-center justify-center min-h-35">
      {/* Avatar placeholder (replace with LiveKit VideoTrack) */}
      <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center text-xl font-bold text-white/60">
        {userId.slice(0, 2).toUpperCase()}
      </div>

      {/* Name + badges */}
      <div className="mt-2 flex items-center gap-1.5">
        <span className="text-xs text-white/80 max-w-25 truncate">
          {isSelf ? "You" : userId.slice(0, 10) + "…"}
        </span>
        {isHost && (
          <span className="text-[10px] px-1 rounded bg-warning/20 text-warning font-semibold">
            HOST
          </span>
        )}
      </div>

      {/* Media state indicators */}
      <div className="absolute bottom-2 right-2 flex gap-1">
        {!micOn && (
          <span className="w-5 h-5 rounded-full bg-error/80 flex items-center justify-center">
            <MicOff className="w-3 h-3 text-white" />
          </span>
        )}
        {!cameraOn && (
          <span className="w-5 h-5 rounded-full bg-black/40 flex items-center justify-center">
            <VideoOff className="w-3 h-3 text-white/60" />
          </span>
        )}
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
      className={cn(
        "w-12 h-12 rounded-full flex items-center justify-center transition cursor-pointer",
        active ? "bg-white/20 hover:bg-white/30" : "bg-white/10 hover:bg-white/15"
      )}
    >
      {active ? onIcon : offIcon}
    </button>
  );
}
