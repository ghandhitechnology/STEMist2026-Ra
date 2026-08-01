/**
 * app/api/auth/password-reset/confirm/route.ts — step 2 of password recovery.
 *
 * POST { token, newPassword } -> 200 { ok: true } | 400 { error }
 *
 * `token` is the reset token WorkOS emailed in step 1. Resetting the password
 * also verifies the address if it was not verified yet. No session is issued
 * here — the caller is sent back to /sign-in to authenticate normally.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { crossSiteRejection } from "@/lib/server/http";

export const runtime = "nodejs";

const ConfirmSchema = z.object({
  token: z.string().trim().min(1).max(4096),
  newPassword: z.string().min(8).max(256),
});

/** The subset of a WorkOS exception we actually read. */
type WorkOSErrorLike = {
  code?: string;
  message?: string;
  rawData?: { code?: string };
};

function friendlyResetError(err: unknown): string {
  const workosError = (err ?? {}) as WorkOSErrorLike;
  const code = workosError.code ?? workosError.rawData?.code ?? "";
  const message = (workosError.message ?? "").toLowerCase();
  if (code === "password_strength_error" || message.includes("password strength")) {
    return "That password is too weak. Use at least 10 characters and avoid common words.";
  }
  return "That reset code is invalid or has expired.";
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
  const parsed = ConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error:
          "Enter the reset code from your email and a password of at least 8 characters.",
      },
      { status: 400 }
    );
  }

  if (!process.env.WORKOS_CLIENT_ID) {
    return Response.json({ error: "Auth is not configured." }, { status: 500 });
  }

  try {
    await getWorkOS().userManagement.resetPassword({
      token: parsed.data.token,
      newPassword: parsed.data.newPassword,
    });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: friendlyResetError(err) }, { status: 400 });
  }
}
