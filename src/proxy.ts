import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only: bounce visitors without a session cookie to the sign-in
// page. Pages still verify the signed session themselves.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("ready_session")) return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.next();
}

export const config = { matcher: ["/onboarding/:path*", "/connect/:path*", "/map/:path*"] };
