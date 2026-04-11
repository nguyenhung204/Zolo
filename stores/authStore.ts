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
  isSessionRevoked: boolean;
  setAuth: (data: { token: string; user?: Partial<AuthUser> }) => void;
  clearAuth: () => void;
  setInitialized: () => void;
  setSessionRevoked: (revoked: boolean, persist?: boolean) => void;
}

const SESSION_REVOKED_KEY = "zolo-session-revoked";

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isInitialized: false,
  isSessionRevoked: false,

  setAuth: ({ token, user }) => {
    set((state) => {
      window.localStorage.removeItem(SESSION_REVOKED_KEY);
      return {
        token,
        isAuthenticated: true,
        isSessionRevoked: false,
        user: user
          ? ({ ...state.user, ...user } as AuthUser)
          : state.user,
      };
    });
  },

  clearAuth: () => {
    window.localStorage.removeItem(SESSION_REVOKED_KEY);
    set({ user: null, token: null, isAuthenticated: false, isSessionRevoked: false });
  },

  setInitialized: () => set({ isInitialized: true }),

  setSessionRevoked: (revoked, persist = true) => {
    if (typeof window !== "undefined") {
      if (revoked && persist) {
        window.localStorage.setItem(SESSION_REVOKED_KEY, "1");
      } else {
        window.localStorage.removeItem(SESSION_REVOKED_KEY);
      }
    }
    set({ isSessionRevoked: revoked });
  },
}));
