import { apiClient } from "@/lib/api/client";
import type { AxiosRequestConfig } from "axios";

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
  status: "FRIEND";
  createdAt?: string;
}

export interface PendingRequestsResponse {
  incoming: string[];
  outgoing: string[];
}

export interface FriendshipStatusResponse {
  userId: string;
  targetUserId: string;
  status: FriendshipStatus;
}

export interface FriendsResponse {
  friends: string[];
  fromCache: boolean;
}

export interface FriendshipMutationResponse {
  success: boolean;
  message: string;
  autoAccepted?: boolean;
}

export interface UserSearchResult {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  title?: string;
  friendship?: FriendshipStatus;
}

export interface FriendSearchProfile {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
}

export async function getFriends(): Promise<Friendship[]> {
  const res = await apiClient.get("/friendships");
  const data = res.data?.data as FriendsResponse | undefined;
  const friendIds = Array.isArray(data?.friends) ? data.friends : [];
  return friendIds.map((friendId) => ({
    id: friendId,
    userId: "",
    friendId,
    status: "FRIEND",
  }));
}

export async function getFriendRequests(): Promise<PendingRequestsResponse> {
  const res = await apiClient.get("/friendships/requests");
  const data = res.data?.data as PendingRequestsResponse | undefined;
  return {
    incoming: Array.isArray(data?.incoming) ? data.incoming : [],
    outgoing: Array.isArray(data?.outgoing) ? data.outgoing : [],
  };
}

export async function getFriendshipStatus(
  targetUserId: string
): Promise<FriendshipStatusResponse> {
  const res = await apiClient.get(`/friendships/${targetUserId}/status`);
  return res.data.data;
}

export async function sendFriendRequest(
  toUserId: string
): Promise<FriendshipMutationResponse> {
  const res = await apiClient.post(`/friendships/requests/${toUserId}`);
  return res.data.data;
}

export async function acceptFriendRequest(
  fromUserId: string
): Promise<FriendshipMutationResponse> {
  const res = await apiClient.post(`/friendships/requests/${fromUserId}/accept`);
  return res.data.data;
}

export async function rejectOrCancelFriendRequest(
  userId: string
): Promise<FriendshipMutationResponse> {
  const res = await apiClient.post(`/friendships/requests/${userId}/reject`);
  return res.data.data;
}

export async function unfriend(userId: string): Promise<FriendshipMutationResponse> {
  const res = await apiClient.delete(`/friendships/${userId}`);
  return res.data.data;
}

export async function blockUser(userId: string): Promise<FriendshipMutationResponse> {
  const res = await apiClient.post(`/friendships/blocks/${userId}`);
  return res.data.data;
}

export async function unblockUser(userId: string): Promise<FriendshipMutationResponse> {
  try {
    const res = await apiClient.delete(
      `/friendships/blocks/${userId}`,
      { _silent400: true } as AxiosRequestConfig & { _silent400: boolean }
    );
    return res.data.data;
  } catch (error) {
    const err = error as { status?: number; code?: string; message?: string };
    if (err.status === 400 && err.code === "RESOURCE_CONFLICT" && err.message === "User is not blocked") {
      return { success: true, message: "User is not blocked" };
    }
    throw error;
  }
}

export async function searchUsers(query: string): Promise<UserSearchResult[]> {
  const res = await apiClient.get(`/users/search?q=${encodeURIComponent(query)}`);
  // Response shape: { data: [...], total, page, limit }
  const d = res.data?.data;
  return Array.isArray(d) ? d : [];
}

export async function searchFriends(query: string): Promise<FriendSearchProfile[]> {
  const res = await apiClient.get(`/friendships/search?q=${encodeURIComponent(query)}`);
  // Response may be a raw array or { data: [...] }
  const d = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
  return Array.isArray(d) ? d : [];
}

export function mapFriendshipStatus(status: FriendshipStatus):
  | "none"
  | "pending_out"
  | "pending_in"
  | "friend"
  | "blocked" {
  switch (status) {
    case "PENDING_OUT":
      return "pending_out";
    case "PENDING_IN":
      return "pending_in";
    case "FRIEND":
      return "friend";
    case "BLOCKED":
      return "blocked";
    default:
      return "none";
  }
}
