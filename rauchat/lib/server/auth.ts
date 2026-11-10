/**
 * lib/server/auth.ts — WorkOS session helpers for route handlers.
 *
 * The middleware already redirects unauthenticated page loads, but API
 * handlers still verify the session themselves and key every workspace
 * operation on the WorkOS user id — the per-user sandbox boundary.
 */

import { withAuth } from "@workos-inc/authkit-nextjs";
import {
  isLocalFullAccessEnabled,
  LOCAL_FULL_ACCESS_USER,
} from "@/lib/local-access";

/** The signed-in WorkOS user id, or null when there is no session. */
export async function getUserId(): Promise<string | null> {
  if (isLocalFullAccessEnabled()) {
    return LOCAL_FULL_ACCESS_USER.id;
  }

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
