"use client";

import { useState, useEffect } from "react";
import { Sun, Moon, Monitor, AlignJustify, Rows3, Check } from "lucide-react";
import { useMyProfile, useUpdateSettings } from "@/hooks/useUser";
import type { NotificationSettings, PrivacySettings, UpdateSettingsDto } from "@/lib/api/users";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { cn } from "@/lib/utils";

type Theme = "LIGHT" | "DARK" | "SYSTEM";
type Density = "COMFORTABLE" | "COMPACT";

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "LIGHT", label: "Light", icon: Sun },
  { value: "DARK", label: "Dark", icon: Moon },
  { value: "SYSTEM", label: "System", icon: Monitor },
];

const DENSITY_OPTIONS: { value: Density; label: string; description: string; icon: typeof AlignJustify }[] = [
  { value: "COMFORTABLE", label: "Comfortable", description: "More spacing between messages", icon: Rows3 },
  { value: "COMPACT", label: "Compact", description: "Fit more messages on screen", icon: AlignJustify },
];

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
  const setEnterToSendStore = usePreferencesStore((s) => s.setEnterToSend);

  const [statusMessage, setStatusMessage] = useState("");
  const [theme, setTheme] = useState<"LIGHT" | "DARK" | "SYSTEM">("SYSTEM");
  const [messageDensity, setMessageDensity] = useState<"COMFORTABLE" | "COMPACT">("COMFORTABLE");
  const [enterToSend, setEnterToSend] = useState(true);
  const [desktopEnabled, setDesktopEnabled] = useState(true);
  const [mobileEnabled, setMobileEnabled] = useState(true);
  const [notifyFor, setNotifyFor] = useState<NotificationSettings["notifyFor"]>("ALL");
  const [allowStrangerMessagesAndCalls, setAllowStrangerMessagesAndCalls] = useState(true);
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
    // Default true for backward-compat: field absent on old accounts means allowed
    setAllowStrangerMessagesAndCalls(s.privacy?.allowStrangerMessagesAndCalls ?? true);
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
      },
      privacy: {
        allowStrangerMessagesAndCalls,
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
    <section className="bg-surface rounded-2xl border border-border p-5 sm:p-6 space-y-6">
      <div>
        <h2 className="text-base font-bold text-text">Preferences</h2>
        <p className="text-xs text-muted mt-0.5">Personalise how Zolo looks and notifies you.</p>
      </div>

      {/* ── Status message ───────────────────────────────────── */}
      <div className="space-y-1">
        <label htmlFor="statusMessage" className="text-xs font-semibold text-secondary">
          Status message
        </label>
        <input
          id="statusMessage"
          type="text"
          value={statusMessage}
          maxLength={100}
          onChange={(e) => { setStatusMessage(e.target.value); mark(); }}
          placeholder="“In a meeting”, “BRB”…"
          className="w-full px-3 py-2.5 rounded-xl border border-border bg-bg text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cta/40 focus:border-cta transition"
        />
        <p className="text-[10px] text-muted text-right">{statusMessage.length}/100</p>
      </div>

      {/* ── Appearance: theme cards ──────────────────────────── */}
      <SettingGroup label="Appearance">
        <div className="px-4 py-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-text">Theme</p>
            <p className="text-xs text-muted mt-0.5">Choose how Zolo looks for you.</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
              const active = theme === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => { setTheme(value); setThemeStore(value); mark(); }}
                  className={cn(
                    "relative flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition cursor-pointer text-center",
                    active
                      ? "border-cta bg-cta/5 text-cta"
                      : "border-border bg-bg text-secondary hover:border-secondary/60"
                  )}
                >
                  {active && (
                    <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-cta text-white flex items-center justify-center">
                      <Check className="w-2.5 h-2.5" />
                    </span>
                  )}
                  <Icon className="w-5 h-5" />
                  <span className="text-xs font-semibold">{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-4 py-4 border-t border-border space-y-3">
          <div>
            <p className="text-sm font-semibold text-text">Message density</p>
            <p className="text-xs text-muted mt-0.5">Spacing between messages in chat.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {DENSITY_OPTIONS.map(({ value, label, description, icon: Icon }) => {
              const active = messageDensity === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => { setMessageDensity(value); setDensityStore(value); mark(); }}
                  className={cn(
                    "relative flex items-start gap-3 p-3 rounded-xl border-2 text-left transition cursor-pointer",
                    active
                      ? "border-cta bg-cta/5"
                      : "border-border bg-bg hover:border-secondary/60"
                  )}
                >
                  <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", active ? "text-cta" : "text-muted")} />
                  <div className="min-w-0">
                    <p className={cn("text-sm font-semibold", active ? "text-cta" : "text-text")}>{label}</p>
                    <p className="text-xs text-muted truncate">{description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </SettingGroup>

      {/* ── Messaging ────────────────────────────────────────── */}
      <SettingGroup label="Messaging">
        <SettingRow label="Enter to send" description="Press Enter to send; Shift+Enter for new line">
          <Toggle checked={enterToSend} onChange={() => { setEnterToSend((v) => !v); setEnterToSendStore(!enterToSend); mark(); }} />
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
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border cursor-pointer hover:bg-bg transition has-checked:border-cta has-checked:bg-cta/5"
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
      </SettingGroup>

      {/* ── Privacy ──────────────────────────────────────────── */}
      <SettingGroup label="Privacy">
        <SettingRow
          label="Allow strangers to message & call me"
          description="When off, only accepted friends can send you direct messages or calls"
        >
          <Toggle
            checked={allowStrangerMessagesAndCalls}
            onChange={() => { setAllowStrangerMessagesAndCalls((v) => !v); mark(); }}
          />
        </SettingRow>
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
      <div className="px-4 py-2 bg-bg/60 border-b border-border">
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


