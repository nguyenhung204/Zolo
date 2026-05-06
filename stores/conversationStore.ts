import { create } from "zustand";

interface ConversationState {
  activeConversationId: string | null;
  replyToMessage: ReplyTarget | null;
  editingMessage: EditTarget | null;
  targetOffset: number | null;
  targetMessageId: string | null;
  messageMode: "LIVE" | "JUMPED";
  pendingJumpedMessages: Record<string, number>;
  setActiveConversation: (id: string | null) => void;
  setReplyTo: (msg: ReplyTarget | null) => void;
  setEditingMessage: (msg: EditTarget | null) => void;
  setTargetOffset: (offset: number | null) => void;
  setTargetMessageId: (messageId: string | null) => void;
  setMessageMode: (mode: "LIVE" | "JUMPED") => void;
  incrementPendingJumpedMessages: (conversationId: string) => void;
  clearPendingJumpedMessages: (conversationId: string) => void;
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
  targetOffset: null,
  targetMessageId: null,
  messageMode: "LIVE",
  pendingJumpedMessages: {},
  setActiveConversation: (id) => set({ activeConversationId: id }),
  setReplyTo: (msg) => set({ replyToMessage: msg }),
  setEditingMessage: (msg) => set({ editingMessage: msg }),
  setTargetOffset: (offset) => set({ targetOffset: offset }),
  setTargetMessageId: (messageId) => set({ targetMessageId: messageId }),
  setMessageMode: (mode) => set({ messageMode: mode }),
  incrementPendingJumpedMessages: (conversationId) =>
    set((state) => ({
      pendingJumpedMessages: {
        ...state.pendingJumpedMessages,
        [conversationId]: (state.pendingJumpedMessages[conversationId] ?? 0) + 1,
      },
    })),
  clearPendingJumpedMessages: (conversationId) =>
    set((state) => {
      const next = { ...state.pendingJumpedMessages };
      delete next[conversationId];
      return { pendingJumpedMessages: next };
    }),
}));
