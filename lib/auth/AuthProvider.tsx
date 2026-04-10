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
import {
  connectChatSocket,
  connectCallSocket,
  disconnectChatSocket,
  disconnectCallSocket,
  getChatSocket,
} from "@/lib/socket/socket";

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
  const { setAuth, clearAuth, setInitialized } = useAuthStore();
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
        clearRefreshToken();
        clearAuth();
        document.cookie = "zolo-auth=; path=/; max-age=0";
        disconnectChatSocket();
        disconnectCallSocket();
      })
      .finally(() => {
        setInitialized();
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Disconnect & redirect when server revokes the session ──────────────────
  useEffect(() => {
    const socket = getChatSocket();
    const onRevoked = () => {
      clearRefreshToken();
      clearAuth();
      document.cookie = "zolo-auth=; path=/; max-age=0";
      disconnectChatSocket();
      disconnectCallSocket();
      router.push("/login");
    };
    socket.on("session_revoked", onRevoked);
    return () => {
      socket.off("session_revoked", onRevoked);
    };
  }, [clearAuth, router]);

  return <>{children}</>;
}
