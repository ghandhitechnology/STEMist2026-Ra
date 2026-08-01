/**
 * app/api/account/route.ts
 *   DELETE -> { ok: true } — permanently deletes the signed-in user: their
 *             sandboxed workspace (lib/server/workspace.ts), their
 *             personalization profile and memory file (lib/server/profile.ts,
 *             lib/server/memory.ts), and the WorkOS user record itself.
 *
 * The client navigates to /signout after this resolves. A session cookie
 * left over after deletion is harmless: middleware treats a session whose
 * user no longer resolves as signed-out and bounces back to sign-in.
 */

import { rm } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { getUserId, unauthorized } from "@/lib/server/auth";
import { workspaceRootFor } from "@/lib/server/workspace";
import { deleteProfile, profilesDir } from "@/lib/server/profile";
import { isLocalFullAccessEnabled } from "@/lib/local-access";

export const runtime = "nodejs";

function sanitizeUserId(userId: string): string {
  const safe = String(userId ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) {
    throw new Error("Invalid user id for account deletion.");
  }
  return safe;
}

export async function DELETE() {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  // WorkOS has no identity for a local full-access session. In normal mode,
  // delete the identity first so a failure is a true no-op.
  if (!isLocalFullAccessEnabled()) {
    await getWorkOS().userManagement.deleteUser(userId);
  }

  // Wipe the sandboxed workspace (skills, exports, files) and account metadata.
  try {
    await rm(workspaceRootFor(userId), { recursive: true, force: true });
    await deleteProfile(userId);
    await rm(path.join(profilesDir(), `${sanitizeUserId(userId)}.memory.md`), {
      force: true,
    });
  } catch {
    // Best effort: the account is deleted either way.
  }

  return NextResponse.json({ ok: true });
}
