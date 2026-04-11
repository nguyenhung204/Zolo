import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getFriends,
  getFriendRequests,
  getFriendshipStatus,
  sendFriendRequest,
  acceptFriendRequest,
  rejectOrCancelFriendRequest,
  unfriend,
  blockUser,
  unblockUser,
  searchUsers,
  type FriendshipStatus,
} from "@/lib/api/friends";
import { queryKeys } from "@/lib/query/keys";
import { useAuthStore } from "@/stores/authStore";

export function useFriends() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: queryKeys.friends.list(),
    queryFn: getFriends,
    enabled: isAuthenticated,
  });
}

export function useFriendRequests() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: queryKeys.friends.requests(),
    queryFn: getFriendRequests,
    enabled: isAuthenticated,
  });
}

export function useUserSearch(query: string) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: queryKeys.users.search(query),
    queryFn: () => searchUsers(query),
    enabled: isAuthenticated && query.trim().length >= 2,
    staleTime: 15_000,
  });
}

export function useFriendshipStatus(
  targetUserId: string | undefined,
  initialStatus?: FriendshipStatus
) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: queryKeys.friends.status(targetUserId ?? ""),
    queryFn: () => getFriendshipStatus(targetUserId!),
    enabled: isAuthenticated && !!targetUserId,
    initialData:
      targetUserId && initialStatus
        ? {
            userId: "",
            targetUserId,
            status: initialStatus,
          }
        : undefined,
  });
}

function invalidateFriendshipData(qc: ReturnType<typeof useQueryClient>, userId?: string) {
  qc.invalidateQueries({ queryKey: queryKeys.friends.list() });
  qc.invalidateQueries({ queryKey: queryKeys.friends.requests() });
  qc.invalidateQueries({ queryKey: queryKeys.users.all });
  if (userId) {
    qc.invalidateQueries({ queryKey: queryKeys.friends.status(userId) });
  }
}

export function useSendFriendRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: sendFriendRequest,
    onSuccess: (_, userId) => {
      invalidateFriendshipData(qc, userId);
    },
  });
}

export function useAcceptFriendRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acceptFriendRequest,
    onSuccess: (_, userId) => {
      invalidateFriendshipData(qc, userId);
      qc.invalidateQueries({ queryKey: queryKeys.conversations.list() });
    },
  });
}

export function useRejectFriendRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rejectOrCancelFriendRequest,
    onSuccess: (_, userId) => invalidateFriendshipData(qc, userId),
  });
}

export function useUnfriend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: unfriend,
    onSuccess: (_, userId) => invalidateFriendshipData(qc, userId),
  });
}

export function useBlockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: blockUser,
    onSuccess: (_, userId) => invalidateFriendshipData(qc, userId),
  });
}

export function useUnblockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: unblockUser,
    onSuccess: (_, userId) => invalidateFriendshipData(qc, userId),
  });
}
