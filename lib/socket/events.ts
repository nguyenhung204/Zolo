// ─── Shared domain types ─────────────────────────────────────────────────────

import type { SystemMessageAction } from "@/lib/api/messages";

export type MessageType = "text" | "image" | "file" | "audio" | "video" | "system" | "sticker" | "media" | "call_summary" | "contact_card";
export type MediaStatus = "created" | "uploaded" | "processing" | "ready" | "failed";
export type ModerationAction = "mute_audio" | "mute_video" | "disable_screen" | "kick";
export type RecordingStatus = "recording" | "paused" | "stopped" | "failed";
export type ConversationMemberAddedSource = "member_add" | "invite_link" | "join_approved";
export type ConversationMemberRemovedSource = "member_left" | "member_removed";

export interface WsMessage {
  messageId: string;
  conversationId: string;
  senderId?: string | null;
  content?: string | null;
  type: MessageType;
  offset: number;
  isPinned?: boolean;
  pinnedBy?: string;
  pinnedByName?: string;
  pinnedAt?: string;
  mediaId?: string;
  mediaStatus?: MediaStatus;
  replyToMessageId?: string;
  clientMessageId?: string;
  createdAt: string;
  editedAt?: string;
  deletedAt?: string;
  metadata?: {
    mentions?: string[];
    mentionAll?: boolean;
    tags?: string[];
    attachmentUrls?: string[];
    url?: string;
    // system message fields (type === "system")
    action?: SystemMessageAction | "CALL_MISSED" | "CALL_MISSED_BUSY" | "CALL_REJECTED" | "CALL_ENDED";
    actorId?: string;
    actorName?: string;
    targetIds?: string[];
    targetNames?: string[];
    joinSource?: "manual" | "invite_link" | "join_request";
    newRole?: string;
    changes?: {
      name?: string;
      avatarChanged?: boolean;
      allowMemberMessage?: boolean;
      joinApprovalRequired?: boolean;
    };
    ownershipTransferredTo?: string;
    visibility?: "all" | "admins";
    pollId?: string;
    optionIds?: string[];
    optionTexts?: string[];
    contactUserId?: string;
    cardType?: "friend_contact";
    contactUsername?: string;
    contactEmail?: string;
    contactAvatarId?: string;
    messageId?: string;
    // system_call fields (present when type === "system" && systemType === "system_call")
    systemType?: "system_call";
    callId?: string;
    callerId?: string;
    callerName?: string;
    durationMs?: number;
    isMissed?: boolean;
    reason?: string;
  };
}

// ─── Client → Server events ──────────────────────────────────────────────────

export interface ClientEvents {
  authenticate: (payload: {
    token: string;
    deviceId?: string;
    deviceType?: "web" | "mobile" | "desktop";
    platform?: string;
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

  "message:get_status": (payload: {
    messageId: string;
  }) => void;

  heartbeat: () => void;
}

// ─── Server → Client events ──────────────────────────────────────────────────

export interface ServerEvents {
  authenticated: (data: { userId: string; socketId: string }) => void;
  "conversation:joined": (data: {
    conversationId?: string;
    success: boolean;
    latestOffset?: number;
    error?: string;
  }) => void;
  "heartbeat:ack": (data?: { timestamp?: string }) => void;

  "chat:message_received": (data: WsMessage) => void;
  "message:new": (data: WsMessage) => void;
  "message:notify": (data: {
    conversationId: string;
    latestOffset: number;
    senderName: string;
    content: string;
    type: string;
    metadata?: WsMessage["metadata"];
    mentions?: string[];
    conversationName?: string;
  }) => void;
  "message:saved": (data: {
    clientMessageId?: string;
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
    deletedAt?: string;
  }) => void;
  "message:deleted_for_me": (data: {
    messageId: string;
    conversationId: string;
    deletedAt: string;
  }) => void;
  "message:revoked": (data: {
    messageId: string;
    conversationId: string;
    revokedAt?: string;
    tombstoneTextKey?: string;
  }) => void;
  "message:media_ready": (data: {
    messageId: string;
    conversationId: string;
    attachment: {
      mediaId: string;
      kind: "image" | "video" | "audio" | "file";
      status: string;
      variantsReady?: boolean;
      thumbReady?: boolean;
      meta?: { width?: number; height?: number; format?: string };
      error?: string;
    };
  }) => void;
  "message:updated": (data: {
    messageId: string;
    conversationId?: string;
    /** New payload shape from backend */
    attachment?: {
      mediaId: string;
      kind: "image" | "video" | "audio" | "file";
      status: string;
      variantsReady?: boolean;
      thumbReady?: boolean;
      meta?: { width?: number; height?: number; format?: string };
      error?: string;
    };
    /** Legacy field — kept for backward compat */
    mediaStatus?: MediaStatus;
    metadata?: { waveform?: number[] };
  }) => void;
  "message:status": (data: {
    messageId: string;
    offset?: number;
    sent?: boolean;
    delivered?: { count: number; total: number; percentage: number };
    seen?: { count: number; total: number; percentage: number };
    status?: "sending" | "sent" | "delivered" | "read" | "failed";
    seenByCount?: number;
    deliveredToCount?: number;
    error?: string;
  }) => void;
  "message:failed": (data: {
    clientMessageId?: string;
    conversationId: string;
    errorMessage: string;
    failedAt: string;
    originalTopic?: string;
  }) => void;
  "message:pinned": (data: {
    messageId: string;
    conversationId: string;
    pinnedBy: string;
    pinnedByName?: string;
    pinnedAt: string;
  }) => void;
  "message:unpinned": (data: {
    messageId: string;
    conversationId: string;
    unpinnedBy: string;
    unpinnedByName?: string;
    unpinnedAt: string;
  }) => void;

  "typing:started": (data: { conversationId: string; userId: string }) => void;
  "typing:stopped": (data: { conversationId: string; userId: string }) => void;

  "user:online": (data: { userId: string }) => void;
  "user:offline": (data: { userId: string; lastSeen: string | null }) => void;

  "friendship:request_sent": (data: {
    fromUserId: string;
    fromUserName?: string;
    toUserId: string;
    toUserName?: string;
    timestamp: string;
  }) => void;
  "friendship:request_received": (data: {
    fromUserId: string;
    fromUserName?: string;
    toUserId: string;
    toUserName?: string;
    timestamp: string;
  }) => void;
  "friendship:request_accepted": (data: {
    acceptedBy: string;
    acceptedByName?: string;
    requesterId: string;
    requesterName?: string;
    userIds: string[];
    timestamp: string;
  }) => void;
  "friendship:request_rejected": (data: {
    rejectedBy: string;
    rejectedByName?: string;
    requesterId: string;
    requesterName?: string;
    userIds: string[];
    timestamp: string;
  }) => void;
  "friendship:request_canceled": (data: {
    canceledBy: string;
    canceledByName?: string;
    targetUserId: string;
    userIds: string[];
    timestamp: string;
  }) => void;
  "friendship:removed": (data: {
    userIds: string[];
    removedBy: string;
    targetUserId: string;
    timestamp: string;
  }) => void;
  "friendship:blocked": (data: {
    blocker: string;
    blocked: string;
    timestamp: string;
  }) => void;
  "friendship:unblocked": (data: {
    unblocker: string;
    unblocked: string;
    timestamp: string;
  }) => void;

  "conversation:member-added": (data: {
    conversationId: string;
    addedBy?: string;
    addedByName?: string;
    addedUsers?: Array<{ id: string; displayName: string }>;
    /** Legacy flat list */
    addedUserIds?: string[];
    conversationType?: string;
    memberCount?: number;
    timestamp: string;
    source?: ConversationMemberAddedSource;
  }) => void;
  "conversation:member-removed": (data: {
    conversationId: string;
    removedBy?: string;
    removedByName?: string;
    removedUsers?: Array<{ id: string; displayName: string }>;
    /** Legacy flat list */
    removedUserIds?: string[];
    conversationType?: string;
    memberCount?: number;
    timestamp: string;
    source?: ConversationMemberRemovedSource;
  }) => void;

  "conversation:updated": (data: {
    conversationId: string;
    changes: Record<string, unknown>;
    updatedBy?: string;
    timestamp?: string;
  }) => void;

  error: (data: { message: string; code: string }) => void;

  "cursor:seen_updated": (data: { conversationId: string; userId?: string; upToOffset: number; status?: "processing"; timestamp?: string }) => void;
  "cursor:delivered_updated": (data: { conversationId: string; userId?: string; upToOffset: number; status?: "processing"; timestamp?: string }) => void;
  "message:reaction_updated": (data: {
    messageId: string;
    conversationId: string;
    reactions: Record<string, { count: number; reactors: string[]; myReaction: boolean }>;
    action?: "add" | "remove";
    reactorId?: string;
    emoji?: string;
  }) => void;

  session_revoked: (data: {
    reason: "logged_in_elsewhere" | "new_login_elsewhere" | "manual_logout" | "token_expired" | "tab_limit_exceeded";
  }) => void;

  "conversation:created": (data: {
    conversationId: string;
    kind: "DIRECT" | "GROUP" | "COMMUNITY";
    name?: string;
    description?: string;
    memberIds: string[];
    createdBy: string;
    createdAt: string;
  }) => void;

  /** Emitted by ConversationCreatedConsumer — friend request accepted → DIRECT auto-created */
  "conversation:new": (data: {
    conversationId: string;
    type: "direct" | "group" | "announcement" | string;
    createdBy: string;
    timestamp: string;
  }) => void;

  /**
   * Fired after media.ready propagates through the backend pipeline.
   * The snapshot reflects the current state of the changed fields.
   * snapshot.avatarMediaId is a mediaId — call GET /media/:id/url to resolve
   * a presigned URL before rendering.
   */
  "user:profile-updated": (data: {
    userId: string;
    changedFields: string[];
    snapshot: {
      displayName: string | null;
      avatarMediaId: string | null;
    };
    timestamp: number;
  }) => void;

  // NOTE: call / meeting events are NOT on this namespace.
  // They are emitted on the /call namespace — see CallServerEvents below.

  // ─── Dedicated group action events (emitted immediately when action is committed) ───
  "group:settings_updated": (data: {
    conversationId: string;
    changes: {
      name?: string;
      avatarChanged?: boolean;
      allowMemberMessage?: boolean;
      joinApprovalRequired?: boolean;
    };
    updatedBy: string;
    updatedByName?: string;
    timestamp: string;
  }) => void;

  "group:member_role_changed": (data: {
    conversationId: string;
    userId: string;
    userName?: string;
    newRole: string;
    changedBy: string;
    changedByName?: string;
    timestamp: string;
  }) => void;

  "group:member_kicked": (data: {
    conversationId: string;
    userId: string;
    userName?: string;
    kickedBy: string;
    kickedByName?: string;
    timestamp: string;
  }) => void;

  "group:disbanded": (data: {
    conversationId: string;
    disbandedBy: string;
    disbandedByName?: string;
    timestamp: string;
  }) => void;

  "group:join_requested": (data: {
    conversationId: string;
    userId: string;
    userName?: string;
    requestId: string;
    requestMessage: string | null;
    source?: "invite_link" | "request";
    timestamp: string;
  }) => void;

  "group:join_approved": (data: {
    conversationId: string;
    userId?: string;
    userName?: string;
    requestId: string;
    reviewedBy: string;
    reviewedByName?: string;
    timestamp: string;
  }) => void;

  "group:join_rejected": (data: {
    conversationId: string;
    userId?: string;
    userName?: string;
    requestId: string;
    reviewedBy: string;
    reviewedByName?: string;
    timestamp: string;
  }) => void;

  "conversation:removed": (data: {
    conversationId: string;
    reason: "removed-from-conversation" | "group-member-kicked" | "group-disbanded" | string;
    message?: string;
  }) => void;

  "group:poll_created": (data: {
    conversationId: string;
    poll: {
      id: string;
      conversationId: string;
      creatorId: string;
      question: string;
      options: Array<{ id: string; text: string; voterIds: string[] }>;
      multipleChoice: boolean;
      deadline: string | null;
      isClosed: boolean;
    };
    createdBy: string;
    createdByName: string;
    timestamp: string;
  }) => void;

  "group:poll_voted": (data: {
    conversationId: string;
    pollId: string;
    voterId: string;
    voterName: string;
    optionIds: string[];
    options: Array<{ id: string; text: string; voterIds: string[] }>;
    timestamp: string;
  }) => void;

  "group:poll_closed": (data: {
    conversationId: string;
    pollId: string;
    closedBy: string;
    closedByName: string;
    options: Array<{ id: string; text: string; voterIds: string[] }>;
    timestamp: string;
  }) => void;

  "account:status-changed": (data: {
    reason: "deactivated" | "deleted";
  }) => void;
}

// ─── /call namespace — Client → Server ───────────────────────────────────────

export interface CallClientEvents {
  authenticate: (payload: { token: string }) => void;

  "meeting:start": (payload: {
    conversationId: string;
    orgId: string;
    allowWaitingRoom?: boolean;
  }) => void;

  "meeting:join": (payload: { conversationId: string }) => void;

  "meeting:approve_waiting": (payload: { meetingId: string; userId: string }) => void;

  "meeting:reject_waiting": (payload: {
    meetingId: string;
    userId: string;
    reason?: string;
  }) => void;

  "meeting:leave": (payload: { meetingId: string }) => void;

  "meeting:end": (payload: { meetingId: string }) => void;

  "meeting:media_state": (payload: {
    meetingId: string;
    micOn: boolean;
    cameraOn: boolean;
    screenSharing: boolean;
  }) => void;

  "meeting:moderate": (payload: {
    meetingId: string;
    targetUserId: string;
    action: ModerationAction;
    reason?: string;
  }) => void;

  "meeting:snapshot": (payload: { meetingId: string }) => void;

  // ─── Instant call (Zalo/Messenger-style) ─────────────────────────────────
  /** Join the Socket.IO room for a specific call to receive call:accepted / call:declined / call:ended */
  "call:join_room": (payload: { callId: string }) => void;
  /** Leave the Socket.IO room after the call ends */
  "call:leave_room": (payload: { callId: string }) => void;
}

// ─── /call namespace — Server → Client ───────────────────────────────────────

export interface CallServerEvents {
  authenticated: (data: { userId: string; socketId: string }) => void;

  "meeting:started": (data: {
    meetingId: string;
    hostId: string;
    conversationId: string;
    startedAt: string;
  }) => void;

  "meeting:join_requested": (data: {
    meetingId: string;
    userId: string;
    conversationId: string;
  }) => void;

  "meeting:participant_joined": (data: {
    meetingId: string;
    userId: string;
    conversationId: string;
    role: string;
    joinedAt: string;
  }) => void;

  "meeting:participant_left": (data: {
    meetingId: string;
    userId: string;
    conversationId: string;
  }) => void;

  /** Sent only to the user who was waiting — they are now approved to join */
  "meeting:approved": (data: { meetingId: string; conversationId: string }) => void;

  /** Sent only to the user who was waiting — they were rejected by the host */
  "meeting:rejected": (data: {
    meetingId: string;
    conversationId: string;
    reason?: string;
  }) => void;

  "meeting:ended": (data: {
    meetingId: string;
    conversationId: string;
    durationMs: number;
  }) => void;

  "meeting:media_state": (data: {
    meetingId: string;
    userId: string;
    mediaState: { micOn: boolean; cameraOn: boolean; screenSharing: boolean };
  }) => void;

  "meeting:recording_state": (data: {
    meetingId: string;
    recordingId: string;
    status: RecordingStatus;
    startedBy: string;
  }) => void;

  "meeting:participant_moderated": (data: {
    meetingId: string;
    targetUserId: string;

    action: ModerationAction;
  }) => void;

  /** Sent only to the user who was kicked */
  "meeting:kicked": (data: { meetingId: string; reason?: string }) => void;

  error: (data: { message: string; code: string }) => void;

  // ─── Instant call (Zalo/Messenger-style) ─────────────────────────────────

  /**
   * Delivered to each callee's personal room `user:{calleeId}` when a call is started.
   * Callee should join `call:{callId}` room immediately after receiving this.
   */
  "call:ringing": (data: {
    callId: string;
    conversationId: string;
    caller: { id: string; name: string; avatar: string };
    calleeIds: string[];
    startedAt: string;
  }) => void;

  /**
   * Broadcast to `call:{callId}` room when the callee accepts.
   * The **caller** receives this and must fetch GET /calls/:callId/token to connect to LiveKit.
   */
  "call:accepted": (data: {
    callId: string;
    conversationId: string;
    calleeId: string;
    acceptedAt: string;
  }) => void;

  /**
   * Broadcast to `call:{callId}` room when the callee declines or call times out.
   * - finalStatus "RINGING" → group call, one callee declined, others still pending
   * - finalStatus "REJECTED" → all callees declined (direct or last group callee)
   * - finalStatus "MISSED"   → ringing timeout with no answer
   */
  "call:declined": (data: {
    callId: string;
    conversationId: string;
    declinedBy: string;
    finalStatus: "REJECTED" | "RINGING" | "MISSED";
    declinedAt: string;
  }) => void;

  /**
   * Broadcast to `call:{callId}` room when any participant ends the active call.
   */
  "call:ended": (data: {
    callId: string;
    conversationId: string;
    endedBy: string;
    endReason: "user_ended" | "declined" | "caller_cancelled" | "ringing_timeout" | "ghost_call_cleanup" | "membership_revoked";
    durationMs: number;
    endedAt: string;
  }) => void;
}
