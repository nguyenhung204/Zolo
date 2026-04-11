// Browser-only auth utilities — no Keycloak browser SDK

import { getErrorMessage } from "@/lib/api/errors";

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms since epoch
}

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  preferred_username: string;
  [key: string]: unknown;
}

type TokenApiResponse = {
  message?: string;
  statusCode?: number;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number | string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  data?: TokenApiResponse;
};

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

// ─── Refresh token persistence ────────────────────────────────────────────────

const REFRESH_KEY = "zolo-refresh-token";
const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");

function getDeviceName() {
  if (typeof navigator === "undefined") return "web-client";
  return navigator.userAgent || "web-client";
}

function parseTokenResponse(raw: unknown): TokenSet {
  const body = (raw ?? {}) as TokenApiResponse;
  const nested = (body.data ?? {}) as TokenApiResponse;

  const accessToken = body.accessToken ?? body.access_token ?? nested.accessToken ?? nested.access_token;
  const refreshToken = body.refreshToken ?? body.refresh_token ?? nested.refreshToken ?? nested.refresh_token;
  const expiresInRaw = body.expiresIn ?? body.expires_in ?? nested.expiresIn ?? nested.expires_in;
  const expiresIn = typeof expiresInRaw === "number" ? expiresInRaw : Number(expiresInRaw);

  if (!accessToken || !refreshToken || !Number.isFinite(expiresIn)) {
    throw new Error("Invalid authentication response from server.");
  }

  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + (expiresIn - 30) * 1000,
  };
}

export function saveRefreshToken(token: string) {
  localStorage.setItem(REFRESH_KEY, token);
}

export function loadRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function clearRefreshToken() {
  localStorage.removeItem(REFRESH_KEY);
}

// ─── API calls (server-side proxied to keep client_secret off browser) ────────

export async function loginWithPassword(
  email: string,
  password: string
): Promise<TokenSet> {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Platform": "web",
    },
    body: JSON.stringify({
      email,
      password,
      platform: "web",
      deviceInfo: { deviceName: getDeviceName() },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(err, "Invalid email or password."));
  }

  const data = (await res.json()) as unknown;
  return parseTokenResponse(data);
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Platform": "web",
    },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(err, "Session expired. Please sign in again."));
  }

  const data = (await res.json()) as unknown;
  return parseTokenResponse(data);
}
