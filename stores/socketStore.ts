import { create } from "zustand";

interface SocketState {
  connected: boolean;
  socketId: string | undefined;
  setConnected: (connected: boolean, socketId?: string) => void;
}

export const useSocketStore = create<SocketState>((set) => ({
  connected: false,
  socketId: undefined,
  setConnected: (connected, socketId) =>
    set({ connected, socketId: connected ? socketId : undefined }),
}));
