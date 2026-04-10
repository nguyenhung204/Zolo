"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Check } from "lucide-react";
import { getErrorMessage } from "@/lib/api/errors";
import { registerComplete } from "@/lib/api/auth";

const strengthChecks = (pwd: string) => [
  { label: "8+ characters", ok: pwd.length >= 8 },
  { label: "Uppercase letter", ok: /[A-Z]/.test(pwd) },
  { label: "Lowercase letter", ok: /[a-z]/.test(pwd) },
  { label: "Number", ok: /\d/.test(pwd) },
  { label: "Special character (!@#$%^&*)", ok: /[!@#$%^&*]/.test(pwd) },
];

function CompleteRegistrationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const registrationToken = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const checks = strengthChecks(password);
  const allStrong = checks.every((c) => c.ok);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!allStrong) {
      setError("Password does not meet all requirements.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!agreed) {
      setError("You must agree to the Terms of Service and Privacy Policy to continue.");
      return;
    }
    if (!registrationToken) {
      setError("Registration session expired. Please start over.");
      return;
    }

    setLoading(true);
    try {
      await registerComplete({
        registrationToken,
        password,
        platform: "web",
      });
      router.push("/login?registered=1");
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Could not complete registration."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-bg">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-10 shadow-xl space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-primary tracking-tight">Set your password</h1>
          <p className="text-sm text-muted">Almost done — create a strong password</p>
        </div>

        <div className="h-px bg-border" />

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Password */}
          <div className="space-y-1.5">
            <label
              className="text-xs font-medium text-secondary uppercase tracking-wide"
              htmlFor="reg-password"
            >
              Password
            </label>
            <input
              id="reg-password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cta"
              placeholder="••••••••"
            />
          </div>

          {/* Strength checklist */}
          {password.length > 0 && (
            <ul className="space-y-1">
              {checks.map((c) => (
                <li key={c.label} className="flex items-center gap-2 text-xs">
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                      c.ok
                        ? "border-green-500 bg-green-500 text-white"
                        : "border-border text-muted"
                    }`}
                  >
                    {c.ok && <Check className="w-2.5 h-2.5" />}
                  </span>
                  <span className={c.ok ? "text-green-600" : "text-muted"}>{c.label}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Confirm password */}
          <div className="space-y-1.5">
            <label
              className="text-xs font-medium text-secondary uppercase tracking-wide"
              htmlFor="reg-confirm"
            >
              Confirm password
            </label>
            <input
              id="reg-confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cta"
              placeholder="••••••••"
            />
          </div>

          {/* Terms & Policy agreement */}
          <label className="flex items-start gap-2.5 cursor-pointer group">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-cta cursor-pointer"
            />
            <span className="text-xs text-muted leading-relaxed">
              I agree to the{" "}
              <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:opacity-75"
                onClick={(e) => e.stopPropagation()}
              >
                Terms of Service
              </a>{" "}
              and{" "}
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:opacity-75"
                onClick={(e) => e.stopPropagation()}
              >
                Privacy Policy
              </a>
            </span>
          </label>

          {error && (
            <p className="text-xs text-red-500 bg-red-500/10 rounded px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !agreed}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-cta px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-60 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cta"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Create account
          </button>
        </form>

        <div className="text-center">
          <a href="/login" className="text-xs text-muted hover:text-primary transition">
            Already have an account? Sign in
          </a>
        </div>
      </div>
    </div>
  );
}

export default function CompleteRegistrationPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted" />
        </div>
      }
    >
      <CompleteRegistrationContent />
    </Suspense>
  );
}
