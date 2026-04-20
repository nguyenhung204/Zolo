import { logout } from "@/lib/api/auth";
import { clearRefreshTokenCookie } from "@/lib/auth/token";
import { disconnectChatSocket, disconnectCallSocket } from "@/lib/socket/socket";
import { useAuthStore } from "@/stores/authStore";

export function clearClientAuthSession() {
  useAuthStore.getState().clearAuth();
  disconnectChatSocket();
  disconnectCallSocket();
  // Clear the HttpOnly refresh cookie via the BFF (best-effort, non-blocking).
  void clearRefreshTokenCookie();
}

export async function logoutCompletely() {
  try {
    await logout();
  } finally {
    // Always clear local state even if network/API logout fails.
    clearClientAuthSession();
  }
}
