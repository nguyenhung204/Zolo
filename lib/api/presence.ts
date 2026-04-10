import { apiClient } from "@/lib/api/client";

export interface UserPresence {
  userId: string;
  status: "online" | "offline";
  lastSeen: string | null;
}

export async function getFriendsPresence(): Promise<UserPresence[]> {
  const res = await apiClient.get("/presence/friends");
  const d = res.data?.data;
  return Array.isArray(d) ? d : [];
}
