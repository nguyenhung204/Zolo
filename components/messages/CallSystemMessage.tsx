"use client";

import { PhoneMissed, PhoneOff, PhoneCall, PhoneIncoming, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Message } from "@/lib/api/messages";
import { formatTime } from "@/lib/utils/date";
import { useAuthStore } from "@/stores/authStore";

function formatDurationMs(ms: number | undefined): string | null {
  if (!ms || ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (sec > 0 || parts.length === 0) parts.push(`${sec}s`);
  return parts.join(" ");
}

interface Props {
  message: Message;
  /** When provided (direct conv, type="text"), renders as a directional card instead of a centered pill */
  isMine?: boolean;
}

type CallRow = {
  Icon: React.ElementType;
  /** Tailwind text color for the icon circle bg tint and text */
  variant: "success" | "error" | "warning" | "neutral";
  title: string;
  subtitle: string | null;
};

export function CallSystemMessage({ message, isMine }: Props) {
  const myId = useAuthStore((s) => s.user?.id);
  const { metadata, createdAt, senderId } = message;
  const { action: rawAction, callerId, callerName, durationMs, isMissed, reason } = metadata ?? {};

  const resolvedCallerId = callerId ?? senderId;
  const isCaller = !!myId && myId === resolvedCallerId;
  const other = callerName ?? "Someone";

  const action: string | undefined = rawAction ?? (
    reason === "callee_busy" ? "CALL_MISSED_BUSY" :
    isMissed ? "CALL_MISSED" :
    undefined
  );
  const duration = formatDurationMs(durationMs);

  const getRow = (): CallRow => {
    switch (action) {
      case "CALL_ENDED":
        return {
          Icon: PhoneCall,
          variant: "success",
          title: "Cuộc gọi đã kết thúc",
          subtitle: duration ?? null,
        };
      case "CALL_REJECTED":
        return isCaller
          ? { Icon: PhoneOff, variant: "error", title: "Cuộc gọi bị từ chối", subtitle: null }
          : { Icon: PhoneOff, variant: "warning", title: "Bạn đã từ chối cuộc gọi", subtitle: other };
      case "CALL_MISSED_BUSY":
        return isCaller
          ? { Icon: PhoneOff, variant: "warning", title: "Cuộc gọi thất bại", subtitle: "Đường dây bận" }
          : { Icon: PhoneMissed, variant: "error", title: "Cuộc gọi nhỡ", subtitle: `${other} đang bận` };
      case "CALL_MISSED":
      default:
        return isCaller
          ? { Icon: PhoneMissed, variant: "warning", title: "Không có người trả lời", subtitle: null }
          : { Icon: PhoneMissed, variant: "error", title: "Cuộc gọi nhỡ", subtitle: other };
    }
  };

  const { Icon, variant, title, subtitle } = getRow();

  const variantStyles: Record<CallRow["variant"], { bg: string; iconColor: string; titleColor: string }> = {
    success: {
      bg: "bg-emerald-50 dark:bg-emerald-950/30",
      iconColor: "text-emerald-500",
      titleColor: "text-emerald-600 dark:text-emerald-400",
    },
    error: {
      bg: "bg-red-50 dark:bg-red-950/30",
      iconColor: "text-red-500",
      titleColor: "text-red-600 dark:text-red-400",
    },
    warning: {
      bg: "bg-amber-50 dark:bg-amber-950/30",
      iconColor: "text-amber-500",
      titleColor: "text-amber-600 dark:text-amber-400",
    },
    neutral: {
      bg: "bg-slate-100 dark:bg-slate-800",
      iconColor: "text-slate-500",
      titleColor: "text-slate-600 dark:text-slate-400",
    },
  };

  const styles = variantStyles[variant];

  // ─── Directional card (direct conv, type="text") ───────────────────────────
  if (isMine !== undefined) {
    return (
      <div
        className="flex items-center gap-3 w-[240px] px-3 py-2.5 rounded-2xl border border-border/60 shadow-sm select-none"
        style={{ background: "var(--color-surface, #fff)" }}
      >
        {/* Icon circle */}
        <div className={cn("flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center", styles.bg)}>
          <Icon className={cn("w-5 h-5", styles.iconColor)} />
        </div>

        {/* Text */}
        <div className="flex flex-col min-w-0 flex-1">
          <span className={cn("text-[13px] font-semibold leading-tight", styles.titleColor)}>
            {title}
          </span>
          {subtitle && (
            <span className="text-[11px] text-muted leading-tight mt-0.5 truncate">{subtitle}</span>
          )}
          <span className="text-[10px] text-muted/60 mt-1 tabular-nums">{formatTime(createdAt)}</span>
        </div>
      </div>
    );
  }

  // ─── Centered pill (group/announcement conv, type="system") ───────────────
  const pillStyle: Record<CallRow["variant"], string> = {
    success: "text-emerald-600 dark:text-emerald-400",
    error: "text-red-500",
    warning: "text-amber-600 dark:text-amber-400",
    neutral: "text-muted",
  };

  return (
    <div className="flex justify-center py-1.5 px-4 select-none">
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface border border-border/50">
        <Icon className={cn("w-3.5 h-3.5 shrink-0", pillStyle[variant])} />
        <span className={cn("text-xs", pillStyle[variant])}>{title}</span>
        {subtitle && <span className="text-xs text-muted">· {subtitle}</span>}
        <span className="text-[10px] text-muted/60">· {formatTime(createdAt)}</span>
      </div>
    </div>
  );
}

