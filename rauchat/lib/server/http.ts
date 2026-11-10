/**
 * lib/server/http.ts — request guards shared by mutating route handlers.
 *
 * The credential routes under /api/auth are reachable without a session, so
 * they need their own CSRF defense: without one, an attacker page can POST a
 * forged JSON body cross-site (Request.json() ignores Content-Type, so a
 * `enctype="text/plain"` form is enough) and the response's Set-Cookie would
 * silently sign the victim's browser into an attacker-controlled account.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getCanonicalAuthOrigin } from "@/lib/server/auth-config";
import {
  authConfigurationResponse,
  authErrorResponse,
  logAuthEvent,
} from "@/lib/server/auth-errors";

/**
 * A 302 with a RELATIVE Location.
 *
 * Never build redirects from `req.nextUrl.origin`: Next derives that from the
 * server's own bind address, so behind a TLS-terminating proxy (tailscale
 * serve, Render) it is `http://localhost:3111` — the browser would be sent to
 * an address it cannot reach. A relative Location is resolved by the browser
 * against the URL in its address bar, which is correct everywhere and trusts
 * no forwarded headers.
 */
export function redirectTo(path: string): NextResponse {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new TypeError("redirectTo only accepts an absolute application path.");
  }
  return new NextResponse(null, { status: 302, headers: { Location: path } });
}

export type CrossSiteRejectionOptions = {
  /**
   * When true, accept `multipart/form-data` in addition to JSON. Used by
   * binary upload routes; origin / fetch-metadata checks still apply.
   */
  allowMultipart?: boolean;
};

/**
 * Rejects any state-changing request that did not originate from this app.
 * Returns a Response to send back, or null when the request is same-origin.
 */
export function crossSiteRejection(
  req: NextRequest,
  options: CrossSiteRejectionOptions = {}
): Response | null {
  const contentType = contentTypeRejection(req, options);
  if (contentType) return contentType;

  let expectedOrigin: string;
  try {
    expectedOrigin = getCanonicalAuthOrigin(req);
  } catch (error) {
    return authConfigurationResponse("request-guard", error);
  }

  const rejected = (reason: string) => {
    logAuthEvent("request_rejected", { route: "request-guard", reason });
    return authErrorResponse(
      "AUTH_ORIGIN_MISMATCH",
      "This authentication request came from an unexpected address. Reload Rauchat from its official URL and try again.",
      403
    );
  };

  const site = req.headers.get("sec-fetch-site")?.toLowerCase();
  if (site === "cross-site") return rejected("fetch_metadata_cross_site");

  const origin = req.headers.get("origin");
  if (origin) {
    let actualOrigin: string;
    try {
      actualOrigin = new URL(origin).origin;
    } catch {
      return rejected("invalid_origin_header");
    }
    if (actualOrigin !== expectedOrigin) {
      return rejected("origin_does_not_match_canonical");
    }
  } else if (site === "same-site") {
    return rejected("same_site_without_exact_origin");
  }

  return null;
}

/**
 * A real JSON fetch always declares itself. The cross-site form forgery
 * cannot: `enctype="text/plain"` is the only way to shape a valid JSON body
 * from a form, and it cannot set this header.
 */
function contentTypeRejection(
  req: NextRequest,
  options: CrossSiteRejectionOptions = {}
): Response | null {
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("application/json")) return null;
  if (options.allowMultipart && contentType.includes("multipart/form-data")) {
    return null;
  }
  return authErrorResponse(
    "AUTH_CONTENT_TYPE_INVALID",
    options.allowMultipart
      ? "Expected a JSON or multipart request body."
      : "Expected a JSON request body.",
    415
  );
}
