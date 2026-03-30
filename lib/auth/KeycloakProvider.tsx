"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getKeycloak } from "./keycloak";
import { useAuthStore } from "@/stores/authStore";
import { connectChatSocket, connectCallSocket, disconnectChatSocket, disconnectCallSocket } from "@/lib/socket/socket";

const PUBLIC_PATHS = ["/login"];

export function KeycloakProvider({ children }: { children: React.ReactNode }) {
  const initialized = useRef(false);
  const { setAuth, clearAuth } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const kc = getKeycloak();

    kc.init({
      pkceMethod: "S256",
      // check-sso silently restores session without forcing re-login
      onLoad: "check-sso",
      silentCheckSsoRedirectUri:
        typeof window !== "undefined"
          ? `${window.location.origin}/silent-check-sso.html`
          : undefined,
    }).then((authenticated) => {
      if (authenticated && kc.token && kc.tokenParsed) {
        const parsed = kc.tokenParsed as Record<string, string>;
        setAuth({
          token: kc.token,
          user: {
            id: parsed.sub,
            email: parsed.email,
            name: parsed.name ?? parsed.preferred_username,
            username: parsed.preferred_username,
          },
        });
        // Persist a lightweight session marker for the middleware
        document.cookie = "zolo-auth=1; path=/; SameSite=Lax";
        // Connect websockets
        connectChatSocket(kc.token);
        connectCallSocket(kc.token);
      } else {
        clearAuth();
        document.cookie = "zolo-auth=; path=/; max-age=0";
        if (!PUBLIC_PATHS.includes(pathname)) {
          router.push("/login");
        }
      }
    });

    // Keep token fresh — re-connect sockets with new token on refresh
    kc.onTokenExpired = () => {
      kc.updateToken(30)
        .then((refreshed) => {
          if (refreshed && kc.token) {
            setAuth({ token: kc.token });
            connectChatSocket(kc.token);
            connectCallSocket(kc.token);
          }
        })
        .catch(() => {
          clearAuth();
          document.cookie = "zolo-auth=; path=/; max-age=0";
          disconnectChatSocket();
          disconnectCallSocket();
          router.push("/login");
        });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <>{children}</>;
}
