import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const IS_PROD = process.env.NODE_ENV === "production";
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

function clearAuthCookies(response: NextResponse) {
  response.cookies.set("zolo-refresh", "", { path: "/api/auth", maxAge: 0 });
  response.cookies.set("zolo-auth", "", { path: "/", maxAge: 0 });
}

export async function POST(req: NextRequest) {
  try {
    // Read the refresh token exclusively from the HttpOnly cookie — never from the request body.
    const refreshToken = req.cookies.get("zolo-refresh")?.value;

    if (!refreshToken) {
      return NextResponse.json({ error: "No session" }, { status: 401 });
    }

    let res: Response;
    try {
      res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Platform": "web",
        },
        body: JSON.stringify({ refreshToken }),
      });
    } catch (networkErr) {
      console.error("[auth/refresh] Cannot reach backend:", networkErr);
      return NextResponse.json({ error: "Authentication service unavailable" }, { status: 502 });
    }

    if (!res.ok) {
      const response = NextResponse.json({ error: "Session expired" }, { status: 401 });
      clearAuthCookies(response);
      return response;
    }

    const raw = await res.json() as BackendTokenResponse;
    const { accessToken, refreshToken: newRefreshToken, expiresIn } = pick(raw);

    if (!accessToken || !newRefreshToken || !Number.isFinite(expiresIn)) {
      console.error("[auth/refresh] Unexpected token shape from backend");
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const response = NextResponse.json({ accessToken, expiresIn });

    response.cookies.set("zolo-refresh", newRefreshToken, {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: "strict",
      path: "/api/auth",
      maxAge: REFRESH_COOKIE_MAX_AGE,
    });
    response.cookies.set("zolo-auth", "1", {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: "lax",
      path: "/",
      maxAge: REFRESH_COOKIE_MAX_AGE,
    });

    return response;
  } catch (err) {
    console.error("[auth/refresh] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
