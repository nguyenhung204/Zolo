import { logout } from "@/lib/api/auth";
import { endInstantCall, declineInstantCall } from "@/lib/api/calls";
import { clearRefreshTokenCookie } from "@/lib/auth/token";
import { disconnectChatSocket, disconnectCallSocket } from "@/lib/socket/socket";
import { useAuthStore } from "@/stores/authStore";
import { useCallStore } from "@/stores/callStore";
import { getQueryClient } from "@/lib/query/queryClient";

/**
 * If the user is in (or ringing into) an active call, terminate it on the
 * server and wipe all call state immediately. Fire-and-forget — the UI must
 * not block logout on a network failure.
 */
async function endActiveCallBeforeLogout(): Promise<void> {
  const { activeCall, outgoingCall, incomingCall, clearCallState } = useCallStore.getState();

  // End or decline whichever call is live; ignore errors (session may already be gone).
  const tasks: Promise<unknown>[] = [];
  if (activeCall?.id) tasks.push(endInstantCall(activeCall.id).catch(() => {}));
  else if (outgoingCall?.id) tasks.push(endInstantCall(outgoingCall.id).catch(() => {}));
  if (incomingCall?.id) tasks.push(declineInstantCall(incomingCall.id).catch(() => {}));

  if (tasks.length) await Promise.allSettled(tasks);
  clearCallState();
}

export async function clearClientAuthSession() {
  // End any active/ringing call before wiping auth state.
  await endActiveCallBeforeLogout();
  useAuthStore.getState().clearAuth();
  // Nuke all cached query data so stale data never bleeds into a fresh session.
  getQueryClient().clear();
  disconnectChatSocket();
  disconnectCallSocket();
  // Clear the HttpOnly refresh cookie before navigating so middleware cannot
  // bounce the user back into protected routes with a stale marker cookie.
  await clearRefreshTokenCookie();
}

export async function logoutCompletely() {
  try {
    await logout();
  } finally {
    // Always clear local state even if network/API logout fails.
    await clearClientAuthSession();
  }
}
