"use client";

import { useEffect, useState } from "react";
import { Users, ExternalLink } from "lucide-react";
import { formatTime } from "@/lib/utils/date";

interface Props {
  groupName: string;
  joinUrl: string;
  createdAt: string;
  isMine?: boolean;
}

export function GroupInviteCard({ groupName, joinUrl, createdAt, isMine }: Props) {
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    import("qrcode").then((QRCode) => {
      QRCode.toDataURL(joinUrl, { margin: 2, width: 160, color: { dark: "#0f172a", light: "#ffffff" } })
        .then((url) => { if (!cancelled) setQrDataUrl(url); })
        .catch(() => {});
    });
    return () => { cancelled = true; };
  }, [joinUrl]);

  return (
    <div
      className="w-[220px] rounded-2xl overflow-hidden border border-border/60 shadow-sm select-none"
      style={{ background: "var(--color-surface)" }}
    >
      {/* Header */}
      <div className="bg-cta/10 px-4 pt-4 pb-3 flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-cta/20 flex items-center justify-center shrink-0">
          <Users className="w-4 h-4 text-cta" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-cta/70 font-medium uppercase tracking-wide leading-none mb-0.5">
            Group Invite
          </p>
          <p className="text-[13px] font-semibold text-text truncate leading-tight">{groupName}</p>
        </div>
      </div>

      {/* QR */}
      <div className="flex justify-center py-3 bg-white">
        {qrDataUrl ? (
          <img src={qrDataUrl} alt="QR code" width={140} height={140} className="rounded-lg" />
        ) : (
          <div className="w-[140px] h-[140px] rounded-lg bg-border/30 animate-pulse" />
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 flex items-center justify-between gap-2">
        <a
          href={joinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[11px] text-cta hover:underline truncate"
        >
          <ExternalLink className="w-3 h-3 shrink-0" />
          <span className="truncate">Join group</span>
        </a>
        <span className="text-[10px] text-muted/60 tabular-nums shrink-0">{formatTime(createdAt)}</span>
      </div>
    </div>
  );
}
