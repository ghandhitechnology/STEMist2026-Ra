/**
 * middleware.ts — WorkOS AuthKit session middleware (composable form).
 *
 * Rauchat ships its own branded /sign-in and /sign-up screens instead of the
 * hosted AuthKit page, so this runs `authkit()` directly rather than the
 * `authkitProxy()` helper: it refreshes the session on every request, then
 * decides where an unauthenticated caller goes — a 401 JSON body for /api/*,
 * a redirect to /sign-in for pages. Every response is built through
 * `handleAuthkitProxy` so refreshed cookies reach the browser and the internal
 * x-workos-* request headers reach server components and route handlers
 * (that is what makes `withAuth()` work downstream).
 */

import { NextResponse, type NextRequest } from "next/server";
import { authkit, handleAuthkitProxy } from "@workos-inc/authkit-nextjs";
import { isLocalFullAccessEnabled } from "./lib/local-access";

/**
 * Paths reachable without a session. Matched exactly (plus the /api/auth
 * namespace) so a future route merely *starting* with one of these names
 * cannot silently inherit public access.
 */
const PUBLIC_PATHS = new Set([
  "/sign-in",
  "/sign-up",
  "/reset-password",
  "/callback",
  "/signout",
]);

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) ||
    pathname === "/api/auth" ||
    pathname.startsWith("/api/auth/")
  );
}

export default async function middleware(request: NextRequest) {
  // Explicitly opted-in Mac Mini development sessions do not touch WorkOS at
  // all. Keeping this before authkit() also keeps stale cookies or provider
  // configuration from producing login errors in the local-only build.
  if (isLocalFullAccessEnabled()) {
    const { pathname } = request.nextUrl;
    if (pathname === "/sign-in" || pathname === "/sign-up") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  const { session, headers } = await authkit(request);
  const { pathname } = request.nextUrl;
  const signedIn = Boolean(session.user);

  // Already signed in — the auth screens have nothing to offer.
  if (signedIn && (pathname === "/sign-in" || pathname === "/sign-up")) {
    return handleAuthkitProxy(request, headers, { redirect: "/" });
  }

  if (!signedIn && !isPublicPath(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }
    return handleAuthkitProxy(request, headers, { redirect: "/sign-in" });
  }

  return handleAuthkitProxy(request, headers);
}

export const config = {
  // Only genuine static assets are excluded. An extension-based exclusion
  // would carve real routes out of session verification — /api/pdf/x.png
  // would have slipped past this entirely.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
