import { apiClient } from "@/lib/api/client";

export interface UserPresence {
  userId: string;
  status: "online" | "offline";
  lastSeen: string | null;
}

export interface SelfPresenceStatus {
  status: "online" | "offline";
  lastSeen: string | null;
}

export async function getFriendsPresence(): Promise<UserPresence[]> {
  const res = await apiClient.get("/presence/friends");
  const d = res.data?.data;
  return Array.isArray(d) ? d : [];
}

export async function getMyPresenceStatus(): Promise<SelfPresenceStatus | null> {
  const res = await apiClient.get("/presence/status");
  const d = res.data?.data;
  if (!d || typeof d !== "object") return null;
  const status = d.status === "online" ? "online" : "offline";
  const lastSeen = typeof d.lastSeen === "string" ? d.lastSeen : null;
  return { status, lastSeen };
}
