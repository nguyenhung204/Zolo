import { create } from "zustand";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  username: string;
  orgId?: string;
  avatarUrl?: string;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isInitialized: boolean;
  setAuth: (data: { token: string; user?: Partial<AuthUser> }) => void;
  clearAuth: () => void;
  setInitialized: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isInitialized: false,

  setAuth: ({ token, user }) => {
    set((state) => ({
      token,
      isAuthenticated: true,
      user: user
        ? ({ ...state.user, ...user } as AuthUser)
        : state.user,
    }));
  },

  clearAuth: () =>
    set({ user: null, token: null, isAuthenticated: false }),

  setInitialized: () => set({ isInitialized: true }),
}));
