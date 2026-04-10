import { logout } from "@/lib/api/auth";
import { clearRefreshToken } from "@/lib/auth/token";
import { disconnectChatSocket, disconnectCallSocket } from "@/lib/socket/socket";
import { useAuthStore } from "@/stores/authStore";

export function clearClientAuthSession() {
  useAuthStore.getState().clearAuth();
  clearRefreshToken();
  disconnectChatSocket();
  disconnectCallSocket();
  document.cookie = "zolo-auth=; path=/; max-age=0";
}

export async function logoutCompletely() {
  try {
    await logout();
  } finally {
    // Always clear local state even if network/API logout fails.
    clearClientAuthSession();
  }
}
