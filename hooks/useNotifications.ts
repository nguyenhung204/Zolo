"use client";

import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getVapidPublicKey,
  registerDevice,
  unregisterDevice,
  getNotificationPreferences,
  putNotificationPreferences,
  muteConversation,
  type PutPreferencesDto,
  type NotificationPreferences,
  type ConversationMuteDuration,
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

/** Toggle a conversation mute using the simple duration tokens from the API. */
export function useMuteConversation(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (duration: ConversationMuteDuration) => muteConversation(conversationId, duration),
    // Optimistic update so the UI (mute toggle, "muted until …" label) reflects
    // the new state instantly instead of waiting for the next refetch.
    onMutate: async (duration) => {
      const key = queryKeys.notifications.preferences(conversationId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<NotificationPreferences>(key);
      const now = Date.now();
      const muteUntil =
        duration === "off"
          ? null
          : duration === "forever"
            ? new Date(now + 100 * 365 * 24 * 60 * 60 * 1000).toISOString() // ~100 yrs
            : new Date(
                now +
                  ({ "1h": 1, "4h": 4, "8h": 8, "24h": 24 }[duration] ?? 0) *
                    60 *
                    60 *
                    1000,
              ).toISOString();
      const notifyOnMessage = duration === "off";
      const next: NotificationPreferences = {
        global: prev?.global ?? {
          conversationId: null,
          muteUntil: null,
          notifyOnMention: true,
          notifyOnMessage: true,
          quietHoursEnabled: false,
          quietHoursStart: null,
          quietHoursEnd: null,
          timezone: null,
        },
        conversation: {
          conversationId,
          muteUntil,
          notifyOnMention: prev?.conversation?.notifyOnMention ?? true,
          notifyOnMessage,
          quietHoursEnabled: prev?.conversation?.quietHoursEnabled ?? false,
          quietHoursStart: prev?.conversation?.quietHoursStart ?? null,
          quietHoursEnd: prev?.conversation?.quietHoursEnd ?? null,
          timezone: prev?.conversation?.timezone ?? null,
        },
      };
      qc.setQueryData(key, next);
      return { prev };
    },
    onError: (_err, _duration, ctx) => {
      const key = queryKeys.notifications.preferences(conversationId);
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
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
