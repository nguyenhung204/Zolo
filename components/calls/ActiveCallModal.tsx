"use client";

import { useCallback, useRef, useState } from "react";
import {
  PhoneCall,
  PhoneOff,
  GripHorizontal,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { toast } from "sonner";
import {
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
  useTrackToggle,
  useRoomContext,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { useCallStore } from "@/stores/callStore";
import { useAuthStore } from "@/stores/authStore";
import { usePresenceStore } from "@/stores/presenceStore";
import { endInstantCall } from "@/lib/api/calls";
import { getCallSocket } from "@/lib/socket/socket";
import { MODAL_COMPACT, MODAL_EXPANDED, useDraggablePosition } from "./useDraggablePosition";
import { is409 } from "./call-utils";

// ─── 1:1 Video layout ─────────────────────────────────────────────────────────
interface VideoLayoutProps {
  remoteDisplayName: string;
  remoteAvatarUrl: string | null;
}

function VideoLayout({ remoteDisplayName, remoteAvatarUrl }: VideoLayoutProps) {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }],
    { onlySubscribed: false }
  );
  const { enabled: localCameraEnabled } = useTrackToggle({ source: Track.Source.Camera });
  const remoteTrack = tracks.find((t) => !t.participant.isLocal);
  const localTrack = tracks.find((t) => t.participant.isLocal);

  // Camera is live only when the track has an actual publication that is not muted
  const remoteHasLiveCamera =
    remoteTrack != null &&
    remoteTrack.publication != null &&
    !remoteTrack.publication.isMuted;

  const localHasLiveCamera =
    localCameraEnabled &&
    localTrack != null &&
    localTrack.publication != null &&
    !localTrack.publication.isMuted;

  return (
    <div className="relative w-full h-full bg-[#0a0f1a]">
      {/* Remote — video or avatar */}
      <div className="absolute inset-0 flex items-center justify-center">
        {remoteHasLiveCamera ? (
          <ParticipantTile
            trackRef={remoteTrack}
            disableSpeakingIndicator
            style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}
          />
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div
              className="rounded-full overflow-hidden ring-2 ring-white/20"
              style={{ width: 96, height: 96 }}
            >
              <img
                src={remoteAvatarUrl ?? "/user.webp"}
                alt={remoteDisplayName}
                className="w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).src = "/user.webp"; }}
              />
            </div>
            <span className="text-white/80 text-sm font-semibold tracking-wide">
              {remoteDisplayName}
            </span>
          </div>
        )}
      </div>

      {/* Local self-view PiP — only when camera is on */}
      {localHasLiveCamera && (
        <div
          className="absolute bottom-3 right-3 rounded-xl overflow-hidden z-10"
          style={{
            width: 88,
            height: 118,
            border: "2px solid rgba(255,255,255,0.18)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
          }}
        >
          <ParticipantTile
            trackRef={localTrack}
            disableSpeakingIndicator
            style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Group video layout (3+ participants) ─────────────────────────────────────
function GroupVideoLayout() {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }],
    { onlySubscribed: false }
  );
  const { enabled: localCameraEnabled } = useTrackToggle({ source: Track.Source.Camera });
  const profileMap = usePresenceStore((s) => s.profileMap);

  const remoteTracks = tracks.filter((t) => !t.participant.isLocal);
  const localTrack = tracks.find((t) => t.participant.isLocal);
  const localHasLiveCamera =
    localCameraEnabled && localTrack?.publication != null && !localTrack.publication.isMuted;

  const gridCols =
    remoteTracks.length === 1 ? "grid-cols-1" :
    remoteTracks.length <= 4 ? "grid-cols-2" : "grid-cols-3";

  return (
    <div className="relative w-full h-full bg-[#0a0f1a]">
      <div className={`w-full h-full grid gap-0.5 ${gridCols}`}>
        {remoteTracks.map((track) => {
          const hasLiveCamera = track.publication != null && !track.publication.isMuted;
          // track.participant.identity is the livekit participant identity (userId)
          const userId = track.participant.identity;
          const profile = profileMap[userId];
          const name = profile?.displayName ?? track.participant.name ?? userId;
          const initial = name.charAt(0).toUpperCase();

          return (
            <div
              key={track.participant.identity}
              className="relative bg-[#111827] flex items-center justify-center overflow-hidden"
            >
              {hasLiveCamera ? (
                <ParticipantTile
                  trackRef={track}
                  disableSpeakingIndicator
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                />
              ) : (
                <div className="flex flex-col items-center gap-2 px-2">
                  <div
                    className="rounded-full bg-white/10 flex items-center justify-center text-white font-semibold shrink-0"
                    style={{ width: 48, height: 48, fontSize: 18 }}
                  >
                    {profile?.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={profile.avatarUrl}
                        alt={name}
                        className="w-full h-full object-cover rounded-full"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      initial
                    )}
                  </div>
                  <span className="text-white/70 text-xs text-center truncate w-full">{name}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Local self-view PiP */}
      {localHasLiveCamera && (
        <div
          className="absolute bottom-3 right-3 rounded-xl overflow-hidden z-10"
          style={{
            width: 72,
            height: 96,
            border: "2px solid rgba(255,255,255,0.18)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
          }}
        >
          <ParticipantTile
            trackRef={localTrack}
            disableSpeakingIndicator
            style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Control buttons ──────────────────────────────────────────────────────────
function MicButton() {
  const { toggle, enabled } = useTrackToggle({ source: Track.Source.Microphone });
  return (
    <button
      onClick={() => toggle()}
      aria-label={enabled ? "Mute" : "Unmute"}
      className="w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer hover:brightness-90"
      style={{ background: enabled ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.08)" }}
    >
      {enabled
        ? <Mic className="w-5 h-5 text-white" />
        : <MicOff className="w-5 h-5 text-white/50" />}
    </button>
  );
}

function CameraButton() {
  const { toggle, enabled } = useTrackToggle({ source: Track.Source.Camera });
  return (
    <button
      onClick={() => toggle()}
      aria-label={enabled ? "Camera off" : "Camera on"}
      className="w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer hover:brightness-90"
      style={{ background: enabled ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.08)" }}
    >
      {enabled
        ? <Video className="w-5 h-5 text-white" />
        : <VideoOff className="w-5 h-5 text-white/50" />}
    </button>
  );
}

function EndCallButton({ callId, isGroup }: { callId: string; isGroup: boolean }) {
  const { clearCallState, setDeclinedGroupCall } = useCallStore();
  const groupCallsByConversation = useCallStore((s) => s.groupCallsByConversation);
  const room = useRoomContext();
  const isBusyRef = useRef(false);

  // For a group call with only 2 participants left, leaving = ending the call.
  const conversationId = useCallStore.getState().activeCall?.conversationId ?? "";
  const groupEntry = conversationId ? groupCallsByConversation[conversationId] : undefined;
  const participantCount = groupEntry?.participantIds.length ?? 0;
  const shouldEndGroupCall = isGroup && participantCount <= 2;

  const handleAction = useCallback(() => {
    if (isBusyRef.current) return;
    isBusyRef.current = true;

    if (isGroup && !shouldEndGroupCall) {
      // Group call with 3+ participants: just leave, call stays alive for others.
      void room.disconnect();
      clearCallState();

      if (conversationId) {
        setDeclinedGroupCall({ callId, conversationId });
      }
      // isBusyRef intentionally left true — component unmounts
    } else {
      // 1:1 call OR group call down to 2 people: end for everyone.
      void room.disconnect();
      getCallSocket().emit("call:leave_room", { callId });
      clearCallState();
      endInstantCall(callId).catch((err) => {
        if (!is409(err)) toast.error("Failed to end the call.");
      });
    }
  }, [callId, isGroup, shouldEndGroupCall, conversationId, clearCallState, setDeclinedGroupCall, room]);

  const label = isGroup && !shouldEndGroupCall ? "Leave" : "End";

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={handleAction}
        aria-label={label}
        title={isGroup && !shouldEndGroupCall ? "Leave call (others stay connected)" : "End call for everyone"}
        className="w-14 h-14 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer hover:brightness-90"
        style={{ background: "#DC2626" }}
      >
        <PhoneOff className="w-6 h-6 text-white" />
      </button>
      <span className="text-[10px] text-white/40 select-none">
        {label}
      </span>
    </div>
  );
}

// ─── Active room inner (needs LiveKit context) ────────────────────────────────
function ActiveCallRoom({
  callId,
  isGroup,
  remoteDisplayName,
  remoteAvatarUrl,
}: {
  callId: string;
  isGroup: boolean;
  remoteDisplayName: string;
  remoteAvatarUrl: string | null;
}) {
  return (
    <>
      {/* Force LiveKit tiles to fill their container absolutely */}
      <style>{`
        .lk-participant-tile {
          position: absolute !important;
          inset: 0 !important;
          width: 100% !important;
          height: 100% !important;
        }
        .lk-participant-tile video {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
        }
      `}</style>

      <div className="flex-1 min-h-0 overflow-hidden relative">
        {isGroup ? (
          <GroupVideoLayout />
        ) : (
          <VideoLayout
            remoteDisplayName={remoteDisplayName}
            remoteAvatarUrl={remoteAvatarUrl}
          />
        )}
      </div>

      <RoomAudioRenderer />

      <div
        className="shrink-0 flex items-center justify-center gap-5 py-4"
        style={{ background: "rgba(0,0,0,0.5)", borderTop: "1px solid rgba(255,255,255,0.07)" }}
      >
        <CameraButton />
        <EndCallButton callId={callId} isGroup={isGroup} />
        <MicButton />
      </div>
    </>
  );
}

// ─── Active Call Modal ────────────────────────────────────────────────────────
export function ActiveCallModal() {
  const { activeCall, liveKitCredentials } = useCallStore();
  const myId = useAuthStore((s) => s.user?.id);
  const profileMap = usePresenceStore((s) => s.profileMap);
  const [isExpanded, setIsExpanded] = useState(false);
  const { w: modalW, h: modalH } = isExpanded ? MODAL_EXPANDED : MODAL_COMPACT;
  const { pos, handlePointerDown, handlePointerMove, handlePointerUp } =
    useDraggablePosition(modalW, modalH);

  if (!activeCall) return null;

  // Group call: more than 2 total participants (caller + multiple callees)
  const calleeCount = activeCall.participants.filter((p) => p.role === "CALLEE").length;
  const isGroup = calleeCount > 1 || (activeCall.calleeIds?.length ?? 0) > 1;

  // Resolve the other participant's display info (used for 1:1 only)
  const otherUserId =
    activeCall.participants.find((p) => p.userId !== myId)?.userId ??
    (activeCall.callerId !== myId ? activeCall.callerId : "");
  const otherProfile = otherUserId ? profileMap[otherUserId] : null;
  const remoteDisplayName = otherProfile?.displayName ?? "Caller";
  const remoteAvatarUrl = otherProfile?.avatarUrl ?? null;

  return (
    <div
      className="fixed z-[9999] flex flex-col overflow-hidden"
      style={{
        left: pos.x,
        top: pos.y,
        width: modalW,
        height: modalH,
        background: "#0F172A",
        borderRadius: 16,
        boxShadow: "0 20px 25px rgba(0,0,0,0.15)",
        fontFamily: "var(--font-jakarta, 'Plus Jakarta Sans', sans-serif)",
        transition: "width 220ms ease, height 220ms ease",
      }}
      role="dialog"
      aria-label="Active call"
      aria-modal="false"
    >
      {/* Drag handle */}
      <div
        className="shrink-0 flex items-center gap-2 px-3 py-2.5 cursor-grab active:cursor-grabbing select-none"
        style={{
          background: "rgba(255,255,255,0.05)",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <GripHorizontal className="w-4 h-4 text-white/25 shrink-0" />
        <PhoneCall className="w-3.5 h-3.5 text-white/40 shrink-0" />
        <span className="text-xs font-medium text-white/50 tracking-widest uppercase flex-1">
          Active Call
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setIsExpanded((v) => !v); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="ml-auto p-1.5 rounded-md text-white/40 hover:text-white/80 hover:bg-white/10 transition-all duration-200 cursor-pointer"
          aria-label={isExpanded ? "Collapse" : "Expand"}
        >
          {isExpanded
            ? <Minimize2 className="w-3.5 h-3.5" />
            : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* LiveKit Room — shown once we have credentials; connecting placeholder until then */}
      {liveKitCredentials ? (
        <LiveKitRoom
          serverUrl={liveKitCredentials.livekitUrl}
          token={liveKitCredentials.token}
          connect
          video={false}
          audio
          options={{
            videoCaptureDefaults: {
              resolution: { width: 1280, height: 720, frameRate: 30 },
            },
            publishDefaults: {
              simulcast: true,
            },
            adaptiveStream: true,
          }}
          onConnected={() => useCallStore.getState().setHasJoinedCall(true)}
          className="flex flex-col flex-1 min-h-0"
        >
          <ActiveCallRoom
            callId={activeCall.id}
            isGroup={isGroup}
            remoteDisplayName={remoteDisplayName}
            remoteAvatarUrl={remoteAvatarUrl}
          />
        </LiveKitRoom>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-white/50 text-sm animate-pulse">Connecting…</span>
        </div>
      )}
    </div>
  );
}
