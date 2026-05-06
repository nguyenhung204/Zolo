export const queryKeys = {
  // Conversations
  conversations: {
    all: ["conversations"] as const,
    list: () => [...queryKeys.conversations.all, "list"] as const,
    search: (query: string, limit = 30) =>
      [...queryKeys.conversations.all, "search", query, limit] as const,
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
    search: (query: string) => [...queryKeys.friends.all, "search", query] as const,
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
    history: (conversationId: string) =>
      [...queryKeys.calls.all, "history", conversationId] as const,
    summary: (callId: string) =>
      [...queryKeys.calls.all, "summary", callId] as const,
  },

  // Stickers
  stickers: {
    all: ["stickers"] as const,
    packages: () => [...queryKeys.stickers.all, "packages"] as const,
    list: (packageId: string) => [...queryKeys.stickers.all, "list", packageId] as const,
  },

  // Notifications
  notifications: {
    all: ["notifications"] as const,
    preferences: (conversationId?: string) =>
      conversationId
        ? ([...queryKeys.notifications.all, "preferences", conversationId] as const)
        : ([...queryKeys.notifications.all, "preferences"] as const),
  },

  // Group Management
  polls: {
    all: ["polls"] as const,
    list: (conversationId: string) => ["polls", "list", conversationId] as const,
    detail: (pollId: string) => ["polls", "detail", pollId] as const,
  },

  appointments: {
    all: ["appointments"] as const,
    list: (conversationId: string) => ["appointments", "list", conversationId] as const,
  },

  inviteLink: {
    detail: (conversationId: string) => ["inviteLink", conversationId] as const,
  },

  joinRequests: {
    list: (conversationId: string) => ["joinRequests", "list", conversationId] as const,
  },
} as const;
