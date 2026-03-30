// ─── Shared domain types ─────────────────────────────────────────────────────

export type MessageType = "TEXT" | "IMAGE" | "FILE" | "AUDIO" | "VIDEO" | "SYSTEM";
export type MediaStatus = "CREATED" | "UPLOADED" | "PROCESSING" | "READY" | "FAILED";

export interface WsMessage {
  messageId: string;
  conversationId: string;
  senderId: string;
  content: string;
  type: MessageType;
  offset: number;
  mediaId?: string;
  mediaStatus?: MediaStatus;
  replyToMessageId?: string;
  clientMessageId?: string;
  createdAt: string;
  editedAt?: string;
  deletedAt?: string;
  metadata?: {
    mentions?: string[];
    tags?: string[];
    attachmentUrls?: string[];
  };
}

// ─── Client → Server events ──────────────────────────────────────────────────

export interface ClientEvents {
  authenticate: (payload: {
    token: string;
    deviceId?: string;
    deviceType?: "web" | "mobile" | "desktop";
  }) => void;

  "conversation:join": (payload: { conversationId: string }) => void;
  "conversation:leave": (payload: { conversationId: string }) => void;

  "message:send": (payload: {
    conversationId: string;
    content: string;
    type: MessageType;
    clientMessageId: string;
    replyToMessageId?: string;
    mediaId?: string;
  }) => void;

  "typing:start": (payload: { conversationId: string }) => void;
  "typing:stop": (payload: { conversationId: string }) => void;

  "conversation:update_seen_cursor": (payload: {
    conversationId: string;
    upToOffset: number;
  }) => void;

  "conversation:update_delivered_cursor": (payload: {
    conversationId: string;
    upToOffset: number;
  }) => void;

  heartbeat: () => void;
}

// ─── Server → Client events ──────────────────────────────────────────────────

export interface ServerEvents {
  authenticated: (data: { userId: string; socketId: string }) => void;

  "message:new": (data: WsMessage) => void;
  "message:notify": (data: {
    conversationId: string;
    latestOffset: number;
  }) => void;
  "message:saved": (data: {
    clientMessageId: string;
    messageId: string;
    conversationId: string;
    offset: number;
  }) => void;
  "message:queued": (data: {
    clientMessageId: string;
    messageId: string;
  }) => void;
  "message:rejected": (data: {
    clientMessageId: string;
    code: string;
    reason: string;
  }) => void;
  "message:edited": (data: {
    messageId: string;
    conversationId: string;
    content: string;
    editedAt: string;
  }) => void;
  "message:deleted": (data: {
    messageId: string;
    conversationId: string;
  }) => void;
  "message:updated": (data: {
    messageId: string;
    mediaStatus: MediaStatus;
  }) => void;

  "typing:started": (data: { conversationId: string; userId: string }) => void;
  "typing:stopped": (data: { conversationId: string; userId: string }) => void;

  "member:added": (data: {
    conversationId: string;
    addedUserIds: string[];
    timestamp: string;
  }) => void;
  "member:removed": (data: {
    conversationId: string;
    removedUserIds: string[];
    timestamp: string;
  }) => void;

  error: (data: { message: string; code: string }) => void;

  // ─── Call events ─────────────────────────────────────────────────────────
  "call:started": (data: {
    meetingId: string;
    hostId: string;
    conversationId: string;
  }) => void;
  "call:join_requested": (data: { meetingId: string; userId: string }) => void;
  "call:approved": (data: { meetingId: string; approvalToken: string }) => void;
  "call:participant_joined": (data: { meetingId: string; userId: string }) => void;
  "call:participant_left": (data: { meetingId: string; userId: string }) => void;
  "call:media_state_updated": (data: {
    meetingId: string;
    userId: string;
    mediaState: { micOn: boolean; cameraOn: boolean; screenSharing: boolean };
  }) => void;
  "call:ended": (data: { meetingId: string; durationMs: number }) => void;
}
