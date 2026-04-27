"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Link2,
  RefreshCw,
  Copy,
  Loader2,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query/keys";
import { generateInviteLink, resetInviteLink, hasMinRole } from "@/lib/api/group";
import { useMyConversationRole } from "@/hooks/useConversations";
import type { InviteLink } from "@/lib/api/group";
import type { ApiError } from "@/lib/api/errors";

// ─── Props ────────────────────────────────────────────────────────────────────

interface GroupInviteConfigProps {
  conversationId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Generates and resets group invite links.
 *
 * Implements Section 2.3 of FE_INTEGRATION_GUIDE.md:
 *
 * - GENERATE: POST /conversations/:id/invite-link — stores the returned URL
 *   in the React Query cache (`queryKeys.inviteLink.detail`).
 *
 * - RESET: POST /conversations/:id/invite-link/reset — immediately clears
 *   the cached URL on success so the old (now-invalid) link is never shown.
 *   The `group.invite_link_reset` Socket.IO event (handled in
 *   useGroupSocketEvents) triggers the same cache eviction for all other
 *   admins who currently have the UI open.
 *
 * Access is restricted to ADMIN or above (§2.3). The UI is hidden for members.
 */
export function GroupInviteConfig({ conversationId }: GroupInviteConfigProps) {
  const qc = useQueryClient();
  const myRole = useMyConversationRole(conversationId);

  const canManageLinks = hasMinRole(myRole ?? "member", "admin");

  // ── Current invite link query ──────────────────────────────────────────────
  // The query key matches what useGroupSocketEvents evicts on
  // `group.invite_link_reset` — keeping both in sync automatically.
  const {
    data: inviteLink,
    isLoading: isLinkLoading,
  } = useQuery<InviteLink | null>({
    queryKey: queryKeys.inviteLink.detail(conversationId),
    queryFn: () => null, // Link is populated only via the generate mutation.
    staleTime: Infinity, // Populated by mutation; socket event evicts on reset.
    enabled: canManageLinks,
    initialData: null,
  });

  // ── Generate mutation ──────────────────────────────────────────────────────
  const generateMutation = useMutation<InviteLink, ApiError>({
    mutationFn: () => generateInviteLink(conversationId),
    onSuccess: (data) => {
      // Populate the cache with the new link so the UI renders immediately.
      qc.setQueryData<InviteLink>(queryKeys.inviteLink.detail(conversationId), data);
      toast.success("Invite link generated.");
    },
    onError: (err) => {
      if (err.status === 403) {
        toast.error("You need to be an admin to generate invite links.");
      } else {
        toast.error(err.message ?? "Failed to generate invite link.");
      }
    },
  });

  // ── Reset mutation ─────────────────────────────────────────────────────────
  // On success, instantly delete the cached URL so the old (now-revoked) link
  // is never displayed. The socket event (`group.invite_link_reset`) will
  // trigger the same eviction on all other open clients (§4.4 / §3).
  const resetMutation = useMutation<void, ApiError>({
    mutationFn: () => resetInviteLink(conversationId),
    onSuccess: () => {
      // Evict immediately — do not display the stale, now-invalid URL.
      qc.removeQueries({ queryKey: queryKeys.inviteLink.detail(conversationId) });
      toast.success("All previous invite links have been revoked.");
    },
    onError: (err) => {
      if (err.status === 403) {
        toast.error("You need to be an admin to reset invite links.");
      } else {
        toast.error(err.message ?? "Failed to reset the invite link.");
      }
    },
  });

  // ── Copy to clipboard ──────────────────────────────────────────────────────
  const handleCopy = async () => {
    if (!inviteLink?.url) return;
    try {
      await navigator.clipboard.writeText(inviteLink.url);
      toast.success("Link copied to clipboard.");
    } catch {
      toast.error("Could not copy to clipboard.");
    }
  };

  const isGenerating = generateMutation.isPending;
  const isResetting = resetMutation.isPending;
  const isBusy = isGenerating || isResetting || isLinkLoading;

  const formattedExpiry = inviteLink?.expiresAt
    ? new Date(inviteLink.expiresAt).toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  // ── Guard: hide entirely for members ──────────────────────────────────────
  if (!canManageLinks) return null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Link2 className="w-4 h-4 text-muted" />
        <h3 className="text-sm font-semibold text-text">Invite Link</h3>
      </div>

      {inviteLink ? (
        // ── Active link state ─────────────────────────────────────────────
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2">
            <ExternalLink className="w-3.5 h-3.5 flex-shrink-0 text-muted" />
            <span className="flex-1 text-xs text-text truncate font-mono select-all">
              {inviteLink.url}
            </span>
            <button
              onClick={handleCopy}
              aria-label="Copy invite link"
              className="flex-shrink-0 p-1 rounded hover:bg-muted/20 transition-colors"
            >
              <Copy className="w-3.5 h-3.5 text-muted" />
            </button>
          </div>

          {formattedExpiry && (
            <p className="text-xs text-muted px-1">
              Expires {formattedExpiry} · Valid for 7 days
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => generateMutation.mutate()}
              disabled={isBusy}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium",
                "border border-border bg-surface transition-colors",
                "hover:bg-border/40 focus-visible:outline-none",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {isGenerating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Regenerate
            </button>

            <button
              onClick={() => resetMutation.mutate()}
              disabled={isBusy}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium",
                "border border-error/40 text-error transition-colors",
                "hover:bg-error/10 focus-visible:outline-none",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {isResetting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5" />
              )}
              Revoke all links
            </button>
          </div>
        </div>
      ) : (
        // ── No link / evicted state ───────────────────────────────────────
        <div className="space-y-2">
          <p className="text-xs text-muted">
            Generate a 7-day invite link that anyone can use to join this group.
          </p>
          <button
            onClick={() => generateMutation.mutate()}
            disabled={isBusy}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium",
              "bg-cta text-white transition-colors",
              "hover:bg-cta/90 focus-visible:outline-none",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {isGenerating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Link2 className="w-3.5 h-3.5" />
            )}
            Generate invite link
          </button>
        </div>
      )}
    </div>
  );
}
