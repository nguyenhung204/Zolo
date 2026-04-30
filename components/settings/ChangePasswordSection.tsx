"use client";

import { useEffect, useState } from "react";
import {
  Loader2,
  CheckCircle2,
  Eye,
  EyeOff,
  Check,
  ChevronRight,
  KeyRound,
  X,
} from "lucide-react";
import { changePassword } from "@/lib/api/auth";
import { cn } from "@/lib/utils";

const strengthChecks = (pwd: string) => [
  { label: "8+ characters", ok: pwd.length >= 8 },
  { label: "Uppercase letter", ok: /[A-Z]/.test(pwd) },
  { label: "Lowercase letter", ok: /[a-z]/.test(pwd) },
  { label: "Number", ok: /\d/.test(pwd) },
  { label: "Special character (!@#$%^&*)", ok: /[!@#$%^&*]/.test(pwd) },
];

export function ChangePasswordSection() {
  const [open, setOpen] = useState(false);

  return (
    <section className="bg-surface rounded-2xl border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-surface-secondary transition cursor-pointer"
      >
        <div className="w-10 h-10 rounded-xl bg-cta/10 text-cta flex items-center justify-center shrink-0">
          <KeyRound className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1 text-left">
          <p className="text-sm font-semibold text-text">Change password</p>
          <p className="text-xs text-muted mt-0.5">
            Update the password used to sign in.
          </p>
        </div>
        <ChevronRight className="w-5 h-5 text-muted shrink-0" />
      </button>

      {open && <ChangePasswordModal onClose={() => setOpen(false)} />}
    </section>
  );
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
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
  const confirmMismatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword;

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (!allStrong) {
      setError("Password does not meet all requirements.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (currentPassword === newPassword) {
      setError("New password must differ from current password.");
      return;
    }

    setLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      // Auto-close after a short success indicator.
      setTimeout(onClose, 1500);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to change password. Check your current password.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-surface rounded-2xl shadow-xl border border-border max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-text">Change password</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-surface-secondary flex items-center justify-center text-muted hover:text-text transition cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto px-5 py-5 space-y-4"
        >
          <PasswordField
            id="cp-current"
            label="Current password"
            value={currentPassword}
            onChange={setCurrentPassword}
            show={showCurrent}
            onToggle={() => setShowCurrent((s) => !s)}
            autoComplete="current-password"
          />

          <PasswordField
            id="cp-new"
            label="New password"
            value={newPassword}
            onChange={setNewPassword}
            show={showNew}
            onToggle={() => setShowNew((s) => !s)}
            autoComplete="new-password"
          />

          {newPassword.length > 0 && (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
              {checks.map((c) => (
                <li
                  key={c.label}
                  className="flex items-center gap-2 text-xs"
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-full border shrink-0",
                      c.ok
                        ? "border-green-500 bg-green-500 text-white"
                        : "border-border text-muted",
                    )}
                  >
                    {c.ok && <Check className="w-2.5 h-2.5" />}
                  </span>
                  <span className={c.ok ? "text-green-600" : "text-muted"}>
                    {c.label}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <PasswordField
            id="cp-confirm"
            label="Confirm new password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            show={showConfirm}
            onToggle={() => setShowConfirm((s) => !s)}
            autoComplete="new-password"
            error={confirmMismatch ? "Passwords do not match." : undefined}
          />

          {error && (
            <p className="text-xs text-red-500 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2 border border-red-200 dark:border-red-500/30">
              {error}
            </p>
          )}

          {success && (
            <p className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 dark:bg-green-500/10 rounded-lg px-3 py-2 border border-green-200 dark:border-green-500/30">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              Password changed successfully.
            </p>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-surface-secondary">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-text hover:bg-border/40 transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={
              loading || (newPassword.length > 0 && !allStrong) || confirmMismatch
            }
            className="flex items-center gap-2 rounded-lg bg-cta px-5 py-2 text-sm font-semibold text-white hover:bg-cta-hover transition disabled:opacity-60 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cta"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Update password
          </button>
        </div>
      </div>
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  show,
  onToggle,
  autoComplete,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  autoComplete: string;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label
        className="text-xs font-medium text-secondary uppercase tracking-wide"
        htmlFor={id}
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "w-full rounded-lg border bg-bg px-3 py-2 pr-10 text-sm text-text placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cta",
            error ? "border-red-400" : "border-border",
          )}
          placeholder="••••••••"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute inset-y-0 right-0 px-3 text-muted hover:text-text transition cursor-pointer"
          tabIndex={-1}
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
