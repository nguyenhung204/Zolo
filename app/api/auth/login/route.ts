import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const IS_PROD = process.env.NODE_ENV === "production";
// 30 days — typical refresh token lifetime
const REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

type BackendTokenResponse = {
  accessToken?: string;
  access_token?: string;
  refreshToken?: string;
  refresh_token?: string;
  expiresIn?: number | string;
  expires_in?: number | string;
  data?: BackendTokenResponse;
};

function pick(body: BackendTokenResponse) {
  const nested = body.data ?? {};
  return {
    accessToken: body.accessToken ?? body.access_token ?? nested.accessToken ?? nested.access_token,
    refreshToken: body.refreshToken ?? body.refresh_token ?? nested.refreshToken ?? nested.refresh_token,
    expiresIn: Number(body.expiresIn ?? body.expires_in ?? nested.expiresIn ?? nested.expires_in),
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const { email, password, platform, deviceInfo } = body ?? {};

    if (!email || !password) {
      return NextResponse.json({ error: "email and password required" }, { status: 400 });
    }

    let res: Response;
    try {
      res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Platform": "web",
        },
        body: JSON.stringify({ email, password, platform, deviceInfo }),
      });
    } catch (networkErr) {
      console.error("[auth/login] Cannot reach backend:", networkErr);
      return NextResponse.json({ error: "Authentication service unavailable" }, { status: 502 });
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>;
      const msg = (err.message ?? err.error ?? "Invalid credentials") as string;
      return NextResponse.json({ error: msg }, { status: res.status });
    }

    const raw = await res.json() as BackendTokenResponse;
    const { accessToken, refreshToken, expiresIn } = pick(raw);

    if (!accessToken || !refreshToken || !Number.isFinite(expiresIn)) {
      console.error("[auth/login] Unexpected token shape from backend");
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const response = NextResponse.json({ accessToken, expiresIn });

    // Store refresh token in an HttpOnly cookie — inaccessible to JavaScript.
    response.cookies.set("zolo-refresh", refreshToken, {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: "strict",
      path: "/api/auth",
      maxAge: REFRESH_COOKIE_MAX_AGE,
    });
    // Presence indicator for the Next.js edge middleware (no sensitive value).
    response.cookies.set("zolo-auth", "1", {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: "lax",
      path: "/",
      maxAge: REFRESH_COOKIE_MAX_AGE,
    });

    return response;
  } catch (err) {
    console.error("[auth/login] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
