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
  notifyOnMention?: boolean;
  notifyOnMessage?: boolean;
  quietHoursEnabled?: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  timezone?: string | null;
}

export interface NotificationPreferences {
  global: NotificationPreferenceEntry | null;
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

export type ConversationMuteDuration = "1h" | "4h" | "8h" | "24h" | "forever" | "off";

export interface ConversationMutePreference {
  userId: string;
  conversationId: string;
  muteUntil: string | null;
  notifyOnMessage?: boolean;
  notifyOnMention?: boolean;
  updatedAt: string;
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
  const data = res.data.data ?? {};
  return {
    global: data.global ?? data.globalPref ?? null,
    conversation: data.conversation ?? data.conversationPref ?? null,
  };
}

/** Toggle per-conversation mute using backend duration tokens. */
export async function muteConversation(
  conversationId: string,
  duration: ConversationMuteDuration,
): Promise<ConversationMutePreference> {
  const res = await apiClient.put(`/notifications/conversations/${conversationId}/mute`, {
    duration,
  });
  return res.data.data ?? res.data;
}
