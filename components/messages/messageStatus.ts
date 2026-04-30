import type { Message } from "@/lib/api/messages";

export type MessageDeliveryStatus = "sending" | "sent" | "delivered" | "read" | "failed";

export interface MemberCursor {
  lastSeenOffset: number;
  lastDeliveredOffset: number;
}

export function resolveMessageDeliveryStatus(
  message: Message & { _pending?: boolean; _failed?: boolean },
  otherMembers: MemberCursor[] = []
): MessageDeliveryStatus {
  if (message._failed) return "failed";
  if (message._pending || message.offset == null || message.offset < 0) return "sending";

  const offset = Number(message.offset);
  const hasSeen = otherMembers.some((m) => offset > 0 && Number(m.lastSeenOffset ?? 0) >= offset);
  if (hasSeen) return "read";

  const hasDelivered = otherMembers.some((m) => offset > 0 && Number(m.lastDeliveredOffset ?? 0) >= offset);
  if (hasDelivered) return "delivered";

  return message.deliveryStatus ?? "sent";
}

export function messageDeliveryLabel(status: MessageDeliveryStatus) {
  switch (status) {
    case "sending":
      return "Đang gửi";
    case "failed":
      return "Gửi lỗi";
    case "read":
      return "Đã xem";
    case "delivered":
      return "Đã nhận";
    case "sent":
    default:
      return "Đã gửi";
  }
}
