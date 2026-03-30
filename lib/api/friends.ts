import { apiClient } from "@/lib/api/client";

export type FriendshipStatus =
  | "FRIEND"
  | "PENDING_IN"
  | "PENDING_OUT"
  | "BLOCKED"
  | "NONE";

export interface Friendship {
  id: string;
  userId: string;
  friendId: string;
  status: FriendshipStatus;
  createdAt: string;
}

export interface FriendRequest {
  id: string;
  fromUserId: string;
  toUserId: string;
  createdAt: string;
}

export interface UserSearchResult {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  title?: string;
  friendship: FriendshipStatus;
}

export async function getFriends(): Promise<Friendship[]> {
  const res = await apiClient.get("/friendships");
  const d = res.data?.data;
  return Array.isArray(d) ? d : [];
}

export async function getFriendRequests(): Promise<FriendRequest[]> {
  const res = await apiClient.get("/friendships/requests");
  const d = res.data?.data;
  return Array.isArray(d) ? d : [];
}

export async function sendFriendRequest(toUserId: string): Promise<void> {
  await apiClient.post(`/friendships/requests/${toUserId}`);
}

export async function acceptFriendRequest(fromUserId: string): Promise<void> {
  await apiClient.post(`/friendships/requests/${fromUserId}/accept`);
}

export async function rejectFriendRequest(fromUserId: string): Promise<void> {
  await apiClient.delete(`/friendships/requests/${fromUserId}`);
}

export async function unfriend(userId: string): Promise<void> {
  await apiClient.delete(`/friendships/${userId}`);
}

export async function blockUser(userId: string): Promise<void> {
  await apiClient.post(`/friendships/${userId}/block`);
}

export async function searchUsers(query: string): Promise<UserSearchResult[]> {
  const res = await apiClient.get(`/users/search?q=${encodeURIComponent(query)}`);
  const d = res.data?.data;
  return Array.isArray(d) ? d : [];
}
