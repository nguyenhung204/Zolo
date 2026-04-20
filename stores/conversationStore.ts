import { create } from "zustand";

interface ConversationState {
  activeConversationId: string | null;
  replyToMessage: ReplyTarget | null;
  editingMessage: EditTarget | null;
  setActiveConversation: (id: string | null) => void;
  setReplyTo: (msg: ReplyTarget | null) => void;
  setEditingMessage: (msg: EditTarget | null) => void;
}

export interface ReplyTarget {
  messageId: string;
  senderId: string;
  senderName?: string;
  content: string;
  type: string;
  metadata?: {
    filename?: string;
    durationMs?: number;
    [key: string]: unknown;
  };
}

export interface EditTarget {
  messageId: string;
  content: string;
}

export const useConversationStore = create<ConversationState>((set) => ({
  activeConversationId: null,
  replyToMessage: null,
  editingMessage: null,
  setActiveConversation: (id) => set({ activeConversationId: id }),
  setReplyTo: (msg) => set({ replyToMessage: msg }),
  setEditingMessage: (msg) => set({ editingMessage: msg }),
}));
