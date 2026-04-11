import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getFriends,
  getFriendRequests,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  unfriend,
  blockUser,
  searchUsers,
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

export function useSendFriendRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: sendFriendRequest,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.friends.all });
      qc.invalidateQueries({ queryKey: queryKeys.users.all });
    },
  });
}

export function useAcceptFriendRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acceptFriendRequest,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.friends.all });
      qc.invalidateQueries({ queryKey: queryKeys.conversations.list() });
    },
  });
}

export function useRejectFriendRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rejectFriendRequest,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.friends.all }),
  });
}

export function useUnfriend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: unfriend,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.friends.all }),
  });
}

export function useBlockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: blockUser,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.friends.all }),
  });
}
