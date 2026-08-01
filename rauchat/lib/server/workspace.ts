/**
 * lib/server/workspace.ts — the sandboxed workspace filesystem root.
 *
 * Every file the server reads or writes on the user's behalf (skills,
 * generated PDFs, and the file_read/file_write tools) is resolved through
 * `resolveWorkspacePath`, which rejects any path that would escape
 * RAUCHAT_WORKSPACE (default './workspace', relative to the project root).
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export class WorkspacePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathError";
  }
}

export const WORKSPACE_ROOT = path.resolve(
  process.cwd(),
  process.env.RAUCHAT_WORKSPACE || "./workspace"
);

export const EXPORTS_DIR = path.join(WORKSPACE_ROOT, "exports");
export const SKILLS_DIR = path.join(WORKSPACE_ROOT, "skills");

let ensured: Promise<void> | null = null;

/** Idempotently creates the workspace root and its reserved subdirectories. */
export function ensureWorkspaceDirs(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await mkdir(WORKSPACE_ROOT, { recursive: true });
      await mkdir(EXPORTS_DIR, { recursive: true });
      await mkdir(SKILLS_DIR, { recursive: true });
    })();
  }
  return ensured;
}

/**
 * Resolves a workspace-relative path to an absolute path, rejecting any
 * path that would resolve outside WORKSPACE_ROOT (`..` traversal, absolute
 * paths, symlink-style tricks via `path.resolve` normalization, etc).
 */
export function resolveWorkspacePath(relPath: string): string {
  if (typeof relPath !== "string" || relPath.trim().length === 0) {
    throw new WorkspacePathError("Path must be a non-empty string.");
  }
  const normalized = relPath.replace(/\\/g, "/");
  const joined = path.resolve(WORKSPACE_ROOT, normalized);
  const rootWithSep = WORKSPACE_ROOT.endsWith(path.sep)
    ? WORKSPACE_ROOT
    : WORKSPACE_ROOT + path.sep;
  if (joined !== WORKSPACE_ROOT && !joined.startsWith(rootWithSep)) {
    throw new WorkspacePathError(`Path escapes the workspace: ${relPath}`);
  }
  return joined;
}

export async function readWorkspaceFile(relPath: string): Promise<string> {
  await ensureWorkspaceDirs();
  const abs = resolveWorkspacePath(relPath);
  return readFile(abs, "utf8");
}

export async function writeWorkspaceFile(
  relPath: string,
  content: string
): Promise<void> {
  await ensureWorkspaceDirs();
  const abs = resolveWorkspacePath(relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

export type WorkspaceFileEntry = {
  /** Relative to WORKSPACE_ROOT, posix-style separators. */
  path: string;
  size: number;
  mtime: number;
  isDirectory: boolean;
};

/** Recursively lists every file and directory under the workspace root. */
export async function listWorkspaceFiles(
  subdir = ""
): Promise<WorkspaceFileEntry[]> {
  await ensureWorkspaceDirs();
  const startAbs = resolveWorkspacePath(subdir || ".");
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
      const rel = path.relative(WORKSPACE_ROOT, abs).split(path.sep).join("/");
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
