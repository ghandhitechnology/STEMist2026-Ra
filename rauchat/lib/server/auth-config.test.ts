import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthConfigurationError,
  getAuthRuntimeConfig,
  getCanonicalAuthOrigin,
} from "./auth-config";

const AUTH_ENV_KEYS = [
  "RAUCHAT_PUBLIC_URL",
  "RAUCHAT_TRUST_PROXY",
  "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
  "WORKOS_API_KEY",
  "WORKOS_CLIENT_ID",
  "WORKOS_COOKIE_PASSWORD",
] as const;

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://internal:3111/api/auth/sign-in", { headers });
}

function configureAuth(origin = "https://rau.example"): void {
  vi.stubEnv("RAUCHAT_PUBLIC_URL", origin);
  vi.stubEnv("NEXT_PUBLIC_WORKOS_REDIRECT_URI", `${origin}/callback`);
  vi.stubEnv("WORKOS_API_KEY", "sk_test_example");
  vi.stubEnv("WORKOS_CLIENT_ID", "client_example");
  vi.stubEnv("WORKOS_COOKIE_PASSWORD", "a".repeat(32));
}

describe("auth configuration", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    for (const key of AUTH_ENV_KEYS) vi.stubEnv(key, "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the configured canonical origin instead of proxy headers", () => {
    configureAuth();
    vi.stubEnv("RAUCHAT_TRUST_PROXY", "true");
    const req = request({
      "x-forwarded-host": "attacker.example",
      "x-forwarded-proto": "https",
    });

    expect(getCanonicalAuthOrigin(req)).toBe("https://rau.example");
  });

  it("rejects mismatched public and callback origins", () => {
    configureAuth();
    vi.stubEnv(
      "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
      "https://other.example/callback"
    );

    expect(() => getAuthRuntimeConfig(request())).toThrow(
      AuthConfigurationError
    );
  });

  it("resolves a trusted proxy only when explicitly enabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RAUCHAT_TRUST_PROXY", "true");
    const req = request({
      "x-forwarded-host": "rau.example",
      "x-forwarded-proto": "https",
    });

    expect(getCanonicalAuthOrigin(req)).toBe("https://rau.example");
  });

  it("fails closed when production has neither a canonical URL nor trusted proxy", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(() => getCanonicalAuthOrigin(request())).toThrow(
      AuthConfigurationError
    );
  });

  it("rejects ambiguous forwarded header chains", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RAUCHAT_TRUST_PROXY", "true");
    const req = request({
      "x-forwarded-host": "rau.example, attacker.example",
      "x-forwarded-proto": "https",
    });

    expect(() => getCanonicalAuthOrigin(req)).toThrow(
      AuthConfigurationError
    );
  });

  it("requires HTTPS for a configured production origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    configureAuth("http://rau.example");

    expect(() => getCanonicalAuthOrigin(request())).toThrow(
      AuthConfigurationError
    );
  });

  it("returns a canonical external session URL", () => {
    configureAuth();

    expect(getAuthRuntimeConfig(request())).toEqual({
      clientId: "client_example",
      publicOrigin: "https://rau.example",
      redirectUri: "https://rau.example/callback",
      sessionUrl: "https://rau.example/",
      trustProxy: false,
    });
  });

  it("requires every WorkOS secret and a 32 character cookie password", () => {
    configureAuth();
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", "too-short");

    expect(() => getAuthRuntimeConfig(request())).toThrow(
      AuthConfigurationError
    );
  });
});
