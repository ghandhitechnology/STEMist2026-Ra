/**
 * app/api/auth/verify/route.ts — second step of the email-verification flow.
 *
 * POST { pendingAuthenticationToken, code } -> 200 { ok: true } | 400 { error }
 *
 * The pending token is issued by /api/auth/sign-in or /api/auth/sign-up when
 * WorkOS answers with `email_verification_required`; exchanging it plus the
 * emailed code yields a real session, which we seal into the cookie.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { getWorkOS, saveSession } from "@workos-inc/authkit-nextjs";
import { crossSiteRejection } from "@/lib/server/http";

export const runtime = "nodejs";

const VerifySchema = z.object({
  pendingAuthenticationToken: z.string().min(1).max(4096),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code."),
});

export async function POST(req: NextRequest) {
  const crossSite = crossSiteRejection(req);
  if (crossSite) return crossSite;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = VerifySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Enter the 6-digit code from your email." },
      { status: 400 }
    );
  }

  const clientId = process.env.WORKOS_CLIENT_ID;
  if (!clientId) {
    return Response.json({ error: "Auth is not configured." }, { status: 500 });
  }

  try {
    const authResponse =
      await getWorkOS().userManagement.authenticateWithEmailVerification({
        clientId,
        code: parsed.data.code,
        pendingAuthenticationToken: parsed.data.pendingAuthenticationToken,
      });
    await saveSession(authResponse, req);
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "That code is incorrect or has expired." },
      { status: 400 }
    );
  }
}
