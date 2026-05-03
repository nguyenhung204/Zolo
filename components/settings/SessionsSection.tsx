"use client";

import { useState } from "react";
import { useSessions, useDeleteSession, useDeleteAllSessions } from "@/hooks/useUser";
import { formatDistanceToNowStrict } from "@/lib/utils/date";
import { Monitor, Smartphone, Globe, LogOut, Loader2 } from "lucide-react";
import type { UserSession } from "@/lib/api/users";

export function SessionsSection() {
  const { data: sessions, isLoading, isError } = useSessions();
  const deleteSession = useDeleteSession();
  const deleteAllSessions = useDeleteAllSessions();
  const [confirmAll, setConfirmAll] = useState(false);

  if (isLoading) {
    return (
      <section className="bg-surface rounded-2xl border border-border p-6 space-y-4 animate-pulse">
        <div className="h-4 w-28 bg-border rounded" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 w-full bg-border rounded-xl" />
        ))}
      </section>
    );
  }

  if (isError) {
    return (
      <section className="bg-surface rounded-2xl border border-border p-6">
        <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide mb-3">Active Sessions</h2>
        <p className="text-sm text-muted">Could not load sessions. Please try again.</p>
      </section>
    );
  }

  const count = sessions?.length ?? 0;

  return (
    <section className="bg-surface rounded-2xl border border-border p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">Active Sessions</h2>
          <p className="text-xs text-muted mt-0.5">{count} {count === 1 ? "session" : "sessions"} active</p>
        </div>

        {count > 1 && (
          confirmAll ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-secondary">Sign out all other devices?</span>
              <button
                onClick={() => { deleteAllSessions.mutate(); setConfirmAll(false); }}
                disabled={deleteAllSessions.isPending}
                className="text-xs font-semibold text-error hover:underline disabled:opacity-50"
              >
                {deleteAllSessions.isPending ? "Signing out…" : "Confirm"}
              </button>
              <button
                onClick={() => setConfirmAll(false)}
                className="text-xs text-muted hover:underline"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmAll(true)}
              className="text-xs font-medium text-error hover:underline"
            >
              Sign out all other devices
            </button>
          )
        )}
      </div>

      {count === 0 ? (
        <p className="text-sm text-muted py-2">No active sessions found.</p>
      ) : (
        <div className="space-y-2">
          {sessions!.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              onRevoke={() => deleteSession.mutate(session.id)}
              isRevoking={deleteSession.isPending && deleteSession.variables === session.id}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SessionCard({
  session,
  onRevoke,
  isRevoking,
}: {
  session: UserSession;
  onRevoke: () => void;
  isRevoking: boolean;
}) {
  const deviceLabel = session.deviceName ?? session.userAgent?.split(" ")[0] ?? "Unknown device";
  const platform = session.platform?.toLowerCase() ?? "";

  const Icon =
    platform === "mobile" || platform === "ios" || platform === "android"
      ? Smartphone
      : platform === "web"
        ? Monitor
        : Globe;

  const startedAt = session.start ? new Date(session.start) : null;
  const lastAccessAt = session.lastAccess ? new Date(session.lastAccess) : null;

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl border border-border/70 bg-bg/50 hover:bg-bg transition">
      <div className="flex items-center gap-3 min-w-0">
        <div className="shrink-0 w-9 h-9 rounded-xl bg-cta/10 text-cta flex items-center justify-center">
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text truncate">{deviceLabel}</p>
          <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted mt-0.5">
            {session.ipAddress && (
              <span className="font-mono bg-border/40 rounded px-1 py-0.5 text-[10px]">{session.ipAddress}</span>
            )}
            {session.platform && (
              <span className="capitalize">{session.platform}</span>
            )}
            {lastAccessAt && (
              <>
                <span>·</span>
                <span>Active {formatDistanceToNowStrict(lastAccessAt.toISOString())} ago</span>
              </>
            )}
          </div>
          {startedAt && (
            <p className="text-[10px] text-muted/60 mt-0.5">
              Since {startedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </p>
          )}
        </div>
      </div>

      <button
        onClick={onRevoke}
        disabled={isRevoking}
        className="shrink-0 flex items-center gap-1 text-xs font-medium text-error hover:text-error/80 disabled:opacity-50 transition cursor-pointer"
      >
        {isRevoking
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <LogOut className="w-3.5 h-3.5" />}
        {isRevoking ? "Revoking…" : "Revoke"}
      </button>
    </div>
  );
}
