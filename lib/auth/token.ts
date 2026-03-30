// Browser-only auth utilities — no Keycloak browser SDK

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

// ─── JWT decode (no external dependency) ─────────────────────────────────────

export function decodeJwt(token: string): JwtPayload {
  const payload = token.split(".")[1];
  const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(json) as JwtPayload;
}

// ─── Refresh token persistence ────────────────────────────────────────────────

const REFRESH_KEY = "zolo-refresh-token";

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
  username: string,
  password: string
): Promise<TokenSet> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, string>;
    throw new Error(err.error ?? "Login failed");
  }

  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in - 30) * 1000,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const res = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!res.ok) throw new Error("Session expired");

  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in - 30) * 1000,
  };
}
