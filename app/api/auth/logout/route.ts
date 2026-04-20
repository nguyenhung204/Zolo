import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");

export async function POST(req: NextRequest) {
  // Best-effort: notify the backend so it can revoke the refresh token server-side.
  const refreshToken = req.cookies.get("zolo-refresh")?.value;
  if (refreshToken) {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Platform": "web",
        },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Non-fatal — always clear local cookies regardless.
    }
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("zolo-refresh", "", { path: "/api/auth", maxAge: 0 });
  response.cookies.set("zolo-auth", "", { path: "/", maxAge: 0 });
  return response;
}
