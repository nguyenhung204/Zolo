"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { getErrorMessage } from "@/lib/api/errors";
import { registerInit } from "@/lib/api/auth";

const NAME_MAX_LENGTH = 20;

export default function RegisterPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.toLowerCase().endsWith("@gmail.com")) {
      setError("Only Gmail addresses (@gmail.com) are accepted.");
      return;
    }

    if (!firstName.trim() || !lastName.trim()) {
      setError("First name and last name are required.");
      return;
    }

    if (firstName.trim().length > NAME_MAX_LENGTH || lastName.trim().length > NAME_MAX_LENGTH) {
      setError("First name and last name must be at most 20 characters.");
      return;
    }

    setLoading(true);
    try {
      await registerInit({
        email,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      router.push(
        `/register/verify-otp?email=${encodeURIComponent(email)}&firstName=${encodeURIComponent(firstName.trim())}&lastName=${encodeURIComponent(lastName.trim())}`
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Registration failed. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-bg">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-10 shadow-xl space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-primary tracking-tight">Create account</h1>
          <p className="text-sm text-muted">We&apos;ll send a verification code to your email</p>
        </div>

        <div className="h-px bg-border" />

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
            <label className="text-xs font-medium text-secondary uppercase tracking-wide" htmlFor="firstName">
              First name
            </label>
            <input
              id="firstName"
              type="text"
              autoComplete="given-name"
              required
              maxLength={NAME_MAX_LENGTH}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cta"
              placeholder="John"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-secondary uppercase tracking-wide" htmlFor="lastName">
              Last name
            </label>
            <input
              id="lastName"
              type="text"
              autoComplete="family-name"
              required
              maxLength={NAME_MAX_LENGTH}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cta"
              placeholder="Doe"
            />
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
            Continue
          </button>
        </form>

        <div className="text-center">
          <a
            href="/login"
            className="text-xs text-muted hover:text-primary transition"
          >
            Already have an account? Sign in
          </a>
        </div>
      </div>
    </div>
  );
}
