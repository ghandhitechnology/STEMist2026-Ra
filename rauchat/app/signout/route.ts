/**
 * app/signout/route.ts — GET /signout ends the session and lands on the
 * branded /sign-in screen.
 *
 * Self-contained on purpose: WorkOS's hosted logout redirect only honors
 * absolute, dashboard-registered return URIs (and dead-ends entirely when
 * the session's user was just deleted), so instead this revokes the WorkOS
 * session server-side (best-effort) and expires the session cookie itself.
 */

import { getWorkOS, withAuth } from "@workos-inc/authkit-nextjs";
import { redirectTo } from "@/lib/server/http";
import { isLocalFullAccessEnabled } from "@/lib/local-access";

export const runtime = "nodejs";

export async function GET() {
  // A local full-access session has no WorkOS state to revoke — go home.
  if (isLocalFullAccessEnabled()) {
    return redirectTo("/");
  }

  try {
    const { sessionId } = await withAuth();
    if (sessionId) {
      await getWorkOS().userManagement.revokeSession({ sessionId });
    }
  } catch {
    // No session, or the user behind it is already gone — nothing to revoke.
  }

  const res = redirectTo("/sign-in");
  res.cookies.delete(process.env.WORKOS_COOKIE_NAME || "wos-session");
  return res;
}
