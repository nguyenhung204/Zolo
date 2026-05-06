"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, ArrowLeft, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { getErrorMessage } from "@/lib/api/errors";
import { verifyOtp, resetPassword } from "@/lib/api/auth";

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,}$/;

const passwordStrength = (pwd: string) => [
  { label: "8+ characters", ok: pwd.length >= 8 },
  { label: "Uppercase", ok: /[A-Z]/.test(pwd) },
  { label: "Lowercase", ok: /[a-z]/.test(pwd) },
  { label: "Number", ok: /\d/.test(pwd) },
  { label: "Special (!@#$%^&*)", ok: /[!@#$%^&*]/.test(pwd) },
];

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillEmail = searchParams.get("email") ?? "";

  // step 1: verify OTP  |  step 2: set new password  |  done
  const [step, setStep] = useState<"otp" | "password" | "done">("otp");

  const [email, setEmail] = useState(prefillEmail);
  const [otp, setOtp] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ── Step 1: verify OTP ──────────────────────────────────────────────────────
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { resetToken: token } = await verifyOtp(email, otp);
      setResetToken(token);
      setStep("password");
    } catch (err) {
      setError(getErrorMessage(err, "Invalid or expired OTP."));
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: set new password ────────────────────────────────────────────────
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!PASSWORD_REGEX.test(newPassword)) {
      setError(
        "Password must be at least 8 characters and include uppercase, lowercase, a number, and a special character (!@#$%^&*).",
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await resetPassword(resetToken, newPassword);
      setStep("done");
    } catch (err) {
      setError(getErrorMessage(err, "Unable to reset password right now."));
    } finally {
      setLoading(false);
    }
  };

  // ── Done ────────────────────────────────────────────────────────────────────
  if (step === "done") {
    return (
      <div className="flex h-screen items-center justify-center bg-bg">
        <div className="w-full max-w-sm rounded-2xl bg-surface p-10 shadow-xl space-y-6 text-center">
          <CheckCircle2 className="mx-auto w-10 h-10 text-cta" />
          <h1 className="text-xl font-bold text-primary">Password reset</h1>
          <p className="text-sm text-muted">
            Your password has been updated. You can now sign in with your new password.
          </p>
          <button
            onClick={() => router.push("/login")}
            className="w-full rounded-lg bg-cta px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 focus:outline-none"
          >
            Go to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-bg">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-10 shadow-xl space-y-6">

        {/* ── Step 1: OTP ── */}
        {step === "otp" && (
          <>
            <div className="space-y-1">
              <h1 className="text-2xl font-bold text-primary tracking-tight">Verify OTP</h1>
              <p className="text-sm text-muted">
                Enter the one-time code sent to your email.
              </p>
            </div>

            <div className="h-px bg-border" />

            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  className="text-xs font-medium text-secondary uppercase tracking-wide"
                  htmlFor="rp-email"
                >
                  Email
                </label>
                <input
                  id="rp-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none"
                  placeholder="you@example.com"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  className="text-xs font-medium text-secondary uppercase tracking-wide"
                  htmlFor="rp-otp"
                >
                  One-time code
                </label>
                <input
                  id="rp-otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder:text-muted tracking-widest focus:outline-none"
                  placeholder="123456"
                />
              </div>

              {error && (
                <p className="text-xs text-red-500 bg-red-500/10 rounded px-3 py-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-cta px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-60 cursor-pointer focus:outline-none"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Verify OTP
              </button>
            </form>

            <button
              onClick={() => router.push("/forgot-password")}
              className="flex items-center gap-1.5 text-xs text-muted hover:text-primary transition cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>
          </>
        )}

        {/* ── Step 2: New password ── */}
        {step === "password" && (
          <>
            <div className="space-y-1">
              <h1 className="text-2xl font-bold text-primary tracking-tight">New password</h1>
              <p className="text-sm text-muted">Choose a strong new password for your account.</p>
            </div>

            <div className="h-px bg-border" />

            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  className="text-xs font-medium text-secondary uppercase tracking-wide"
                  htmlFor="rp-new-password"
                >
                  New password
                </label>
                <div className="relative">
                  <input
                    id="rp-new-password"
                    type={showNewPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 pr-10 text-sm text-primary placeholder:text-muted focus:outline-none"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((prev) => !prev)}
                    className="absolute inset-y-0 right-0 px-3 text-muted hover:text-primary transition"
                    aria-label={showNewPassword ? "Hide password" : "Show password"}
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {newPassword.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap pt-1">
                    {passwordStrength(newPassword).map(({ label, ok }) => (
                      <span
                        key={label}
                        className={`text-[11px] px-2 py-0.5 rounded-full border ${
                          ok
                            ? "border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400"
                            : "border-border bg-surface text-muted"
                        }`}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label
                  className="text-xs font-medium text-secondary uppercase tracking-wide"
                  htmlFor="rp-confirm-password"
                >
                  Confirm new password
                </label>
                <div className="relative">
                  <input
                    id="rp-confirm-password"
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 pr-10 text-sm text-primary placeholder:text-muted focus:outline-none"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    className="absolute inset-y-0 right-0 px-3 text-muted hover:text-primary transition"
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <p className="text-xs text-red-500 bg-red-500/10 rounded px-3 py-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-cta px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-60 cursor-pointer focus:outline-none"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Reset password
              </button>
            </form>

            <button
              onClick={() => { setStep("otp"); setError(""); }}
              className="flex items-center gap-1.5 text-xs text-muted hover:text-primary transition cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  );
}
