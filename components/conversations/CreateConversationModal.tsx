"use client";

import { useState, useRef, useCallback } from "react";
import {
  X,
  ImagePlus,
  Hash,
  Megaphone,
  MessageCircle,
  Loader2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  useCreateConversation,
} from "@/hooks/useConversations";
import { useUserSearch } from "@/hooks/useFriends";
import { useAvatarUpload } from "@/hooks/useMediaUpload";
import { deleteMedia } from "@/lib/api/media";
import { updateConversationInfo } from "@/lib/api/conversations";
import type { UserSearchResult } from "@/lib/api/friends";
import { encodeId } from "@/lib/utils/obfuscateId";
import type { ConversationKind } from "@/lib/api/conversations";

// ─── Tab configuration ────────────────────────────────────────────────────────

const TABS: { kind: ConversationKind; label: string; icon: React.ElementType }[] = [
  { kind: "direct", label: "Direct", icon: MessageCircle },
  { kind: "group", label: "Group", icon: Hash },
  { kind: "community", label: "Community", icon: Megaphone },
];

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreateConversationModal({ open, onClose }: Props) {
  const [kind, setKind] = useState<ConversationKind>("direct");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<UserSearchResult[]>([]);
  const [selectedDirect, setSelectedDirect] = useState<UserSearchResult | null>(null);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const create = useCreateConversation();
  const avatarUpload = useAvatarUpload();

  const { data: searchResults = [] } = useUserSearch(memberQuery);

  const isUploading =
    avatarUpload.status === "uploading" ||
    avatarUpload.status === "finalizing";

  // ─── Reset ─────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    setKind("direct");
    setName("");
    setDescription("");
    setMemberQuery("");
    setSelectedMembers([]);
    setSelectedDirect(null);
    setError("");
    setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    avatarUpload.reset();
  }, [avatarUpload]);

  const handleClose = () => {
    // If an avatar was uploaded but the form was never submitted, delete the orphaned media
    if (avatarUpload.mediaId) {
      deleteMedia(avatarUpload.mediaId).catch(() => {});
    }
    reset();
    onClose();
  };

  // ─── Avatar ────────────────────────────────────────────────────────────────

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Delete previously uploaded (but not yet saved) media before starting a new upload
    if (avatarUpload.mediaId) {
      deleteMedia(avatarUpload.mediaId).catch(() => {});
      avatarUpload.reset();
    }
    // Optimistic local preview
    setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
    avatarUpload.upload(file);
    e.target.value = "";
  };

  // ─── Members (multi-select for PROJECT) ───────────────────────────────────

  const toggleMember = (user: UserSearchResult) => {
    setSelectedMembers((prev) =>
      prev.some((m) => m.id === user.id)
        ? prev.filter((m) => m.id !== user.id)
        : [...prev, user]
    );
    setMemberQuery("");
  };

  // ─── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    setError("");
    try {
      let conv;

      if (kind === "direct") {
        if (!selectedDirect) {
          setError("Please select a user");
          return;
        }
        conv = await create.mutateAsync({
          kind: "direct",
          memberIds: [selectedDirect.id],
        });
      } else if (kind === "group") {
        if (!name.trim()) {
          setError("Name is required");
          return;
        }
        conv = await create.mutateAsync({
          kind: "group",
          name: name.trim(),
          description: description.trim() || undefined,
          memberIds: selectedMembers.map((m) => m.id),
        });
      } else {
        // COMMUNITY
        if (!name.trim()) {
          setError("Name is required");
          return;
        }
        conv = await create.mutateAsync({
          kind: "community",
          name: name.trim(),
          description: description.trim() || undefined,
          memberIds: [],
        });
      }

      // POST /conversations doesn't accept avatarMediaId — patch it separately
      if (avatarUpload.mediaId && kind !== "direct") {
        await updateConversationInfo(conv.id, { avatarMediaId: avatarUpload.mediaId });
      }

      // Clear avatar state so handleClose won't delete the now-saved media
      avatarUpload.reset();
      handleClose();
      router.push(`/conversations/${encodeId(conv.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create conversation");
    }
  };

  if (!open) return null;

  const isPending = create.isPending;
  const disabled = isPending || isUploading;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-surface rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
            <h2 className="text-base font-bold text-primary">New Conversation</h2>
            <button
              onClick={handleClose}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-primary hover:bg-border/50 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Type tabs */}
          <div className="flex gap-1 px-4 pt-4 shrink-0">
            {TABS.map(({ kind: k, label, icon: Icon }) => (
              <button
                key={k}
                onClick={() => {
                  setKind(k);
                  setError("");
                  setMemberQuery("");
                }}
                className={cn(
                  "flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer",
                  kind === k
                    ? "bg-cta/10 text-cta"
                    : "text-muted hover:bg-border/50 hover:text-secondary"
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-0">
            {/* ── Avatar (non-DIRECT) ── */}
            {kind !== "direct" && (
              <div className="flex items-center gap-4">
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="relative w-16 h-16 rounded-2xl bg-border/60 flex items-center justify-center cursor-pointer hover:bg-border transition overflow-hidden shrink-0"
                >
                  {previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewUrl}
                      alt="avatar preview"
                      className="w-full h-full object-cover"
                    />
                  ) : isUploading ? (
                    <Loader2 className="w-5 h-5 text-muted animate-spin" />
                  ) : (
                    <ImagePlus className="w-5 h-5 text-muted" />
                  )}
                  {isUploading && (
                    <div
                      className="absolute bottom-0 left-0 h-1 bg-cta transition-all"
                      style={{ width: `${avatarUpload.progress}%` }}
                    />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-text">Channel avatar</p>
                  <p className="text-xs text-muted mt-0.5">Optional · click to upload</p>
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

            {/* ── DIRECT: single user search ── */}
            {kind === "direct" && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary">Search user</label>
                {selectedDirect ? (
                  <div className="flex items-center gap-2.5 px-3 py-2.5 bg-cta/5 border border-cta/20 rounded-xl">
                    {selectedDirect.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selectedDirect.avatarUrl}
                        alt=""
                        className="w-7 h-7 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-cta/20 flex items-center justify-center text-xs font-semibold text-cta shrink-0">
                        {(selectedDirect.firstName?.[0] ?? selectedDirect.username[0]).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text truncate">
                        {selectedDirect.firstName} {selectedDirect.lastName || ""}
                      </p>
                      <p className="text-xs text-muted">@{selectedDirect.username}</p>
                    </div>
                    <button
                      onClick={() => setSelectedDirect(null)}
                      className="text-muted hover:text-primary transition cursor-pointer shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      placeholder="Type a name or username…"
                      value={memberQuery}
                      onChange={(e) => setMemberQuery(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg bg-bg border border-border focus:border-cta focus:outline-none focus:ring-2 focus:ring-cta/10 transition"
                    />
                    {memberQuery.length >= 2 && searchResults.length > 0 && (
                      <div className="border border-border rounded-xl overflow-hidden divide-y divide-border/50 max-h-48 overflow-y-auto">
                        {searchResults.slice(0, 6).map((user) => (
                          <button
                            key={user.id}
                            onClick={() => {
                              setSelectedDirect(user);
                              setMemberQuery("");
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
                            <div>
                              <p className="text-sm font-medium text-text">
                                {user.firstName} {user.lastName}
                              </p>
                              <p className="text-xs text-muted">@{user.username}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── Name (PROJECT / ANNOUNCEMENT) ── */}
            {(kind === "group" || kind === "community") && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-secondary">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder={
                    kind === "group" ? "e.g. Team Alpha" : "e.g. Company Updates"
                  }
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-bg border border-border focus:border-cta focus:outline-none focus:ring-2 focus:ring-cta/10 transition"
                />
              </div>
            )}

            {/* ── DEPARTMENT: name (optional) + departmentId ── */}
            {/* ── Description (GROUP / COMMUNITY) ── */}
            {(kind === "group" || kind === "community") && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-secondary">Description</label>
                <input
                  type="text"
                  placeholder="Optional description…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-bg border border-border focus:border-cta focus:outline-none focus:ring-2 focus:ring-cta/10 transition"
                />
              </div>
            )}

            {/* ── PROJECT: multi-member search ── */}
            {/* ── GROUP: multi-member search ── */}
            {kind === "group" && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary">Add members</label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search users…"
                    value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-bg border border-border focus:border-cta focus:outline-none focus:ring-2 focus:ring-cta/10 transition"
                  />
                  {memberQuery.length >= 2 &&
                    searchResults.filter(
                      (u) => !selectedMembers.some((m) => m.id === u.id)
                    ).length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 z-10 bg-surface border border-border rounded-xl shadow-lg max-h-40 overflow-y-auto">
                        {searchResults
                          .filter((u) => !selectedMembers.some((m) => m.id === u.id))
                          .slice(0, 6)
                          .map((user) => (
                            <button
                              key={user.id}
                              onClick={() => toggleMember(user)}
                              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-border/40 text-left transition cursor-pointer"
                            >
                              {user.avatarUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={user.avatarUrl}
                                  alt=""
                                  className="w-6 h-6 rounded-full object-cover shrink-0"
                                />
                              ) : (
                                <div className="w-6 h-6 rounded-full bg-secondary/20 flex items-center justify-center text-[10px] font-semibold text-secondary shrink-0">
                                  {(user.firstName?.[0] ?? user.username[0]).toUpperCase()}
                                </div>
                              )}
                              <span className="text-sm text-text">
                                {user.firstName} {user.lastName || `@${user.username}`}
                              </span>
                            </button>
                          ))}
                      </div>
                    )}
                </div>
                {selectedMembers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedMembers.map((m) => (
                      <span
                        key={m.id}
                        className="flex items-center gap-1 pl-2.5 pr-1.5 py-1 bg-cta/10 text-cta text-xs font-medium rounded-full"
                      >
                        {m.firstName || m.username}
                        <button
                          onClick={() =>
                            setSelectedMembers((p) => p.filter((u) => u.id !== m.id))
                          }
                          className="hover:text-red-500 transition cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── ANNOUNCEMENT note ── */}
            {/* ── COMMUNITY note ── */}
            {kind === "community" && (
              <div className="px-3 py-2.5 bg-warning/10 rounded-xl">
                <p className="text-xs text-warning font-medium">
                  Only Owner, Admin can post in this channel
                </p>
              </div>
            )}

            {/* Error */}
            {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
          </div>

          {/* Footer */}
          <div className="flex gap-2 px-6 py-4 border-t border-border shrink-0">
            <button
              onClick={handleClose}
              className="flex-1 py-2.5 text-sm font-semibold text-secondary border border-border rounded-xl hover:bg-border/50 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={disabled}
              className="flex-1 py-2.5 text-sm font-semibold text-white bg-cta rounded-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
            >
              {isPending ? "Creating…" : isUploading ? "Uploading…" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
