/**
 * lib/server/memory.ts — durable, per-user agent memory.
 *
 * One markdown file per user at `<RAUCHAT_WORKSPACE>/profiles/<userId>.memory.md`,
 * holding a flat bullet list of dated one-line facts. It lives beside the
 * profile store and OUTSIDE the per-user workspace sandbox so the file_read /
 * file_write tools cannot reach it — only the memory_add tool
 * (lib/server/tools.ts) and app/api/memory/route.ts write here.
 *
 * The whole file is injected into the system prompt on every turn
 * (app/api/chat/route.ts), so entries are kept short and single-line.
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { memoryFile, profilesDir } from "./paths";

async function ensureProfilesDir(): Promise<void> {
  await mkdir(profilesDir(), { recursive: true });
}

/** The raw memory markdown, or "" when the user has none yet. */
export async function readMemory(userId: string): Promise<string> {
  try {
    return await readFile(memoryFile(userId), "utf8");
  } catch {
    return "";
  }
}

/** Longest single memory entry kept, in characters. */
const MAX_ENTRY_CHARS = 400;

/**
 * `- [YYYY-MM-DD] <single-line content>`; returns "" for empty content.
 *
 * The entry is flattened to one line and stripped of the fence delimiters
 * used when this file is injected into the system prompt, so a saved fact can
 * never close the fence and pose as instructions.
 */
function formatEntry(text: string): string {
  const line = String(text ?? "")
    .replace(/\s+/g, " ")
    .replace(/<\/?user_memory>/gi, "")
    .trim()
    .slice(0, MAX_ENTRY_CHARS);
  if (!line) return "";
  const date = new Date().toISOString().slice(0, 10);
  return `- [${date}] ${line}`;
}

/**
 * Appends one dated bullet. Empty or whitespace-only content is ignored.
 *
 * Uses O_APPEND rather than read-modify-write: two memory_add calls in the
 * same turn (the model routinely emits several) would otherwise race, and the
 * later write would silently drop the earlier fact.
 */
export async function appendMemory(userId: string, text: string): Promise<void> {
  const entry = formatEntry(text);
  if (!entry) return;
  await ensureProfilesDir();
  await appendFile(memoryFile(userId), `${entry}\n`, "utf8");
}

/** Overwrites the whole file — used by the settings editor. */
export async function replaceMemory(
  userId: string,
  content: string
): Promise<void> {
  await ensureProfilesDir();
  const body = String(content ?? "").trimEnd();
  await writeFile(memoryFile(userId), body ? `${body}\n` : "", "utf8");
}
