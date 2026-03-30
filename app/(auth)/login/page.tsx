"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { loginWithPassword, saveRefreshToken } from "@/lib/auth/token";
import { applyTokenSet, scheduleRefresh } from "@/lib/auth/AuthProvider";
import { useAuthStore } from "@/stores/authStore";

function LoginContent() {
  const searchParams = useSearchParams();
  const from = searchParams.get("from") ?? "/conversations";
  const router = useRouter();
  const { setAuth } = useAuthStore();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const tokens = await loginWithPassword(username, password);
      saveRefreshToken(tokens.refreshToken);
      applyTokenSet(tokens, setAuth);
      scheduleRefresh(tokens, (fresh) => {
        applyTokenSet(fresh, setAuth);
      });
      router.push(from);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
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

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-secondary uppercase tracking-wide" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cta"
              placeholder="your.name"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-secondary uppercase tracking-wide" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cta"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-xs text-red-500 bg-red-50 rounded px-3 py-2">{error}</p>
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
