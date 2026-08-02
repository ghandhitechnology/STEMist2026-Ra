/**
 * Liveness probe for the deployment platform (Render's healthCheckPath).
 * Public by design — listed in middleware.ts PUBLIC_PATHS — and dynamic so
 * every probe exercises the running server instead of a build-time snapshot.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true });
}
