/**
 * app/api/auth/sign-in/route.ts — password sign-in against WorkOS.
 *
 * POST { email, password }
 *   -> 200 { ok: true }                                   (session cookie set)
 *   -> 200 { ok: false, verify: true, pendingAuthenticationToken, email }
 *   -> 401 { error: "Incorrect email or password." }
 *
 * Credential failures are deliberately indistinguishable from one another so
 * the endpoint cannot be used to enumerate accounts.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { getWorkOS, saveSession } from "@workos-inc/authkit-nextjs";
import { crossSiteRejection } from "@/lib/server/http";

export const runtime = "nodejs";

const SignInSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(256),
});

/** The subset of a WorkOS exception we actually read. */
type WorkOSErrorLike = {
  code?: string;
  message?: string;
  pendingAuthenticationToken?: string;
  rawData?: { code?: string; pending_authentication_token?: string };
};

function asWorkOSError(err: unknown): WorkOSErrorLike {
  return (err ?? {}) as WorkOSErrorLike;
}

/** Non-null when WorkOS wants an emailed code before issuing a session. */
function pendingVerification(err: WorkOSErrorLike): string | null {
  const code = err.code ?? err.rawData?.code;
  if (code !== "email_verification_required") return null;
  return (
    err.pendingAuthenticationToken ??
    err.rawData?.pending_authentication_token ??
    null
  );
}

export async function POST(req: NextRequest) {
  const crossSite = crossSiteRejection(req);
  if (crossSite) return crossSite;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = SignInSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Enter your email and password." },
      { status: 400 }
    );
  }

  const { email, password } = parsed.data;
  const clientId = process.env.WORKOS_CLIENT_ID;
  if (!clientId) {
    return Response.json({ error: "Auth is not configured." }, { status: 500 });
  }

  try {
    const authResponse = await getWorkOS().userManagement.authenticateWithPassword(
      { clientId, email, password }
    );
    await saveSession(authResponse, req);
    return Response.json({ ok: true });
  } catch (err) {
    const workosError = asWorkOSError(err);
    const pendingAuthenticationToken = pendingVerification(workosError);
    if (pendingAuthenticationToken) {
      return Response.json({
        ok: false,
        verify: true,
        pendingAuthenticationToken,
        email,
      });
    }
    return Response.json(
      { error: "Incorrect email or password." },
      { status: 401 }
    );
  }
}
