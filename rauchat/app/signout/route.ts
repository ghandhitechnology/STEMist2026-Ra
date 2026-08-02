/**
 * app/signout/route.ts — POST /signout ends the current session.
 *
 * Self-contained on purpose: WorkOS's hosted logout redirect only honors
 * absolute, dashboard-registered return URIs (and dead-ends entirely when
 * the session's user was just deleted), so instead this revokes the WorkOS
 * session server-side (best-effort) and expires the session cookie itself.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getWorkOS, withAuth } from "@workos-inc/authkit-nextjs";
import { crossSiteRejection } from "@/lib/server/http";
import { isLocalFullAccessEnabled } from "@/lib/local-access";
import { getCanonicalAuthOrigin } from "@/lib/server/auth-config";
import { getWorkOSErrorDetails, logAuthEvent } from "@/lib/server/auth-errors";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const crossSite = crossSiteRejection(req);
  if (crossSite) return crossSite;

  // A local full-access session has no WorkOS state to revoke.
  if (!isLocalFullAccessEnabled()) {
    try {
      const { sessionId } = await withAuth();
      if (sessionId) {
        await getWorkOS().userManagement.revokeSession({ sessionId });
      }
    } catch (error) {
      // Cookie deletion remains authoritative for this device. Revocation is
      // best-effort so a missing/deleted WorkOS user can still sign out.
      logAuthEvent("session_revoke_failed", {
        details: getWorkOSErrorDetails(error),
        route: "signout",
      });
    }
  }

  const res = NextResponse.json({ ok: true });
  const secure = getCanonicalAuthOrigin(req).startsWith("https://");
  const cookieName = process.env.WORKOS_COOKIE_NAME || "wos-session";
  res.cookies.set({
    name: cookieName,
    value: "",
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: 0,
  });
  return res;
}
