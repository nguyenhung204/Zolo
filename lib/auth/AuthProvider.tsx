"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore, type AuthUser } from "@/stores/authStore";
import {
  loadRefreshToken,
  saveRefreshToken,
  clearRefreshToken,
  refreshAccessToken,
  decodeJwt,
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
      const fresh = await refreshAccessToken(tokens.refreshToken);
      saveRefreshToken(fresh.refreshToken);
      onRefreshed(fresh);
      scheduleRefresh(fresh, onRefreshed);
    } catch {
      clearRefreshToken();
    }
  }, msUntilRefresh);
}

export function applyTokenSet(tokens: TokenSet, setAuth: (data: { token: string; user?: Partial<AuthUser> }) => void) {
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
  document.cookie = "zolo-auth=1; path=/; SameSite=Lax";
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

    const storedRefresh = loadRefreshToken();
    if (!storedRefresh) {
      setInitialized();
      if (!PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
        router.push("/login");
      }
      return;
    }

    refreshAccessToken(storedRefresh)
      .then((tokens) => {
        saveRefreshToken(tokens.refreshToken);
        applyTokenSet(tokens, setAuth);
        scheduleRefresh(tokens, (fresh) => {
          applyTokenSet(fresh, setAuth);
        });
      })
      .catch(() => {
        clearClientAuthSession();
      })
      .finally(() => {
        setInitialized();
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Disconnect session and show notice when server revokes the session ─────
  useEffect(() => {
    const socket = getChatSocket();
    const onRevoked = (_data: { reason: "logged_in_elsewhere" | "manual_logout" | "token_expired" | "tab_limit_exceeded" }) => {
      setSessionRevoked(true);
    };

    socket.on("session_revoked", onRevoked);
    return () => {
      socket.off("session_revoked", onRevoked);
    };
  }, [setSessionRevoked]);

  return <>{children}</>;
}
