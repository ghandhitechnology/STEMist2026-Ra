import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crossSiteRejection, redirectTo } from "./http";

function authRequest(options: {
  contentType?: string;
  forwardedHost?: string;
  forwardedProto?: string;
  origin?: string;
  site?: string;
} = {}): NextRequest {
  const headers = new Headers();
  headers.set("content-type", options.contentType ?? "application/json");
  if (options.origin !== undefined) headers.set("origin", options.origin);
  if (options.site !== undefined) headers.set("sec-fetch-site", options.site);
  if (options.forwardedHost) {
    headers.set("x-forwarded-host", options.forwardedHost);
  }
  if (options.forwardedProto) {
    headers.set("x-forwarded-proto", options.forwardedProto);
  }
  return new NextRequest("http://internal:3111/api/auth/sign-in", {
    method: "POST",
    headers,
    body: "{}",
  });
}

async function responseCode(response: Response | null): Promise<string | null> {
  if (!response) return null;
  return (await response.json()).code as string;
}

describe("crossSiteRejection", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("RAUCHAT_PUBLIC_URL", "https://rau.example");
    vi.stubEnv(
      "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
      "https://rau.example/callback"
    );
    vi.stubEnv("RAUCHAT_TRUST_PROXY", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows an exact same-origin browser request", () => {
    const result = crossSiteRejection(
      authRequest({ origin: "https://rau.example", site: "same-origin" })
    );

    expect(result).toBeNull();
  });

  it.each([
    "http://rau.example",
    "https://rau.example:444",
    "https://auth.rau.example",
  ])("rejects a noncanonical origin: %s", async (origin) => {
    const result = crossSiteRejection(
      authRequest({ origin, site: "same-site" })
    );

    expect(result?.status).toBe(403);
    expect(await responseCode(result)).toBe("AUTH_ORIGIN_MISMATCH");
  });

  it("rejects cross-site fetch metadata even with a matching Origin", async () => {
    const result = crossSiteRejection(
      authRequest({ origin: "https://rau.example", site: "cross-site" })
    );

    expect(result?.status).toBe(403);
    expect(await responseCode(result)).toBe("AUTH_ORIGIN_MISMATCH");
  });

  it("allows a JSON non-browser client without fetch metadata", () => {
    expect(crossSiteRejection(authRequest())).toBeNull();
  });

  it("rejects a form-compatible content type", async () => {
    const result = crossSiteRejection(
      authRequest({ contentType: "text/plain", site: "cross-site" })
    );

    expect(result?.status).toBe(415);
    expect(await responseCode(result)).toBe("AUTH_CONTENT_TYPE_INVALID");
  });

  it("allows multipart when opted in", () => {
    const result = crossSiteRejection(
      authRequest({
        contentType: "multipart/form-data; boundary=abc",
        origin: "https://rau.example",
        site: "same-origin",
      }),
      { allowMultipart: true }
    );
    expect(result).toBeNull();
  });

  it("rejects multipart when not opted in", async () => {
    const result = crossSiteRejection(
      authRequest({
        contentType: "multipart/form-data; boundary=abc",
        origin: "https://rau.example",
        site: "same-origin",
      })
    );
    expect(result?.status).toBe(415);
    expect(await responseCode(result)).toBe("AUTH_CONTENT_TYPE_INVALID");
  });

  it("accepts trusted overwritten proxy headers when no canonical URL is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RAUCHAT_PUBLIC_URL", "");
    vi.stubEnv("RAUCHAT_TRUST_PROXY", "true");
    const result = crossSiteRejection(
      authRequest({
        forwardedHost: "rau.example",
        forwardedProto: "https",
        origin: "https://rau.example",
        site: "same-origin",
      })
    );

    expect(result).toBeNull();
  });

  it("does not trust forwarded headers without the opt-in", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RAUCHAT_PUBLIC_URL", "");
    const result = crossSiteRejection(
      authRequest({
        forwardedHost: "rau.example",
        forwardedProto: "https",
        origin: "https://rau.example",
        site: "same-origin",
      })
    );

    expect(result?.status).toBe(500);
    expect(await responseCode(result)).toBe("AUTH_NOT_CONFIGURED");
  });
});

describe("redirectTo", () => {
  it("creates a relative redirect", () => {
    expect(redirectTo("/sign-in").headers.get("location")).toBe("/sign-in");
  });

  it("rejects protocol-relative redirects", () => {
    expect(() => redirectTo("//attacker.example")).toThrow(TypeError);
  });
});
