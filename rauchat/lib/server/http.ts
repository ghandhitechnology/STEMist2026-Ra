/**
 * lib/server/http.ts — request guards shared by mutating route handlers.
 *
 * The credential routes under /api/auth are reachable without a session, so
 * they need their own CSRF defense: without one, an attacker page can POST a
 * forged JSON body cross-site (Request.json() ignores Content-Type, so a
 * `enctype="text/plain"` form is enough) and the response's Set-Cookie would
 * silently sign the victim's browser into an attacker-controlled account.
 */

import type { NextRequest } from "next/server";

/**
 * Rejects any state-changing request that did not originate from this app.
 * Returns a Response to send back, or null when the request is same-origin.
 */
export function crossSiteRejection(req: NextRequest): Response | null {
  // Sec-Fetch-Site is set by every browser that can mount this attack.
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return Response.json({ error: "Cross-site request rejected." }, { status: 403 });
  }

  // Origin covers non-browser clients and older browsers; when present it must match.
  const origin = req.headers.get("origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).origin;
    } catch {
      return Response.json({ error: "Cross-site request rejected." }, { status: 403 });
    }
    if (originHost !== req.nextUrl.origin) {
      return Response.json({ error: "Cross-site request rejected." }, { status: 403 });
    }
  }

  // A real JSON fetch always declares itself; the form-based forgery cannot.
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return Response.json(
      { error: "Expected a JSON request body." },
      { status: 415 }
    );
  }

  return null;
}
