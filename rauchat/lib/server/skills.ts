/**
 * lib/server/skills.ts — CRUD for persisted Skill objects.
 *
 * Skills are stored as one JSON file per skill under workspace/skills/.
 * Used by app/api/skills/route.ts and by the skill_make tool in
 * lib/server/tools.ts, and read back by app/api/chat/route.ts when
 * `options.activeSkillIds` is set.
 */

import { randomUUID } from "node:crypto";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Skill } from "@/lib/types";
import { SKILLS_DIR, ensureWorkspaceDirs } from "./workspace";

function skillFilePath(id: string): string {
  return path.join(SKILLS_DIR, `${id}.json`);
}

export async function listSkills(): Promise<Skill[]> {
  await ensureWorkspaceDirs();
  let files: string[];
  try {
    files = await readdir(SKILLS_DIR);
  } catch {
    return [];
  }
  const skills: Skill[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(path.join(SKILLS_DIR, file), "utf8");
      skills.push(JSON.parse(raw) as Skill);
    } catch {
      // Skip corrupt/partial files rather than failing the whole list.
    }
  }
  return skills.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getSkill(id: string): Promise<Skill | null> {
  await ensureWorkspaceDirs();
  try {
    const raw = await readFile(skillFilePath(id), "utf8");
    return JSON.parse(raw) as Skill;
  } catch {
    return null;
  }
}

export async function createSkill(input: {
  name: string;
  description: string;
  instructions: string;
}): Promise<Skill> {
  await ensureWorkspaceDirs();
  const skill: Skill = {
    id: randomUUID(),
    name: input.name,
    description: input.description,
    instructions: input.instructions,
    createdAt: Date.now(),
  };
  await writeFile(
    skillFilePath(skill.id),
    JSON.stringify(skill, null, 2),
    "utf8"
  );
  return skill;
}

export async function updateSkill(
  id: string,
  patch: Partial<Pick<Skill, "name" | "description" | "instructions" | "autoLoad">>
): Promise<Skill | null> {
  const existing = await getSkill(id);
  if (!existing) return null;
  const updated: Skill = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt };
  await writeFile(skillFilePath(id), JSON.stringify(updated, null, 2), "utf8");
  return updated;
}

/** Skills flagged autoLoad — injected into every conversation. */
export async function listAutoLoadSkills(): Promise<Skill[]> {
  return (await listSkills()).filter((s) => s.autoLoad);
}

export async function deleteSkill(id: string): Promise<boolean> {
  await ensureWorkspaceDirs();
  try {
    await unlink(skillFilePath(id));
    return true;
  } catch {
    return false;
  }
}
