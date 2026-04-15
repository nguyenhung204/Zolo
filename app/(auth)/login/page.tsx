"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Loader2, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { getErrorMessage } from "@/lib/api/errors";
import { loginWithPassword, saveRefreshToken } from "@/lib/auth/token";
import { applyTokenSet, scheduleRefresh } from "@/lib/auth/AuthProvider";
import { useAuthStore } from "@/stores/authStore";

function LoginContent() {
  const searchParams = useSearchParams();
  const from = searchParams.get("from") ?? "/conversations";
  const registered = searchParams.get("registered") === "1";
  const accountDeleted = searchParams.get("accountDeleted") === "1";
  const router = useRouter();
  const { setAuth } = useAuthStore();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.toLowerCase().endsWith("@gmail.com")) {
      setError("Only Gmail addresses (@gmail.com) are accepted.");
      return;
    }
    setLoading(true);
    try {
      const tokens = await loginWithPassword(email, password);
      saveRefreshToken(tokens.refreshToken);
      applyTokenSet(tokens, setAuth);
      scheduleRefresh(tokens, (fresh) => {
        applyTokenSet(fresh, setAuth);
      });
      router.push(from);
    } catch (err) {
      setError(getErrorMessage(err, "Invalid email or password."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-bg">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-10 shadow-xl space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-primary tracking-tight">ZoloChat</h1>
          <p className="text-sm text-muted">Enterprise communication platform</p>
        </div>

        <div className="h-px bg-border" />

        {registered && (
          <div className="flex items-center gap-2 rounded-lg bg-green-500/10 px-3 py-2 text-xs text-green-600">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Account created! Sign in to get started.
          </div>
        )}

        {accountDeleted && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Your account has been deleted permanently.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-secondary uppercase tracking-wide" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cta"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-secondary uppercase tracking-wide" htmlFor="password">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 pr-10 text-sm text-primary placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cta"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute inset-y-0 right-0 px-3 text-muted hover:text-primary transition"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-500 bg-red-500/10 rounded px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-cta px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-60 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cta"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Sign in
          </button>
        </form>

        <div className="text-center">
          <a
            href="/forgot-password"
            className="text-xs text-muted hover:text-primary transition"
          >
            Forgot password?
          </a>
        </div>

        <div className="text-center">
          <a
            href="/register"
            className="text-xs text-muted hover:text-primary transition"
          >
            Don&apos;t have an account? Sign up
          </a>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted" />
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
