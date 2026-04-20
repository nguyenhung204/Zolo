"use client";

import { cn } from "@/lib/utils";
import { Reply, Share2, Pin, Info, Pencil, Ban, Trash2 } from "lucide-react";
import type { Message } from "@/lib/api/messages";

const QUICK_EMOJIS = ["❤️", "😂", "👍", "😮", "😢"];

interface Props {
  isMine: boolean;
  message: Message;
  onEmojiPick?: (emoji: string) => void;
  onReply?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onRevoke?: () => void;
  onForward?: () => void;
  onPin?: () => void;
  onViewDetails?: () => void;
}

export function MessageContextMenu({
  isMine, message, onEmojiPick, onReply, onEdit, onDelete, onRevoke, onForward, onPin, onViewDetails,
}: Props) {
  const now = Date.now();
  const ageMs = now - new Date(message.createdAt).getTime();
  const canEdit = isMine && message.type === "text" && ageMs < 1 * 60 * 60 * 1000;
  const canRevoke = isMine && ageMs < 1 * 60 * 60 * 1000;
  const canDelete = isMine;

  return (
    <div className={cn(
      "absolute z-[9999] bottom-full mb-2 bg-surface rounded-2xl border border-border/80 shadow-xl overflow-hidden min-w-[180px]",
      isMine ? "right-0" : "left-0"
    )}>
      <div className="flex items-center px-2 py-2 gap-0.5 border-b border-border/60">
        {QUICK_EMOJIS.map((e) => (
          <button key={e} onClick={() => onEmojiPick?.(e)}
            className="w-8 h-8 rounded-full flex items-center justify-center text-base transition-transform hover:scale-125 cursor-pointer hover:bg-border/40">
            {e}
          </button>
        ))}
      </div>
      <div className="py-1">
        {onReply && <CtxItem icon={<Reply className="w-3.5 h-3.5" />} label="Trả lời" onClick={onReply} />}
        {onForward && <CtxItem icon={<Share2 className="w-3.5 h-3.5" />} label="Chuyển tiếp" onClick={onForward} />}
        {onPin && <CtxItem icon={<Pin className="w-3.5 h-3.5" />} label="Ghim tin nhắn" onClick={onPin} />}
        {onViewDetails && <CtxItem icon={<Info className="w-3.5 h-3.5" />} label="Xem chi tiết" onClick={onViewDetails} />}
        {canEdit && onEdit && <CtxItem icon={<Pencil className="w-3.5 h-3.5" />} label="Chỉnh sửa" onClick={onEdit} />}
        {canRevoke && onRevoke && <CtxItem icon={<Ban className="w-3.5 h-3.5" />} label="Thu hồi" onClick={onRevoke} danger />}
        {canDelete && onDelete && <CtxItem icon={<Trash2 className="w-3.5 h-3.5" />} label="Xóa" onClick={onDelete} danger />}
      </div>
    </div>
  );
}

function CtxItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 px-3.5 py-2 text-sm transition-colors cursor-pointer text-left",
        danger ? "text-error hover:bg-error/8" : "text-text hover:bg-border/40"
      )}>
      <span className="opacity-60 shrink-0">{icon}</span>{label}
    </button>
  );
}
