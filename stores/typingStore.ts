import { create } from "zustand";

// conversationId → Set of userIds currently typing
type TypingMap = Record<string, Set<string>>;

interface TypingState {
  typingMap: TypingMap;
  setTyping: (conversationId: string, userId: string) => void;
  clearTyping: (conversationId: string, userId: string) => void;
  clearConversationTyping: (conversationId: string) => void;
}

export const useTypingStore = create<TypingState>((set, get) => ({
  typingMap: {},

  setTyping: (conversationId, userId) =>
    set((state) => {
      const current = new Set(state.typingMap[conversationId]);
      current.add(userId);
      return { typingMap: { ...state.typingMap, [conversationId]: current } };
    }),

  clearTyping: (conversationId, userId) =>
    set((state) => {
      const current = new Set(state.typingMap[conversationId]);
      current.delete(userId);
      return { typingMap: { ...state.typingMap, [conversationId]: current } };
    }),

  clearConversationTyping: (conversationId) =>
    set((state) => {
      const next = { ...state.typingMap };
      delete next[conversationId];
      return { typingMap: next };
    }),
}));
