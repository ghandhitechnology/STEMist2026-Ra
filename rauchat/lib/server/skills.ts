/**
 * lib/server/skills.ts — CRUD for persisted Skill objects, per user.
 *
 * Skills are stored as one JSON file per skill under
 * <workspace>/users/<userId>/skills/. Used by app/api/skills/route.ts and by
 * the skill_make tool in lib/server/tools.ts, and read back by
 * app/api/chat/route.ts when `options.activeSkillIds` is set.
 */

import { randomUUID } from "node:crypto";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Skill } from "@/lib/types";
import { skillsDirFor, ensureWorkspaceDirs } from "./workspace";

export class SkillIdError extends Error {
  constructor() {
    super("Invalid skill id.");
    this.name = "SkillIdError";
  }
}

/**
 * Skill ids become filenames, so they are restricted to the alphabet
 * `randomUUID()` produces. Without this, a crafted `?id=../../..` escapes the
 * caller's sandbox and reaches any .json on disk.
 */
function safeSkillId(raw: unknown): string {
  const id = String(raw ?? "");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new SkillIdError();
  return id;
}

function skillFilePath(userId: string, id: string): string {
  const dir = skillsDirFor(userId);
  const file = path.join(dir, `${safeSkillId(id)}.json`);
  // Defense in depth: the id alphabet already forbids traversal.
  if (!file.startsWith(dir + path.sep)) throw new SkillIdError();
  return file;
}

export async function listSkills(userId: string): Promise<Skill[]> {
  await ensureWorkspaceDirs(userId);
  let files: string[];
  try {
    files = await readdir(skillsDirFor(userId));
  } catch {
    return [];
  }
  const skills: Skill[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(path.join(skillsDirFor(userId), file), "utf8");
      skills.push(JSON.parse(raw) as Skill);
    } catch {
      // Skip corrupt/partial files rather than failing the whole list.
    }
  }
  return skills.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getSkill(
  userId: string,
  id: string
): Promise<Skill | null> {
  await ensureWorkspaceDirs(userId);
  try {
    const raw = await readFile(skillFilePath(userId, id), "utf8");
    return JSON.parse(raw) as Skill;
  } catch {
    return null;
  }
}

export async function createSkill(
  userId: string,
  input: {
    name: string;
    description: string;
    instructions: string;
  }
): Promise<Skill> {
  await ensureWorkspaceDirs(userId);
  const skill: Skill = {
    id: randomUUID(),
    name: input.name,
    description: input.description,
    instructions: input.instructions,
    createdAt: Date.now(),
  };
  await writeFile(
    skillFilePath(userId, skill.id),
    JSON.stringify(skill, null, 2),
    "utf8"
  );
  return skill;
}

export async function updateSkill(
  userId: string,
  id: string,
  patch: Partial<Pick<Skill, "name" | "description" | "instructions" | "autoLoad">>
): Promise<Skill | null> {
  const existing = await getSkill(userId, id);
  if (!existing) return null;
  const updated: Skill = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt };
  await writeFile(skillFilePath(userId, id), JSON.stringify(updated, null, 2), "utf8");
  return updated;
}

/** Skills flagged autoLoad — injected into every conversation. */
export async function listAutoLoadSkills(userId: string): Promise<Skill[]> {
  return (await listSkills(userId)).filter((s) => s.autoLoad);
}

export async function deleteSkill(userId: string, id: string): Promise<boolean> {
  await ensureWorkspaceDirs(userId);
  try {
    await unlink(skillFilePath(userId, id));
    return true;
  } catch {
    return false;
  }
}
