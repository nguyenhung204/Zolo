"use client";

import type { ReactNode } from "react";
import { X, Reply, Pencil, Clock3, ShieldAlert, User, MessageSquareText, Image, Video, Mic, Sticker, ClipboardList, Hash, Eye, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Message } from "@/lib/api/messages";

type MemberLike = { displayName?: string; username?: string; avatarUrl?: string | null };

interface OtherMemberCursor {
  userId: string;
  displayName?: string;
  username?: string;
  avatarUrl?: string | null;
  lastSeenOffset: number;
  lastDeliveredOffset: number;
}

interface MessageDetailsModalProps {
  message: Message;
  memberMap: Map<string, MemberLike>;
  messageById: Map<string, Message>;
  otherMembers?: OtherMemberCursor[];
  onClose: () => void;
}

function rowIcon(type: string) {
  switch (type) {
    case "text": return <MessageSquareText className="w-4 h-4" />;
    case "image": return <Image className="w-4 h-4" />;
    case "video": return <Video className="w-4 h-4" />;
    case "audio": return <Mic className="w-4 h-4" />;
    case "file": return <ClipboardList className="w-4 h-4" />;
    case "sticker": return <Sticker className="w-4 h-4" />;
    default: return <Hash className="w-4 h-4" />;
  }
}

function typeLabel(type: string) {
  const map: Record<string, string> = {
    text: "Văn bản",
    image: "Hình ảnh",
    video: "Video",
    audio: "Giọng nói",
    file: "Tệp đính kèm",
    sticker: "Nhãn dán",
  };
  return map[type] ?? type;
}

function formatDateVN(iso: string | undefined | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function resolveName(member: MemberLike | undefined): string {
  return member?.displayName ?? member?.username ?? "Không rõ";
}

function Field({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-bg px-3 py-2">
      <div className="mt-0.5 text-cta shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wide text-muted mb-0.5">{label}</p>
        <div className="text-sm text-text break-words">{value}</div>
      </div>
    </div>
  );
}

export function MessageDetailsModal({ message, memberMap, messageById, otherMembers = [], onClose }: MessageDetailsModalProps) {
  const senderName = resolveName(memberMap.get(message.senderId));

  const repliedToMsg = message.replyToMessageId ? messageById.get(message.replyToMessageId) ?? null : null;
  const repliedToSenderName = repliedToMsg ? resolveName(memberMap.get(repliedToMsg.senderId)) : null;

  const isEdited = !!message.editedAt;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <p className="text-[10px] font-semibold text-cta uppercase tracking-wide">Chi tiết</p>
            <h2 className="text-base font-bold text-text">Xem chi tiết tin nhắn</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-muted hover:text-text hover:bg-border/60 transition-colors cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          {/* Content preview */}
          <div className={cn("rounded-2xl border px-4 py-3", message.isRevoked ? "border-error/30 bg-error/5" : message.deletedAt ? "border-warning/30 bg-warning/5" : "border-border bg-bg")}>
            <div className="flex items-center gap-2 text-sm text-text font-medium">
              {rowIcon(message.type)}
              <span>{typeLabel(message.type)}</span>
              {isEdited && <Pencil className="w-3.5 h-3.5 text-cta" />}
              {repliedToMsg && <Reply className="w-3.5 h-3.5 text-cta" />}
            </div>
            <p className="mt-2 text-sm text-text whitespace-pre-wrap break-words">{message.content || "(trống)"}</p>
          </div>

          <Field icon={<User className="w-4 h-4" />} label="Người gửi" value={senderName} />
          <Field icon={<Clock3 className="w-4 h-4" />} label="Thời gian gửi" value={formatDateVN(message.createdAt)} />
          <Field
            icon={<ShieldAlert className="w-4 h-4" />}
            label="Trạng thái"
            value={message.isRevoked ? "Đã thu hồi" : message.deletedAt ? "Đã xóa" : message._failed ? "Thất bại" : message._pending ? "Đang gửi" : "Đã gửi"}
          />
          {isEdited && (
            <Field icon={<Pencil className="w-4 h-4" />} label="Đã chỉnh sửa lúc" value={formatDateVN(message.editedAt)} />
          )}
          {repliedToMsg && repliedToSenderName && (
            <Field
              icon={<Reply className="w-4 h-4" />}
              label="Trả lời tin nhắn của"
              value={
                <span>
                  <span className="font-medium">{repliedToSenderName}</span>
                  <span className="text-muted"> — </span>
                  <span className="text-muted">{repliedToMsg.content || "(không có nội dung)"}</span>
                </span>
              }
            />
          )}

          {/* Seen / Delivered sections — only shown when offset is valid */}
          {message.offset > 0 && otherMembers.length > 0 && (() => {
            const seenMembers = otherMembers.filter((m) => m.lastSeenOffset >= message.offset);
            const deliveredMembers = otherMembers.filter((m) => m.lastDeliveredOffset >= message.offset && m.lastSeenOffset < message.offset);
            return (
              <>
                {seenMembers.length > 0 && (
                  <div className="rounded-xl border border-border/60 bg-bg px-3 py-2">
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted mb-2">
                      <Eye className="w-3.5 h-3.5 text-cta shrink-0" />
                      <span>Đã xem ({seenMembers.length})</span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {seenMembers.map((m) => (
                        <div key={m.userId} className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full overflow-hidden bg-border shrink-0">
                            {m.avatarUrl ? (
                              <img src={m.avatarUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[9px] text-muted font-bold">
                                {(m.displayName ?? m.username ?? "?")[0].toUpperCase()}
                              </div>
                            )}
                          </div>
                          <span className="text-sm text-text">{m.displayName ?? m.username ?? m.userId.slice(0, 8)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {deliveredMembers.length > 0 && (
                  <div className="rounded-xl border border-border/60 bg-bg px-3 py-2">
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted mb-2">
                      <CheckCheck className="w-3.5 h-3.5 text-muted shrink-0" />
                      <span>Đã nhận ({deliveredMembers.length})</span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {deliveredMembers.map((m) => (
                        <div key={m.userId} className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full overflow-hidden bg-border shrink-0">
                            {m.avatarUrl ? (
                              <img src={m.avatarUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[9px] text-muted font-bold">
                                {(m.displayName ?? m.username ?? "?")[0].toUpperCase()}
                              </div>
                            )}
                          </div>
                          <span className="text-sm text-text">{m.displayName ?? m.username ?? m.userId.slice(0, 8)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
