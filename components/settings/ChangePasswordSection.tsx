"use client";

import { useState } from "react";
import { Loader2, CheckCircle2, Eye, EyeOff, Check } from "lucide-react";
import { changePassword } from "@/lib/api/auth";

const strengthChecks = (pwd: string) => [
  { label: "8+ characters", ok: pwd.length >= 8 },
  { label: "Uppercase letter", ok: /[A-Z]/.test(pwd) },
  { label: "Lowercase letter", ok: /[a-z]/.test(pwd) },
  { label: "Number", ok: /\d/.test(pwd) },
  { label: "Special character (!@#$%^&*)", ok: /[!@#$%^&*]/.test(pwd) },
];

export function ChangePasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const checks = strengthChecks(newPassword);
  const allStrong = checks.every((c) => c.ok);
  const confirmMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (!allStrong) { setError("Password does not meet all requirements."); return; }
    if (newPassword !== confirmPassword) { setError("Passwords do not match."); return; }
    if (currentPassword === newPassword) { setError("New password must differ from current password."); return; }

    setLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password. Check your current password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="bg-surface rounded-2xl border border-border p-6 space-y-5">
      <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">
        Change Password
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
        {/* Current password */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-secondary uppercase tracking-wide" htmlFor="cp-current">
            Current password
          </label>
          <div className="relative">
            <input
              id="cp-current"
              type={showCurrent ? "text" : "password"}
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 pr-10 text-sm text-primary placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cta"
              placeholder="••••••••"
            />
            <button type="button" onClick={() => setShowCurrent((s) => !s)} className="absolute inset-y-0 right-0 px-3 text-muted hover:text-primary transition" tabIndex={-1}>
              {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* New password */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-secondary uppercase tracking-wide" htmlFor="cp-new">
            New password
          </label>
          <div className="relative">
            <input
              id="cp-new"
              type={showNew ? "text" : "password"}
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 pr-10 text-sm text-primary placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cta"
              placeholder="••••••••"
            />
            <button type="button" onClick={() => setShowNew((s) => !s)} className="absolute inset-y-0 right-0 px-3 text-muted hover:text-primary transition" tabIndex={-1}>
              {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Strength checklist */}
        {newPassword.length > 0 && (
          <ul className="space-y-1">
            {checks.map((c) => (
              <li key={c.label} className="flex items-center gap-2 text-xs">
                <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${c.ok ? "border-green-500 bg-green-500 text-white" : "border-border text-muted"}`}>
                  {c.ok && <Check className="w-2.5 h-2.5" />}
                </span>
                <span className={c.ok ? "text-green-600" : "text-muted"}>{c.label}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Confirm password */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-secondary uppercase tracking-wide" htmlFor="cp-confirm">
            Confirm new password
          </label>
          <div className="relative">
            <input
              id="cp-confirm"
              type={showConfirm ? "text" : "password"}
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={`w-full rounded-lg border bg-bg px-3 py-2 pr-10 text-sm text-primary placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cta ${confirmMismatch ? "border-red-400" : "border-border"}`}
              placeholder="••••••••"
            />
            <button type="button" onClick={() => setShowConfirm((s) => !s)} className="absolute inset-y-0 right-0 px-3 text-muted hover:text-primary transition" tabIndex={-1}>
              {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {confirmMismatch && (
            <p className="text-xs text-red-500">Passwords do not match.</p>
          )}
        </div>

        {error && (
          <p className="text-xs text-red-500 bg-red-50 rounded px-3 py-2">{error}</p>
        )}

        {success && (
          <p className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 rounded px-3 py-2">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            Password changed successfully.
          </p>
        )}

        <button
          type="submit"
          disabled={loading || (newPassword.length > 0 && !allStrong) || confirmMismatch}
          className="flex items-center gap-2 rounded-lg bg-cta px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-60 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cta"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          Update password
        </button>
      </form>
    </section>
  );
}
