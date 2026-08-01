/**
 * lib/server/paths.ts — the single source of truth for every on-disk path
 * derived from a user id.
 *
 * The sandbox boundary is only as strong as its weakest copy: id
 * sanitization and the workspace root used to live in three modules plus a
 * route handler, each free to drift. Everything that touches the filesystem
 * on a user's behalf resolves through here instead.
 *
 *   <RAUCHAT_WORKSPACE>/users/<userId>/      per-user sandbox (skills, exports, diagrams)
 *   <RAUCHAT_WORKSPACE>/profiles/<userId>.json      personalization profile
 *   <RAUCHAT_WORKSPACE>/profiles/<userId>.memory.md long-term agent memory
 *
 * Profiles and memory sit OUTSIDE the sandbox on purpose, so the
 * file_read / file_write tools can never reach them.
 */

import path from "node:path";

export class WorkspacePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathError";
  }
}

/** Root of all Rauchat state. Relative values resolve against the project root. */
export const WORKSPACE_BASE_ROOT = path.resolve(
  process.cwd(),
  process.env.RAUCHAT_WORKSPACE || "./workspace"
);

/**
 * User ids become path segments, so they are restricted to the alphabet
 * WorkOS ids use. Anything else throws rather than being silently rewritten
 * into some other user's path.
 */
export function sanitizeUserId(userId: string): string {
  const safe = String(userId ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) throw new WorkspacePathError("Invalid user id.");
  return safe;
}

/** The user's sandbox root: everything the tools and /api/files can see. */
export function userWorkspaceRoot(userId: string): string {
  return path.join(WORKSPACE_BASE_ROOT, "users", sanitizeUserId(userId));
}

/** Account metadata directory, shared by profiles and memory. */
export function profilesDir(): string {
  return path.join(WORKSPACE_BASE_ROOT, "profiles");
}

export function profileFile(userId: string): string {
  return path.join(profilesDir(), `${sanitizeUserId(userId)}.json`);
}

export function memoryFile(userId: string): string {
  return path.join(profilesDir(), `${sanitizeUserId(userId)}.memory.md`);
}
