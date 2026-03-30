import { NextResponse } from "next/server";

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? "http://localhost:8080";
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? "nest-realm";
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? "nest-api";
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? "";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const { refresh_token } = body ?? {};

    if (!refresh_token) {
      return NextResponse.json({ error: "refresh_token required" }, { status: 400 });
    }

    const tokenUrl = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;

    let res: Response;
    try {
      res = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          refresh_token,
        }),
      });
    } catch (networkErr) {
      console.error("[auth/refresh] Cannot reach Keycloak:", networkErr);
      return NextResponse.json(
        { error: `Cannot reach Keycloak at ${KEYCLOAK_URL}` },
        { status: 502 }
      );
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = (err as Record<string, string>).error_description ?? "Refresh failed";
      return NextResponse.json({ error: msg }, { status: 401 });
    }

    const tokens = await res.json();

    return NextResponse.json({
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string,
      expires_in: tokens.expires_in as number,
    });
  } catch (err) {
    console.error("[auth/refresh] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
