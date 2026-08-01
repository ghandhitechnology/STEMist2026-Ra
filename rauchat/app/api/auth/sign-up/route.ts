/**
 * app/api/auth/sign-up/route.ts — password sign-up against WorkOS.
 *
 * POST { email, password, firstName?, lastName? }
 *   -> 200 { ok: true }                                   (session cookie set)
 *   -> 200 { ok: false, verify: true, pendingAuthenticationToken, email }
 *   -> 400 { error }                                      (friendly copy)
 *
 * WorkOS environments with email verification enabled reject the immediate
 * password authentication with `email_verification_required`; that is not an
 * error for us, it is the second step of the flow (see /api/auth/verify).
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { getWorkOS, saveSession } from "@workos-inc/authkit-nextjs";
import { crossSiteRejection } from "@/lib/server/http";

export const runtime = "nodejs";

const SignUpSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(8).max(256),
  firstName: z.string().trim().max(120).optional(),
  lastName: z.string().trim().max(120).optional(),
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

function friendlyCreateError(err: WorkOSErrorLike): string {
  const code = err.code ?? err.rawData?.code ?? "";
  const message = (err.message ?? "").toLowerCase();
  if (
    code === "email_not_available" ||
    message.includes("already exists") ||
    message.includes("not available")
  ) {
    return "An account with that email already exists.";
  }
  if (code === "password_strength_error" || message.includes("password")) {
    return "That password is too weak. Use at least 10 characters and avoid common words.";
  }
  if (code === "email_validation_error" || message.includes("email")) {
    return "Enter a valid email address.";
  }
  return "Could not create your account. Try again.";
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
  const parsed = SignUpSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Enter a valid email and a password of at least 8 characters." },
      { status: 400 }
    );
  }

  const { email, password, firstName, lastName } = parsed.data;
  const clientId = process.env.WORKOS_CLIENT_ID;
  if (!clientId) {
    return Response.json({ error: "Auth is not configured." }, { status: 500 });
  }

  const workos = getWorkOS();

  try {
    await workos.userManagement.createUser({
      email,
      password,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
    });
  } catch (err) {
    return Response.json(
      { error: friendlyCreateError(asWorkOSError(err)) },
      { status: 400 }
    );
  }

  try {
    const authResponse = await workos.userManagement.authenticateWithPassword({
      clientId,
      email,
      password,
    });
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
      {
        error:
          "Your account was created, but signing in failed. Try signing in.",
      },
      { status: 400 }
    );
  }
}
