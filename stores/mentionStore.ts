import { create } from "zustand";

interface MentionState {
  /** Set of conversationIds where the current user has unread mentions */
  mentionedConversations: Set<string>;
  setMention: (conversationId: string) => void;
  clearMention: (conversationId: string) => void;
}

export const useMentionStore = create<MentionState>((set) => ({
  mentionedConversations: new Set(),
  setMention: (conversationId) =>
    set((state) => ({
      mentionedConversations: new Set([...state.mentionedConversations, conversationId]),
    })),
  clearMention: (conversationId) =>
    set((state) => {
      const next = new Set(state.mentionedConversations);
      next.delete(conversationId);
      return { mentionedConversations: next };
    }),
}));
