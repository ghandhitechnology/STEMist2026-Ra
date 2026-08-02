/**
 * app/api/auth/password-reset/confirm/route.ts — step 2 of password recovery.
 *
 * POST { token, newPassword } -> 200 { ok: true } | 400 { error }
 *
 * `token` is the reset token WorkOS emailed in step 1. Resetting the password
 * also verifies the address if it was not verified yet. No session is issued
 * here — the caller is sent back to /sign-in to authenticate normally.
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

const ConfirmSchema = z.object({
  token: z.string().trim().min(1).max(4096),
  newPassword: z.string().min(8).max(256),
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
  const parsed = ConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return authErrorResponse(
      "INVALID_REQUEST",
      "Enter the reset code from your email and a password of at least 8 characters.",
      400
    );
  }

  try {
    getAuthRuntimeConfig(req);
  } catch (error) {
    return authConfigurationResponse("password-reset-confirm", error);
  }

  try {
    await getWorkOS().userManagement.resetPassword({
      token: parsed.data.token,
      newPassword: parsed.data.newPassword,
    });
    return Response.json({ ok: true });
  } catch (err) {
    const details = getWorkOSErrorDetails(err);
    logAuthEvent("password_reset_failed", {
      details,
      route: "password-reset-confirm",
    });
    if (
      details.code === "password_strength_error" ||
      details.code === "password_validation_error"
    ) {
      return authErrorResponse(
        "PASSWORD_TOO_WEAK",
        "That password is too weak. Use at least 10 characters and avoid common words.",
        400
      );
    }
    if (isWorkOSUnavailable(details)) {
      return authErrorResponse(
        "AUTH_PROVIDER_UNAVAILABLE",
        "The authentication service is temporarily unavailable. Try again.",
        502
      );
    }
    return authErrorResponse(
      "PASSWORD_RESET_INVALID",
      "That reset code is invalid or has expired.",
      400
    );
  }
}
