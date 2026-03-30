"use client";

import { getKeycloak } from "@/lib/auth/keycloak";
import { useAuthStore } from "@/stores/authStore";
import { UserAvatar } from "@/components/presence/UserAvatar";
import { disconnectChatSocket, disconnectCallSocket } from "@/lib/socket/socket";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const router = useRouter();

  const handleLogout = () => {
    clearAuth();
    disconnectChatSocket();
    disconnectCallSocket();
    document.cookie = "zolo-auth=; path=/; max-age=0";
    const kc = getKeycloak();
    kc.logout({ redirectUri: `${window.location.origin}/login` });
  };

  return (
    <div className="flex flex-col h-full min-h-0 max-w-2xl mx-auto w-full p-6 space-y-6">
      <h1 className="text-lg font-bold text-primary">Settings</h1>

      {/* Profile card */}
      <section className="bg-surface rounded-2xl border border-border p-6 space-y-4">
        <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">Profile</h2>
        <div className="flex items-center gap-4">
          {user && (
            <UserAvatar
              userId={user.id}
              name={user.name}
              avatarUrl={user.avatarUrl}
              size="lg"
              showPresence={false}
            />
          )}
          <div>
            <p className="text-base font-bold text-text">{user?.name ?? "—"}</p>
            <p className="text-sm text-muted">{user?.email ?? "—"}</p>
            {user?.username && (
              <p className="text-xs text-muted">@{user.username}</p>
            )}
          </div>
        </div>
      </section>

      {/* Account */}
      <section className="bg-surface rounded-2xl border border-border p-6 space-y-2">
        <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide mb-4">Account</h2>
        <SettingRow label="User ID" value={user?.id ?? "—"} />
        <SettingRow label="Organisation" value={user?.orgId ?? "—"} />
      </section>

      {/* Danger */}
      <section className="bg-surface rounded-2xl border border-error/30 p-6">
        <h2 className="text-sm font-semibold text-error uppercase tracking-wide mb-4">Session</h2>
        <button
          onClick={handleLogout}
          className="px-5 py-2.5 rounded-lg bg-error text-white text-sm font-semibold hover:opacity-90 transition cursor-pointer"
        >
          Sign out
        </button>
      </section>
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/60 last:border-0">
      <span className="text-sm text-secondary">{label}</span>
      <span className="text-sm font-medium text-text font-mono truncate max-w-[260px]">{value}</span>
    </div>
  );
}
