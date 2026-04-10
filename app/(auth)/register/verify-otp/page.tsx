"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { getErrorMessage } from "@/lib/api/errors";
import { registerInit, registerVerifyOtp } from "@/lib/api/auth";

function VerifyOtpContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const firstName = searchParams.get("firstName") ?? "";
  const lastName = searchParams.get("lastName") ?? "";

  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!/^\d{6}$/.test(otp)) {
      setError("Please enter the 6-digit code");
      return;
    }

    setLoading(true);
    try {
      const { registrationToken } = await registerVerifyOtp({ email, otp });
      router.push(
        `/register/complete?token=${encodeURIComponent(registrationToken)}`
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Invalid or expired code."));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email || !firstName || !lastName || resending) return;
    setResending(true);
    setError("");
    try {
      await registerInit({ email, firstName, lastName });
      setResent(true);
      setTimeout(() => setResent(false), 5000);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Could not resend code."));
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-bg">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-10 shadow-xl space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-primary tracking-tight">Check your email</h1>
          <p className="text-sm text-muted">
            We sent a 6-digit code to <span className="text-primary font-medium">{email}</span>
          </p>
        </div>

        <div className="h-px bg-border" />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-secondary uppercase tracking-wide" htmlFor="otp">
              Verification code
            </label>
            <input
              id="otp"
              type="text"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              required
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary text-center tracking-widest placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cta"
              placeholder="000000"
            />
            <p className="text-xs text-muted">Code expires in 10 minutes</p>
          </div>

          {error && (
            <p className="text-xs text-red-500 bg-red-500/10 rounded px-3 py-2">{error}</p>
          )}

          {resent && (
            <p className="text-xs text-green-600 bg-green-500/10 rounded px-3 py-2">
              A new code has been sent.
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-cta px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-60 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cta"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Verify
          </button>
        </form>

        <div className="text-center space-y-1">
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="text-xs text-muted hover:text-primary transition disabled:opacity-50"
          >
            {resending ? "Sending…" : "Didn't receive a code? Resend"}
          </button>
          <div>
            <a
              href="/register"
              className="text-xs text-muted hover:text-primary transition"
            >
              ← Back
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RegisterVerifyOtpPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted" />
      </div>
    }>
      <VerifyOtpContent />
    </Suspense>
  );
}
