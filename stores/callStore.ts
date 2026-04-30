import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { CallDto, CallTokenDto } from '@/lib/api/calls';

export type { CallDto, CallTokenDto };

export interface ActiveGroupCallEntry {
  callId: string;
  conversationId: string;
  callerId: string;
  /** RINGING = waiting for someone to accept, ACTIVE = at least one callee joined */
  status: "RINGING" | "ACTIVE";
  /** UserIds who have joined the LiveKit room (caller is always included) */
  participantIds: string[];
  startedAt: string;
}

interface InstantCallState {
  /** A call ringing for the current user (they are the callee). */
  incomingCall: CallDto | null;
  /** A call the current user initiated (waiting for pickup). */
  outgoingCall: CallDto | null;
  /** The currently active call both parties are connected to. */
  activeCall: CallDto | null;
  /** LiveKit credentials for the active call. */
  liveKitCredentials: CallTokenDto | null;
  /**
   * A group call the current user declined but which may still be ringing/active.
   * Used to show a "Join call" button in the conversation header.
   */
  declinedGroupCall: { callId: string; conversationId: string } | null;
  /**
   * Tracks active/ringing group calls keyed by conversationId.
   * Used to render the in-conversation "call in progress" banner.
   */
  groupCallsByConversation: Record<string, ActiveGroupCallEntry>;

  setIncomingCall: (call: CallDto | null) => void;
  setOutgoingCall: (call: CallDto | null) => void;
  setActiveCall: (call: CallDto | null) => void;
  setLiveKitCredentials: (creds: CallTokenDto | null) => void;
  setDeclinedGroupCall: (call: { callId: string; conversationId: string } | null) => void;
  setGroupCall: (conversationId: string, entry: ActiveGroupCallEntry | null) => void;
  addGroupCallParticipant: (conversationId: string, userId: string) => void;
  /** Clears all call state - call on terminal events (ended/declined/missed). */
  clearCallState: () => void;
  /** True once the user has actually connected to the LiveKit room. */
  hasJoinedCall: boolean;
  setHasJoinedCall: (v: boolean) => void;
}

export const useCallStore = create<InstantCallState>()(
  persist(
    (set) => ({
      incomingCall: null,
      outgoingCall: null,
      activeCall: null,
      liveKitCredentials: null,
      declinedGroupCall: null,
      groupCallsByConversation: {},
      hasJoinedCall: false,

      setIncomingCall: (call) => set({ incomingCall: call }),
      setOutgoingCall: (call) => set({ outgoingCall: call }),
      setActiveCall: (call) => set({ activeCall: call }),
      setLiveKitCredentials: (creds) => set({ liveKitCredentials: creds }),
      setDeclinedGroupCall: (call) => set({ declinedGroupCall: call }),

      setGroupCall: (conversationId, entry) =>
        set((state) => {
          const next = { ...state.groupCallsByConversation };
          if (entry === null) {
            delete next[conversationId];
          } else {
            next[conversationId] = entry;
          }
          return { groupCallsByConversation: next };
        }),

      addGroupCallParticipant: (conversationId, userId) =>
        set((state) => {
          const entry = state.groupCallsByConversation[conversationId];
          if (!entry) return {};
          if (entry.participantIds.includes(userId)) return {};
          return {
            groupCallsByConversation: {
              ...state.groupCallsByConversation,
              [conversationId]: {
                ...entry,
                status: "ACTIVE",
                participantIds: [...entry.participantIds, userId],
              },
            },
          };
        }),

      clearCallState: () =>
        set({ incomingCall: null, outgoingCall: null, activeCall: null, liveKitCredentials: null, declinedGroupCall: null, hasJoinedCall: false }),

      setHasJoinedCall: (v) => set({ hasJoinedCall: v }),
    }),
    {
      name: 'zolo-call-state',
      // sessionStorage: persists across page reloads within the tab,
      // but clears when the tab/browser is closed. Ideal for call state.
      storage: createJSONStorage(() => sessionStorage),
      // Only persist active call data. Ringing states (incomingCall/outgoingCall)
      // are transient — they must NOT survive a reload, as the call will have
      // already been answered/declined/missed by then.
      // groupCallsByConversation and declinedGroupCall ARE persisted so the
      // "call in progress" banner and re-join option survive page reloads.
      partialize: (state) => ({
        activeCall: state.activeCall,
        liveKitCredentials: state.liveKitCredentials,
        groupCallsByConversation: state.groupCallsByConversation,
        declinedGroupCall: state.declinedGroupCall,
      }),
    }
  )
);
