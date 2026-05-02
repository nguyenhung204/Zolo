"use client";

import { PhoneMissed, PhoneOff, PhoneCall } from "lucide-react";
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
}

export function CallSystemMessage({ message }: Props) {
  const myId = useAuthStore((s) => s.user?.id);
  const { metadata, createdAt } = message;
  const { action, callerId, callerName, durationMs } = metadata ?? {};

  const isCaller = !!myId && myId === callerId;
  const other = callerName ?? "Someone";
  const duration = formatDurationMs(durationMs);

  type Row = { Icon: React.ElementType; color: string; text: string };

  const getRow = (): Row => {
    switch (action as string | undefined) {
      case "CALL_ENDED":
        return {
          Icon: PhoneCall,
          color: "text-success",
          text: duration ? `Call ended · ${duration}` : "Call ended",
        };
      case "CALL_REJECTED":
        return isCaller
          ? { Icon: PhoneOff, color: "text-error", text: "Call declined" }
          : { Icon: PhoneOff, color: "text-warning", text: `You declined · ${other}` };
      case "CALL_MISSED_BUSY":
        return isCaller
          ? { Icon: PhoneOff, color: "text-warning", text: "Call failed · Busy" }
          : { Icon: PhoneMissed, color: "text-error", text: `Missed call · ${other} was busy` };
      case "CALL_MISSED":
      default:
        return isCaller
          ? { Icon: PhoneMissed, color: "text-warning", text: "No answer" }
          : { Icon: PhoneMissed, color: "text-error", text: `Missed call · ${other}` };
    }
  };

  const { Icon, color, text } = getRow();

  return (
    <div className="flex justify-center py-1.5 px-4 select-none">
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface border border-border/50">
        <Icon className={cn("w-3.5 h-3.5 shrink-0", color)} />
        <span className="text-xs text-muted">{text}</span>
        <span className="text-[10px] text-muted/60">· {formatTime(createdAt)}</span>
      </div>
    </div>
  );
}
