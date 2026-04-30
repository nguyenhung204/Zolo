"use client";

import { useState, useRef, useEffect } from "react";
import {
  X,
  ImagePlus,
  Crown,
  Shield,
  User,
  UserX,
  Hash,
  Megaphone,
  Loader2,
  UserPlus,
  Check,
  Users,
  BellOff,
  Trash2,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  useConversation,
  useConversationMembers,
  useMyConversationRole,
  useUpdateConversationInfo,
  useAddConversationMembers,
  useRemoveConversationMember,
  useSetMemberRole,
} from "@/hooks/useConversations";
import { useUserSearch, useBlockUser } from "@/hooks/useFriends";
import { useAvatarUpload } from "@/hooks/useMediaUpload";
import { useAuthStore } from "@/stores/authStore";
import { queryKeys } from "@/lib/query/keys";
import {
  updateGroupSettings,
  disbandGroup as disbandGroupApi,
  hasMinRole,
  type GroupSettingsPayload,
} from "@/lib/api/group";
import { GroupInviteConfig } from "./GroupInviteConfig";
import { JoinRequestsPanel } from "./JoinRequestsPanel";
import { useJoinRequests, useLeaveGroup, useDeleteConversationForMe } from "@/hooks/useGroup";
import { useMuteConversation, useNotificationPreferences } from "@/hooks/useNotifications";
import type { ConversationMuteDuration } from "@/lib/api/notifications";
import type { MemberRole, Conversation } from "@/lib/api/conversations";
import type { UserSearchResult } from "@/lib/api/friends";

// ─── Role helpers ─────────────────────────────────────────────────────────────

const ROLE_ICON: Record<MemberRole, React.ReactNode> = {
  owner: <Crown className="w-3 h-3 text-warning" />,
  admin: <Shield className="w-3 h-3 text-cta" />,
  member: <User className="w-3 h-3 text-muted" />,
};

const ROLE_LABEL: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

const ASSIGNABLE_ROLES: MemberRole[] = ["admin", "member"];

// ─── Toggle switch ────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={cn(
        "relative inline-flex w-10 h-[22px] rounded-full transition-colors duration-200 shrink-0",
        checked ? "bg-cta" : "bg-border",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
      )}
    >
      <span
        className={cn(
          "absolute top-[3px] left-[3px] w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200",
          checked ? "translate-x-[18px]" : "translate-x-0",
        )}
      />
    </button>
  );
}

// ─── Setting row ──────────────────────────────────────────────────────────────

function SettingRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text">{label}</p>
        <p className="text-xs text-muted leading-tight mt-0.5">{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  conversationId: string;
  open: boolean;
  onClose: () => void;
}

type Tab = "info" | "members" | "settings" | "invite" | "requests";

// ─── Component ────────────────────────────────────────────────────────────────

export function ConversationSettingsModal({ conversationId, open, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("info");
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [pendingAdd, setPendingAdd] = useState<UserSearchResult[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [confirmDisband, setConfirmDisband] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaveSilent, setLeaveSilent] = useState(false);
  const [transferOwnershipTo, setTransferOwnershipTo] = useState("");
  const [confirmDeleteForMe, setConfirmDeleteForMe] = useState(false);
  const [isBlockingDirect, setIsBlockingDirect] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const currentUserId = useAuthStore((s) => s.user?.id);
  const { data: conv } = useConversation(conversationId);
  const { data: members = [], isLoading: membersLoading } = useConversationMembers(conversationId);
  const myRole = useMyConversationRole(conversationId);

  // hasMinRole normalises casing internally — works with both "owner" and "OWNER"
  const canEdit = hasMinRole(myRole ?? "member", "admin");
  const isOwner = hasMinRole(myRole ?? "member", "owner");
  const canManageAdmin = hasMinRole(myRole ?? "member", "admin");

  const updateInfo = useUpdateConversationInfo();
  const addMembers = useAddConversationMembers();
  const removeMember = useRemoveConversationMember();
  const setRole = useSetMemberRole();
  const { mutateAsync: blockUser } = useBlockUser();
  const avatarUpload = useAvatarUpload();
  const leaveGroupMutation = useLeaveGroup();
  const deleteForMeMutation = useDeleteConversationForMe();
  const muteConversation = useMuteConversation(conversationId);
  const { data: notificationPreferences } = useNotificationPreferences(conversationId);

  const { data: searchResults = [] } = useUserSearch(addQuery);

  const isDirect = conv?.kind === "direct";
  const isAnnouncement = conv?.kind === "community";
  const ownerCount = members.filter((m) => m.role === "owner").length;
  const ownershipTransferCandidates = members.filter((m) => m.userId !== currentUserId);
  const muteOptions: Array<{ value: ConversationMuteDuration; label: string }> = [
    { value: "1h", label: "Mute 1 hour" },
    { value: "4h", label: "Mute 4 hours" },
    { value: "8h", label: "Mute 8 hours" },
    { value: "24h", label: "Mute 24 hours" },
    { value: "forever", label: "Mute until I turn it back on" },
    { value: "off", label: "Turn notifications back on" },
  ];
  const convNotification = notificationPreferences?.conversation;
  const isConversationMuted =
    convNotification?.notifyOnMessage === false ||
    (!!convNotification?.muteUntil && new Date(convNotification.muteUntil).getTime() > Date.now());
  const isUploading =
    avatarUpload.status === "uploading" || avatarUpload.status === "finalizing";

  // Pending join request count (used for badge on Requests tab)
  const joinApprovalRequired = conv?.joinApprovalRequired ?? false;
  const { data: pendingRequests = [] } = useJoinRequests(
    conversationId,
    !isDirect && canManageAdmin && joinApprovalRequired,
  );

  // ── Group settings mutation ────────────────────────────────────────────────
  const updateSettingsMutation = useMutation({
    mutationFn: (payload: GroupSettingsPayload) =>
      updateGroupSettings(conversationId, payload),
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: queryKeys.conversations.detail(conversationId) });
      const prev = qc.getQueryData<Conversation>(queryKeys.conversations.detail(conversationId));
      qc.setQueryData<Conversation>(
        queryKeys.conversations.detail(conversationId),
        (old) => (old ? { ...old, ...payload } : old),
      );
      return { prev };
    },
    onSuccess: (updated) => {
      qc.setQueryData<Conversation>(
        queryKeys.conversations.detail(conversationId),
        (old) => (old ? { ...old, ...updated } : old),
      );
      qc.setQueryData<Conversation[]>(
        queryKeys.conversations.list(),
        (old) => old?.map((c) => (c.id === conversationId ? { ...c, ...updated } : c)),
      );
      toast.success("Settings saved.");
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(queryKeys.conversations.detail(conversationId), ctx.prev);
      }
      toast.error("Failed to save settings.");
    },
  });

  // ── Disband group mutation ─────────────────────────────────────────────────
  const disbandMutation = useMutation({
    mutationFn: () => disbandGroupApi(conversationId),
    onSuccess: () => {
      toast.success("Group disbanded.");
      onClose();
    },
    onError: () => toast.error("Failed to disband the group."),
  });

  // Sync edit fields when conv loads or tab changes
  useEffect(() => {
    if (conv) {
      setEditName(conv.name ?? "");
      setEditDesc(conv.description ?? "");
      setIsDirty(false);
    }
  }, [conv, activeTab]);

  // Reset transient state when sidebar closes
  useEffect(() => {
    if (!open) {
      setConfirmDisband(false);
      setConfirmLeave(false);
      setLeaveSilent(false);
      setTransferOwnershipTo("");
      setConfirmDeleteForMe(false);
      setAddQuery("");
      setPendingAdd([]);
    }
  }, [open]);

  useEffect(() => {
    if (!transferOwnershipTo && ownershipTransferCandidates.length > 0) {
      setTransferOwnershipTo(ownershipTransferCandidates[0].userId);
    }
  }, [ownershipTransferCandidates, transferOwnershipTo]);

  const handleClose = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    onClose();
  };

  // ── Avatar ─────────────────────────────────────────────────────────────────
  const handleAvatarSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const blobUrl = URL.createObjectURL(file);
    setPreviewUrl(blobUrl);
    const mediaId = await avatarUpload.upload(file);
    if (mediaId) {
      updateInfo.mutate(
        { id: conversationId, avatarMediaId: mediaId },
        {
          onSuccess: () => {
            setPreviewUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return null;
            });
          },
        },
      );
    } else {
      URL.revokeObjectURL(blobUrl);
      setPreviewUrl(null);
    }
  };

  const handleSaveInfo = () => {
    updateInfo.mutate(
      {
        id: conversationId,
        name: editName.trim() || undefined,
        description: editDesc.trim() || undefined,
      },
      { onSuccess: () => setIsDirty(false) },
    );
  };

  // ── Add members ────────────────────────────────────────────────────────────
  const handleAddMembers = () => {
    if (!pendingAdd.length) return;
    addMembers.mutate(
      { conversationId, userIds: pendingAdd.map((u) => u.id) },
      {
        onSuccess: () => {
          setPendingAdd([]);
          setAddQuery("");
        },
      },
    );
  };

  const togglePending = (user: UserSearchResult) => {
    setPendingAdd((prev) =>
      prev.some((u) => u.id === user.id)
        ? prev.filter((u) => u.id !== user.id)
        : [...prev, user],
    );
  };

  // ── Block direct user ──────────────────────────────────────────────────────
  const handleBlockDirectUser = async () => {
    const otherUserId = conv?.otherUser?.id;
    if (!otherUserId) return;
    setIsBlockingDirect(true);
    try {
      await blockUser(otherUserId);
      onClose();
    } finally {
      setIsBlockingDirect(false);
    }
  };

  // ── Group permission toggles ───────────────────────────────────────────────
  const handleSettingChange = (key: keyof GroupSettingsPayload, value: boolean) => {
    updateSettingsMutation.mutate({ [key]: value });
  };

  const handleLeaveGroup = () => {
    if (isOwner && !transferOwnershipTo) {
      toast.error("Choose a member to receive ownership first.");
      return;
    }
    leaveGroupMutation.mutate({
      conversationId,
      silent: leaveSilent,
      ...(isOwner ? { transferOwnershipTo } : {}),
    });
  };

  const handleMuteChange = (value: ConversationMuteDuration) => {
    muteConversation.mutate(value, {
      onSuccess: () => {
        toast.success(value === "off" ? "Notifications turned on." : "Conversation muted.");
      },
      onError: () => toast.error("Failed to update notification setting."),
    });
  };

  if (!open || !conv) return null;

  const displayAvatarUrl = previewUrl ?? conv.avatarUrl;

  // Tabs visible to this user
  const tabs: { id: Tab; label: string }[] = [
    { id: "info", label: "Info" },
    { id: "members", label: `Members (${membersLoading ? "…" : members.length})` },
    ...(!isDirect
      ? [
          { id: "settings" as Tab, label: "Settings" },
          ...(canManageAdmin
            ? [
                { id: "invite" as Tab, label: "Invite" },
                ...(joinApprovalRequired
                  ? [
                      {
                        id: "requests" as Tab,
                        label: pendingRequests.length > 0
                          ? `Requests (${pendingRequests.length})`
                          : "Requests",
                      },
                    ]
                  : []),
              ]
            : []),
        ]
      : []),
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
        onClick={handleClose}
      />

      {/* Sidebar panel — slides in from right (full-screen on mobile) */}
      <div
        className="fixed top-0 right-0 bottom-0 z-50 w-full sm:w-96 max-w-full bg-surface flex flex-col shadow-2xl border-l border-border"
        style={{ animation: "slideInFromRight 0.25s ease-out" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-primary truncate">
              {isDirect ? "Conversation Info" : (conv.name ?? "Group Settings")}
            </h2>
            {!isDirect && (
              <p className="text-xs text-muted mt-0.5 capitalize">
                {conv.kind} · {conv.memberCount} members
              </p>
            )}
          </div>
          <button
            onClick={handleClose}
            className="w-7 h-7 ml-2 rounded-lg flex items-center justify-center text-muted hover:text-primary hover:bg-border/50 transition cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex-1 py-3 text-xs font-semibold whitespace-nowrap px-1 transition cursor-pointer",
                activeTab === tab.id
                  ? "text-cta border-b-2 border-cta"
                  : "text-muted hover:text-secondary",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* ══ INFO TAB ══ */}
          {activeTab === "info" && (
            <div className="p-5 space-y-5">

              {/* Group avatar */}
              {!isDirect && (
                <div className="flex items-center gap-4">
                  <div
                    onClick={() => canEdit && fileInputRef.current?.click()}
                    className={cn(
                      "relative w-16 h-16 rounded-2xl flex items-center justify-center overflow-hidden shrink-0 group",
                      canEdit ? "cursor-pointer" : "cursor-default",
                      !displayAvatarUrl && "bg-cta/10",
                    )}
                  >
                    {displayAvatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={displayAvatarUrl}
                        alt={conv.name ?? ""}
                        className="w-full h-full object-cover"
                      />
                    ) : isUploading ? (
                      <Loader2 className="w-5 h-5 text-muted animate-spin" />
                    ) : isAnnouncement ? (
                      <Megaphone className="w-7 h-7 text-cta" />
                    ) : (
                      <Hash className="w-7 h-7 text-cta" />
                    )}

                    {isUploading && (
                      <div
                        className="absolute bottom-0 left-0 h-1 bg-cta transition-all"
                        style={{ width: `${avatarUpload.progress}%` }}
                      />
                    )}

                    {canEdit && !isUploading && (
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <ImagePlus className="w-5 h-5 text-white" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text truncate">
                      {conv.name ?? "Unnamed"}
                    </p>
                    {canEdit && (
                      <p
                        className="text-xs text-cta mt-1 cursor-pointer"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Change avatar
                      </p>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAvatarSelect}
                  />
                </div>
              )}

              {/* Direct — other user profile */}
              {isDirect && conv.otherUser && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    {conv.otherUser.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={conv.otherUser.avatarUrl}
                        alt=""
                        className="w-12 h-12 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-secondary/20 flex items-center justify-center text-sm font-semibold text-secondary shrink-0">
                        {conv.otherUser.displayName[0]?.toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-text truncate">
                        {conv.otherUser.displayName}
                      </p>
                      <p className="text-xs text-muted">@{conv.otherUser.username}</p>
                    </div>
                  </div>
                  <button
                    onClick={handleBlockDirectUser}
                    disabled={isBlockingDirect}
                    className="w-full py-2.5 text-sm font-semibold text-error border border-error/40 rounded-xl hover:bg-error/10 transition disabled:opacity-50 cursor-pointer"
                  >
                    {isBlockingDirect ? "Blocking…" : "Block User"}
                  </button>
                </div>
              )}

              {isDirect && (
                <div className="pt-2 space-y-4">
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-secondary uppercase tracking-wider">
                      Notifications
                    </p>
                    <select
                      value=""
                      disabled={muteConversation.isPending}
                      onChange={(e) => handleMuteChange(e.target.value as ConversationMuteDuration)}
                      className="w-full px-3 py-2 text-sm rounded-lg bg-bg border border-border focus:border-cta focus:outline-none focus:ring-2 focus:ring-cta/10 transition cursor-pointer disabled:opacity-50"
                    >
                      <option value="" disabled>
                        {isConversationMuted ? "Muted — choose a new option…" : "Choose mute duration…"}
                      </option>
                      {muteOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    {!confirmDeleteForMe ? (
                      <button
                        onClick={() => setConfirmDeleteForMe(true)}
                        className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-error border border-error/40 rounded-xl hover:bg-error/10 transition cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete Conversation For Me
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-error/80">
                          This hides the conversation and clears your current message history only for you.
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => deleteForMeMutation.mutate(conversationId)}
                            disabled={deleteForMeMutation.isPending}
                            className="flex-1 py-2 text-xs font-bold text-white bg-error rounded-lg hover:opacity-90 disabled:opacity-50 cursor-pointer"
                          >
                            {deleteForMeMutation.isPending ? "Deleting…" : "Delete"}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteForMe(false)}
                            className="flex-1 py-2 text-xs font-semibold text-secondary border border-border rounded-lg hover:bg-border/40 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Group name + description */}
              {!isDirect && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-secondary">Name</label>
                    {canEdit ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => {
                          setEditName(e.target.value);
                          setIsDirty(true);
                        }}
                        placeholder="Group name…"
                        className="w-full px-3 py-2 text-sm rounded-lg bg-bg border border-border focus:border-cta focus:outline-none focus:ring-2 focus:ring-cta/10 transition"
                      />
                    ) : (
                      <p className="px-3 py-2 text-sm text-text rounded-lg bg-bg border border-border/50">
                        {conv.name ?? "—"}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-secondary">Description</label>
                    {canEdit ? (
                      <textarea
                        value={editDesc}
                        onChange={(e) => {
                          setEditDesc(e.target.value);
                          setIsDirty(true);
                        }}
                        rows={3}
                        placeholder="Optional description…"
                        className="w-full px-3 py-2 text-sm rounded-lg bg-bg border border-border focus:border-cta focus:outline-none focus:ring-2 focus:ring-cta/10 transition resize-none"
                      />
                    ) : (
                      <p className="px-3 py-2 text-sm text-text rounded-lg bg-bg border border-border/50 min-h-[4.5rem]">
                        {conv.description ?? "—"}
                      </p>
                    )}
                  </div>

                  {canEdit && (
                    <button
                      onClick={handleSaveInfo}
                      disabled={!isDirty || updateInfo.isPending}
                      className="w-full py-2.5 text-sm font-semibold text-white bg-cta rounded-xl hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                    >
                      {updateInfo.isPending ? "Saving…" : "Save Changes"}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* ══ MEMBERS TAB ══ */}
          {activeTab === "members" && (
            <div className="flex flex-col">
              {/* Add members (admin+, non-direct) */}
              {canEdit && !isDirect && (
                <div className="p-4 border-b border-border space-y-2">
                  <label className="text-xs font-semibold text-secondary">Add members</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search users…"
                      value={addQuery}
                      onChange={(e) => setAddQuery(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg bg-bg border border-border focus:border-cta focus:outline-none focus:ring-2 focus:ring-cta/10 transition"
                    />
                    {addQuery.length >= 2 &&
                      searchResults.filter(
                        (u) => !members.some((m) => m.userId === u.id),
                      ).length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 z-10 bg-surface border border-border rounded-xl shadow-lg max-h-44 overflow-y-auto">
                          {searchResults
                            .filter((u) => !members.some((m) => m.userId === u.id))
                            .slice(0, 6)
                            .map((user) => {
                              const isPending = pendingAdd.some((u) => u.id === user.id);
                              return (
                                <button
                                  key={user.id}
                                  onClick={() => {
                                    togglePending(user);
                                    setAddQuery("");
                                  }}
                                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-border/40 text-left transition cursor-pointer"
                                >
                                  {user.avatarUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={user.avatarUrl}
                                      alt=""
                                      className="w-7 h-7 rounded-full object-cover shrink-0"
                                    />
                                  ) : (
                                    <div className="w-7 h-7 rounded-full bg-secondary/20 flex items-center justify-center text-xs font-semibold text-secondary shrink-0">
                                      {(user.firstName?.[0] ?? user.username[0]).toUpperCase()}
                                    </div>
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-text truncate">
                                      {user.firstName} {user.lastName}
                                    </p>
                                    <p className="text-xs text-muted">@{user.username}</p>
                                  </div>
                                  {isPending && (
                                    <Check className="w-4 h-4 text-cta shrink-0" />
                                  )}
                                </button>
                              );
                            })}
                        </div>
                      )}
                  </div>

                  {pendingAdd.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      {pendingAdd.map((u) => (
                        <span
                          key={u.id}
                          className="flex items-center gap-1 pl-2.5 pr-1.5 py-1 bg-cta/10 text-cta text-xs font-medium rounded-full"
                        >
                          {u.firstName || u.username}
                          <button
                            onClick={() => togglePending(u)}
                            className="hover:text-red-500 transition cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                      <button
                        onClick={handleAddMembers}
                        disabled={addMembers.isPending}
                        className="flex items-center gap-1.5 px-3 py-1 bg-cta text-white text-xs font-semibold rounded-full hover:opacity-90 disabled:opacity-50 transition cursor-pointer"
                      >
                        <UserPlus className="w-3 h-3" />
                        {addMembers.isPending ? "Adding…" : "Add"}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Member list */}
              <div className="p-3 space-y-0.5">
                {/* Loading skeletons */}
                {membersLoading &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="w-9 h-9 rounded-full bg-border animate-pulse shrink-0" />
                      <div className="space-y-1.5 flex-1">
                        <div className="h-3 bg-border animate-pulse rounded w-3/4" />
                        <div className="h-2.5 bg-border animate-pulse rounded w-1/3" />
                      </div>
                    </div>
                  ))}

                {/* Empty state */}
                {!membersLoading && members.length === 0 && (
                  <div className="flex flex-col items-center py-10 text-muted gap-2">
                    <Users className="w-8 h-8 opacity-40" />
                    <p className="text-sm">No members found</p>
                  </div>
                )}

                {/* Member rows */}
                {!membersLoading &&
                  members.map((member) => {
                    const mRole = member.role as MemberRole;
                    const isSelf = member.userId === currentUserId;
                    const isLastOwner = mRole === "owner" && ownerCount <= 1;
                    const canRemove =
                      canEdit && !isSelf && !isLastOwner && mRole !== "owner";
                    const canChangeRole = isOwner && !isSelf && mRole !== "owner";

                    const displayName =
                      (member as { displayName?: string }).displayName ??
                      (member as { username?: string }).username ??
                      member.userId;
                    const memberAvatarUrl = (member as { avatarUrl?: string | null }).avatarUrl;

                    return (
                      <div
                        key={member.id}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-border/20 transition group"
                      >
                        {memberAvatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={memberAvatarUrl}
                            alt={displayName}
                            className="w-9 h-9 rounded-full object-cover shrink-0"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-secondary/20 flex items-center justify-center text-sm font-semibold text-secondary shrink-0">
                            {displayName[0]?.toUpperCase()}
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-text truncate">
                            {displayName}
                            {isSelf && (
                              <span className="text-muted font-normal ml-1">(you)</span>
                            )}
                          </p>
                        </div>

                        {canChangeRole ? (
                          <select
                            value={mRole}
                            onChange={(e) =>
                              setRole.mutate({
                                conversationId,
                                userId: member.userId,
                                role: e.target.value as MemberRole,
                              })
                            }
                            className="text-xs border border-border rounded-lg px-2 py-1 bg-surface text-secondary cursor-pointer focus:outline-none focus:border-cta transition"
                          >
                            {ASSIGNABLE_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABEL[r]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="flex items-center gap-1 text-xs text-muted shrink-0">
                            {ROLE_ICON[mRole]}
                            <span>{ROLE_LABEL[mRole]}</span>
                          </div>
                        )}

                        {canRemove ? (
                          <button
                            onClick={() =>
                              removeMember.mutate({
                                conversationId,
                                userId: member.userId,
                              })
                            }
                            disabled={removeMember.isPending}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-red-500 hover:bg-red-50 transition cursor-pointer opacity-0 group-hover:opacity-100 disabled:opacity-40 shrink-0"
                            title="Remove member"
                          >
                            <UserX className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <div className="w-7 h-7 shrink-0" />
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* ══ SETTINGS TAB ══ (groups) */}
          {activeTab === "settings" && !isDirect && (
            <div className="p-5 space-y-5">
              {canManageAdmin && (
                <div className="space-y-4">
                  <p className="text-xs font-bold text-secondary uppercase tracking-wider">
                    Permissions
                  </p>

                  <SettingRow
                    label="Allow member messages"
                    description="When off, only the owner and admins can send messages"
                    checked={conv.allowMemberMessage ?? true}
                    onChange={(v) => handleSettingChange("allowMemberMessage", v)}
                    disabled={updateSettingsMutation.isPending}
                  />
                  <div className="h-px bg-border" />

                  <SettingRow
                    label="Public group"
                    description="Anyone with the invite link can discover and join"
                    checked={conv.isPublic ?? false}
                    onChange={(v) => handleSettingChange("isPublic", v)}
                    disabled={updateSettingsMutation.isPending}
                  />
                  <div className="h-px bg-border" />

                  <SettingRow
                    label="Require join approval"
                    description="New members need admin approval before joining"
                    checked={conv.joinApprovalRequired ?? false}
                    onChange={(v) => handleSettingChange("joinApprovalRequired", v)}
                    disabled={updateSettingsMutation.isPending}
                  />
                </div>
              )}

              {/* Notifications */}
              <div className="pt-4 border-t border-border space-y-3">
                <p className="text-xs font-bold text-secondary uppercase tracking-wider">
                  Notifications
                </p>
                <div className="flex items-center gap-2 text-xs text-muted">
                  <BellOff className="w-3.5 h-3.5" />
                  <span>
                    {isConversationMuted
                      ? convNotification?.muteUntil
                        ? `Muted until ${new Date(convNotification.muteUntil).toLocaleString()}`
                        : "Muted until you turn notifications back on"
                      : "Notifications are on"}
                  </span>
                </div>
                <select
                  value=""
                  disabled={muteConversation.isPending}
                  onChange={(e) => handleMuteChange(e.target.value as ConversationMuteDuration)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-bg border border-border focus:border-cta focus:outline-none focus:ring-2 focus:ring-cta/10 transition cursor-pointer disabled:opacity-50"
                >
                  <option value="" disabled>
                    Choose mute duration…
                  </option>
                  {muteOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Leave group */}
              <div className="pt-4 border-t border-border space-y-3">
                <p className="text-xs font-bold text-secondary uppercase tracking-wider">
                  Membership
                </p>
                {!confirmLeave ? (
                  <button
                    onClick={() => setConfirmLeave(true)}
                    className="w-full py-2.5 text-sm font-semibold text-warning border border-warning/40 rounded-xl hover:bg-warning/10 transition cursor-pointer"
                  >
                    Leave Group
                  </button>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-warning/80">
                      You will no longer have access to this group&apos;s messages.
                      {isOwner && " Transfer ownership to another member before leaving."}
                    </p>
                    {isOwner && (
                      <label className="block space-y-1.5">
                        <span className="text-xs font-semibold text-secondary">
                          Transfer ownership to
                        </span>
                        <select
                          value={transferOwnershipTo}
                          onChange={(e) => setTransferOwnershipTo(e.target.value)}
                          className="w-full px-3 py-2 text-sm rounded-lg bg-bg border border-border focus:border-cta focus:outline-none focus:ring-2 focus:ring-cta/10 transition cursor-pointer"
                        >
                          {ownershipTransferCandidates.map((member) => (
                            <option key={member.userId} value={member.userId}>
                              {member.displayName ?? member.username ?? member.userId}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="flex items-start gap-2 text-xs text-muted cursor-pointer">
                      <input
                        type="checkbox"
                        checked={leaveSilent}
                        onChange={(e) => setLeaveSilent(e.target.checked)}
                        className="mt-0.5 accent-[var(--color-cta)]"
                      />
                      <span>Leave silently — only admins see the system message.</span>
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={handleLeaveGroup}
                        disabled={leaveGroupMutation.isPending || (isOwner && !transferOwnershipTo)}
                        className="flex-1 py-2 text-xs font-bold text-white bg-warning rounded-lg hover:opacity-90 disabled:opacity-50 cursor-pointer"
                      >
                        {leaveGroupMutation.isPending ? "Leaving…" : "Yes, Leave"}
                      </button>
                      <button
                        onClick={() => setConfirmLeave(false)}
                        className="flex-1 py-2 text-xs font-semibold text-secondary border border-border rounded-lg hover:bg-border/40 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Danger zone — owner only */}
              {isOwner && (
                <div className="pt-4 border-t border-border space-y-3">
                  <p className="text-xs font-bold text-error uppercase tracking-wider">
                    Danger Zone
                  </p>
                  {!confirmDisband ? (
                    <button
                      onClick={() => setConfirmDisband(true)}
                      className="w-full py-2.5 text-sm font-semibold text-error border border-error/40 rounded-xl hover:bg-error/10 transition cursor-pointer"
                    >
                      Disband Group
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-error/80">
                        This is permanent and cannot be undone. All members will be removed.
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => disbandMutation.mutate()}
                          disabled={disbandMutation.isPending}
                          className="flex-1 py-2 text-xs font-bold text-white bg-error rounded-lg hover:opacity-90 disabled:opacity-50 cursor-pointer"
                        >
                          {disbandMutation.isPending ? "Disbanding…" : "Yes, Disband"}
                        </button>
                        <button
                          onClick={() => setConfirmDisband(false)}
                          className="flex-1 py-2 text-xs font-semibold text-secondary border border-border rounded-lg hover:bg-border/40 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Delete for me */}
              <div className="pt-4 border-t border-border space-y-3">
                <p className="text-xs font-bold text-error uppercase tracking-wider">
                  Delete for me
                </p>
                {!confirmDeleteForMe ? (
                  <button
                    onClick={() => setConfirmDeleteForMe(true)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-error border border-error/40 rounded-xl hover:bg-error/10 transition cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete Conversation For Me
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-error/80">
                      This hides the conversation and clears your current message history only for you.
                      New messages will make it appear again.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => deleteForMeMutation.mutate(conversationId)}
                        disabled={deleteForMeMutation.isPending}
                        className="flex-1 py-2 text-xs font-bold text-white bg-error rounded-lg hover:opacity-90 disabled:opacity-50 cursor-pointer"
                      >
                        {deleteForMeMutation.isPending ? "Deleting…" : "Delete"}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteForMe(false)}
                        className="flex-1 py-2 text-xs font-semibold text-secondary border border-border rounded-lg hover:bg-border/40 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══ INVITE TAB ══ (groups, admin+) */}
          {activeTab === "invite" && !isDirect && canManageAdmin && (
            <div className="p-5">
              <GroupInviteConfig conversationId={conversationId} />
            </div>
          )}

          {/* ══ REQUESTS TAB ══ (groups, admin+, joinApprovalRequired) */}
          {activeTab === "requests" && !isDirect && canManageAdmin && (
            <JoinRequestsPanel conversationId={conversationId} />
          )}
        </div>
      </div>
    </>
  );
}
