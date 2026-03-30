import { NextRequest, NextResponse } from "next/server";

const PROTECTED_PREFIXES = [
  "/conversations",
  "/friends",
  "/settings",
  "/calls",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has("zolo-auth");

  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix)
  );

  if (isProtected && !hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname === "/login" && hasSession) {
    return NextResponse.redirect(new URL("/conversations", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/conversations/:path*",
    "/friends/:path*",
    "/settings/:path*",
    "/calls/:path*",
    "/login",
  ],
};
