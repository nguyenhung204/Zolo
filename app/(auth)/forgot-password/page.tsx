"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ArrowLeft, MailCheck } from "lucide-react";
import { getErrorMessage } from "@/lib/api/errors";
import { forgotPassword } from "@/lib/api/auth";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.toLowerCase().endsWith("@gmail.com")) {
      setError("Only Gmail addresses (@gmail.com) are accepted.");
      return;
    }
    setLoading(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to send OTP right now."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-bg">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-10 shadow-xl space-y-6">
        {sent ? (
          <div className="text-center space-y-4">
            <MailCheck className="mx-auto w-10 h-10 text-cta" />
            <h1 className="text-xl font-bold text-primary">Check your email</h1>
            <p className="text-sm text-muted">
              If <span className="font-medium text-primary">{email}</span> is registered,
              you will receive a one-time code shortly.
            </p>
            <button
              onClick={() =>
                router.push(`/reset-password?email=${encodeURIComponent(email)}`)
              }
              className="w-full rounded-lg bg-cta px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 focus:outline-none"
            >
              Enter OTP
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <h1 className="text-2xl font-bold text-primary tracking-tight">
                Forgot password
              </h1>
              <p className="text-sm text-muted">
                Enter your email and we will send you an OTP to reset your password.
              </p>
            </div>

            <div className="h-px bg-border" />

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  className="text-xs font-medium text-secondary uppercase tracking-wide"
                  htmlFor="email"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none"
                  placeholder="you@example.com"
                />
              </div>

              {error && (
                <p className="text-xs text-red-500 bg-red-500/10 rounded px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-cta px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-60 cursor-pointer focus:outline-none"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Send OTP
              </button>
            </form>

            <button
              onClick={() => router.push("/login")}
              className="flex items-center gap-1.5 text-xs text-muted hover:text-primary transition cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
