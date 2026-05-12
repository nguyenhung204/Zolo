"use client";

import { useEffect, useRef } from "react";
import type { Message } from "@/lib/api/messages";
import type { RichMember } from "../types";
import { usePresenceStore } from "@/stores/presenceStore";
import { getQueryClient } from "@/lib/query/queryClient";
import { queryKeys } from "@/lib/query/keys";
import { getUserById } from "@/lib/api/users";

/**
 * Hydrates the presence profile store with sender info for each visible
 * message. Resolves in priority order:
 * 1. Already in presenceStore (no-op)
 * 2. Available from the conversationMember list (avatar already presigned)
 * 3. Fetched from the users API (deduplicated via React Query)
 */
export function usePresenceHydration(
  conversationId: string,
  messages: Message[],
  memberMap: Map<string, RichMember>,
) {
  const setUserProfile = usePresenceStore((s) => s.setUserProfile);
  const qcRef = useRef(getQueryClient());
  // Track which IDs we've already attempted to avoid duplicate fetches.
  const fetchedIdsRef = useRef<Set<string>>(new Set());
  // Reset when switching conversations so a new conversation seeds profiles.
  useEffect(() => {
    fetchedIdsRef.current = new Set();
  }, [conversationId]);
  // Always-current snapshot without making it a dep of the main effect.
  const memberMapRef = useRef(memberMap);
  memberMapRef.current = memberMap;

  useEffect(() => {
    if (messages.length === 0) return;

    const senderIds = new Set(
      messages.map((m) => m.senderId).filter((id) => id && id !== "SYSTEM"),
    );

    for (const senderId of senderIds) {
      if (fetchedIdsRef.current.has(senderId)) continue;

      if (usePresenceStore.getState().profileMap[senderId]) {
        fetchedIdsRef.current.add(senderId);
        continue;
      }

      const member = memberMapRef.current.get(senderId);
      if (member) {
        fetchedIdsRef.current.add(senderId);
        setUserProfile(senderId, {
          displayName: member.displayName ?? member.username ?? null,
          avatarMediaId: null,
          avatarUrl: member.avatarUrl ?? null,
        });
        continue;
      }

      fetchedIdsRef.current.add(senderId);
      qcRef.current
        .fetchQuery({
          queryKey: queryKeys.users.detail(senderId),
          queryFn: () => getUserById(senderId),
          staleTime: 5 * 60_000,
        })
        .then((profile) => {
          const displayName =
            [profile.firstName, profile.lastName].filter(Boolean).join(" ") ||
            profile.username;
          setUserProfile(senderId, {
            displayName,
            avatarMediaId: profile.avatarMediaId ?? null,
            avatarUrl: profile.avatarUrl ?? null,
          });
        })
        .catch(() => {
          // Swallow — UI falls back to placeholder
        });
    }
  }, [messages, setUserProfile]);
}
