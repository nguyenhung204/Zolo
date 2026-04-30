"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Check, X, Eye, EyeOff } from "lucide-react";
import { getErrorMessage } from "@/lib/api/errors";
import { registerComplete } from "@/lib/api/auth";

type PolicyTab = "terms" | "privacy";

const TERMS_SECTIONS = [
  {
    title: "Welcome to Zolo",
    paragraphs: [
      "Welcome to Zolo. By registering, accessing, and using the Zolo messaging application, you confirm that you have read, understood, and agreed to be bound by the Terms of Service below.",
    ],
  },
  {
    title: "1. Your Account",
    paragraphs: [
      "To use Zolo, you must register an account using accurate personal information, including your email address, phone number, and display name.",
      "You are fully responsible for keeping your password secure and managing active sessions on your devices. Any activity carried out through your account remains your legal responsibility.",
    ],
  },
  {
    title: "2. Conduct Rules and User-Generated Content",
    paragraphs: [
      "Zolo is a real-time communication platform. To protect the community, you may not use Zolo to post, share, or distribute illegal, obscene, violent, extremist, or copyright-infringing content.",
      "You may not distribute malware, viruses, spam, or attempt to disrupt system resources, including intentionally opening excessive WebSocket connections or carrying out denial-of-service attacks.",
      "You may not use Zolo for fraud, asset theft, harassment, or abuse of other users.",
      "You may not crawl, scrape, or collect personal data belonging to other users on the platform without authorization.",
    ],
  },
  {
    title: "3. Suspension and Account Termination",
    paragraphs: [
      "Zolo operates monitoring systems and reserves the right to intervene on your account. We may disable or permanently delete your account without prior notice if we determine that you violated the conduct rules above or if we receive a lawful request from a competent authority.",
    ],
  },
  {
    title: "4. Limitation of Liability",
    paragraphs: [
      "Zolo provides the service on an \"as is\" basis. We work to maintain real-time message delivery and reduce interruption, but we do not guarantee uninterrupted or error-free service in all circumstances.",
      "We are not responsible for the authenticity, accuracy, or legality of content sent by users through the chat system.",
    ],
  },
  {
    title: "5. Changes to These Terms",
    paragraphs: [
      "We may update these Terms of Service at any time. Material changes may be communicated through the application or by email.",
    ],
  },
] as const;

const PRIVACY_SECTIONS = [
  {
    title: "Privacy Policy",
    paragraphs: [
      "Last updated: April 11, 2026",
      "Your privacy is a top priority at Zolo. This policy explains how we collect, use, store, and protect your personal data when you use our real-time messaging platform.",
    ],
  },
  {
    title: "1. Data We Collect",
    paragraphs: [
      "To operate Zolo reliably, we collect identifying information such as your email, display name, avatar, and password hash.",
      "We also process communication data, including text messages, media files, conversation history, and delivery or read states.",
      "For device and session management, we collect data such as IP address, browser or user-agent information, operating system, device identifiers, and online or offline presence status.",
    ],
  },
  {
    title: "2. How We Use Data",
    paragraphs: [
      "Your data is used only to provide real-time messaging to your devices, send push notifications for new messages or important events, manage security and session revocation, improve system performance, and prevent spam or abuse.",
    ],
  },
  {
    title: "3. Sharing Data with Third Parties",
    paragraphs: [
      "We do not sell your personal data to advertisers. Zolo shares only the data necessary with infrastructure vendors that help operate the service.",
      "This may include Google Firebase or Apple APNs for push notifications, cloud providers for storing databases and uploaded media, and lawful authorities where disclosure is legally required.",
    ],
  },
  {
    title: "4. Storage and Security",
    paragraphs: [
      "Messages and personal data are transmitted over encrypted HTTPS and WSS connections.",
      "Sessions are protected with token-based authentication and are actively managed. The system can automatically invalidate expired or suspicious sessions.",
      "Messages and account data may be retained as long as required to provide the service, satisfy legal obligations, and support security or abuse investigations.",
    ],
  },
  {
    title: "5. User Rights",
    paragraphs: [
      "You may request an export of your personal data or request deletion of your account and related data from Zolo by contacting us through the support channels we provide.",
    ],
  },
] as const;

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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [policyTab, setPolicyTab] = useState<PolicyTab>("terms");
  const [policyOpen, setPolicyOpen] = useState(false);

  const checks = strengthChecks(password);
  const allStrong = checks.every((c) => c.ok);

  const openPolicyModal = (tab: PolicyTab) => {
    setPolicyTab(tab);
    setPolicyOpen(true);
  };

  const activeSections = policyTab === "terms" ? TERMS_SECTIONS : PRIVACY_SECTIONS;

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
            <div className="relative">
              <input
                id="reg-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
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
            <div className="relative">
              <input
                id="reg-confirm"
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 pr-10 text-sm text-primary placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cta"
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
              <button
                type="button"
                className="text-primary underline underline-offset-2 hover:opacity-75"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openPolicyModal("terms");
                }}
              >
                Terms of Service
              </button>{" "}
              and{" "}
              <button
                type="button"
                className="text-primary underline underline-offset-2 hover:opacity-75"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openPolicyModal("privacy");
                }}
              >
                Privacy Policy
              </button>
            </span>
          </label>

          <p className="text-[11px] text-muted">
            Click either document name to open the full policy in a modal before creating your account.
          </p>

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

      {policyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close policy modal"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setPolicyOpen(false)}
          />

          <div className="relative z-10 w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-3xl border border-border bg-surface shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-secondary">Legal</p>
                <h2 className="mt-1 text-xl font-bold text-primary">
                  {policyTab === "terms" ? "Terms of Service" : "Privacy Policy"}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Review the full document before agreeing to create your Zolo account.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setPolicyOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-secondary transition hover:border-secondary hover:text-primary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="border-b border-border px-6 py-3">
              <div className="flex gap-2">
                {([
                  { id: "terms", label: "Terms of Service" },
                  { id: "privacy", label: "Privacy Policy" },
                ] as const).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setPolicyTab(tab.id)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      policyTab === tab.id
                        ? "bg-cta text-white"
                        : "bg-bg text-secondary hover:text-primary"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-[calc(85vh-9.5rem)] overflow-y-auto px-6 py-6 space-y-6">
              {activeSections.map((section) => (
                <section key={section.title} className="space-y-2">
                  <h3 className="text-base font-semibold text-primary">{section.title}</h3>
                  <div className="space-y-2">
                    {section.paragraphs.map((paragraph) => (
                      <p key={paragraph} className="text-sm leading-6 text-secondary">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
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
