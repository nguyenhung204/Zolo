"use client";

import { useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { changePassword } from "@/lib/api/auth";

export function ChangePasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to change password. Check your current password.";
      setError(msg);
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
        <div className="space-y-1.5">
          <label
            className="text-xs font-medium text-secondary uppercase tracking-wide"
            htmlFor="cp-current"
          >
            Current password
          </label>
          <input
            id="cp-current"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cta"
            placeholder="••••••••"
          />
        </div>

        <div className="space-y-1.5">
          <label
            className="text-xs font-medium text-secondary uppercase tracking-wide"
            htmlFor="cp-new"
          >
            New password
          </label>
          <input
            id="cp-new"
            type="password"
            autoComplete="new-password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cta"
            placeholder="••••••••"
          />
        </div>

        <div className="space-y-1.5">
          <label
            className="text-xs font-medium text-secondary uppercase tracking-wide"
            htmlFor="cp-confirm"
          >
            Confirm new password
          </label>
          <input
            id="cp-confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cta"
            placeholder="••••••••"
          />
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
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-cta px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-60 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cta"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          Update password
        </button>
      </form>
    </section>
  );
}
