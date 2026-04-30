import { useQueries } from "@tanstack/react-query";
import { useFriends } from "@/hooks/useFriends";
import { getUserById, type UserProfile } from "@/lib/api/users";
import { queryKeys } from "@/lib/query/keys";
import { useAuthStore } from "@/stores/authStore";

/**
 * Returns the full user profile for every friend ID in `GET /friendships`.
 *
 * The API only returns IDs, so we fan-out per-ID `getUserById` calls. Each
 * profile is independently cached by react-query under
 * `queryKeys.users.detail(id)`, so subsequent renders, profile modals, and
 * other consumers all share the same in-memory copy.
 */
export function useFriendProfiles() {
  const { data: friends = [], isLoading: friendsLoading } = useFriends();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const queries = useQueries({
    queries: friends.map((f) => ({
      queryKey: queryKeys.users.detail(f.friendId),
      queryFn: () => getUserById(f.friendId),
      enabled: isAuthenticated,
      staleTime: 4 * 60_000,
    })),
  });

  const profiles = queries
    .map((q) => q.data)
    .filter((u): u is UserProfile => !!u);

  return {
    profiles,
    isLoading: friendsLoading || queries.some((q) => q.isLoading),
    isFetching: queries.some((q) => q.isFetching),
    friendIds: friends.map((f) => f.friendId),
  };
}
