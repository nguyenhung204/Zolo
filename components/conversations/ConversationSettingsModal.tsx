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
} from "lucide-react";
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
import type { MemberRole } from "@/lib/api/conversations";
import type { UserSearchResult } from "@/lib/api/friends";

// ─── Role helpers ─────────────────────────────────────────────────────────────

const ROLE_ICON: Record<MemberRole, React.ReactNode> = {
  owner: <Crown className="w-3 h-3 text-warning" />,
  admin: <Shield className="w-3 h-3 text-cta" />,
  moderator: <Shield className="w-3 h-3 text-success" />,
  member: <User className="w-3 h-3 text-muted" />,
  guest: <User className="w-3 h-3 text-muted/60" />,
};

const ROLE_LABEL: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  moderator: "Mod",
  member: "Member",
  guest: "Guest",
};

const ASSIGNABLE_ROLES: MemberRole[] = [
  "admin",
  "moderator",
  "member",
  "guest",
];

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  conversationId: string;
  open: boolean;
  onClose: () => void;
}

export function ConversationSettingsModal({ conversationId, open, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<"info" | "members">("info");
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [pendingAdd, setPendingAdd] = useState<UserSearchResult[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const handleClose = () => {
    setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    onClose();
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentUserId = useAuthStore((s) => s.user?.id);
  const { data: conv } = useConversation(conversationId);
  const { data: members = [] } = useConversationMembers(conversationId);
  const myRole = useMyConversationRole(conversationId);

  const canEdit = myRole === "owner" || myRole === "admin";
  const isOwner = myRole === "owner";

  const updateInfo = useUpdateConversationInfo();
  const addMembers = useAddConversationMembers();
  const removeMember = useRemoveConversationMember();
  const setRole = useSetMemberRole();
  const { mutateAsync: blockUser } = useBlockUser();
  const avatarUpload = useAvatarUpload();
  const [isBlockingDirect, setIsBlockingDirect] = useState(false);

  const { data: searchResults = [] } = useUserSearch(addQuery);

  const isDirect = conv?.kind === "DIRECT";
  const isAnnouncement = conv?.kind === "COMMUNITY";
  const ownerCount = members.filter((m) => m.role === "owner").length;
  const isUploading =
    avatarUpload.status === "uploading" ||
    avatarUpload.status === "finalizing";

  // Sync edit fields when conv or tab changes
  useEffect(() => {
    if (conv) {
      setEditName(conv.name ?? "");
      setEditDesc(conv.description ?? "");
      setIsDirty(false);
    }
  }, [conv, activeTab]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleAvatarSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    // Optimistic preview — instant feedback while upload runs
    const blobUrl = URL.createObjectURL(file);
    setPreviewUrl(blobUrl);
    const mediaId = await avatarUpload.upload(file);
    if (mediaId) {
      updateInfo.mutate(
        { id: conversationId, avatarMediaId: mediaId },
        {
          onSuccess: () => {
            // Server avatarUrl is now in the refetched query; release the blob
            setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
          },
        }
      );
    } else {
      // Upload failed — drop the preview
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
      { onSuccess: () => setIsDirty(false) }
    );
  };

  const handleAddMembers = () => {
    if (!pendingAdd.length) return;
    addMembers.mutate(
      { conversationId, userIds: pendingAdd.map((u) => u.id) },
      {
        onSuccess: () => {
          setPendingAdd([]);
          setAddQuery("");
        },
      }
    );
  };

  const togglePending = (user: UserSearchResult) => {
    setPendingAdd((prev) =>
      prev.some((u) => u.id === user.id)
        ? prev.filter((u) => u.id !== user.id)
        : [...prev, user]
    );
  };

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

  if (!open || !conv) return null;

  // ─── Render ────────────────────────────────────────────────────────────────

  const displayAvatarUrl = previewUrl ?? conv.avatarUrl;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-surface rounded-2xl shadow-xl flex flex-col max-h-[88vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
            <h2 className="text-base font-bold text-primary">Conversation Settings</h2>
            <button
              onClick={handleClose}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-primary hover:bg-border/50 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border shrink-0">
            {(["info", "members"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "flex-1 py-3 text-sm font-semibold transition cursor-pointer",
                  activeTab === tab
                    ? "text-cta border-b-2 border-cta"
                    : "text-muted hover:text-secondary"
                )}
              >
                {tab === "info" ? "Info" : `Members (${members.length})`}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {/* ══ INFO TAB ══ */}
            {activeTab === "info" && (
              <div className="p-6 space-y-5">
                {/* Avatar — non-DIRECT */}
                {!isDirect && (
                  <div className="flex items-center gap-4">
                    <div
                      onClick={() => canEdit && fileInputRef.current?.click()}
                      className={cn(
                        "relative w-16 h-16 rounded-2xl flex items-center justify-center overflow-hidden shrink-0 group",
                        canEdit ? "cursor-pointer" : "cursor-default",
                        !displayAvatarUrl && "bg-cta/10"
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

                      {/* Upload progress */}
                      {isUploading && (
                        <div
                          className="absolute bottom-0 left-0 h-1 bg-cta transition-all"
                          style={{ width: `${avatarUpload.progress}%` }}
                        />
                      )}

                      {/* Hover overlay */}
                      {canEdit && !isUploading && (
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <ImagePlus className="w-5 h-5 text-white" />
                        </div>
                      )}
                    </div>

                    <div>
                      <p className="text-sm font-semibold text-text">
                        {conv.name ?? "Unnamed"}
                      </p>
                      <p className="text-xs text-muted mt-0.5 capitalize">
                        {conv.kind.toLowerCase()} · {conv.memberCount} members
                      </p>
                      {canEdit && (
                        <p className="text-xs text-cta mt-1">Click avatar to change</p>
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

                {/* DIRECT — other user info */}
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
                      <div>
                        <p className="text-sm font-semibold text-text">
                          {conv.otherUser.displayName}
                        </p>
                        <p className="text-xs text-muted">@{conv.otherUser.username}</p>
                      </div>
                    </div>

                    <button
                      onClick={handleBlockDirectUser}
                      disabled={isBlockingDirect}
                      className="w-full py-2.5 text-sm font-semibold text-error border border-error/40 rounded-xl hover:bg-error/10 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {isBlockingDirect ? "Blocking..." : "Block User"}
                    </button>
                  </div>
                )}

                {/* Name + Description — non-DIRECT */}
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
                          placeholder="Channel name…"
                          className="w-full px-3 py-2 text-sm rounded-lg bg-bg border border-border focus:border-cta focus:outline-none focus:ring-2 focus:ring-cta/10 transition"
                        />
                      ) : (
                        <p className="px-3 py-2 text-sm text-text rounded-lg bg-bg border border-border/50">
                          {conv.name ?? "—"}
                        </p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-secondary">
                        Description
                      </label>
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
                        <p className="px-3 py-2 text-sm text-text rounded-lg bg-bg border border-border/50 min-h-18">
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
                {/* Add members section (OWNER/ADMIN, non-DIRECT) */}
                {canEdit && !isDirect && (
                  <div className="p-4 border-b border-border space-y-2">
                    <label className="text-xs font-semibold text-secondary">
                      Add members
                    </label>
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
                          (u) => !members.some((m) => m.userId === u.id)
                        ).length > 0 && (
                          <div className="absolute top-full left-0 right-0 mt-1 z-10 bg-surface border border-border rounded-xl shadow-lg max-h-44 overflow-y-auto">
                            {searchResults
                              .filter((u) => !members.some((m) => m.userId === u.id))
                              .slice(0, 6)
                              .map((user) => {
                                const isPending = pendingAdd.some(
                                  (u) => u.id === user.id
                                );
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
                                        {(
                                          user.firstName?.[0] ?? user.username[0]
                                        ).toUpperCase()}
                                      </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium text-text truncate">
                                        {user.firstName} {user.lastName}
                                      </p>
                                      <p className="text-xs text-muted">
                                        @{user.username}
                                      </p>
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

                    {/* Pending chips + Add button */}
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
                  {members.map((member) => {
                    const mRole = member.role as MemberRole;
                    const isSelf = member.userId === currentUserId;
                    const isLastOwner = mRole === "owner" && ownerCount <= 1;
                    const canRemove = canEdit && !isSelf && !isLastOwner;
                    const canChangeRole = isOwner && !isSelf && mRole !== "owner";

                    const displayName =
                      (member as { displayName?: string }).displayName ??
                      (member as { username?: string }).username ??
                      member.userId;
                    const memberAvatarUrl = (member as { avatarUrl?: string | null })
                      .avatarUrl;

                    return (
                      <div
                        key={member.id}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-border/20 transition group"
                      >
                        {/* Avatar */}
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

                        {/* Name */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-text truncate">
                            {displayName}
                            {isSelf && (
                              <span className="text-muted font-normal ml-1">(you)</span>
                            )}
                          </p>
                        </div>

                        {/* Role */}
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

                        {/* Remove button */}
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
                          /* Spacer to keep layout consistent */
                          <div className="w-7 h-7 shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
