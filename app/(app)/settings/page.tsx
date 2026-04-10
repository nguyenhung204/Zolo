"use client";

import { useState } from "react";
import { ProfileSection } from "@/components/settings/ProfileSection";
import { UserSettingsSection } from "@/components/settings/UserSettingsSection";
import { SessionsSection } from "@/components/settings/SessionsSection";
import { ChangePasswordSection } from "@/components/settings/ChangePasswordSection";
import { useAuthStore } from "@/stores/authStore";
import { getErrorMessage } from "@/lib/api/errors";
import { logoutCompletely } from "@/lib/auth/logout";
import { useRouter } from "next/navigation";

type Tab = "profile" | "preferences" | "sessions" | "account";

const TABS: { id: Tab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "preferences", label: "Preferences" },
  { id: "sessions", label: "Sessions" },
  { id: "account", label: "Account" },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const user = useAuthStore((s) => s.user);
  const router = useRouter();

  const handleLogout = async () => {
    setLogoutError("");
    setLogoutPending(true);
    try {
      await logoutCompletely();
      router.push("/login");
    } catch (error) {
      setLogoutError(getErrorMessage(error, "Could not sign out right now."));
    } finally {
      setLogoutPending(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 max-w-2xl mx-auto w-full p-6 space-y-5">
      <h1 className="text-lg font-bold text-primary">Settings</h1>

      {/* Tab nav */}
      <nav className="flex gap-1 border-b border-border pb-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition cursor-pointer border-b-2 -mb-px ${
              activeTab === tab.id
                ? "border-cta text-cta"
                : "border-transparent text-secondary hover:text-text hover:border-border"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Tab panels */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-6">
        {activeTab === "profile" && <ProfileSection />}

        {activeTab === "preferences" && <UserSettingsSection />}

        {activeTab === "sessions" && <SessionsSection />}

        {activeTab === "account" && (
          <>
            <ChangePasswordSection />

            <section className="bg-surface rounded-2xl border border-border p-6 space-y-2">
              <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide mb-4">Account</h2>
              <SettingRow label="User ID" value={user?.id ?? "—"} />
              <SettingRow label="Organisation" value={user?.orgId ?? "—"} />
            </section>

            <section className="bg-surface rounded-2xl border border-error/30 p-6">
              <h2 className="text-sm font-semibold text-error uppercase tracking-wide mb-4">Danger zone</h2>
              {logoutError && (
                <p className="mb-3 text-xs text-error">{logoutError}</p>
              )}
              <button
                onClick={handleLogout}
                disabled={logoutPending}
                className="px-5 py-2.5 rounded-lg bg-error text-white text-sm font-semibold hover:opacity-90 transition cursor-pointer"
              >
                {logoutPending ? "Signing out..." : "Sign out"}
              </button>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/60 last:border-0">
      <span className="text-sm text-secondary">{label}</span>
      <span className="text-sm font-medium text-text font-mono truncate max-w-65">{value}</span>
    </div>
  );
}
