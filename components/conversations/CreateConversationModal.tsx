"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import { X, Camera, Search, Loader2, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useCreateConversation } from "@/hooks/useConversations";
import { useFriendshipSearch, useUserSearch } from "@/hooks/useFriends";
import { useFriendProfiles } from "@/hooks/useFriendProfiles";
import { useAvatarUpload } from "@/hooks/useMediaUpload";
import { deleteMedia } from "@/lib/api/media";
import { encodeId } from "@/lib/utils/obfuscateId";
import type { UserProfile } from "@/lib/api/users";

type FriendPickUser = Pick<UserProfile, "id" | "username" | "email" | "firstName" | "lastName" | "avatarUrl">;

function getDisplayName(u: FriendPickUser) {
  return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.username || "?";
}

function groupAlphabetically(friends: FriendPickUser[]): { letter: string; users: FriendPickUser[] }[] {
  const map = new Map<string, FriendPickUser[]>();
  for (const u of friends) {
    const letter = getDisplayName(u)[0]?.toUpperCase() ?? "#";
    if (!map.has(letter)) map.set(letter, []);
    map.get(letter)!.push(u);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, users]) => ({ letter, users }));
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreateConversationModal({ open, onClose }: Props) {
  const [name, setName] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedUsers, setSelectedUsers] = useState<FriendPickUser[]>([]);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const create = useCreateConversation();
  const avatarUpload = useAvatarUpload();

  const { profiles: friendProfiles, isLoading: friendsLoading } = useFriendProfiles();
  const { data: searchedFriends = [], isFetching: friendsSearching } = useFriendshipSearch(memberQuery);

  const filteredFriends = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    const source = q.length >= 2 ? searchedFriends : friendProfiles;
    const sorted = [...source].sort((a, b) =>
      getDisplayName(a).localeCompare(getDisplayName(b))
    );
    if (!q) return sorted;
    return sorted.filter((u) => {
      const fullName = getDisplayName(u).toLowerCase();
      return (
        fullName.includes(q) ||
        u.username.toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [friendProfiles, memberQuery, searchedFriends]);

  const strangerSearchQuery = memberQuery.includes("@") && filteredFriends.length === 0 ? memberQuery : "";
  const { data: searchedStrangers = [], isFetching: strangersSearching } = useUserSearch(strangerSearchQuery);
  const strangerResults = useMemo(
    () => searchedStrangers.filter((u) => !selectedIds.has(u.id)),
    [searchedStrangers, selectedIds]
  );

  const grouped = useMemo(
    () => (memberQuery.trim() ? null : groupAlphabetically(filteredFriends)),
    [filteredFriends, memberQuery]
  );

  const isUploading = avatarUpload.status === "uploading" || avatarUpload.status === "finalizing";
  const uploadFailed = avatarUpload.status === "error";

  const reset = useCallback(() => {
    setName("");
    setMemberQuery("");
    setSelectedIds(new Set());
    setSelectedUsers([]);
    setError("");
    setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    avatarUpload.reset();
  }, [avatarUpload]);

  const handleClose = () => {
    if (avatarUpload.mediaId) deleteMedia(avatarUpload.mediaId).catch(() => {});
    reset();
    onClose();
  };

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (avatarUpload.mediaId) { deleteMedia(avatarUpload.mediaId).catch(() => {}); avatarUpload.reset(); }
    setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
    avatarUpload.upload(file);
    e.target.value = "";
  };

  const toggleMember = (user: FriendPickUser) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(user.id)) next.delete(user.id); else next.add(user.id);
      return next;
    });
    setSelectedUsers((prev) =>
      prev.some((u) => u.id === user.id)
        ? prev.filter((u) => u.id !== user.id)
        : [...prev, user]
    );
  };

  const handleSubmit = async () => {
    setError("");
    if (!name.trim()) { setError("Vui lòng nhập tên nhóm"); return; }
    try {
      const conv = await create.mutateAsync({
        kind: "group",
        name: name.trim(),
        memberIds: Array.from(selectedIds),
        avatarMediaId: avatarUpload.mediaId ?? undefined,
      });
      reset();
      onClose();
      router.push(`/conversations/${encodeId(conv.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tạo nhóm thất bại");
    }
  };

  if (!open) return null;

  const isPending = create.isPending;
  const canCreate = name.trim().length > 0 && !isPending && !isUploading && !uploadFailed;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={handleClose} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-[420px] bg-surface rounded-2xl shadow-xl flex flex-col max-h-[85vh]">

          {/* ── Header ── */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <h2 className="text-base font-bold text-text">Tạo nhóm</h2>
            <button onClick={handleClose} className="w-7 h-7 rounded-full flex items-center justify-center text-muted hover:text-text hover:bg-border/60 transition cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* ── Avatar + Name row ── */}
          <div className="flex items-center gap-3 px-5 pt-4 pb-3 shrink-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="relative w-12 h-12 rounded-full bg-border/60 flex items-center justify-center cursor-pointer hover:bg-border transition overflow-hidden shrink-0"
            >
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="" className={cn("w-full h-full object-cover", uploadFailed && "opacity-40")} />
              ) : isUploading ? (
                <Loader2 className="w-4 h-4 text-muted animate-spin" />
              ) : (
                <Camera className="w-4 h-4 text-muted" />
              )}
              {isUploading && (
                <div className="absolute bottom-0 left-0 h-0.5 bg-cta transition-all" style={{ width: `${avatarUpload.progress}%` }} />
              )}
            </button>
            <input
              type="text"
              placeholder="Nhập tên nhóm..."
              value={name}
              onChange={(e) => { setName(e.target.value); setError(""); }}
              className="flex-1 border-b border-border bg-transparent text-sm text-text placeholder:text-muted outline-none pb-1 transition"
              autoFocus
            />
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarSelect} />
          </div>

          {/* ── Search bar ── */}
          <div className="px-5 pb-3 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none" />
              <input
                type="text"
                placeholder="Nhập tên bạn bè hoặc email..."
                value={memberQuery}
                onChange={(e) => setMemberQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-xl bg-bg border border-border focus:outline-none transition placeholder:text-muted/70"
              />
            </div>
          </div>

          {/* ── Selected chips ── */}
          {selectedUsers.length > 0 && (
            <div className="px-5 pb-2 flex flex-wrap gap-1.5 shrink-0">
              {selectedUsers.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggleMember(u)}
                  className="flex items-center gap-1.5 pl-1 pr-2 py-0.5 bg-cta/10 hover:bg-cta/20 text-cta text-xs font-medium rounded-full transition cursor-pointer"
                >
                  {u.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={u.avatarUrl} alt="" className="w-4 h-4 rounded-full object-cover" />
                  ) : (
                    <div className="w-4 h-4 rounded-full bg-cta/30 flex items-center justify-center text-[9px] font-bold">
                      {getDisplayName(u)[0]?.toUpperCase()}
                    </div>
                  )}
                  {getDisplayName(u)}
                  <X className="w-2.5 h-2.5 opacity-60" />
                </button>
              ))}
            </div>
          )}

          {/* ── Friend list ── */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {friendsLoading || friendsSearching || strangersSearching ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-5 h-5 text-muted animate-spin" />
              </div>
            ) : filteredFriends.length === 0 && strangerResults.length === 0 ? (
              <p className="text-center text-xs text-muted py-8">
                {memberQuery.includes("@") ? "Không tìm thấy người dùng với email này" : "Không tìm thấy bạn bè"}
              </p>
            ) : strangerResults.length > 0 ? (
              <>
                <p className="px-5 py-1.5 text-xs font-semibold text-muted bg-bg/50">Người dùng theo email</p>
                {strangerResults.map((u) => (
                  <FriendRow key={u.id} user={u} selected={selectedIds.has(u.id)} onToggle={toggleMember} />
                ))}
              </>
            ) : grouped ? (
              // Alphabetical groups (no search query)
              <>{grouped.map(({ letter, users }) => (
                <div key={letter}>
                  <p className="px-5 py-1.5 text-xs font-semibold text-muted bg-bg/50">{letter}</p>
                  {users.map((u) => (
                    <FriendRow key={u.id} user={u} selected={selectedIds.has(u.id)} onToggle={toggleMember} />
                  ))}
                </div>
              ))}</>
            ) : (
              // Flat list when searching
              <>{filteredFriends.map((u) => (
                <FriendRow key={u.id} user={u} selected={selectedIds.has(u.id)} onToggle={toggleMember} />
              ))}</>
            )}
          </div>

          {/* ── Error ── */}
          {error && <p className="px-5 pb-1 text-xs text-red-500 shrink-0">{error}</p>}

          {/* ── Footer ── */}
          <div className="flex gap-2 px-5 py-4 border-t border-border shrink-0">
            <button
              onClick={handleClose}
              className="flex-1 py-2.5 text-sm font-semibold text-secondary border border-border rounded-xl hover:bg-border/50 transition cursor-pointer"
            >
              Huỷ
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canCreate}
              className="flex-1 py-2.5 text-sm font-semibold text-white bg-cta rounded-xl hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            >
              {isPending ? "Đang tạo…" : isUploading ? "Đang tải…" : "Tạo nhóm"}
            </button>
          </div>

        </div>
      </div>
    </>
  );
}

// ─── FriendRow ─────────────────────────────────────────────────────────────────

function FriendRow({ user, selected, onToggle }: { user: FriendPickUser; selected: boolean; onToggle: (user: FriendPickUser) => void }) {
  const name = getDisplayName(user);
  return (
    <button
      type="button"
      onClick={() => onToggle(user)}
      className="w-full flex items-center gap-3 px-5 py-2.5 hover:bg-border/30 transition cursor-pointer text-left"
    >
      {/* Checkbox */}
      <div className={cn(
        "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition",
        selected ? "bg-cta border-cta" : "border-border"
      )}>
        {selected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
      </div>

      {/* Avatar */}
      {user.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
      ) : (
        <div className="w-9 h-9 rounded-full bg-cta/20 flex items-center justify-center text-sm font-semibold text-cta shrink-0">
          {name[0]?.toUpperCase()}
        </div>
      )}

      {/* Name */}
      <span className="text-sm text-text truncate">{name}</span>
    </button>
  );
}
