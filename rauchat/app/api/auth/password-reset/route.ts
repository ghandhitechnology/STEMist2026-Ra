/**
 * app/api/auth/password-reset/route.ts — step 1 of password recovery.
 *
 * POST { email } -> 200 { ok: true }
 *
 * The answer is `{ ok: true }` whether or not the address belongs to an
 * account: anything else turns this endpoint into an account-enumeration
 * oracle. WorkOS mints the reset token (and delivers the environment's
 * password-reset email) inside `createPasswordReset`; the token itself is
 * never returned to the browser.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { crossSiteRejection } from "@/lib/server/http";

export const runtime = "nodejs";

const PasswordResetSchema = z.object({
  email: z.email().max(320),
});

export async function POST(req: NextRequest) {
  const crossSite = crossSiteRejection(req);
  if (crossSite) return crossSite;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = PasswordResetSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Enter a valid email address." },
      { status: 400 }
    );
  }

  if (!process.env.WORKOS_CLIENT_ID) {
    return Response.json({ error: "Auth is not configured." }, { status: 500 });
  }

  try {
    await getWorkOS().userManagement.createPasswordReset({
      email: parsed.data.email,
    });
  } catch {
    // Swallowed on purpose: an unknown address, a rate limit, and a real send
    // must all look identical from the outside.
  }

  return Response.json({ ok: true });
}
