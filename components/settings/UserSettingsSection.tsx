"use client";

import { useState, useEffect } from "react";
import { useMyProfile, useUpdateSettings } from "@/hooks/useUser";
import type { NotificationSettings, UpdateSettingsDto } from "@/lib/api/users";
import { usePreferencesStore } from "@/stores/preferencesStore";

// ─── Constants ────────────────────────────────────────────────────────────────

const NOTIFY_FOR_OPTIONS: { value: NotificationSettings["notifyFor"]; label: string; description: string }[] = [
  { value: "ALL", label: "All messages", description: "Notify for every new message" },
  { value: "MENTIONS_ONLY", label: "Mentions only", description: "Only when someone @mentions you" },
  { value: "NOTHING", label: "Nothing", description: "No push notifications" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function UserSettingsSection() {
  const { data: profile, isLoading } = useMyProfile();
  const updateSettings = useUpdateSettings();
  const setThemeStore = usePreferencesStore((s) => s.setTheme);
  const setDensityStore = usePreferencesStore((s) => s.setMessageDensity);

  const [statusMessage, setStatusMessage] = useState("");
  const [theme, setTheme] = useState<"LIGHT" | "DARK" | "SYSTEM">("SYSTEM");
  const [messageDensity, setMessageDensity] = useState<"COMFORTABLE" | "COMPACT">("COMFORTABLE");
  const [enterToSend, setEnterToSend] = useState(true);
  const [desktopEnabled, setDesktopEnabled] = useState(true);
  const [mobileEnabled, setMobileEnabled] = useState(true);
  const [notifyFor, setNotifyFor] = useState<NotificationSettings["notifyFor"]>("ALL");
  const [muteUntil, setMuteUntil] = useState<string>("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const s = profile?.settings;
    if (!s) return;
    setStatusMessage(s.statusMessage ?? "");
    setTheme(s.theme ?? "SYSTEM");
    setMessageDensity(s.messageDensity ?? "COMFORTABLE");
    setEnterToSend(s.enterToSend ?? true);
    setDesktopEnabled(s.notifications?.desktopEnabled ?? true);
    setMobileEnabled(s.notifications?.mobileEnabled ?? true);
    setNotifyFor(s.notifications?.notifyFor ?? "ALL");
    setMuteUntil(s.notifications?.muteUntil ?? "");
  }, [profile]);

  function mark() { setDirty(true); }

  async function handleSave() {
    const dto: UpdateSettingsDto = {
      statusMessage: statusMessage || undefined,
      theme,
      messageDensity,
      enterToSend,
      notifications: {
        desktopEnabled,
        mobileEnabled,
        notifyFor,
        muteUntil: muteUntil || null,
      },
    };
    await updateSettings.mutateAsync(dto);
    setDirty(false);
  }

  if (isLoading) {
    return (
      <section className="bg-surface rounded-2xl border border-border p-6 animate-pulse space-y-4">
        <div className="h-4 w-28 bg-border rounded" />
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-10 w-full bg-border rounded-lg" />
        ))}
      </section>
    );
  }

  return (
    <section className="bg-surface rounded-2xl border border-border p-6 space-y-6">
      <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">Preferences</h2>

      {/* ── Status message ───────────────────────────────────── */}
      <div className="space-y-1">
        <label htmlFor="statusMessage" className="text-xs font-medium text-secondary">
          Status message
        </label>
        <input
          id="statusMessage"
          type="text"
          value={statusMessage}
          maxLength={100}
          onChange={(e) => { setStatusMessage(e.target.value); mark(); }}
          placeholder='"In a meeting", "BRB"'
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cta/40 focus:border-cta transition"
        />
        <p className="text-[10px] text-muted text-right">{statusMessage.length}/100</p>
      </div>

      {/* ── Appearance ───────────────────────────────────────── */}
      <SettingGroup label="Appearance">
        {/* Theme */}
        <SettingRow label="Theme" description="Interface colour scheme">
          <div className="flex gap-1">
            {(["LIGHT", "DARK", "SYSTEM"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTheme(t); setThemeStore(t); mark(); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer border ${
                  theme === t
                    ? "bg-cta text-white border-cta"
                    : "bg-background text-secondary border-border hover:border-secondary"
                }`}
              >
                {t === "LIGHT" ? "☀ Light" : t === "DARK" ? "🌙 Dark" : "⚙ System"}
              </button>
            ))}
          </div>
        </SettingRow>

        {/* Message density */}
        <SettingRow label="Message density" description="Spacing between messages in chat">
          <div className="flex gap-1">
            {(["COMFORTABLE", "COMPACT"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => { setMessageDensity(d); setDensityStore(d); mark(); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer border ${
                  messageDensity === d
                    ? "bg-cta text-white border-cta"
                    : "bg-background text-secondary border-border hover:border-secondary"
                }`}
              >
                {d === "COMFORTABLE" ? "Comfortable" : "Compact"}
              </button>
            ))}
          </div>
        </SettingRow>
      </SettingGroup>

      {/* ── Messaging ────────────────────────────────────────── */}
      <SettingGroup label="Messaging">
        <SettingRow label="Enter to send" description="Press Enter to send; Shift+Enter for new line">
          <Toggle checked={enterToSend} onChange={() => { setEnterToSend((v) => !v); mark(); }} />
        </SettingRow>
      </SettingGroup>

      {/* ── Notifications ────────────────────────────────────── */}
      <SettingGroup label="Notifications">
        <SettingRow label="Desktop notifications" description="Push alerts in browser / desktop app">
          <Toggle checked={desktopEnabled} onChange={() => { setDesktopEnabled((v) => !v); mark(); }} />
        </SettingRow>
        <SettingRow label="Mobile notifications" description="Push alerts on mobile devices">
          <Toggle checked={mobileEnabled} onChange={() => { setMobileEnabled((v) => !v); mark(); }} />
        </SettingRow>

        {/* Notify for */}
        <div className="pt-1 space-y-1.5">
          <p className="text-xs font-medium text-secondary">Notify me for</p>
          <div className="space-y-1">
            {NOTIFY_FOR_OPTIONS.map(({ value, label, description }) => (
              <label
                key={value}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border cursor-pointer hover:bg-background transition has-checked:border-cta has-checked:bg-cta/5"
              >
                <input
                  type="radio"
                  name="notifyFor"
                  value={value}
                  checked={notifyFor === value}
                  onChange={() => { setNotifyFor(value); mark(); }}
                  className="accent-cta"
                />
                <div>
                  <p className="text-sm font-medium text-text">{label}</p>
                  <p className="text-xs text-muted">{description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Mute until */}
        <div className="pt-1 space-y-1">
          <label htmlFor="muteUntil" className="text-xs font-medium text-secondary">
            Mute all notifications until
          </label>
          <div className="flex items-center gap-2">
            <input
              id="muteUntil"
              type="datetime-local"
              value={muteUntil ? muteUntil.slice(0, 16) : ""}
              onChange={(e) => { setMuteUntil(e.target.value ? new Date(e.target.value).toISOString() : ""); mark(); }}
              className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm text-text focus:outline-none focus:ring-2 focus:ring-cta/40 focus:border-cta transition"
            />
            {muteUntil && (
              <button
                type="button"
                onClick={() => { setMuteUntil(""); mark(); }}
                className="text-xs text-muted hover:text-error transition"
              >
                Clear
              </button>
            )}
          </div>
          <p className="text-[10px] text-muted">Leave empty to remove mute.</p>
        </div>
      </SettingGroup>

      {/* ── Save ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSave}
          disabled={!dirty || updateSettings.isPending}
          className="px-4 py-2 rounded-lg bg-cta text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition cursor-pointer"
        >
          {updateSettings.isPending ? "Saving…" : "Save preferences"}
        </button>
        {updateSettings.isSuccess && !dirty && (
          <span className="text-xs text-green-600 font-medium">Saved</span>
        )}
        {updateSettings.isError && (
          <span className="text-xs text-error">Failed to save.</span>
        )}
      </div>
    </section>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SettingGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0 rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-2 bg-background/60 border-b border-border">
        <p className="text-[11px] font-semibold text-secondary uppercase tracking-wider">{label}</p>
      </div>
      <div className="divide-y divide-border/60">{children}</div>
    </div>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div>
        <p className="text-sm font-medium text-text">{label}</p>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex w-10 h-5 rounded-full transition-colors shrink-0 ${
        checked ? "bg-cta" : "bg-border"
      }`}
    >
      <span
        className={`block w-4 h-4 rounded-full bg-white shadow-sm absolute top-0.5 transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}


