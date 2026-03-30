import { create } from "zustand";

type PresenceStatus = "online" | "offline";

interface PresenceState {
  presenceMap: Record<string, PresenceStatus>;
  lastSeenMap: Record<string, string>; // userId → ISO8601
  setPresence: (userId: string, status: PresenceStatus, lastSeen?: string) => void;
  bulkSetPresence: (entries: Array<{ userId: string; status: PresenceStatus; lastSeen?: string }>) => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  presenceMap: {},
  lastSeenMap: {},

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
}));
