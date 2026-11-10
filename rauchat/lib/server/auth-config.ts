import type { NextRequest } from "next/server";

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

export type AuthRuntimeConfig = {
  clientId: string;
  publicOrigin: string;
  redirectUri: string;
  sessionUrl: string;
  trustProxy: boolean;
};

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function readBoolean(name: string): boolean {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function parseOrigin(raw: string, variable: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AuthConfigurationError(`${variable} must be an absolute URL.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AuthConfigurationError(`${variable} must use http or https.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new AuthConfigurationError(
      `${variable} cannot contain credentials, a query, or a fragment.`
    );
  }
  return url;
}

function configuredPublicOrigin(): string | null {
  const publicUrl = process.env.RAUCHAT_PUBLIC_URL?.trim();
  const redirectUri = process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI?.trim();

  let publicOrigin: string | null = null;
  if (publicUrl) {
    const url = parseOrigin(publicUrl, "RAUCHAT_PUBLIC_URL");
    if (url.pathname !== "/") {
      throw new AuthConfigurationError(
        "RAUCHAT_PUBLIC_URL must be an origin without a path."
      );
    }
    publicOrigin = url.origin;
  }

  let redirectOrigin: string | null = null;
  if (redirectUri) {
    const url = parseOrigin(
      redirectUri,
      "NEXT_PUBLIC_WORKOS_REDIRECT_URI"
    );
    if (url.pathname !== "/callback") {
      throw new AuthConfigurationError(
        "NEXT_PUBLIC_WORKOS_REDIRECT_URI must end with /callback."
      );
    }
    redirectOrigin = url.origin;
  }

  if (publicOrigin && redirectOrigin && publicOrigin !== redirectOrigin) {
    throw new AuthConfigurationError(
      "RAUCHAT_PUBLIC_URL and NEXT_PUBLIC_WORKOS_REDIRECT_URI must use the same origin."
    );
  }

  const origin = publicOrigin;
  if (origin && isProduction() && !origin.startsWith("https://")) {
    throw new AuthConfigurationError(
      "The production Rauchat public origin must use https."
    );
  }
  return origin;
}

function singleForwardedHeader(
  request: NextRequest,
  name: "x-forwarded-host" | "x-forwarded-proto"
): string {
  const value = request.headers.get(name)?.trim() ?? "";
  if (!value || value.includes(",") || /[\r\n]/.test(value)) {
    throw new AuthConfigurationError(
      `Trusted proxy mode requires one valid ${name} value.`
    );
  }
  return value;
}

function proxyPublicOrigin(request: NextRequest): string {
  const protocol = singleForwardedHeader(request, "x-forwarded-proto");
  const host = singleForwardedHeader(request, "x-forwarded-host");
  if (protocol !== "http" && protocol !== "https") {
    throw new AuthConfigurationError(
      "Trusted x-forwarded-proto must be http or https."
    );
  }
  const url = parseOrigin(`${protocol}://${host}`, "trusted proxy origin");
  if (url.pathname !== "/") {
    throw new AuthConfigurationError("Trusted proxy host is invalid.");
  }
  if (isProduction() && url.protocol !== "https:") {
    throw new AuthConfigurationError(
      "The trusted production proxy must expose https."
    );
  }
  return url.origin;
}

/**
 * Resolve the browser-visible application origin without trusting Host by
 * default. Configuration always wins; forwarded headers are consulted only
 * behind an explicitly trusted proxy. A request-derived fallback exists only
 * for local development so a fresh checkout works before .env.local exists.
 */
export function getCanonicalAuthOrigin(request?: NextRequest): string {
  const configured = configuredPublicOrigin();
  if (configured) return configured;

  if (readBoolean("RAUCHAT_TRUST_PROXY")) {
    if (!request) {
      throw new AuthConfigurationError(
        "A request is required to resolve the trusted proxy origin."
      );
    }
    return proxyPublicOrigin(request);
  }

  if (!isProduction() && request) {
    return parseOrigin(request.url, "request URL").origin;
  }

  throw new AuthConfigurationError(
    "RAUCHAT_PUBLIC_URL is required unless a trusted proxy is explicitly enabled."
  );
}

export function getAuthRuntimeConfig(
  request?: NextRequest
): AuthRuntimeConfig {
  const clientId = process.env.WORKOS_CLIENT_ID?.trim() ?? "";
  const apiKey = process.env.WORKOS_API_KEY?.trim() ?? "";
  const cookiePassword = process.env.WORKOS_COOKIE_PASSWORD ?? "";
  if (!clientId || !apiKey || cookiePassword.length < 32) {
    throw new AuthConfigurationError(
      "WORKOS_CLIENT_ID, WORKOS_API_KEY, and a 32+ character WORKOS_COOKIE_PASSWORD are required."
    );
  }

  const publicOrigin = getCanonicalAuthOrigin(request);
  const configuredRedirect =
    process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI?.trim() ?? "";
  if (!configuredRedirect) {
    throw new AuthConfigurationError(
      "NEXT_PUBLIC_WORKOS_REDIRECT_URI is required."
    );
  }
  const redirect = parseOrigin(
    configuredRedirect,
    "NEXT_PUBLIC_WORKOS_REDIRECT_URI"
  );
  const expectedRedirect = `${publicOrigin}/callback`;
  if (redirect.toString() !== expectedRedirect) {
    throw new AuthConfigurationError(
      "NEXT_PUBLIC_WORKOS_REDIRECT_URI must exactly match the canonical /callback URL."
    );
  }

  return {
    clientId,
    publicOrigin,
    redirectUri: expectedRedirect,
    sessionUrl: `${publicOrigin}/`,
    trustProxy: readBoolean("RAUCHAT_TRUST_PROXY"),
  };
}
