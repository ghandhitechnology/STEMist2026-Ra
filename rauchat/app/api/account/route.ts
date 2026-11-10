/**
 * app/api/account/route.ts
 *   DELETE -> { ok: true } — permanently deletes the signed-in user: their
 *             sandboxed workspace (lib/server/workspace.ts), their
 *             personalization profile and memory file (lib/server/profile.ts,
 *             lib/server/memory.ts), and the WorkOS user record itself.
 *
 * The client POSTs /signout after this resolves so the now-orphaned local
 * session cookie is explicitly expired before returning to /sign-in.
 */

import { rm } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { getUserId, unauthorized } from "@/lib/server/auth";
import { memoryFile, userWorkspaceRoot } from "@/lib/server/paths";
import { deleteProfile } from "@/lib/server/profile";
import { isLocalFullAccessEnabled } from "@/lib/local-access";

export const runtime = "nodejs";

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
    await rm(userWorkspaceRoot(userId), { recursive: true, force: true });
    await deleteProfile(userId);
    await rm(memoryFile(userId), { force: true });
  } catch {
    // Best effort: the account is deleted either way.
  }

  return NextResponse.json({ ok: true });
}
