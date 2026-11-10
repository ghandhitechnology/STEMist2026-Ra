/** Agent-facing skill operations. The chat tool registry supplies the authenticated user id. */

import type { SkillManageInput } from "@/lib/skill-types";
import {
  listSkillCatalog,
  manageSkillPackage,
  viewSkillPackage,
} from "./skills";

export async function skillListForAgent(
  userId: string,
  input: { query?: string } = {}
) {
  return {
    skills: await listSkillCatalog(userId, input.query),
    hint: "Use skill_view with an id to read instructions or package files.",
  };
}

export async function skillViewForAgent(
  userId: string,
  input: { id: string; path?: string; revision?: number }
) {
  const result = await viewSkillPackage(userId, input.id, {
    path: input.path,
    revision: input.revision,
  });
  if (!result) throw new Error("Skill, revision, or package file not found.");
  return result;
}

export async function skillManageForAgent(userId: string, input: SkillManageInput) {
  return manageSkillPackage(userId, input);
}
