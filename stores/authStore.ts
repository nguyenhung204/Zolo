import { create } from "zustand";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  username: string;
  orgId?: string;
  avatarUrl?: string;
}

export type RevocationReason = "logged_in_elsewhere" | "new_login_elsewhere" | "manual_logout" | "token_expired" | "tab_limit_exceeded";

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isInitialized: boolean;
  isSessionRevoked: boolean;
  revocationReason: RevocationReason | null;
  setAuth: (data: { token: string; user?: Partial<AuthUser> }) => void;
  clearAuth: () => void;
  setInitialized: () => void;
  /** @param persist – whether to write to localStorage (default true) */
  setSessionRevoked: (revoked: boolean, reason?: RevocationReason | null, persist?: boolean) => void;
}

const SESSION_REVOKED_KEY = "zolo-session-revoked";

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isInitialized: false,
  isSessionRevoked: false,
  revocationReason: null,

  setAuth: ({ token, user }) => {
    set((state) => {
      window.localStorage.removeItem(SESSION_REVOKED_KEY);
      // Clear any stale single-tab-lock key so the new AppShell session
      // doesn't mistake itself for a duplicate tab.
      window.localStorage.removeItem("zolo-active-tab-id");
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
    set({ user: null, token: null, isAuthenticated: false, isSessionRevoked: false, revocationReason: null });
  },

  setInitialized: () => set({ isInitialized: true }),

  setSessionRevoked: (revoked, reason = null, persist = true) => {
    if (typeof window !== "undefined") {
      if (revoked && persist) {
        window.localStorage.setItem(SESSION_REVOKED_KEY, "1");
      } else {
        window.localStorage.removeItem(SESSION_REVOKED_KEY);
      }
    }
    set({ isSessionRevoked: revoked, revocationReason: revoked ? reason : null });
  },
}));
