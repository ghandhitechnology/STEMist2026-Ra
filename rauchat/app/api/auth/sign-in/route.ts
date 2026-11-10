/**
 * app/api/auth/sign-in/route.ts — password sign-in against WorkOS.
 *
 * POST { email, password }
 *   -> 200 { ok: true }                                   (session cookie set)
 *   -> 200 { ok: false, verify: true, pendingAuthenticationToken, email }
 *   -> 401 { error: "Incorrect email or password." }
 *
 * Credential failures are deliberately indistinguishable from one another so
 * the endpoint cannot be used to enumerate accounts.
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
  isEmailVerificationRequired,
  isUnsupportedAuthChallenge,
  isWorkOSUnavailable,
  logAuthEvent,
} from "@/lib/server/auth-errors";

export const runtime = "nodejs";

const SignInSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(256),
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
  const parsed = SignInSchema.safeParse(body);
  if (!parsed.success) {
    return authErrorResponse(
      "INVALID_REQUEST",
      "Enter your email and password.",
      400
    );
  }

  const { email, password } = parsed.data;
  let config;
  try {
    config = getAuthRuntimeConfig(req);
  } catch (error) {
    return authConfigurationResponse("sign-in", error);
  }

  try {
    const authResponse = await getWorkOS().userManagement.authenticateWithPassword(
      { clientId: config.clientId, email, password }
    );
    await saveSession(authResponse, config.sessionUrl);
    return Response.json({ ok: true });
  } catch (err) {
    const details = getWorkOSErrorDetails(err);
    if (isEmailVerificationRequired(details)) {
      return Response.json({
        ok: false,
        verify: true,
        code: "EMAIL_VERIFICATION_REQUIRED",
        pendingAuthenticationToken: details.pendingAuthenticationToken,
        email,
      });
    }
    if (isUnsupportedAuthChallenge(details)) {
      logAuthEvent("unsupported_challenge", { details, route: "sign-in" });
      return authErrorResponse(
        "AUTH_CHALLENGE_UNSUPPORTED",
        "This account requires an authentication step Rauchat does not support yet. Try Google or GitHub, or contact the administrator.",
        409
      );
    }
    if (isWorkOSUnavailable(details)) {
      logAuthEvent("provider_unavailable", { details, route: "sign-in" });
      return authErrorResponse(
        "AUTH_PROVIDER_UNAVAILABLE",
        "The authentication service is temporarily unavailable. Try again.",
        502
      );
    }
    logAuthEvent("invalid_credentials", { details, route: "sign-in" });
    return authErrorResponse(
      "INVALID_CREDENTIALS",
      "Incorrect email or password.",
      401
    );
  }
}
