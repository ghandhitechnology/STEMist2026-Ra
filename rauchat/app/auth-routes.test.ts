import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workos = vi.hoisted(() => ({
  authenticateWithCode: vi.fn(),
  authenticateWithEmailVerification: vi.fn(),
  authenticateWithPassword: vi.fn(),
  createPasswordReset: vi.fn(),
  createUser: vi.fn(),
  getAuthorizationUrl: vi.fn(),
  listUsers: vi.fn(),
  pkceGenerate: vi.fn(),
  resetPassword: vi.fn(),
  revokeSession: vi.fn(),
  saveSession: vi.fn(),
  withAuth: vi.fn(),
}));

vi.mock("@workos-inc/authkit-nextjs", () => ({
  getWorkOS: () => ({
    pkce: { generate: workos.pkceGenerate },
    userManagement: {
      authenticateWithCode: workos.authenticateWithCode,
      authenticateWithEmailVerification:
        workos.authenticateWithEmailVerification,
      authenticateWithPassword: workos.authenticateWithPassword,
      createPasswordReset: workos.createPasswordReset,
      createUser: workos.createUser,
      getAuthorizationUrl: workos.getAuthorizationUrl,
      listUsers: workos.listUsers,
      resetPassword: workos.resetPassword,
      revokeSession: workos.revokeSession,
    },
  }),
  saveSession: workos.saveSession,
  withAuth: workos.withAuth,
}));

import { POST as signIn } from "@/app/api/auth/sign-in/route";
import { POST as signUp } from "@/app/api/auth/sign-up/route";
import { POST as verifyEmail } from "@/app/api/auth/verify/route";
import { POST as requestPasswordReset } from "@/app/api/auth/password-reset/route";
import { POST as confirmPasswordReset } from "@/app/api/auth/password-reset/confirm/route";
import { GET as startOAuth } from "@/app/api/auth/oauth/route";
import { GET as finishOAuth } from "@/app/callback/route";
import { POST as signOut } from "@/app/signout/route";

function configureAuth(origin = "http://localhost:3000"): void {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("RAUCHAT_PUBLIC_URL", origin);
  vi.stubEnv("NEXT_PUBLIC_WORKOS_REDIRECT_URI", `${origin}/callback`);
  vi.stubEnv("RAUCHAT_TRUST_PROXY", "false");
  vi.stubEnv("RAUCHAT_LOCAL_FULL_ACCESS", "false");
  vi.stubEnv("WORKOS_API_KEY", "sk_test_example");
  vi.stubEnv("WORKOS_CLIENT_ID", "client_example");
  vi.stubEnv("WORKOS_COOKIE_PASSWORD", "a".repeat(32));
}

function jsonRequest(path: string, body: unknown, origin = "http://localhost:3000") {
  return new NextRequest(`http://internal:3111${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

function workosError(
  code: string,
  status = 400,
  extra: Record<string, unknown> = {}
) {
  return Object.assign(new Error("redacted provider error"), {
    code,
    name: "WorkOSError",
    requestID: "request_test",
    status,
    ...extra,
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("authentication routes", () => {
  beforeEach(() => {
    configureAuth();
    vi.clearAllMocks();
    workos.authenticateWithPassword.mockResolvedValue({ user: { id: "user_1" } });
    workos.authenticateWithEmailVerification.mockResolvedValue({
      user: { id: "user_1" },
    });
    workos.authenticateWithCode.mockResolvedValue({ user: { id: "user_1" } });
    workos.createUser.mockResolvedValue({ id: "user_1" });
    workos.createPasswordReset.mockResolvedValue({ id: "reset_1" });
    workos.resetPassword.mockResolvedValue({ id: "user_1" });
    workos.pkceGenerate.mockResolvedValue({
      codeChallenge: "challenge",
      codeChallengeMethod: "S256",
      codeVerifier: "verifier",
    });
    workos.getAuthorizationUrl.mockReturnValue(
      "https://api.workos.test/authorize"
    );
    workos.listUsers.mockResolvedValue({ data: [{ id: "user_1" }] });
    workos.withAuth.mockResolvedValue({ sessionId: "session_1" });
    workos.revokeSession.mockResolvedValue(undefined);
    workos.saveSession.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("signs in and saves the session using the external canonical URL", async () => {
    const response = await signIn(
      jsonRequest("/api/auth/sign-in", {
        email: "person@example.com",
        password: "correct-password",
      })
    );

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ ok: true });
    expect(workos.authenticateWithPassword).toHaveBeenCalledWith({
      clientId: "client_example",
      email: "person@example.com",
      password: "correct-password",
    });
    expect(workos.saveSession).toHaveBeenCalledWith(
      { user: { id: "user_1" } },
      "http://localhost:3000/"
    );
  });

  it("continues password authentication into email verification", async () => {
    workos.authenticateWithPassword.mockRejectedValue(
      workosError("email_verification_required", 400, {
        pendingAuthenticationToken: "pending_1",
      })
    );

    const response = await signIn(
      jsonRequest("/api/auth/sign-in", {
        email: "person@example.com",
        password: "correct-password",
      })
    );

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      ok: false,
      verify: true,
      code: "EMAIL_VERIFICATION_REQUIRED",
      pendingAuthenticationToken: "pending_1",
      email: "person@example.com",
    });
  });

  it("reports unsupported WorkOS challenges instead of bad credentials", async () => {
    workos.authenticateWithPassword.mockRejectedValue(
      workosError("mfa_challenge", 400, {
        pendingAuthenticationToken: "pending_1",
      })
    );

    const response = await signIn(
      jsonRequest("/api/auth/sign-in", {
        email: "person@example.com",
        password: "correct-password",
      })
    );

    expect(response.status).toBe(409);
    expect((await json(response)).code).toBe("AUTH_CHALLENGE_UNSUPPORTED");
  });

  it("separates provider outages from invalid credentials", async () => {
    workos.authenticateWithPassword.mockRejectedValueOnce(
      workosError("server_error", 503)
    );
    const outage = await signIn(
      jsonRequest("/api/auth/sign-in", {
        email: "person@example.com",
        password: "password",
      })
    );
    expect(outage.status).toBe(502);
    expect((await json(outage)).code).toBe("AUTH_PROVIDER_UNAVAILABLE");

    workos.authenticateWithPassword.mockRejectedValueOnce(
      workosError("invalid_grant", 400)
    );
    const invalid = await signIn(
      jsonRequest("/api/auth/sign-in", {
        email: "person@example.com",
        password: "wrong",
      })
    );
    expect(invalid.status).toBe(401);
    expect((await json(invalid)).code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects a mismatched origin before calling WorkOS", async () => {
    const response = await signIn(
      jsonRequest(
        "/api/auth/sign-in",
        { email: "person@example.com", password: "password" },
        "http://127.0.0.1:3000"
      )
    );

    expect(response.status).toBe(403);
    expect((await json(response)).code).toBe("AUTH_ORIGIN_MISMATCH");
    expect(workos.authenticateWithPassword).not.toHaveBeenCalled();
  });

  it("fails safely when required WorkOS configuration is missing", async () => {
    vi.stubEnv("WORKOS_API_KEY", "");
    const response = await signIn(
      jsonRequest("/api/auth/sign-in", {
        email: "person@example.com",
        password: "password",
      })
    );

    expect(response.status).toBe(500);
    expect((await json(response)).code).toBe("AUTH_NOT_CONFIGURED");
    expect(workos.authenticateWithPassword).not.toHaveBeenCalled();
  });

  it("returns a conflict for an existing signup email", async () => {
    workos.createUser.mockRejectedValue(workosError("email_not_available", 422));

    const response = await signUp(
      jsonRequest("/api/auth/sign-up", {
        email: "person@example.com",
        password: "strong-enough-password",
        firstName: "Rau",
        lastName: "User",
      })
    );

    expect(response.status).toBe(409);
    expect((await json(response)).code).toBe("EMAIL_ALREADY_REGISTERED");
    expect(workos.authenticateWithPassword).not.toHaveBeenCalled();
  });

  it("creates an account and signs it in", async () => {
    const response = await signUp(
      jsonRequest("/api/auth/sign-up", {
        email: "person@example.com",
        password: "strong-enough-password",
        firstName: "Rau",
        lastName: "User",
      })
    );

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ ok: true });
    expect(workos.createUser).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "strong-enough-password",
      firstName: "Rau",
      lastName: "User",
    });
    expect(workos.saveSession).toHaveBeenCalledWith(
      { user: { id: "user_1" } },
      "http://localhost:3000/"
    );
  });

  it("returns a stable weak-password outcome from WorkOS", async () => {
    workos.createUser.mockRejectedValue(
      workosError("password_strength_error", 400)
    );
    const response = await signUp(
      jsonRequest("/api/auth/sign-up", {
        email: "person@example.com",
        password: "long-but-breached-password",
      })
    );

    expect(response.status).toBe(400);
    expect((await json(response)).code).toBe("PASSWORD_TOO_WEAK");
  });

  it("maps nested WorkOS user creation errors to a useful outcome", async () => {
    workos.createUser.mockRejectedValue(
      workosError("user_creation_error", 400, {
        errors: [{ code: "email_already_exists", message: "redacted" }],
      })
    );
    const response = await signUp(
      jsonRequest("/api/auth/sign-up", {
        email: "person@example.com",
        password: "strong-enough-password",
      })
    );

    expect(response.status).toBe(409);
    expect((await json(response)).code).toBe("EMAIL_ALREADY_REGISTERED");
  });

  it("does not claim a rejected email is registered when lookup finds no user", async () => {
    workos.createUser.mockRejectedValue(
      workosError("user_creation_error", 400, {
        errors: [{ code: "email_not_available", message: "redacted" }],
      })
    );
    workos.listUsers.mockResolvedValue({ data: [] });

    const response = await signUp(
      jsonRequest("/api/auth/sign-up", {
        email: "person@example.com",
        password: "strong-enough-password",
      })
    );

    expect(response.status).toBe(400);
    expect((await json(response)).code).toBe("EMAIL_UNAVAILABLE");
    expect(workos.listUsers).toHaveBeenCalledWith({
      email: "person@example.com",
      limit: 1,
    });
  });

  it("reports a post-signup authentication failure without losing account state", async () => {
    workos.authenticateWithPassword.mockRejectedValue(
      workosError("server_error", 503)
    );
    const response = await signUp(
      jsonRequest("/api/auth/sign-up", {
        email: "person@example.com",
        password: "strong-enough-password",
      })
    );

    expect(response.status).toBe(502);
    expect((await json(response)).code).toBe("AUTH_PROVIDER_UNAVAILABLE");
    expect(workos.createUser).toHaveBeenCalledOnce();
  });

  it("verifies email and saves the canonical session", async () => {
    const response = await verifyEmail(
      jsonRequest("/api/auth/verify", {
        pendingAuthenticationToken: "pending_1",
        code: "123456",
      })
    );

    expect(response.status).toBe(200);
    expect(workos.authenticateWithEmailVerification).toHaveBeenCalledWith({
      clientId: "client_example",
      code: "123456",
      pendingAuthenticationToken: "pending_1",
    });
    expect(workos.saveSession).toHaveBeenCalledWith(
      { user: { id: "user_1" } },
      "http://localhost:3000/"
    );
  });

  it("returns an explicit invalid verification-code outcome", async () => {
    workos.authenticateWithEmailVerification.mockRejectedValue(
      workosError("invalid_grant", 400)
    );
    const response = await verifyEmail(
      jsonRequest("/api/auth/verify", {
        pendingAuthenticationToken: "pending_1",
        code: "123456",
      })
    );

    expect(response.status).toBe(400);
    expect((await json(response)).code).toBe("VERIFICATION_CODE_INVALID");
  });

  it("preserves reset account privacy while surfacing provider outages", async () => {
    workos.createPasswordReset.mockRejectedValueOnce(workosError("not_found", 404));
    const unknown = await requestPasswordReset(
      jsonRequest("/api/auth/password-reset", {
        email: "unknown@example.com",
      })
    );
    expect(unknown.status).toBe(200);
    expect(await json(unknown)).toEqual({ ok: true });

    workos.createPasswordReset.mockRejectedValueOnce(
      workosError("server_error", 503)
    );
    const outage = await requestPasswordReset(
      jsonRequest("/api/auth/password-reset", {
        email: "person@example.com",
      })
    );
    expect(outage.status).toBe(502);
    expect((await json(outage)).code).toBe("AUTH_PROVIDER_UNAVAILABLE");
  });

  it("maps password reset strength and token failures", async () => {
    workos.resetPassword.mockRejectedValueOnce(
      workosError("password_strength_error", 400)
    );
    const weak = await confirmPasswordReset(
      jsonRequest("/api/auth/password-reset/confirm", {
        token: "token_1",
        newPassword: "long-but-breached-password",
      })
    );
    expect(weak.status).toBe(400);
    expect((await json(weak)).code).toBe("PASSWORD_TOO_WEAK");

    workos.resetPassword.mockRejectedValueOnce(
      workosError("invalid_token", 400)
    );
    const invalid = await confirmPasswordReset(
      jsonRequest("/api/auth/password-reset/confirm", {
        token: "token_1",
        newPassword: "new-valid-password",
      })
    );
    expect(invalid.status).toBe(400);
    expect((await json(invalid)).code).toBe("PASSWORD_RESET_INVALID");
  });

  it("starts OAuth with PKCE and secure short-lived cookies", async () => {
    configureAuth("https://rau.example");
    const response = await startOAuth(
      new NextRequest(
        "http://internal:3111/api/auth/oauth?provider=GoogleOAuth"
      )
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://api.workos.test/authorize"
    );
    expect(workos.getAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client_example",
        provider: "GoogleOAuth",
        redirectUri: "https://rau.example/callback",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256",
      })
    );
    const cookies = response.headers.get("set-cookie") ?? "";
    expect(cookies).toContain("rau-oauth-state=");
    expect(cookies).toContain("rau-oauth-verifier=verifier");
    expect(cookies).toContain("HttpOnly");
    expect(cookies).toContain("SameSite=lax");
    expect(cookies).toContain("Secure");
    expect(cookies).toContain("Max-Age=600");
    expect(cookies).toContain("Path=/");
  });

  it("rejects unsupported OAuth providers before generating state", async () => {
    const response = await startOAuth(
      new NextRequest(
        "http://internal:3111/api/auth/oauth?provider=UnknownOAuth"
      )
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/sign-in?error=provider");
    expect(workos.pkceGenerate).not.toHaveBeenCalled();
  });

  it("maps provider cancellation without attempting an exchange", async () => {
    const response = await finishOAuth(
      new NextRequest("http://internal:3111/callback?error=access_denied")
    );

    expect(response.headers.get("location")).toBe("/sign-in?error=cancelled");
    expect(workos.authenticateWithCode).not.toHaveBeenCalled();
  });

  it("maps a provider callback error without exposing its description", async () => {
    const response = await finishOAuth(
      new NextRequest(
        "http://internal:3111/callback?error=organization_invalid&error_description=sensitive"
      )
    );

    expect(response.headers.get("location")).toBe("/sign-in?error=provider");
    expect(response.headers.get("location")).not.toContain("sensitive");
    expect(workos.authenticateWithCode).not.toHaveBeenCalled();
  });

  it("rejects a missing or mismatched OAuth state", async () => {
    const response = await finishOAuth(
      new NextRequest(
        "http://internal:3111/callback?code=code_1&state=wrong_state",
        {
          headers: {
            cookie:
              "rau-oauth-state=state_1; rau-oauth-verifier=verifier_1",
          },
        }
      )
    );

    expect(response.headers.get("location")).toBe("/sign-in?error=state");
    expect(workos.authenticateWithCode).not.toHaveBeenCalled();
  });

  it("rejects an OAuth callback with a missing verifier", async () => {
    const response = await finishOAuth(
      new NextRequest(
        "http://internal:3111/callback?code=code_1&state=state_1",
        { headers: { cookie: "rau-oauth-state=state_1" } }
      )
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/sign-in?error=pkce");
    expect(workos.authenticateWithCode).not.toHaveBeenCalled();
  });

  it("completes OAuth and saves a canonical session", async () => {
    configureAuth("https://rau.example");
    const response = await finishOAuth(
      new NextRequest(
        "http://internal:3111/callback?code=code_1&state=state_1",
        {
          headers: {
            cookie:
              "rau-oauth-state=state_1; rau-oauth-verifier=verifier_1",
          },
        }
      )
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(workos.authenticateWithCode).toHaveBeenCalledWith({
      clientId: "client_example",
      code: "code_1",
      codeVerifier: "verifier_1",
    });
    expect(workos.saveSession).toHaveBeenCalledWith(
      { user: { id: "user_1" } },
      "https://rau.example/"
    );
  });

  it("reports an OAuth code-exchange failure and does not save a session", async () => {
    workos.authenticateWithCode.mockRejectedValue(
      workosError("invalid_grant", 400)
    );
    const response = await finishOAuth(
      new NextRequest(
        "http://internal:3111/callback?code=code_1&state=state_1",
        {
          headers: {
            cookie:
              "rau-oauth-state=state_1; rau-oauth-verifier=verifier_1",
          },
        }
      )
    );

    expect(response.headers.get("location")).toBe("/sign-in?error=exchange");
    expect(workos.saveSession).not.toHaveBeenCalled();
  });

  it("revokes and deletes the session cookie through guarded POST sign-out", async () => {
    configureAuth("https://rau.example");
    const response = await signOut(
      jsonRequest("/signout", {}, "https://rau.example")
    );

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ ok: true });
    expect(workos.revokeSession).toHaveBeenCalledWith({
      sessionId: "session_1",
    });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("wos-session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Secure");
  });

  it("rejects cross-origin sign-out before revoking a session", async () => {
    configureAuth("https://rau.example");
    const response = await signOut(
      jsonRequest("/signout", {}, "https://attacker.example")
    );

    expect(response.status).toBe(403);
    expect((await json(response)).code).toBe("AUTH_ORIGIN_MISMATCH");
    expect(workos.revokeSession).not.toHaveBeenCalled();
  });
});
