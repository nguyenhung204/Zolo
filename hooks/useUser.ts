import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getMyProfile,
  getUserById,
  updateMyProfile,
  updateMySettings,
  deleteMyAccount,
  getMySessions,
  deleteAllSessions,
  deleteSession,
  type UpdateProfileDto,
  type UpdateSettingsDto,
} from "@/lib/api/users";
import { queryKeys } from "@/lib/query/keys";
import { useAuthStore } from "@/stores/authStore";
import { usePresenceStore } from "@/stores/presenceStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import type { Theme, MessageDensity } from "@/stores/preferencesStore";
import { clearClientAuthSession } from "@/lib/auth/logout";

export function useMyProfile() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const token = useAuthStore((s) => s.token);
  const setAuth = useAuthStore((s) => s.setAuth);
  const setUserProfile = usePresenceStore((s) => s.setUserProfile);

  const query = useQuery({
    queryKey: queryKeys.users.me(),
    queryFn: () => getMyProfile("thumb"),
    enabled: isAuthenticated,
    // avatarUrl is a presigned URL with ~5 min TTL — keep stale time below
    // that so the URL is refreshed before it expires.
    staleTime: 4 * 60_000,
  });

  // Sync avatarUrl and display name from API profile → authStore so all
  // components (NavRail, conversation avatars) stay in sync without mutations.
  useEffect(() => {
    if (query.data && token) {
      const displayName =
        [query.data.firstName, query.data.lastName].filter(Boolean).join(" ") ||
        query.data.username;
      setAuth({ token, user: { avatarUrl: query.data.avatarUrl, name: displayName } });
      setUserProfile(query.data.id, {
        displayName,
        avatarMediaId: query.data.avatarMediaId ?? null,
        avatarUrl: query.data.avatarUrl ?? null,
      });
    }
  }, [query.data]); // eslint-disable-line react-hooks/exhaustive-deps

  return query;
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const setAuth = useAuthStore((s) => s.setAuth);
  const setUserProfile = usePresenceStore((s) => s.setUserProfile);

  return useMutation({
    mutationFn: (dto: UpdateProfileDto) => updateMyProfile(dto, "thumb"),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.users.me(), data);
      if (token) {
        const displayName = [data.firstName, data.lastName].filter(Boolean).join(" ") || data.username;
        setAuth({
          token,
          user: {
            avatarUrl: data.avatarUrl,
            name: displayName,
          },
        });
      }
      setUserProfile(data.id, {
        displayName: [data.firstName, data.lastName].filter(Boolean).join(" ") || data.username,
        avatarMediaId: data.avatarMediaId ?? null,
        avatarUrl: data.avatarUrl ?? null,
      });
    },
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  const setTheme = usePreferencesStore((s) => s.setTheme);
  const setMessageDensity = usePreferencesStore((s) => s.setMessageDensity);

  return useMutation({
    mutationFn: (dto: UpdateSettingsDto) => updateMySettings(dto),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.users.me(), data);
      if (data.settings?.theme) setTheme(data.settings.theme as Theme);
      if (data.settings?.messageDensity) setMessageDensity(data.settings.messageDensity as MessageDensity);
    },
  });
}

export function useSessions() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: queryKeys.users.sessions(),
    queryFn: getMySessions,
    enabled: isAuthenticated,
    staleTime: 30_000,
  });
}

export function useDeleteAllSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteAllSessions,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.users.sessions() });
    },
  });
}

export function useDeleteMyAccount() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: deleteMyAccount,
    onSuccess: () => {
      qc.clear();
      clearClientAuthSession();
    },
  });
}

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => deleteSession(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.users.sessions() });
    },
  });
}

export function useUserById(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.users.detail(userId ?? ""),
    queryFn: () => getUserById(userId!),
    enabled: !!userId,
    staleTime: 4 * 60_000,
  });
}
