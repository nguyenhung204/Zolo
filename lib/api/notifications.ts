import { apiClient } from "@/lib/api/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationPlatform = "FCM" | "APNS" | "WEB";

export interface RegisterDeviceDto {
  token: string;
  platform: NotificationPlatform;
  deviceId: string;
}

export interface NotificationPreferenceEntry {
  conversationId: string | null;
  muteUntil: string | null;
  notifyOnMention: boolean;
  notifyOnMessage: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string | null;
}

export interface NotificationPreferences {
  global: NotificationPreferenceEntry;
  conversation?: NotificationPreferenceEntry | null;
}

export interface PutPreferencesDto {
  conversationId?: string | null;
  muteUntil?: string | null;
  notifyOnMention?: boolean;
  notifyOnMessage?: boolean;
  quietHoursEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone?: string;
}

// ─── API functions ────────────────────────────────────────────────────────────

/** Public — returns the VAPID public key for Web Push subscription. */
export async function getVapidPublicKey(): Promise<string> {
  const res = await apiClient.get("/notifications/vapid-public-key");
  return res.data.data.publicKey as string;
}

/** Register (or refresh) a push token for the current user. */
export async function registerDevice(dto: RegisterDeviceDto): Promise<void> {
  await apiClient.post("/notifications/devices", dto);
}

/** Unregister a device — call on logout or explicit permission revoke. */
export async function unregisterDevice(deviceId: string): Promise<void> {
  await apiClient.delete(`/notifications/devices/${encodeURIComponent(deviceId)}`);
}

/**
 * Save notification preferences.
 * Pass `conversationId: null` (or omit) for the global preference.
 */
export async function putNotificationPreferences(
  dto: PutPreferencesDto
): Promise<NotificationPreferenceEntry> {
  const res = await apiClient.put("/notifications/preferences", dto);
  return res.data.data as NotificationPreferenceEntry;
}

/**
 * Fetch global preferences and, optionally, a conversation-level override.
 * If `conversationId` is provided the response includes both `global` and
 * `conversation` entries.
 */
export async function getNotificationPreferences(
  conversationId?: string
): Promise<NotificationPreferences> {
  const res = await apiClient.get("/notifications/preferences", {
    params: conversationId ? { conversationId } : undefined,
  });
  return res.data.data as NotificationPreferences;
}
