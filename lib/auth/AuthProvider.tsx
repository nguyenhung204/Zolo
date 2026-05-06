"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore, type AuthUser } from "@/stores/authStore";
import {
  refreshAccessToken,
  decodeJwt,
  setCurrentTokenSet,
  isTokenExpiringSoon,
  type TokenSet,
} from "./token";
import { connectChatSocket, connectCallSocket, getChatSocket } from "@/lib/socket/socket";
import { clearClientAuthSession } from "@/lib/auth/logout";

const PUBLIC_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/register",
];

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleRefresh(tokens: TokenSet, onRefreshed: (t: TokenSet) => void) {
  if (refreshTimer) clearTimeout(refreshTimer);
  const msUntilRefresh = Math.max(0, tokens.expiresAt - Date.now());
  refreshTimer = setTimeout(async () => {
    try {
      const fresh = await refreshAccessToken();
      onRefreshed(fresh);
      scheduleRefresh(fresh, onRefreshed);
    } catch {
      // Refresh cookie is invalid or expired — clear local state.
      void clearClientAuthSession();
    }
  }, msUntilRefresh);
}

export function applyTokenSet(tokens: TokenSet, setAuth: (data: { token: string; user?: Partial<AuthUser> }) => void) {
  setCurrentTokenSet(tokens);
  const parsed = decodeJwt(tokens.accessToken);
  setAuth({
    token: tokens.accessToken,
    user: {
      id: parsed.sub,
      email: parsed.email ?? "",
      name: (parsed.name as string) ?? parsed.preferred_username,
      username: parsed.preferred_username,
    },
  });
  connectChatSocket(tokens.accessToken);
  connectCallSocket(tokens.accessToken);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const initialized = useRef(false);
  const { setAuth, setInitialized, setSessionRevoked } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();

  // ── Initial auth bootstrap ──────────────────────────────────────────────────
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Attempt to restore the session via the BFF using the HttpOnly refresh cookie.
    // The browser sends the cookie automatically — no localStorage involved.
    refreshAccessToken()
      .then((tokens) => {
        applyTokenSet(tokens, setAuth);
        scheduleRefresh(tokens, (fresh) => {
          applyTokenSet(fresh, setAuth);
        });
      })
      .catch(() => {
        void clearClientAuthSession();
        if (!PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
          router.push("/login");
        }
      })
      .finally(() => {
        setInitialized();
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-check token when the user switches back to this tab ────────────────
  // Browsers throttle setTimeout in background tabs (down to ~1/minute in
  // Chrome for inactive tabs), so scheduleRefresh may fire late.  This handler
  // triggers an immediate refresh if the token is expiring soon the moment the
  // tab becomes visible again — keeping the session alive without any UX glitch.
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== "visible") return;
      if (!isTokenExpiringSoon()) return;
      try {
        const fresh = await refreshAccessToken();
        applyTokenSet(fresh, setAuth);
        scheduleRefresh(fresh, (t) => applyTokenSet(t, setAuth));
      } catch {
        void clearClientAuthSession();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [setAuth]);

  // ── Disconnect session and show notice when server revokes the session ─────
  useEffect(() => {
    const socket = getChatSocket();
    const onRevoked = (data: { reason: "logged_in_elsewhere" | "new_login_elsewhere" | "manual_logout" | "token_expired" | "tab_limit_exceeded" }) => {
      setSessionRevoked(true, data.reason);
    };

    socket.on("session_revoked", onRevoked);
    return () => {
      socket.off("session_revoked", onRevoked);
    };
  }, [setSessionRevoked]);

  return <>{children}</>;
}
