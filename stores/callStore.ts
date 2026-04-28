import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { CallDto, CallTokenDto } from '@/lib/api/calls';

export type { CallDto, CallTokenDto };

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

  setIncomingCall: (call: CallDto | null) => void;
  setOutgoingCall: (call: CallDto | null) => void;
  setActiveCall: (call: CallDto | null) => void;
  setLiveKitCredentials: (creds: CallTokenDto | null) => void;
  setDeclinedGroupCall: (call: { callId: string; conversationId: string } | null) => void;
  /** Clears all call state - call on terminal events (ended/declined/missed). */
  clearCallState: () => void;
}

export const useCallStore = create<InstantCallState>()(
  persist(
    (set) => ({
      incomingCall: null,
      outgoingCall: null,
      activeCall: null,
      liveKitCredentials: null,
      declinedGroupCall: null,

      setIncomingCall: (call) => set({ incomingCall: call }),
      setOutgoingCall: (call) => set({ outgoingCall: call }),
      setActiveCall: (call) => set({ activeCall: call }),
      setLiveKitCredentials: (creds) => set({ liveKitCredentials: creds }),
      setDeclinedGroupCall: (call) => set({ declinedGroupCall: call }),

      clearCallState: () =>
        set({ incomingCall: null, outgoingCall: null, activeCall: null, liveKitCredentials: null, declinedGroupCall: null }),
    }),
    {
      name: 'zolo-call-state',
      // sessionStorage: persists across page reloads within the tab,
      // but clears when the tab/browser is closed. Ideal for call state.
      storage: createJSONStorage(() => sessionStorage),
      // Only persist active call data. Ringing states (incomingCall/outgoingCall)
      // are transient — they must NOT survive a reload, as the call will have
      // already been answered/declined/missed by then.
      partialize: (state) => ({
        activeCall: state.activeCall,
        liveKitCredentials: state.liveKitCredentials,
      }),
    }
  )
);
