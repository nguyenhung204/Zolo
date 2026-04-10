"use client";

import { useState } from "react";
import { useSessions, useDeleteSession, useDeleteAllSessions } from "@/hooks/useUser";
import { formatDistanceToNowStrict } from "@/lib/utils/date";
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
  const rawClients = session.clients;
  const clientList = Array.isArray(rawClients)
    ? rawClients
    : rawClients && typeof rawClients === "object"
    ? Object.values(rawClients as Record<string, string>)
    : [];
  const clientNames = clientList.join(", ") || "Unknown client";

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl border border-border/70 bg-background/50 hover:bg-background transition">
      <div className="flex items-center gap-3 min-w-0">
        <div className="shrink-0 w-8 h-8 rounded-full bg-border/60 flex items-center justify-center">
          <DeviceIcon />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-text truncate">{clientNames}</p>
          <div className="flex items-center gap-2 text-xs text-muted">
            {session.ipAddress && (
              <>
                <span className="font-mono">{session.ipAddress}</span>
                <span>·</span>
              </>
            )}
            {session.lastAccess ? (
              <span>Active {formatDistanceToNowStrict(session.lastAccess)} ago</span>
            ) : session.started ? (
              <span>Started {formatDistanceToNowStrict(session.started)} ago</span>
            ) : null}
          </div>
          {session.started && (
            <p className="text-[10px] text-muted/70 mt-0.5">
              Since {new Date(session.started).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </p>
          )}
        </div>
      </div>

      <button
        onClick={onRevoke}
        disabled={isRevoking}
        className="shrink-0 text-xs font-medium text-error hover:underline disabled:opacity-50 transition"
      >
        {isRevoking ? "Revoking…" : "Revoke"}
      </button>
    </div>
  );
}

function DeviceIcon() {
  return (
    <svg className="w-4 h-4 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" />
    </svg>
  );
}
