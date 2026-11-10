import type { Skill, ToolName } from "@/lib/types";

export const SKILL_ENTRY_FILE = "SKILL.md" as const;

export type SkillSource = "manual" | "generated" | "imported";

export type SkillPackageFile = {
  path: string;
  size: number;
  updatedAt: number;
};

export type SkillRevision = {
  revision: number;
  createdAt: number;
  reason: "created" | "migrated" | "updated" | "restored";
  restoredFrom?: number;
  files: string[];
};

/** Rich package metadata. It stays structurally compatible with the old Skill type. */
export type SkillPackage = Skill & {
  updatedAt: number;
  revision: number;
  revisionCount: number;
  files: SkillPackageFile[];
};

/** Small first-pass record for agent discovery. Instructions and file bodies are omitted. */
export type SkillCatalogEntry = Pick<
  SkillPackage,
  | "id"
  | "name"
  | "description"
  | "source"
  | "capabilities"
  | "autoLoad"
  | "updatedAt"
  | "revision"
> & {
  matchedOn?: string[];
};

export type SkillPackageView = {
  skill: SkillPackage;
  revision: SkillRevision;
  content?: string;
  path?: string;
};

/** Immutable package content captured for a workflow run or sandbox seed. */
export type SkillPackageSnapshot = {
  id: string;
  name: string;
  description: string;
  revision: number;
  files: Record<string, string>;
};

export type SkillCreateInput = {
  id?: string;
  name: string;
  description: string;
  instructions: string;
  source?: SkillSource;
  sourceDraftId?: string;
  autoLoad?: boolean;
  capabilities?: { tools: ToolName[]; skills: string[] };
  files?: Record<string, string>;
};

export type SkillUpdateInput = Partial<
  Pick<Skill, "name" | "description" | "instructions" | "autoLoad" | "capabilities">
> & {
  files?: Record<string, string | null>;
};

export type SkillManageInput =
  | ({ action: "create" } & SkillCreateInput)
  | ({ action: "update"; id: string } & SkillUpdateInput)
  | { action: "restore"; id: string; revision: number }
  | { action: "delete"; id: string };

export type SkillManageResult =
  | { action: "create" | "update" | "restore"; skill: SkillPackage }
  | { action: "delete"; id: string; deleted: boolean };

export type StoredSkillMetadata = {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  source: SkillSource;
  sourceDraftId?: string;
  autoLoad?: boolean;
  capabilities: { tools: ToolName[]; skills: string[] };
  revisionRecord: Omit<SkillRevision, "files">;
};
