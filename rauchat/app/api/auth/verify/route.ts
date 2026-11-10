/**
 * app/api/auth/verify/route.ts — second step of the email-verification flow.
 *
 * POST { pendingAuthenticationToken, code } -> 200 { ok: true } | 400 { error }
 *
 * The pending token is issued by /api/auth/sign-in or /api/auth/sign-up when
 * WorkOS answers with `email_verification_required`; exchanging it plus the
 * emailed code yields a real session, which we seal into the cookie.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { getWorkOS, saveSession } from "@workos-inc/authkit-nextjs";
import { crossSiteRejection } from "@/lib/server/http";
import { getAuthRuntimeConfig } from "@/lib/server/auth-config";
import {
  authConfigurationResponse,
  authErrorResponse,
  getWorkOSErrorDetails,
  isUnsupportedAuthChallenge,
  isWorkOSUnavailable,
  logAuthEvent,
} from "@/lib/server/auth-errors";

export const runtime = "nodejs";

const VerifySchema = z.object({
  pendingAuthenticationToken: z.string().min(1).max(4096),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code."),
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
  const parsed = VerifySchema.safeParse(body);
  if (!parsed.success) {
    return authErrorResponse(
      "INVALID_REQUEST",
      "Enter the 6-digit code from your email.",
      400
    );
  }

  let config;
  try {
    config = getAuthRuntimeConfig(req);
  } catch (error) {
    return authConfigurationResponse("verify", error);
  }

  try {
    const authResponse =
      await getWorkOS().userManagement.authenticateWithEmailVerification({
        clientId: config.clientId,
        code: parsed.data.code,
        pendingAuthenticationToken: parsed.data.pendingAuthenticationToken,
      });
    await saveSession(authResponse, config.sessionUrl);
    return Response.json({ ok: true });
  } catch (err) {
    const details = getWorkOSErrorDetails(err);
    if (isUnsupportedAuthChallenge(details)) {
      logAuthEvent("unsupported_challenge", { details, route: "verify" });
      return authErrorResponse(
        "AUTH_CHALLENGE_UNSUPPORTED",
        "Email verification succeeded, but this account requires an authentication step Rauchat does not support yet.",
        409
      );
    }
    if (isWorkOSUnavailable(details)) {
      logAuthEvent("provider_unavailable", { details, route: "verify" });
      return authErrorResponse(
        "AUTH_PROVIDER_UNAVAILABLE",
        "The authentication service is temporarily unavailable. Try again.",
        502
      );
    }
    logAuthEvent("verification_failed", { details, route: "verify" });
    return authErrorResponse(
      "VERIFICATION_CODE_INVALID",
      "That code is incorrect or has expired.",
      400
    );
  }
}
