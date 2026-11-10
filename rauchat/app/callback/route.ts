/**
 * app/callback/route.ts — OAuth redirect URI.
 *
 * Rauchat starts provider flows from /api/auth/oauth rather than the hosted
 * AuthKit screen, so this exchanges the returned code itself: verify the CSRF
 * state against its HttpOnly cookie, exchange code + PKCE verifier for tokens,
 * seal them into the AuthKit session cookie via `saveSession`, then land the
 * user in the app. Any failure returns to the branded sign-in screen.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getWorkOS, saveSession } from "@workos-inc/authkit-nextjs";
import { redirectTo } from "@/lib/server/http";
import { getAuthRuntimeConfig } from "@/lib/server/auth-config";
import {
  authConfigurationReason,
  getWorkOSErrorDetails,
  logAuthEvent,
} from "@/lib/server/auth-errors";

export const runtime = "nodejs";

// Kept in sync with app/api/auth/oauth/route.ts, which sets them.
const OAUTH_STATE_COOKIE = "rau-oauth-state";
const OAUTH_VERIFIER_COOKIE = "rau-oauth-verifier";

function clearFlowCookies(response: NextResponse): NextResponse {
  response.cookies.delete(OAUTH_STATE_COOKIE);
  response.cookies.delete(OAUTH_VERIFIER_COOKIE);
  return response;
}

function failed(reason: string): NextResponse {
  logAuthEvent("oauth_callback_failed", {
    route: "oauth-callback",
    reason,
  });
  return clearFlowCookies(
    redirectTo(`/sign-in?error=${encodeURIComponent(reason)}`)
  );
}

export async function GET(req: NextRequest) {
  const providerError = req.nextUrl.searchParams.get("error");
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expectedState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const codeVerifier = req.cookies.get(OAUTH_VERIFIER_COOKIE)?.value;

  if (providerError) {
    return failed(providerError === "access_denied" ? "cancelled" : "provider");
  }
  if (!code) return failed("cancelled");
  if (!state || !expectedState || state !== expectedState) {
    return failed("state");
  }
  if (!codeVerifier) return failed("pkce");

  let config;
  try {
    config = getAuthRuntimeConfig(req);
  } catch (error) {
    logAuthEvent("configuration_error", {
      route: "oauth-callback",
      reason: authConfigurationReason(error),
    });
    return failed("config");
  }

  try {
    const authResponse = await getWorkOS().userManagement.authenticateWithCode({
      clientId: config.clientId,
      code,
      codeVerifier,
    });
    const response = clearFlowCookies(redirectTo("/"));
    // saveSession writes the sealed `wos-session` cookie through next/headers;
    // Next merges that mutation into this response.
    await saveSession(authResponse, config.sessionUrl);
    return response;
  } catch (error) {
    logAuthEvent("oauth_exchange_failed", {
      details: getWorkOSErrorDetails(error),
      route: "oauth-callback",
    });
    return failed("exchange");
  }
}
