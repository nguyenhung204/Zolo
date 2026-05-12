import type { Message } from "@/lib/api/messages";
import type { Poll } from "@/lib/api/group";
import type { ConversationMember } from "@/lib/api/conversations";
import type { ReplyTarget } from "@/stores/conversationStore";

// ─── Timeline item discriminated union ───────────────────────────────────────

export type ListItem =
  | { kind: "message"; msg: Message; prev: Message | null; next: Message | null }
  | { kind: "poll"; poll: Poll }
  | { kind: "divider"; label: string }
  | { kind: "padding" };

// ─── Member type enriched with profile fields ─────────────────────────────────

export type RichMember = ConversationMember & {
  displayName?: string;
  username?: string;
  avatarUrl?: string | null;
};

export type OtherMember = {
  userId: string;
  lastSeenOffset: number;
  lastDeliveredOffset: number;
  avatarUrl?: string | null;
  displayName?: string;
  username?: string;
};

// ─── react-window row data ────────────────────────────────────────────────────

export interface RowData {
  items: ListItem[];
  userId: string;
  messageById: Map<string, Message>;
  memberMap: Map<string, RichMember>;
  otherMembers: OtherMember[];
  myRole: ConversationMember["role"] | null;
  canPinMessages: boolean;
  allowMemberMessage: boolean;
  setReplyTo: (msg: ReplyTarget | null) => void;
  onEdit: (msg: Message) => void;
  onDelete: (msg: Message) => void;
  onRevoke: (msg: Message) => void;
  onForward: (msg: Message) => void;
  onPin: (msg: Message) => void;
  onViewDetails: (msg: Message) => void;
  onRetry: (conversationId: string, clientMessageId: string) => void;
  highlightMessageId: string | null;
}
