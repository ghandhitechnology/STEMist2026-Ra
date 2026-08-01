/**
 * app/signout/route.ts — GET /signout ends the session and lands on the
 * branded /sign-in screen.
 *
 * Self-contained on purpose: WorkOS's hosted logout redirect only honors
 * absolute, dashboard-registered return URIs (and dead-ends entirely when
 * the session's user was just deleted), so instead this revokes the WorkOS
 * session server-side (best-effort) and expires the session cookie itself.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getWorkOS, withAuth } from "@workos-inc/authkit-nextjs";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { sessionId } = await withAuth();
    if (sessionId) {
      await getWorkOS().userManagement.revokeSession({ sessionId });
    }
  } catch {
    // No session, or the user behind it is already gone — nothing to revoke.
  }

  const res = NextResponse.redirect(new URL("/sign-in", req.nextUrl.origin), 302);
  res.cookies.delete(process.env.WORKOS_COOKIE_NAME || "wos-session");
  return res;
}
