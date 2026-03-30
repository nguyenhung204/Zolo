import { create } from "zustand";

export interface MeetingParticipant {
  userId: string;
  micOn: boolean;
  cameraOn: boolean;
  screenSharing: boolean;
}

interface CallState {
  activeMeetingId: string | null;
  conversationId: string | null;
  hostId: string | null;
  participants: MeetingParticipant[];
  myMedia: { micOn: boolean; cameraOn: boolean; screenSharing: boolean };
  waitingParticipants: string[];
  livekitToken: string | null;
  livekitUrl: string | null;

  setActiveMeeting: (data: { meetingId: string; conversationId: string; hostId: string }) => void;
  setLivekitCredentials: (token: string, url: string) => void;
  addParticipant: (p: MeetingParticipant) => void;
  removeParticipant: (userId: string) => void;
  updateParticipantMedia: (userId: string, media: Partial<MeetingParticipant>) => void;
  addWaiting: (userId: string) => void;
  removeWaiting: (userId: string) => void;
  updateMyMedia: (media: Partial<CallState["myMedia"]>) => void;
  endCall: () => void;
}

export const useCallStore = create<CallState>((set) => ({
  activeMeetingId: null,
  conversationId: null,
  hostId: null,
  participants: [],
  myMedia: { micOn: true, cameraOn: true, screenSharing: false },
  waitingParticipants: [],
  livekitToken: null,
  livekitUrl: null,

  setActiveMeeting: ({ meetingId, conversationId, hostId }) =>
    set({ activeMeetingId: meetingId, conversationId, hostId }),

  setLivekitCredentials: (token, url) =>
    set({ livekitToken: token, livekitUrl: url }),

  addParticipant: (p) =>
    set((state) => ({
      participants: [...state.participants.filter((x) => x.userId !== p.userId), p],
    })),

  removeParticipant: (userId) =>
    set((state) => ({
      participants: state.participants.filter((p) => p.userId !== userId),
    })),

  updateParticipantMedia: (userId, media) =>
    set((state) => ({
      participants: state.participants.map((p) =>
        p.userId === userId ? { ...p, ...media } : p
      ),
    })),

  addWaiting: (userId) =>
    set((state) => ({
      waitingParticipants: [...state.waitingParticipants.filter((id) => id !== userId), userId],
    })),

  removeWaiting: (userId) =>
    set((state) => ({
      waitingParticipants: state.waitingParticipants.filter((id) => id !== userId),
    })),

  updateMyMedia: (media) =>
    set((state) => ({ myMedia: { ...state.myMedia, ...media } })),

  endCall: () =>
    set({
      activeMeetingId: null,
      conversationId: null,
      hostId: null,
      participants: [],
      waitingParticipants: [],
      livekitToken: null,
      livekitUrl: null,
    }),
}));
