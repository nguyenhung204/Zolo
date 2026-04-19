export const queryKeys = {
  // Conversations
  conversations: {
    all: ["conversations"] as const,
    list: () => [...queryKeys.conversations.all, "list"] as const,
    detail: (id: string) => [...queryKeys.conversations.all, "detail", id] as const,
    members: (id: string) => [...queryKeys.conversations.all, "members", id] as const,
    unread: (id: string) => [...queryKeys.conversations.all, "unread", id] as const,
  },

  // Messages
  messages: {
    all: ["messages"] as const,
    list: (conversationId: string) =>
      [...queryKeys.messages.all, "list", conversationId] as const,
    pinned: (conversationId: string) =>
      [...queryKeys.messages.all, "pinned", conversationId] as const,
  },

  // Users
  users: {
    all: ["users"] as const,
    me: () => [...queryKeys.users.all, "me"] as const,
    sessions: () => [...queryKeys.users.all, "sessions"] as const,
    detail: (id: string) => [...queryKeys.users.all, "detail", id] as const,
    search: (query: string) => [...queryKeys.users.all, "search", query] as const,
    presence: (ids: string[]) => [...queryKeys.users.all, "presence", ...ids] as const,
  },

  // Friends
  friends: {
    all: ["friends"] as const,
    list: () => [...queryKeys.friends.all, "list"] as const,
    requests: () => [...queryKeys.friends.all, "requests"] as const,
    blocked: () => [...queryKeys.friends.all, "blocked"] as const,
    status: (userId: string) => [...queryKeys.friends.all, "status", userId] as const,
  },

  // Media
  media: {
    all: ["media"] as const,
    detail: (id: string) => [...queryKeys.media.all, id] as const,
  },

  // Calls
  calls: {
    all: ["calls"] as const,
    active: (conversationId: string) =>
      [...queryKeys.calls.all, "active", conversationId] as const,
  },

  // Stickers
  stickers: {
    all: ["stickers"] as const,
    packages: () => [...queryKeys.stickers.all, "packages"] as const,
    list: (packageId: string) => [...queryKeys.stickers.all, "list", packageId] as const,
  },
} as const;
