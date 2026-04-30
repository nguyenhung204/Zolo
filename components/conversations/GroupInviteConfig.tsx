"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Link2,
  RefreshCw,
  Copy,
  Loader2,
  ShieldOff,
  ExternalLink,
  Share2,
  QrCode,
  Download,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query/keys";
import { generateInviteLink, resetInviteLink, hasMinRole } from "@/lib/api/group";
import { useMyConversationRole, useConversation } from "@/hooks/useConversations";
import type { InviteLink } from "@/lib/api/group";
import type { ApiError } from "@/lib/api/errors";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ShareInviteModal } from "./ShareInviteModal";

interface GroupInviteConfigProps {
  conversationId: string;
}

/**
 * Generates and resets group invite links, plus quality-of-life sharing tools:
 * QR code, copy / download, and share-to-conversation.
 */
export function GroupInviteConfig({ conversationId }: GroupInviteConfigProps) {
  const qc = useQueryClient();
  const myRole = useMyConversationRole(conversationId);
  const { data: conv } = useConversation(conversationId);
  const groupName = conv?.name ?? "this group";

  const canManageLinks = hasMinRole(myRole ?? "member", "admin");

  const { data: inviteLink, isLoading: isLinkLoading } = useQuery<InviteLink | null>({
    queryKey: queryKeys.inviteLink.detail(conversationId),
    queryFn: () => null,
    staleTime: Infinity,
    enabled: canManageLinks,
    initialData: null,
  });

  const generateMutation = useMutation<InviteLink, ApiError>({
    mutationFn: () => generateInviteLink(conversationId),
    onSuccess: (data) => {
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

  const resetMutation = useMutation<void, ApiError>({
    mutationFn: () => resetInviteLink(conversationId),
    onSuccess: () => {
      qc.removeQueries({ queryKey: queryKeys.inviteLink.detail(conversationId) });
      toast.success("All previous invite links have been revoked.");
      setConfirmRevoke(false);
    },
    onError: (err) => {
      if (err.status === 403) {
        toast.error("You need to be an admin to reset invite links.");
      } else {
        toast.error(err.message ?? "Failed to reset the invite link.");
      }
    },
  });

  // ── Local UI state ─────────────────────────────────────────────────────────
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  // Generate QR whenever the link changes
  useEffect(() => {
    let cancelled = false;
    const url = inviteLink?.url;
    if (!url) return;
    QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 256,
      color: { dark: "#0F172A", light: "#FFFFFF" },
    })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [inviteLink?.url]);

  const handleCopy = async () => {
    if (!inviteLink?.url) return;
    try {
      await navigator.clipboard.writeText(inviteLink.url);
      setCopied(true);
      toast.success("Link copied to clipboard.");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy to clipboard.");
    }
  };

  const handleDownloadQr = () => {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    const safeName = groupName.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
    a.download = `zolo-invite-${safeName || "group"}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleShareSystem = async () => {
    if (!inviteLink?.url) return;
    const shareData = {
      title: `Join "${groupName}" on Zolo`,
      text: `Join "${groupName}" on Zolo`,
      url: inviteLink.url,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        /* user cancelled — fall through to in-app share */
      }
    }
    setShowShare(true);
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

  if (!canManageLinks) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link2 className="w-4 h-4 text-muted" />
        <h3 className="text-sm font-semibold text-text">Invite link</h3>
      </div>

      {!inviteLink ? (
        <div className="rounded-2xl border border-border bg-surface-secondary p-5 text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-cta/10 text-cta flex items-center justify-center">
            <Link2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-semibold text-text">No active invite link</p>
            <p className="text-xs text-muted mt-1 max-w-xs mx-auto">
              Generate a 7-day link that anyone can use to join {groupName}.
            </p>
          </div>
          <button
            onClick={() => generateMutation.mutate()}
            disabled={isBusy}
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold",
              "bg-cta text-white hover:bg-cta-hover transition",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Link2 className="w-4 h-4" />
            )}
            Generate invite link
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* QR + URL card */}
          <div className="rounded-2xl border border-border bg-surface-secondary overflow-hidden">
            <div className="flex flex-col sm:flex-row gap-4 p-4">
              <div className="shrink-0 mx-auto sm:mx-0">
                {qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qrDataUrl}
                    alt="Invite link QR code"
                    className="w-32 h-32 rounded-xl bg-white p-1.5 shadow-sm"
                  />
                ) : (
                  <div className="w-32 h-32 rounded-xl bg-white flex items-center justify-center text-muted">
                    <QrCode className="w-8 h-8" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div>
                  <p className="text-xs text-muted">Scan or share the link</p>
                  {formattedExpiry && (
                    <p className="text-xs text-muted mt-0.5">
                      Expires {formattedExpiry} · Valid for 7 days
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2">
                  <ExternalLink className="w-3.5 h-3.5 shrink-0 text-muted" />
                  <span className="flex-1 text-xs text-text font-mono truncate select-all">
                    {inviteLink.url}
                  </span>
                  <button
                    onClick={handleCopy}
                    aria-label="Copy invite link"
                    className="shrink-0 p-1 rounded hover:bg-border/50 transition cursor-pointer"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-success" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-muted" />
                    )}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleShareSystem}
                    disabled={isBusy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cta text-white hover:bg-cta-hover transition cursor-pointer disabled:opacity-50"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    Share
                  </button>
                  <button
                    onClick={() => setShowShare(true)}
                    disabled={isBusy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-surface text-text hover:bg-border/40 transition cursor-pointer disabled:opacity-50"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    Send to chat
                  </button>
                  <button
                    onClick={handleDownloadQr}
                    disabled={!qrDataUrl}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-surface text-text hover:bg-border/40 transition cursor-pointer disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Save QR
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Manage actions */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => generateMutation.mutate()}
              disabled={isBusy}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium",
                "border border-border bg-surface transition",
                "hover:bg-border/40",
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
              onClick={() => setConfirmRevoke(true)}
              disabled={isBusy}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium",
                "border border-error/40 text-error transition",
                "hover:bg-error/10",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              <ShieldOff className="w-3.5 h-3.5" />
              Revoke all links
            </button>
          </div>
        </div>
      )}

      {showShare && inviteLink?.url && (
        <ShareInviteModal
          url={inviteLink.url}
          groupName={groupName}
          onClose={() => setShowShare(false)}
        />
      )}

      <ConfirmDialog
        open={confirmRevoke}
        title="Revoke all invite links?"
        description="Anyone holding the current link won't be able to use it anymore. You can always generate a fresh one afterwards."
        confirmLabel={resetMutation.isPending ? "Revoking…" : "Revoke links"}
        loading={resetMutation.isPending}
        tone="danger"
        onCancel={() => setConfirmRevoke(false)}
        onConfirm={() => resetMutation.mutate()}
      />
    </div>
  );
}
