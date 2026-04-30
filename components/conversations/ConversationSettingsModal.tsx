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
  Bell,
  BellOff,
  Trash2,
  ChevronDown,
  LogOut,
  AlertOctagon,
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
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
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

// ─── Notification control ────────────────────────────────────────────────────

const MUTE_DURATION_OPTIONS: Array<{ value: ConversationMuteDuration; label: string }> = [
  { value: "1h", label: "1 hour" },
  { value: "4h", label: "4 hours" },
  { value: "8h", label: "8 hours" },
  { value: "24h", label: "24 hours" },
  { value: "forever", label: "Until I turn it back on" },
];

function NotificationControl({
  isMuted,
  muteUntil,
  pending,
  onChange,
}: {
  isMuted: boolean;
  muteUntil?: string | null;
  pending: boolean;
  onChange: (value: ConversationMuteDuration) => void;
}) {
  const [pickingDuration, setPickingDuration] = useState(false);

  const handleToggle = (turnOn: boolean) => {
    if (turnOn) {
      onChange("off");
      setPickingDuration(false);
    } else {
      setPickingDuration(true);
    }
  };

  const handlePickDuration = (value: ConversationMuteDuration) => {
    onChange(value);
    setPickingDuration(false);
  };

  const muteUntilLabel = muteUntil
    ? new Date(muteUntil).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="space-y-3">
      {/* Status row with toggle */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border px-3 py-3 transition",
          isMuted
            ? "bg-warning/5 border-warning/30"
            : "bg-success/5 border-success/30",
        )}
      >
        <div
          className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
            isMuted ? "bg-warning/15 text-warning" : "bg-success/15 text-success",
          )}
        >
          {isMuted ? (
            <BellOff className="w-4 h-4" />
          ) : (
            <Bell className="w-4 h-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text">
            {isMuted ? "Notifications muted" : "Notifications on"}
          </p>
          <p className="text-xs text-muted mt-0.5 leading-snug">
            {isMuted
              ? muteUntilLabel
                ? `Muted until ${muteUntilLabel}`
                : "Muted until you turn them back on"
              : "You'll get a sound and badge for new messages"}
          </p>
        </div>
        <Toggle
          checked={!isMuted}
          onChange={handleToggle}
          disabled={pending}
        />
      </div>

      {/* Mute-duration picker (shown when user just toggled OFF, or when already muted) */}
      {(pickingDuration || isMuted) && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted">
            {isMuted ? "Change mute duration" : "Mute for…"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {MUTE_DURATION_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={pending}
                onClick={() => handlePickDuration(option.value)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-full border transition cursor-pointer",
                  "border-border bg-bg text-text hover:bg-surface-secondary hover:border-cta/40",
                  "disabled:opacity-50",
                )}
              >
                {option.label}
              </button>
            ))}
            {!isMuted && (
              <button
                type="button"
                onClick={() => setPickingDuration(false)}
                className="px-3 py-1.5 text-xs font-medium rounded-full text-muted hover:text-text cursor-pointer"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Danger zone (collapsible) ────────────────────────────────────────────────

function DangerZone({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="pt-4 border-t border-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-1 py-2 cursor-pointer"
      >
        <span className="text-xs font-bold text-error uppercase tracking-wider">
          Danger zone
        </span>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-error transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-error/30 bg-error/5 divide-y divide-error/20 overflow-hidden">
          {children}
        </div>
      )}
    </div>
  );
}

function DangerRow({
  icon,
  label,
  description,
  tone = "warning",
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  tone?: "warning" | "danger";
  onClick: () => void;
}) {
  const text = tone === "danger" ? "text-error" : "text-warning";
  const bg = tone === "danger" ? "bg-error/10" : "bg-warning/10";
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-start gap-3 px-3 py-3 text-left hover:bg-error/10 transition cursor-pointer"
    >
      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", bg, text)}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-semibold", text)}>{label}</p>
        <p className="text-xs text-muted mt-0.5 leading-snug">{description}</p>
      </div>
    </button>
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
  const [confirmBlockDirect, setConfirmBlockDirect] = useState(false);
  const [pendingRemoveMemberId, setPendingRemoveMemberId] = useState<string | null>(null);
  const [dangerOpen, setDangerOpen] = useState(false);

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
                </div>
              )}

              {isDirect && (
                <div className="pt-2 space-y-4">
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-secondary uppercase tracking-wider">
                      Notifications
                    </p>
                    <NotificationControl
                      isMuted={isConversationMuted}
                      muteUntil={convNotification?.muteUntil}
                      pending={muteConversation.isPending}
                      onChange={handleMuteChange}
                    />
                  </div>

                  <DangerZone
                    open={dangerOpen}
                    onToggle={() => setDangerOpen((v) => !v)}
                  >
                    <DangerRow
                      icon={<UserX className="w-4 h-4" />}
                      label="Block user"
                      description="They won't be able to message you anymore."
                      onClick={() => setConfirmBlockDirect(true)}
                    />
                    <DangerRow
                      icon={<Trash2 className="w-4 h-4" />}
                      label="Delete conversation for me"
                      description="Hides this chat and clears your local history."
                      onClick={() => setConfirmDeleteForMe(true)}
                    />
                  </DangerZone>
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
                            onClick={() => setPendingRemoveMemberId(member.userId)}
                            disabled={removeMember.isPending}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-error hover:bg-error/10 transition cursor-pointer md:opacity-0 md:group-hover:opacity-100 disabled:opacity-40 shrink-0"
                            title="Remove member"
                            aria-label={`Remove member`}
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
                <NotificationControl
                  isMuted={isConversationMuted}
                  muteUntil={convNotification?.muteUntil}
                  pending={muteConversation.isPending}
                  onChange={handleMuteChange}
                />
              </div>

              <DangerZone
                open={dangerOpen}
                onToggle={() => setDangerOpen((v) => !v)}
              >
                <DangerRow
                  icon={<LogOut className="w-4 h-4" />}
                  label="Leave group"
                  description={
                    isOwner
                      ? "You'll need to transfer ownership first."
                      : "You'll lose access to this group's messages."
                  }
                  onClick={() => setConfirmLeave(true)}
                />
                {isOwner && (
                  <DangerRow
                    icon={<AlertOctagon className="w-4 h-4" />}
                    label="Disband group"
                    description="Permanently delete the group for all members. This can't be undone."
                    tone="danger"
                    onClick={() => setConfirmDisband(true)}
                  />
                )}
                <DangerRow
                  icon={<Trash2 className="w-4 h-4" />}
                  label="Delete conversation for me"
                  description="Hides the chat and clears your local history. New messages bring it back."
                  onClick={() => setConfirmDeleteForMe(true)}
                />
              </DangerZone>
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

      {/* Confirm: remove member */}
      <ConfirmDialog
        open={!!pendingRemoveMemberId}
        title="Remove this member?"
        description={(() => {
          const m = members.find((x) => x.userId === pendingRemoveMemberId);
          const n = m?.displayName ?? m?.username ?? "this member";
          return `${n} will lose access to this group's messages. You can re-add them later.`;
        })()}
        confirmLabel={removeMember.isPending ? "Removing…" : "Remove"}
        loading={removeMember.isPending}
        tone="danger"
        onCancel={() => setPendingRemoveMemberId(null)}
        onConfirm={() => {
          if (!pendingRemoveMemberId) return;
          removeMember.mutate(
            { conversationId, userId: pendingRemoveMemberId },
            { onSettled: () => setPendingRemoveMemberId(null) },
          );
        }}
      />

      {/* Confirm: leave group */}
      <ConfirmDialog
        open={confirmLeave}
        title="Leave this group?"
        description={
          isOwner
            ? "You're the owner — pick a member to take over before you go."
            : "You'll lose access to this group's messages. You can rejoin via an invite link."
        }
        confirmLabel={leaveGroupMutation.isPending ? "Leaving…" : "Leave group"}
        loading={leaveGroupMutation.isPending}
        confirmDisabled={isOwner && !transferOwnershipTo}
        tone="warning"
        onCancel={() => setConfirmLeave(false)}
        onConfirm={handleLeaveGroup}
      >
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
              <option value="" disabled>
                Choose a member…
              </option>
              {ownershipTransferCandidates.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName ?? member.username ?? member.userId}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-start gap-2 text-xs text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={leaveSilent}
            onChange={(e) => setLeaveSilent(e.target.checked)}
            className="mt-0.5 accent-[var(--color-cta)]"
          />
          <span>Leave silently — only admins see the system message.</span>
        </label>
      </ConfirmDialog>

      {/* Confirm: disband group */}
      <ConfirmDialog
        open={confirmDisband}
        title="Disband this group?"
        description="This permanently deletes the group for everyone. All members will be removed and messages will be inaccessible. This can't be undone."
        confirmLabel={disbandMutation.isPending ? "Disbanding…" : "Disband group"}
        loading={disbandMutation.isPending}
        tone="danger"
        onCancel={() => setConfirmDisband(false)}
        onConfirm={() => disbandMutation.mutate()}
      />

      {/* Confirm: delete conversation for me */}
      <ConfirmDialog
        open={confirmDeleteForMe}
        title="Delete this conversation for you?"
        description="The chat is hidden and your local message history is cleared. Other members aren't affected. New messages will bring it back."
        confirmLabel={deleteForMeMutation.isPending ? "Deleting…" : "Delete for me"}
        loading={deleteForMeMutation.isPending}
        tone="danger"
        onCancel={() => setConfirmDeleteForMe(false)}
        onConfirm={() =>
          deleteForMeMutation.mutate(conversationId, {
            onSettled: () => setConfirmDeleteForMe(false),
          })
        }
      />

      {/* Confirm: block direct user */}
      <ConfirmDialog
        open={confirmBlockDirect}
        title="Block this user?"
        description={
          conv?.otherUser?.displayName
            ? `${conv.otherUser.displayName} won't be able to message you. You can unblock them later from Settings → Privacy.`
            : "They won't be able to message you. You can unblock them later from Settings → Privacy."
        }
        confirmLabel={isBlockingDirect ? "Blocking…" : "Block user"}
        loading={isBlockingDirect}
        tone="danger"
        onCancel={() => setConfirmBlockDirect(false)}
        onConfirm={async () => {
          await handleBlockDirectUser();
          setConfirmBlockDirect(false);
        }}
      />
    </>
  );
}
