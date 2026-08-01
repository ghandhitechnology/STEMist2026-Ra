/**
 * lib/server/workspace.ts — the sandboxed, per-user workspace filesystem.
 *
 * Every file the server reads or writes on a user's behalf (skills,
 * generated PDFs, diagrams, and the file_read/file_write tools) lives under
 * `<RAUCHAT_WORKSPACE>/users/<userId>/` and is resolved through
 * `resolveWorkspacePath`, which rejects any path that would escape that
 * user's root. The WorkOS user id is the sandbox key — callers obtain it
 * via lib/server/auth.ts and thread it through every call here.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { userWorkspaceRoot, WorkspacePathError } from "./paths";

export { WorkspacePathError };

/** Per-user sandbox root: <base>/users/<sanitized user id>. */
export function workspaceRootFor(userId: string): string {
  return userWorkspaceRoot(userId);
}

export function exportsDirFor(userId: string): string {
  return path.join(workspaceRootFor(userId), "exports");
}

export function skillsDirFor(userId: string): string {
  return path.join(workspaceRootFor(userId), "skills");
}

/**
 * Idempotently creates a user's workspace root and reserved subdirectories.
 *
 * Deliberately uncached: a memoized "already ensured" promise goes stale the
 * moment the directory is removed underneath it (account deletion, or a
 * manual wipe), after which every later write fails with ENOENT until the
 * process restarts. Recursive mkdir on an existing directory is cheap.
 */
export async function ensureWorkspaceDirs(userId: string): Promise<void> {
  await mkdir(workspaceRootFor(userId), { recursive: true });
  await mkdir(exportsDirFor(userId), { recursive: true });
  await mkdir(skillsDirFor(userId), { recursive: true });
}

/**
 * Resolves a workspace-relative path to an absolute path inside the user's
 * sandbox, rejecting any path that would resolve outside it (`..` traversal,
 * absolute paths, symlink-style tricks via `path.resolve` normalization, etc).
 */
export function resolveWorkspacePath(userId: string, relPath: string): string {
  if (typeof relPath !== "string" || relPath.trim().length === 0) {
    throw new WorkspacePathError("Path must be a non-empty string.");
  }
  const root = workspaceRootFor(userId);
  const normalized = relPath.replace(/\\/g, "/");
  const joined = path.resolve(root, normalized);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (joined !== root && !joined.startsWith(rootWithSep)) {
    throw new WorkspacePathError(`Path escapes the workspace: ${relPath}`);
  }
  return joined;
}

export async function readWorkspaceFile(
  userId: string,
  relPath: string
): Promise<string> {
  await ensureWorkspaceDirs(userId);
  const abs = resolveWorkspacePath(userId, relPath);
  return readFile(abs, "utf8");
}

export async function writeWorkspaceFile(
  userId: string,
  relPath: string,
  content: string
): Promise<void> {
  await ensureWorkspaceDirs(userId);
  const abs = resolveWorkspacePath(userId, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

export type WorkspaceFileEntry = {
  /** Relative to the user's workspace root, posix-style separators. */
  path: string;
  size: number;
  mtime: number;
  isDirectory: boolean;
};

/** Recursively lists every file and directory under the user's workspace root. */
export async function listWorkspaceFiles(
  userId: string,
  subdir = ""
): Promise<WorkspaceFileEntry[]> {
  await ensureWorkspaceDirs(userId);
  const root = workspaceRootFor(userId);
  const startAbs = resolveWorkspacePath(userId, subdir || ".");
  const entries: WorkspaceFileEntry[] = [];

  async function walk(dirAbs: string): Promise<void> {
    let items;
    try {
      items = await readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      const abs = path.join(dirAbs, item.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (item.isDirectory()) {
        entries.push({ path: rel, size: 0, mtime: 0, isDirectory: true });
        await walk(abs);
      } else if (item.isFile()) {
        const info = await stat(abs);
        entries.push({
          path: rel,
          size: info.size,
          mtime: info.mtimeMs,
          isDirectory: false,
        });
      }
    }
  }

  await walk(startAbs);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}
