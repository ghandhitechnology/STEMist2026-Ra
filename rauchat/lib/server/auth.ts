/**
 * lib/server/auth.ts — WorkOS session helpers for route handlers.
 *
 * The middleware already redirects unauthenticated page loads, but API
 * handlers still verify the session themselves and key every workspace
 * operation on the WorkOS user id — the per-user sandbox boundary.
 */

import { withAuth } from "@workos-inc/authkit-nextjs";

/** The signed-in WorkOS user id, or null when there is no session. */
export async function getUserId(): Promise<string | null> {
  try {
    const { user } = await withAuth();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

export function unauthorized(): Response {
  return Response.json({ error: "Not signed in." }, { status: 401 });
}
