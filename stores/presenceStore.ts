import { create } from "zustand";

type PresenceStatus = "online" | "offline";

export interface UserProfileSnapshot {
  displayName: string | null;
  avatarMediaId: string | null;
  /** Resolved presigned URL — may be null while fetching or if media is absent */
  avatarUrl: string | null;
}

interface PresenceState {
  presenceMap: Record<string, PresenceStatus>;
  lastSeenMap: Record<string, string>; // userId → ISO8601
  /** Real-time profile cache keyed by userId — updated via user:profile-updated WS event */
  profileMap: Record<string, UserProfileSnapshot>;
  setPresence: (userId: string, status: PresenceStatus, lastSeen?: string) => void;
  bulkSetPresence: (entries: Array<{ userId: string; status: PresenceStatus; lastSeen?: string }>) => void;
  setUserProfile: (userId: string, snapshot: UserProfileSnapshot) => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  presenceMap: {},
  lastSeenMap: {},
  profileMap: {},

  setPresence: (userId, status, lastSeen) =>
    set((state) => ({
      presenceMap: { ...state.presenceMap, [userId]: status },
      lastSeenMap: lastSeen
        ? { ...state.lastSeenMap, [userId]: lastSeen }
        : state.lastSeenMap,
    })),

  bulkSetPresence: (entries) =>
    set((state) => {
      const presenceMap = { ...state.presenceMap };
      const lastSeenMap = { ...state.lastSeenMap };
      for (const { userId, status, lastSeen } of entries) {
        presenceMap[userId] = status;
        if (lastSeen) lastSeenMap[userId] = lastSeen;
      }
      return { presenceMap, lastSeenMap };
    }),

  setUserProfile: (userId, snapshot) =>
    set((state) => ({
      profileMap: { ...state.profileMap, [userId]: snapshot },
    })),
}));
