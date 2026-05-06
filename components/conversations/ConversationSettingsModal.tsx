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
  Users,
  Bell,
  BellOff,
  Trash2,
  ChevronDown,
  LogOut,
  AlertOctagon,
  PhoneOutgoing,
  PhoneIncoming,
  PhoneMissed,
  Phone,
  ChevronUp,
  BarChart3,
  Plus,
  ChevronRight,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useFriendProfiles } from "@/hooks/useFriendProfiles";
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
import { useFriendshipSearch, useFriendshipStatus, useBlockUser, useUnblockUser, useUserSearch } from "@/hooks/useFriends";
import { usePolls, useCreatePoll } from "@/hooks/useGroup";
import type { ConversationMuteDuration } from "@/lib/api/notifications";
import type { MemberRole, Conversation } from "@/lib/api/conversations";
import type { UserProfile } from "@/lib/api/users";
import {
  getCallHistory,
  getCallSummary,
  startInstantCall,
  type CallDto,
  type CallSummaryDto,
} from "@/lib/api/calls";
import { useCallStore } from "@/stores/callStore";
import { usePresenceStore } from "@/stores/presenceStore";
import { getCallSocket } from "@/lib/socket/socket";
import { formatDistanceToNowStrict } from "@/lib/utils/date";
import { PollUI } from "./PollUI";

// ─── Role helpers ─────────────────────────────────────────────────────────────

const ROLE_ICON: Record<MemberRole, React.ReactNode> = {
  owner: <Crown className="w-3 h-3 text-warning" />,
  admin: <Shield className="w-3 h-3 text-cta" />,
  member: <User className="w-3 h-3 text-muted" />,
};

type FriendPickUser = Pick<UserProfile, "id" | "username" | "email" | "firstName" | "lastName" | "avatarUrl">;

function filterFriendProfiles(friends: FriendPickUser[], query: string, excludedIds: Set<string>): FriendPickUser[] {
  const q = query.trim().toLowerCase();
  return friends
    .filter((u) => !excludedIds.has(u.id))
    .filter((u) => {
      if (!q) return true;
      const fullName = `${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase();
      return (
        u.username.toLowerCase().includes(q) ||
        fullName.includes(q) ||
        (u.email ?? "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const an = `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim() || a.username;
      const bn = `${b.firstName ?? ""} ${b.lastName ?? ""}`.trim() || b.username;
      return an.localeCompare(bn);
    });
}

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

function AddMemberRow({
  user,
  selected,
  onToggle,
}: {
  user: FriendPickUser;
  selected: boolean;
  onToggle: (user: FriendPickUser) => void;
}) {
  const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.username;
  return (
    <button
      type="button"
      onClick={() => onToggle(user)}
      className="w-full flex items-center gap-3 px-5 py-2.5 hover:bg-border/40 text-left transition cursor-pointer"
    >
      <div className={cn(
        "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition",
        selected ? "bg-cta border-cta" : "border-border"
      )}>
        {selected && <CheckIcon />}
      </div>
      {user.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
      ) : (
        <div className="w-8 h-8 rounded-full bg-secondary/20 flex items-center justify-center text-xs font-semibold text-secondary shrink-0">
          {name[0]?.toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text truncate">{name}</p>
        <p className="text-xs text-muted truncate">{user.email || `@${user.username}`}</p>
      </div>
    </button>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="3">
      <path d="M20 6 9 17l-5-5" />
    </svg>
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

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-bold text-secondary uppercase tracking-wider">{title}</p>
        {description && <p className="text-[11px] text-muted mt-0.5">{description}</p>}
      </div>
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
  const [now] = useState(() => Date.now());

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

  const isForeverMuted = muteUntil
    ? new Date(muteUntil).getTime() - now > 365 * 24 * 60 * 60 * 1000
    : false;
  const muteUntilLabel = muteUntil && !isForeverMuted
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
            {isMuted ? "Notifications off" : "Notifications on"}
          </p>
          <p className="text-xs text-muted mt-0.5 leading-snug">
            {isMuted
              ? muteUntilLabel
                ? `Muted until ${muteUntilLabel}`
                : "Muted until you turn them back on"
              : "Toggle off to mute this conversation"}
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
            {isMuted ? "Change mute duration" : "Turn notifications off for…"}
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

function formatCallDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return "No answer";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

const END_REASON_LABEL: Record<string, string> = {
  user_ended: "Ended by participant",
  declined: "Declined",
  caller_cancelled: "Cancelled by caller",
  ringing_timeout: "No answer",
  ghost_call_cleanup: "Cleaned up",
  stale_call_cleanup: "Expired",
  membership_revoked: "Membership revoked",
};

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-xs font-medium text-text">{value}</span>
    </div>
  );
}

function CompactCallRow({
  call,
  myId,
  conversationId,
}: {
  call: CallDto;
  myId: string;
  conversationId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [recalling, setRecalling] = useState(false);
  const profileMap = usePresenceStore((s) => s.profileMap);
  const { setOutgoingCall } = useCallStore();

  const { data: summary, isLoading: summaryLoading } = useQuery<CallSummaryDto | null>({
    queryKey: queryKeys.calls.summary(call.id),
    queryFn: () => getCallSummary(call.id),
    enabled: expanded,
    staleTime: Infinity,
  });

  const isOutgoing = call.callerId === myId;
  const isMissed = call.status === "MISSED" || call.status === "REJECTED";
  const callerProfile = profileMap[call.callerId];
  const callerName = callerProfile?.displayName ?? call.callerId.slice(0, 8);
  const Icon = isMissed ? PhoneMissed : isOutgoing ? PhoneOutgoing : PhoneIncoming;
  const iconColor = isMissed ? "text-error" : isOutgoing ? "text-cta" : "text-success";
  const statusLabel = isMissed ? "Missed" : call.status === "ENDED" ? "Ended" : call.status;
  const otherParticipantIds = call.participants.map((p) => p.userId).filter((id) => id !== myId);

  const handleRecall = async () => {
    if (recalling) return;
    setRecalling(true);
    try {
      const callDto = await startInstantCall({ conversationId, calleeIds: otherParticipantIds });
      setOutgoingCall(callDto);
      getCallSocket().emit("call:join_room", { callId: callDto.id });
    } catch {
      toast.error("Could not start the call.");
    } finally {
      setRecalling(false);
    }
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-surface">
      <div className="flex items-center gap-2.5 px-3 py-2">
        <Icon className={cn("w-4 h-4 shrink-0", iconColor)} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text truncate">
            {isOutgoing ? "Outgoing" : `From ${callerName}`}
          </p>
          <p className="text-xs text-muted">
            {statusLabel} · {formatDistanceToNowStrict(call.createdAt)} ago
          </p>
        </div>
        {!isMissed && <span className="text-xs text-muted">{formatCallDuration(summary?.durationMs)}</span>}
        <button
          onClick={handleRecall}
          disabled={recalling}
          title="Call back"
          className="w-7 h-7 rounded-lg flex items-center justify-center text-cta hover:bg-cta/10 transition cursor-pointer disabled:opacity-40"
        >
          {recalling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Phone className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-primary hover:bg-border/50 transition cursor-pointer"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border px-3 py-2.5 bg-bg space-y-1.5">
          {summaryLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading summary…
            </div>
          ) : summary ? (
            <>
              <SummaryRow label="Duration" value={formatCallDuration(summary.durationMs)} />
              <SummaryRow label="End reason" value={END_REASON_LABEL[summary.endReason] ?? summary.endReason} />
              <SummaryRow label="Participants" value={String(summary.participantCount)} />
              {summary.endedAt && <SummaryRow label="Ended at" value={new Date(summary.endedAt).toLocaleTimeString()} />}
            </>
          ) : (
            <p className="text-xs text-muted">No summary available.</p>
          )}
        </div>
      )}
    </div>
  );
}

function CompactCallHistory({ conversationId, enabled }: { conversationId: string; enabled: boolean }) {
  const myId = useAuthStore((s) => s.user?.id ?? "");
  const { data: calls = [], isLoading } = useQuery<CallDto[]>({
    queryKey: queryKeys.calls.history(conversationId),
    queryFn: () => getCallHistory(conversationId, 1, 5),
    enabled,
    staleTime: 1000 * 60,
  });

  return (
    <div className="space-y-2">
      <SectionHeader title="Call History" description={calls.length ? `${calls.length} recent calls` : undefined} />
      {isLoading ? (
        <div className="flex items-center justify-center py-6 rounded-xl border border-border">
          <Loader2 className="w-4 h-4 text-muted animate-spin" />
        </div>
      ) : calls.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center rounded-xl border border-dashed border-border text-muted">
          <PhoneMissed className="w-6 h-6 text-border" />
          <p className="text-sm">No calls yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {calls.map((call) => (
            <CompactCallRow key={call.id} call={call} myId={myId} conversationId={conversationId} />
          ))}
        </div>
      )}
    </div>
  );
}

type PollInfoView = "list" | "create";

function CompactPolls({
  conversation,
  conversationId,
  myRole,
  enabled,
}: {
  conversation: Conversation;
  conversationId: string;
  myRole: MemberRole | null;
  enabled: boolean;
}) {
  const [view, setView] = useState<PollInfoView>("list");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multipleChoice, setMultipleChoice] = useState(false);
  const [deadline, setDeadline] = useState("");
  const [now] = useState(() => Date.now());
  const { data: polls = [] } = usePolls(conversationId, enabled);
  const supportsPolls = conversation.kind === "group";
  const allowMemberMessage = conversation.allowMemberMessage !== false;
  const createPoll = useCreatePoll(conversationId);

  const MAX_ACTIVE_POLLS = 3;
  const activePolls = polls.filter((p) => !p.isClosed && (!p.deadline || new Date(p.deadline).getTime() > now));
  const atPollLimit = activePolls.length >= MAX_ACTIVE_POLLS;

  const sortedPolls = [...polls].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const cleanOptions = options.map((option) => option.trim()).filter(Boolean);
  const uniqueOptions = Array.from(new Set(cleanOptions));
  const deadlineDate = deadline ? new Date(deadline) : null;
  const isDeadlineValid = !deadlineDate || Number.isFinite(deadlineDate.getTime());
  const canCreate = question.trim().length > 0 && uniqueOptions.length >= 2 && uniqueOptions.length <= 10 && isDeadlineValid;

  const resetForm = () => {
    setQuestion("");
    setOptions(["", ""]);
    setMultipleChoice(false);
    setDeadline("");
  };

  const handleCreate = () => {
    if (!supportsPolls) {
      toast.error("Polls are only available in groups.");
      return;
    }
    if (atPollLimit) {
      toast.error(`Tối đa ${MAX_ACTIVE_POLLS} poll đang hoạt động. Đóng bớt poll để tạo mới.`);
      return;
    }
    if (cleanOptions.length !== uniqueOptions.length) {
      toast.error("Poll options must be unique.");
      return;
    }
    if (deadlineDate && deadlineDate.getTime() <= Date.now()) {
      toast.error("Poll deadline must be in the future.");
      return;
    }
    if (!canCreate) {
      toast.error("Polls need a question and 2–10 options.");
      return;
    }
    createPoll.mutate(
      {
        question: question.trim(),
        options: uniqueOptions,
        multipleChoice,
        ...(deadlineDate ? { deadline: deadlineDate.toISOString() } : {}),
      },
      {
        onSuccess: () => {
          toast.success("Poll created.");
          resetForm();
          setView("list");
        },
      },
    );
  };

  if (!supportsPolls) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <SectionHeader title="Polls" description={`${polls.length} poll${polls.length !== 1 ? "s" : ""} \u00b7 ${activePolls.length}/${MAX_ACTIVE_POLLS} active`} />
        {view === "list" && !atPollLimit && (
          <button
            onClick={() => setView("create")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-cta bg-cta/10 rounded-lg hover:bg-cta/15 transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            New
          </button>
        )}
      </div>

      {view === "list" ? (
        polls.length === 0 ? (
          <button
            onClick={() => setView("create")}
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-cta/5 border border-cta/20 hover:bg-cta/10 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <BarChart3 className="w-4 h-4 text-cta" />
              <span className="text-sm font-semibold text-cta">Create new poll</span>
            </div>
            <ChevronRight className="w-4 h-4 text-cta/60" />
          </button>
        ) : (
          <div className="space-y-3">
            {atPollLimit && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-border/30 border border-border text-xs text-muted">
                <BarChart3 className="w-3.5 h-3.5 shrink-0" />
                Tối đa {MAX_ACTIVE_POLLS} poll đang hoạt động. Đóng bớt poll để tạo mới.
              </div>
            )}
            {sortedPolls.map((poll) => (
              <PollUI
                key={poll.id}
                pollId={poll.id}
                myRole={myRole}
                allowMemberMessage={allowMemberMessage}
                initialData={poll}
              />
            ))}
          </div>
        )
      ) : (
        <div className="rounded-2xl border border-border bg-bg p-3 space-y-3">
          <div>
            <label className="text-[11px] font-semibold text-secondary uppercase tracking-wide mb-1.5 block">Question</label>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask something..."
              className="w-full px-3.5 py-2.5 text-sm rounded-xl bg-surface border border-border focus:outline-none placeholder:text-muted/60 text-text transition"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-secondary uppercase tracking-wide mb-1.5 block">Options</label>
            <div className="space-y-2">
              {options.map((option, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    value={option}
                    onChange={(e) => setOptions((prev) => prev.map((item, i) => (i === index ? e.target.value : item)))}
                    placeholder={`Option ${index + 1}`}
                    className="flex-1 px-3.5 py-2.5 text-sm rounded-xl bg-surface border border-border focus:outline-none placeholder:text-muted/60 text-text transition"
                  />
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setOptions((prev) => prev.filter((_, i) => i !== index))}
                      className="w-10 rounded-xl text-muted hover:text-error hover:bg-error/10 transition flex items-center justify-center cursor-pointer"
                      title="Remove option"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={options.length >= 10}
              onClick={() => setOptions((prev) => [...prev, ""])}
              className="flex items-center gap-1.5 mt-2 text-xs font-semibold text-cta hover:text-cta/80 disabled:text-muted disabled:cursor-not-allowed cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add option ({options.length}/10)
            </button>
          </div>
          <label className="flex items-center gap-2 text-xs text-text cursor-pointer">
            <input
              type="checkbox"
              checked={multipleChoice}
              onChange={(e) => setMultipleChoice(e.target.checked)}
              className="accent-[var(--color-cta)] w-3.5 h-3.5"
            />
            Multiple choices
          </label>
          <div>
            <label className="text-[11px] font-semibold text-secondary uppercase tracking-wide mb-1.5 block">Deadline (optional)</label>
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm rounded-xl bg-surface border border-border focus:outline-none text-text transition"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                resetForm();
                setView("list");
              }}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-text bg-surface hover:bg-border/50 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!canCreate || createPoll.isPending}
              className={cn(
                "flex-1 py-2.5 rounded-xl text-sm font-semibold transition cursor-pointer",
                canCreate ? "bg-cta text-white hover:opacity-90 active:scale-[0.98]" : "bg-border text-muted cursor-not-allowed",
              )}
            >
              {createPoll.isPending ? "Creating…" : "Create Poll"}
            </button>
          </div>
        </div>
      )}
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
  const [pendingAdd, setPendingAdd] = useState<FriendPickUser[]>([]);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [confirmDisband, setConfirmDisband] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaveSilent, setLeaveSilent] = useState(false);
  const [transferOwnershipTo, setTransferOwnershipTo] = useState("");
  const [confirmDeleteForMe, setConfirmDeleteForMe] = useState(false);
  const [isBlockingDirect, setIsBlockingDirect] = useState(false);
  const [confirmBlockDirect, setConfirmBlockDirect] = useState(false);
  const [isUnblockingDirect, setIsUnblockingDirect] = useState(false);
  const [confirmUnblockDirect, setConfirmUnblockDirect] = useState(false);
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
  const { mutateAsync: unblockDirectUser } = useUnblockUser();
  const { data: directFriendship } = useFriendshipStatus(
    conv?.kind === "direct" ? conv?.otherUser?.id : undefined,
  );
  const avatarUpload = useAvatarUpload();
  const leaveGroupMutation = useLeaveGroup();
  const deleteForMeMutation = useDeleteConversationForMe();
  const muteConversation = useMuteConversation(conversationId);
  const { data: notificationPreferences } = useNotificationPreferences(conversationId);

  const { profiles: friendProfiles, isLoading: friendsLoading } = useFriendProfiles();
  const { data: searchedFriends = [], isFetching: friendsSearching } = useFriendshipSearch(addQuery);

  const isDirect = conv?.kind === "direct";
  const isAnnouncement = conv?.kind === "community";
  const addableFriends = filterFriendProfiles(
    addQuery.trim().length >= 2 ? searchedFriends : friendProfiles,
    addQuery,
    new Set([
      ...members.map((m) => m.userId),
      ...pendingAdd.map((u) => u.id),
    ]),
  );
  const strangerSearchQuery = addQuery.includes("@") && addableFriends.length === 0 ? addQuery : "";
  const { data: searchedStrangers = [], isFetching: strangersSearching } = useUserSearch(strangerSearchQuery);
  const addableStrangers = searchedStrangers.filter(
    (u) => !members.some((m) => m.userId === u.id) && !pendingAdd.some((p) => p.id === u.id),
  );
  const ownerCount = members.filter((m) => m.role === "owner").length;
  const ownershipTransferCandidates = members.filter((m) => m.userId !== currentUserId);
  const convNotification = notificationPreferences?.conversation;
  const isConversationMuted =
    !!convNotification?.muteUntil && new Date(convNotification.muteUntil).getTime() > Date.now();
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
    setAddMemberOpen(false);
    setAddQuery("");
    setPendingAdd([]);
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
          setAddMemberOpen(false);
        },
      },
    );
  };

  const closeAddMemberModal = () => {
    setAddMemberOpen(false);
    setAddQuery("");
    setPendingAdd([]);
  };

  const togglePending = (user: FriendPickUser) => {
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

  const handleUnblockDirectUser = async () => {
    const otherUserId = conv?.otherUser?.id;
    if (!otherUserId) return;
    setIsUnblockingDirect(true);
    try {
      await unblockDirectUser(otherUserId);
      setConfirmUnblockDirect(false);
    } finally {
      setIsUnblockingDirect(false);
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
    { id: "members" as Tab, label: "Members" },
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
  const pendingAddPreview = pendingAdd.slice(0, 3);
  const pendingAddHiddenCount = Math.max(0, pendingAdd.length - pendingAddPreview.length);

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
                    <SectionHeader title="Notifications" />
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
                    {directFriendship?.status === "BLOCKED" ? (
                      <DangerRow
                        icon={<UserX className="w-4 h-4" />}
                        label="Unblock user"
                        description="Allow them to message you again."
                        tone="warning"
                        onClick={() => setConfirmUnblockDirect(true)}
                      />
                    ) : (
                      <DangerRow
                        icon={<UserX className="w-4 h-4" />}
                        label="Block user"
                        description="They won't be able to message you anymore."
                        onClick={() => setConfirmBlockDirect(true)}
                      />
                    )}
                    <DangerRow
                      icon={<Trash2 className="w-4 h-4" />}
                      label="Delete conversation"
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
                        className="w-full px-3 py-2 text-sm rounded-lg bg-bg border border-border focus:outline-none transition"
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
                        className="w-full px-3 py-2 text-sm rounded-lg bg-bg border border-border focus:outline-none transition resize-none"
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

              {!isDirect && (
                <>


                  <div className="pt-2 border-t border-border">
                    <CompactCallHistory conversationId={conversationId} enabled={open && activeTab === "info"} />
                  </div>

                  <div className="pt-2 border-t border-border">
                    <CompactPolls conversation={conv} conversationId={conversationId} myRole={myRole} enabled={open && activeTab === "info"} />
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === "members" && isDirect && (
            <div className="p-5 space-y-3">
              <SectionHeader title="Members (2)" />
              <div className="space-y-0.5">
                {conv.otherUser && (
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-border/20 transition">
                    {conv.otherUser.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={conv.otherUser.avatarUrl} alt={conv.otherUser.displayName} className="w-9 h-9 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-secondary/20 flex items-center justify-center text-sm font-semibold text-secondary shrink-0">
                        {conv.otherUser.displayName[0]?.toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text truncate">{conv.otherUser.displayName}</p>
                      <p className="text-xs text-muted">@{conv.otherUser.username}</p>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted shrink-0">
                      <User className="w-3 h-3" />
                      <span>Member</span>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-border/20 transition">
                  {members.find((m) => m.userId === currentUserId) && (() => {
                    const me = members.find((m) => m.userId === currentUserId)!;
                    const meAvatar = (me as { avatarUrl?: string | null }).avatarUrl;
                    const meName = (me as { displayName?: string }).displayName ?? (me as { username?: string }).username ?? "You";
                    const meUsername = (me as { username?: string }).username;
                    return (
                      <>
                        {meAvatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={meAvatar} alt={meName} className="w-9 h-9 rounded-full object-cover shrink-0" />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-secondary/20 flex items-center justify-center text-sm font-semibold text-secondary shrink-0">
                            {meName[0]?.toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-text truncate">
                            {meName}
                            <span className="text-muted font-normal ml-1">(you)</span>
                          </p>
                          {meUsername && <p className="text-xs text-muted">@{meUsername}</p>}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted shrink-0">
                          <User className="w-3 h-3" />
                          <span>Member</span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {activeTab === "members" && !isDirect && (
            <div className="p-5">
          <div className="space-y-3">
                <SectionHeader title={`Members (${membersLoading ? "…" : members.length})`} />
                {canEdit && (
                  <button
                    onClick={() => setAddMemberOpen(true)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-semibold text-cta border border-cta/30 rounded-xl hover:bg-cta/10 transition cursor-pointer"
                  >
                    <UserPlus className="w-4 h-4" />
                    Add member
                  </button>
                )}

                <div className="space-y-0.5">
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

                  {!membersLoading && members.length === 0 && (
                    <div className="flex flex-col items-center py-8 text-muted gap-2">
                      <Users className="w-8 h-8 opacity-40" />
                      <p className="text-sm">No members found</p>
                    </div>
                  )}

                  {!membersLoading &&
                    members.map((member) => {
                      const mRole = member.role as MemberRole;
                      const isSelf = member.userId === currentUserId;
                      const isLastOwner = mRole === "owner" && ownerCount <= 1;
                      const canRemove = canEdit && !isSelf && !isLastOwner && mRole !== "owner";
                      const canChangeRole = canManageAdmin && !isSelf && mRole !== "owner";
                      const displayName =
                        (member as { displayName?: string }).displayName ??
                        (member as { username?: string }).username ??
                        "Unknown user";
                      const memberAvatarUrl = (member as { avatarUrl?: string | null }).avatarUrl;

                      return (
                        <div key={member.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-border/20 transition group">
                          {memberAvatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={memberAvatarUrl} alt={displayName} className="w-9 h-9 rounded-full object-cover shrink-0" />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-secondary/20 flex items-center justify-center text-sm font-semibold text-secondary shrink-0">
                              {displayName[0]?.toUpperCase()}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-text truncate">
                              {displayName}
                              {isSelf && <span className="text-muted font-normal ml-1">(you)</span>}
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
                              className="text-xs border border-border rounded-lg px-2 py-1 bg-surface text-secondary cursor-pointer focus:outline-none transition"
                            >
                              {ASSIGNABLE_ROLES.map((r) => (
                                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
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
                              aria-label="Remove member"
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
                  label="Delete conversation"
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

      {addMemberOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeAddMemberModal} />
          <div className="relative w-full max-w-[420px] max-h-[82vh] bg-surface rounded-2xl shadow-2xl border border-border flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <h3 className="text-base font-bold text-text">Add member</h3>
              <button
                onClick={closeAddMemberModal}
                className="w-7 h-7 rounded-full flex items-center justify-center text-muted hover:text-text hover:bg-border/60 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-3 border-b border-border/60 shrink-0">
              <input
                type="text"
                placeholder="Search friends or enter email..."
                value={addQuery}
                onChange={(e) => setAddQuery(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl bg-bg border border-border focus:outline-none transition"
                autoFocus
              />
            </div>

            {pendingAdd.length > 0 && (
              <div className="px-5 py-2 flex items-center gap-2 flex-wrap border-b border-border/60 shrink-0">
                {pendingAddPreview.map((u) => (
                  <span key={u.id} className="flex items-center gap-1 pl-2.5 pr-1.5 py-1 bg-cta/10 text-cta text-xs font-medium rounded-full">
                    {u.firstName || u.username}
                    <button onClick={() => togglePending(u)} className="hover:text-red-500 transition cursor-pointer">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                {pendingAddHiddenCount > 0 && (
                  <span className="px-2.5 py-1 bg-border/60 text-secondary text-xs font-medium rounded-full">
                    +{pendingAddHiddenCount}
                  </span>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto min-h-0">
              {friendsLoading || friendsSearching || strangersSearching ? (
                <div className="px-5 py-8 flex justify-center">
                  <Loader2 className="w-5 h-5 text-muted animate-spin" />
                </div>
              ) : addableFriends.length === 0 && addableStrangers.length === 0 ? (
                <div className="px-5 py-8 text-center text-xs text-muted">
                  {addQuery.includes("@") ? "No user found with this email" : "No friends to add"}
                </div>
              ) : addableStrangers.length > 0 ? (
                <>
                  <p className="px-5 py-1.5 text-xs font-semibold text-muted bg-bg/50">User by email</p>
                  {addableStrangers.map((user) => (
                    <AddMemberRow key={user.id} user={user} selected={pendingAdd.some((u) => u.id === user.id)} onToggle={togglePending} />
                  ))}
                </>
              ) : (
                <>
                  <p className="px-5 py-1.5 text-xs font-semibold text-muted bg-bg/50">Friends</p>
                  {addableFriends.slice(0, 30).map((user) => (
                    <AddMemberRow key={user.id} user={user} selected={pendingAdd.some((u) => u.id === user.id)} onToggle={togglePending} />
                  ))}
                </>
              )}
            </div>

            <div className="flex gap-2 px-5 py-4 border-t border-border shrink-0">
              <button
                onClick={closeAddMemberModal}
                className="flex-1 py-2.5 text-sm font-semibold text-secondary border border-border rounded-xl hover:bg-border/50 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleAddMembers}
                disabled={pendingAdd.length === 0 || addMembers.isPending}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-cta rounded-xl hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              >
                {addMembers.isPending ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}

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
              className="w-full px-3 py-2 text-sm rounded-lg bg-bg border border-border focus:outline-none transition cursor-pointer"
            >
              <option value="" disabled>
                Choose a member…
              </option>
              {ownershipTransferCandidates.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName ?? member.username ?? "Unknown user"}
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

      {/* Confirm: delete conversation */}
      <ConfirmDialog
        open={confirmDeleteForMe}
        title="Delete conversation?"
        description="The chat is hidden and your local message history is cleared. Other members aren't affected. New messages will bring it back."
        confirmLabel={deleteForMeMutation.isPending ? "Deleting…" : "Delete"}
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

      {/* Confirm: unblock direct user */}
      <ConfirmDialog
        open={confirmUnblockDirect}
        title="Unblock this user?"
        description={
          conv?.otherUser?.displayName
            ? `${conv.otherUser.displayName} will be able to message you again.`
            : "They will be able to message you again."
        }
        confirmLabel={isUnblockingDirect ? "Unblocking…" : "Unblock"}
        loading={isUnblockingDirect}
        tone="warning"
        onCancel={() => setConfirmUnblockDirect(false)}
        onConfirm={handleUnblockDirectUser}
      />
    </>
  );
}
