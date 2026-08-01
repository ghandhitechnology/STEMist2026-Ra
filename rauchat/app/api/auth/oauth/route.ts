/**
 * app/api/auth/oauth/route.ts — start a provider OAuth flow.
 *
 * GET /api/auth/oauth?provider=GoogleOAuth|GitHubOAuth -> 302 to WorkOS.
 *
 * The hosted AuthKit screen is bypassed entirely (Rauchat renders its own
 * /sign-in), so this builds the authorization URL directly and stashes the
 * CSRF state plus the PKCE verifier in short-lived HttpOnly cookies that
 * /callback reads back when WorkOS returns.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { redirectTo } from "@/lib/server/http";

export const runtime = "nodejs";

const PROVIDERS = ["GoogleOAuth", "GitHubOAuth"] as const;

// Kept in sync with app/callback/route.ts, which consumes them.
const OAUTH_STATE_COOKIE = "rau-oauth-state";
const OAUTH_VERIFIER_COOKIE = "rau-oauth-verifier";
const OAUTH_COOKIE_MAX_AGE = 600; // 10 minutes — the flow is a single hop.

export async function GET(req: NextRequest) {
  // Misconfiguration lands back on the branded screen rather than a raw JSON
  // page — this route is reached by a top-level navigation, not by fetch.
  const backToSignIn = (reason: string) => redirectTo(`/sign-in?error=${reason}`);

  const provider = req.nextUrl.searchParams.get("provider");
  if (!provider || !PROVIDERS.includes(provider as (typeof PROVIDERS)[number])) {
    return backToSignIn("provider");
  }

  const clientId = process.env.WORKOS_CLIENT_ID;
  const redirectUri = process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return backToSignIn("config");
  }

  const workos = getWorkOS();
  const pkce = await workos.pkce.generate();
  const state = crypto.randomUUID();

  const url = workos.userManagement.getAuthorizationUrl({
    clientId,
    provider,
    redirectUri,
    state,
    codeChallenge: pkce.codeChallenge,
    codeChallengeMethod: pkce.codeChallengeMethod,
  });

  const response = NextResponse.redirect(url, 302);
  const secure = redirectUri.startsWith("https:");
  for (const [name, value] of [
    [OAUTH_STATE_COOKIE, state],
    [OAUTH_VERIFIER_COOKIE, pkce.codeVerifier],
  ] as const) {
    response.cookies.set({
      name,
      value,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure,
      maxAge: OAUTH_COOKIE_MAX_AGE,
    });
  }
  return response;
}
