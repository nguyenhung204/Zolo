"use client";

import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getVapidPublicKey,
  registerDevice,
  unregisterDevice,
  getNotificationPreferences,
  putNotificationPreferences,
  type PutPreferencesDto,
  type NotificationPreferences,
} from "@/lib/api/notifications";
import { queryKeys } from "@/lib/query/keys";
import { useAuthStore } from "@/stores/authStore";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEVICE_ID_KEY = "push_device_id";
const STALE = 5 * 60_000; // 5 min

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a base64url VAPID key to ArrayBuffer for pushManager.subscribe(). */
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const bytes = Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** Get or generate the stable browser device ID. */
function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Fetch notification preferences (global or conversation-level).
 * Pass `conversationId` to get the conversation override alongside the global.
 */
export function useNotificationPreferences(conversationId?: string) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery<NotificationPreferences>({
    queryKey: queryKeys.notifications.preferences(conversationId),
    queryFn: () => getNotificationPreferences(conversationId),
    enabled: isAuthenticated,
    staleTime: STALE,
  });
}

/**
 * Mutation to update notification preferences (global or per-conversation).
 * Invalidates preferences cache on success.
 */
export function useUpdateNotificationPreferences(conversationId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: PutPreferencesDto) => putNotificationPreferences(dto),
    onSuccess: () => {
      // Invalidate both the targeted and global preference caches
      qc.invalidateQueries({ queryKey: queryKeys.notifications.preferences(conversationId) });
      qc.invalidateQueries({ queryKey: queryKeys.notifications.preferences() });
    },
  });
}

/**
 * Manages the full Web Push subscription lifecycle:
 *   1. On mount (authenticated): subscribe via pushManager → register device
 *   2. On unmount / logout: unsubscribe → unregister device
 *
 * Call once at the AppShell level. Requires a registered service worker.
 * Silently no-ops if push is not supported or permission is denied.
 */
export function usePushSubscription() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const subscriptionRef = useRef<PushSubscription | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    let cancelled = false;

    const subscribe = async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;

        const vapidPublicKey = await getVapidPublicKey();
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });

        if (cancelled) {
          subscription.unsubscribe();
          return;
        }

        subscriptionRef.current = subscription;
        const deviceId = getOrCreateDeviceId();

        await registerDevice({
          token: JSON.stringify(subscription.toJSON()),
          platform: "WEB",
          deviceId,
        });
      } catch {
        // Non-fatal — push is optional
      }
    };

    subscribe();

    return () => {
      cancelled = true;
      const sub = subscriptionRef.current;
      subscriptionRef.current = null;
      if (!sub) return;

      const deviceId = localStorage.getItem(DEVICE_ID_KEY);
      sub.unsubscribe().catch(() => null);
      if (deviceId) {
        unregisterDevice(deviceId).catch(() => null);
      }
    };
  }, [isAuthenticated]);
}

/**
 * Explicit unregister — call on user-initiated logout before clearing auth.
 * Unsubscribes push and removes the device registration from the server.
 */
export async function unregisterPushDevice(): Promise<void> {
  if (typeof window === "undefined") return;

  const deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) return;

  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      await sub?.unsubscribe();
    }
    await unregisterDevice(deviceId);
    localStorage.removeItem(DEVICE_ID_KEY);
  } catch {
    // Best-effort — do not block logout
  }
}
