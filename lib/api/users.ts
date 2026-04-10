import { apiClient } from "@/lib/api/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AvatarVariant = "thumb" | "original";

export interface NotificationSettings {
  desktopEnabled?: boolean;
  mobileEnabled?: boolean;
  notifyFor?: "ALL" | "MENTIONS_ONLY" | "NOTHING";
  muteUntil?: string | null;
}

export interface UserSettings {
  statusMessage?: string;
  theme?: "LIGHT" | "DARK" | "SYSTEM";
  messageDensity?: "COMFORTABLE" | "COMPACT";
  enterToSend?: boolean;
  notifications?: NotificationSettings;
}

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  cccdNumber?: string;
  isActive: boolean;
  avatarMediaId?: string;
  avatarUrl?: string;
  settings?: UserSettings;
}

export interface UpdateProfileDto {
  firstName?: string;
  lastName?: string;
  phone?: string;
  cccdNumber?: string;
  avatarMediaId?: string;
}

export interface UpdateSettingsDto {
  statusMessage?: string;
  theme?: "LIGHT" | "DARK" | "SYSTEM";
  messageDensity?: "COMFORTABLE" | "COMPACT";
  enterToSend?: boolean;
  notifications?: NotificationSettings;
}

export interface UserSession {
  id: string;
  ipAddress?: string;
  started?: string;
  lastAccess?: string;
  clients?: string[];
}

// ─── User Profile ─────────────────────────────────────────────────────────────

export async function getMyProfile(avatarVariant: AvatarVariant = "thumb"): Promise<UserProfile> {
  const res = await apiClient.get("/users/me", { params: { avatarVariant } });
  return res.data.data;
}

export async function updateMyProfile(
  dto: UpdateProfileDto,
  avatarVariant: AvatarVariant = "thumb"
): Promise<UserProfile> {
  const res = await apiClient.put("/users/me", dto, { params: { avatarVariant } });
  return res.data.data;
}

export async function updateMySettings(dto: UpdateSettingsDto): Promise<UserProfile> {
  const res = await apiClient.patch("/users/me/settings", dto);
  return res.data.data;
}

// ─── Session Management ───────────────────────────────────────────────────────

export async function getMySessions(): Promise<UserSession[]> {
  const res = await apiClient.get("/users/me/sessions");
  const d = res.data?.data;
  return Array.isArray(d) ? d : [];
}

export async function deleteAllSessions(): Promise<void> {
  await apiClient.delete("/users/me/sessions");
}

export async function deleteSession(sessionId: string): Promise<void> {
  await apiClient.delete(`/users/me/sessions/${sessionId}`);
}
