import { create } from "zustand";

interface ConversationState {
  activeConversationId: string | null;
  replyToMessage: ReplyTarget | null;
  setActiveConversation: (id: string | null) => void;
  setReplyTo: (msg: ReplyTarget | null) => void;
}

export interface ReplyTarget {
  messageId: string;
  senderId: string;
  content: string;
  type: string;
}

export const useConversationStore = create<ConversationState>((set) => ({
  activeConversationId: null,
  replyToMessage: null,
  setActiveConversation: (id) => set({ activeConversationId: id }),
  setReplyTo: (msg) => set({ replyToMessage: msg }),
}));
