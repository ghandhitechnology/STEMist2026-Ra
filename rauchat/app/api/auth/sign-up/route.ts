/**
 * app/api/auth/sign-up/route.ts — password sign-up against WorkOS.
 *
 * POST { email, password, firstName?, lastName? }
 *   -> 200 { ok: true }                                   (session cookie set)
 *   -> 200 { ok: false, verify: true, pendingAuthenticationToken, email }
 *   -> 400 { error }                                      (friendly copy)
 *
 * WorkOS environments with email verification enabled reject the immediate
 * password authentication with `email_verification_required`; that is not an
 * error for us, it is the second step of the flow (see /api/auth/verify).
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
  hasWorkOSIssue,
  isEmailVerificationRequired,
  isUnsupportedAuthChallenge,
  isWorkOSUnavailable,
  logAuthEvent,
} from "@/lib/server/auth-errors";

export const runtime = "nodejs";

const SignUpSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(10).max(256),
  firstName: z.string().trim().max(120).optional(),
  lastName: z.string().trim().max(120).optional(),
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
  const parsed = SignUpSchema.safeParse(body);
  if (!parsed.success) {
    return authErrorResponse(
      "INVALID_REQUEST",
      "Enter a valid email and a password of at least 10 characters.",
      400
    );
  }

  const { email, password, firstName, lastName } = parsed.data;
  let config;
  try {
    config = getAuthRuntimeConfig(req);
  } catch (error) {
    return authConfigurationResponse("sign-up", error);
  }

  const workos = getWorkOS();

  try {
    await workos.userManagement.createUser({
      email,
      password,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
    });
  } catch (err) {
    const details = getWorkOSErrorDetails(err);
    logAuthEvent("create_user_failed", { details, route: "sign-up" });
    if (
      hasWorkOSIssue(
        details,
        "email_already_exists",
        "email_not_available",
        "user_already_exists"
      )
    ) {
      try {
        const existing = await workos.userManagement.listUsers({
          email,
          limit: 1,
        });
        if (existing.data.length === 0) {
          logAuthEvent("email_unavailable_without_user", {
            details,
            route: "sign-up",
          });
          return authErrorResponse(
            "EMAIL_UNAVAILABLE",
            "WorkOS rejected this email even though no matching account exists. Try another email or review the WorkOS email restrictions.",
            400
          );
        }
      } catch (lookupError) {
        logAuthEvent("email_availability_lookup_failed", {
          details: getWorkOSErrorDetails(lookupError),
          route: "sign-up",
        });
      }
      return authErrorResponse(
        "EMAIL_ALREADY_REGISTERED",
        "An account with that email already exists. Sign in instead.",
        409
      );
    }
    if (
      hasWorkOSIssue(
        details,
        "password_strength_error",
        "password_too_short",
        "password_too_weak",
        "password_validation_error"
      )
    ) {
      return authErrorResponse(
        "PASSWORD_TOO_WEAK",
        "That password is too weak. Use at least 10 characters and avoid common words.",
        400
      );
    }
    if (
      hasWorkOSIssue(
        details,
        "email_invalid",
        "email_required",
        "email_validation_error",
        "invalid_email"
      )
    ) {
      return authErrorResponse(
        "INVALID_EMAIL",
        "Enter a valid email address.",
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
      "SIGN_UP_FAILED",
      "Could not create your account. Check your details and try again.",
      400
    );
  }

  try {
    const authResponse = await workos.userManagement.authenticateWithPassword({
      clientId: config.clientId,
      email,
      password,
    });
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
      logAuthEvent("unsupported_challenge", { details, route: "sign-up" });
      return authErrorResponse(
        "AUTH_CHALLENGE_UNSUPPORTED",
        "Your account was created, but it requires an authentication step Rauchat does not support yet. Try Google or GitHub, or contact the administrator.",
        409
      );
    }
    logAuthEvent("post_signup_authentication_failed", {
      details,
      route: "sign-up",
    });
    return authErrorResponse(
      "AUTH_PROVIDER_UNAVAILABLE",
      "Your account was created, but the authentication service could not sign you in. Try signing in again.",
      502
    );
  }
}
