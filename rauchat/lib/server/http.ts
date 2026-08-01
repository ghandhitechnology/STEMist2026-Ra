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
  return new NextResponse(null, { status: 302, headers: { Location: path } });
}

/**
 * Rejects any state-changing request that did not originate from this app.
 * Returns a Response to send back, or null when the request is same-origin.
 */
export function crossSiteRejection(req: NextRequest): Response | null {
  const rejected = () =>
    Response.json({ error: "Cross-site request rejected." }, { status: 403 });

  // Sec-Fetch-Site is set by the browser itself and cannot be forged by page
  // script, so it is the authoritative signal whenever it is present.
  const site = req.headers.get("sec-fetch-site");
  if (site) {
    return site === "same-origin" || site === "none"
      ? contentTypeRejection(req)
      : rejected();
  }

  // Fallback for clients that omit Sec-Fetch-Site. Compare HOSTS, not full
  // origins: behind a TLS-terminating proxy (tailscale serve, Render, any
  // load balancer) the browser's Origin is https:// while this server sees
  // itself as http://, and a scheme comparison would reject every request.
  const origin = req.headers.get("origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return rejected();
    }
    // Compare against the Host the browser addressed. X-Forwarded-* is NOT
    // consulted: it is attacker-settable, and trusting it would let a forged
    // request declare its own identity and match itself.
    const selfHost = req.headers.get("host") ?? req.nextUrl.host;
    if (originHost !== selfHost) return rejected();
  }

  return contentTypeRejection(req);
}

/**
 * A real JSON fetch always declares itself. The cross-site form forgery
 * cannot: `enctype="text/plain"` is the only way to shape a valid JSON body
 * from a form, and it cannot set this header.
 */
function contentTypeRejection(req: NextRequest): Response | null {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return Response.json(
      { error: "Expected a JSON request body." },
      { status: 415 }
    );
  }
  return null;
}
