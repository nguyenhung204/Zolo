// Browser-only auth utilities

import { getErrorMessage } from "@/lib/api/errors";

export interface TokenSet {
  accessToken: string;
  expiresAt: number; // ms since epoch
}

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  preferred_username: string;
  [key: string]: unknown;
}

type BffTokenResponse = {
  accessToken?: string;
  expiresIn?: number | string;
  error?: string;
};

// ─── In-memory token tracking (for visibility-based refresh) ─────────────────

let _currentTokenSet: TokenSet | null = null;

export function setCurrentTokenSet(t: TokenSet) {
  _currentTokenSet = t;
}

/**
 * Returns true when the current access token expires within `bufferMs`
 * (default 5 minutes). Used by the visibilitychange handler to decide
 * whether to refresh immediately after the tab is un-hidden.
 */
export function isTokenExpiringSoon(bufferMs = 5 * 60_000): boolean {
  if (!_currentTokenSet) return true;
  return _currentTokenSet.expiresAt - Date.now() < bufferMs;
}

// ─── JWT decode (no external dependency) ─────────────────────────────────────

export function decodeJwt(token: string): JwtPayload {
  if (!token || typeof token !== "string") {
    throw new Error("Invalid access token.");
  }

  const segments = token.split(".");
  if (segments.length < 2 || !segments[1]) {
    throw new Error("Malformed access token.");
  }

  const payload = segments[1];
  const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(json) as JwtPayload;
}

function getDeviceName() {
  if (typeof navigator === "undefined") return "web-client";
  return navigator.userAgent || "web-client";
}

function parseBffResponse(raw: unknown): TokenSet {
  const body = (raw ?? {}) as BffTokenResponse;
  const accessToken = body.accessToken;
  const expiresIn = Number(body.expiresIn);

  if (!accessToken || !Number.isFinite(expiresIn)) {
    throw new Error("Invalid authentication response from server.");
  }

  return {
    accessToken,
    expiresAt: Date.now() + (expiresIn - 30) * 1000,
  };
}

// ─── API calls via Next.js BFF — refresh token is kept in an HttpOnly cookie ──

export async function loginWithPassword(
  email: string,
  password: string
): Promise<TokenSet> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      platform: "web",
      deviceInfo: { deviceName: getDeviceName() },
    }),
    credentials: "same-origin",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(err, "Invalid email or password."));
  }

  const data = (await res.json()) as unknown;
  return parseBffResponse(data);
}

/**
 * Refresh the access token via the BFF.
 * The refresh token is transmitted automatically as an HttpOnly cookie —
 * no token is ever passed as an argument or stored in JavaScript.
 */
export async function refreshAccessToken(): Promise<TokenSet> {
  const res = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(err, "Session expired. Please sign in again."));
  }

  const data = (await res.json()) as unknown;
  return parseBffResponse(data);
}

/**
 * Clear the HttpOnly refresh-token cookie via the BFF logout endpoint.
 * After this call no JavaScript-inaccessible credentials remain in the browser.
 */
export async function clearRefreshTokenCookie(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  }).catch(() => {/* non-fatal */});
}
