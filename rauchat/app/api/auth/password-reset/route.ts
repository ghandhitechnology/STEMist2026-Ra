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
import { getAuthRuntimeConfig } from "@/lib/server/auth-config";
import {
  authConfigurationResponse,
  authErrorResponse,
  getWorkOSErrorDetails,
  isWorkOSUnavailable,
  logAuthEvent,
} from "@/lib/server/auth-errors";

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
    return authErrorResponse("INVALID_REQUEST", "Invalid JSON body.", 400);
  }
  const parsed = PasswordResetSchema.safeParse(body);
  if (!parsed.success) {
    return authErrorResponse(
      "INVALID_EMAIL",
      "Enter a valid email address.",
      400
    );
  }

  try {
    getAuthRuntimeConfig(req);
  } catch (error) {
    return authConfigurationResponse("password-reset", error);
  }

  try {
    await getWorkOS().userManagement.createPasswordReset({
      email: parsed.data.email,
    });
  } catch (err) {
    const details = getWorkOSErrorDetails(err);
    if (isWorkOSUnavailable(details)) {
      logAuthEvent("provider_unavailable", {
        details,
        route: "password-reset",
      });
      return authErrorResponse(
        "AUTH_PROVIDER_UNAVAILABLE",
        "The authentication service is temporarily unavailable. Try again.",
        502
      );
    }
    // Unknown addresses and other account-specific failures remain
    // indistinguishable so this endpoint cannot enumerate users.
    logAuthEvent("reset_request_suppressed", {
      details,
      route: "password-reset",
    });
  }

  return Response.json({ ok: true });
}
