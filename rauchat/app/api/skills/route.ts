/**
 * app/api/skills/route.ts — GET (list) / POST (create) / PATCH (?id=, partial
 * update incl. autoLoad) / DELETE (?id=) backed by lib/server/skills.ts
 * (workspace/skills/<id>.json).
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSkill,
  deleteSkill,
  listSkills,
  updateSkill,
} from "@/lib/server/skills";
import type { Skill, ToolName } from "@/lib/types";
import { getUserId, unauthorized } from "@/lib/server/auth";
import { crossSiteRejection } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const skills = await listSkills(userId);
  return NextResponse.json({ skills });
}

const ToolNameSchema = z.enum([
  "web_search",
  "research",
  "pdf_create",
  "file_read",
  "file_write",
  "skill_make",
  "diagram",
  "memory_add",
  "browser_use",
]);

const CapabilitiesSchema = z
  .object({
    tools: z.array(ToolNameSchema).max(12).optional().default([]),
    // Imported/generated drafts may use a dependency's id or exact name.
    skills: z.array(z.string().trim().min(1).max(100)).max(20).optional().default([]),
  })
  .optional()
  .default({ tools: [], skills: [] });

const CreateSkillSchema = z.object({
  name: z.string().trim().min(1, "name must not be empty").max(100),
  description: z
    .string()
    .trim()
    .min(1, "description must not be empty")
    .max(300),
  instructions: z
    .string()
    .trim()
    .min(1, "instructions must not be empty")
    .max(20000),
  source: z.enum(["manual", "generated", "imported"]).optional().default("manual"),
  draftId: z.string().uuid().optional(),
  capabilities: CapabilitiesSchema,
});

async function resolveCapabilitySkills(
  userId: string,
  references: string[]
): Promise<{ ids: string[]; unknown: string[] }> {
  const installed = await listSkills(userId);
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const reference of references) {
    const normalized = reference.trim().toLowerCase();
    const match = installed.find(
      (skill) =>
        skill.id === reference || skill.name.trim().toLowerCase() === normalized
    );
    if (!match) {
      unknown.push(reference);
      continue;
    }
    if (!ids.includes(match.id)) ids.push(match.id);
  }
  return { ids, unknown };
}

export async function POST(req: NextRequest) {
  const crossSite = crossSiteRejection(req);
  if (crossSite) return crossSite;

  const userId = await getUserId();
  if (!userId) return unauthorized();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = CreateSkillSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // A generated draft card can be revisited after reload. Treat installation
  // as idempotent before resolving capabilities that may since have changed.
  if (parsed.data.draftId) {
    const existing = (await listSkills(userId)).find(
      (skill) => skill.sourceDraftId === parsed.data.draftId
    );
    if (existing) return NextResponse.json(existing);
  }

  const dependencies = await resolveCapabilitySkills(
    userId,
    parsed.data.capabilities.skills
  );
  if (dependencies.unknown.length) {
    return NextResponse.json(
      {
        error: `Unknown skill capabilities: ${dependencies.unknown.join(", ")}`,
      },
      { status: 400 }
    );
  }

  const skill = await createSkill(userId, {
    name: parsed.data.name,
    description: parsed.data.description,
    instructions: parsed.data.instructions,
    source: parsed.data.source,
    sourceDraftId: parsed.data.draftId,
    capabilities: {
      tools: parsed.data.capabilities.tools as ToolName[],
      skills: dependencies.ids,
    },
  });
  return NextResponse.json(skill, { status: 201 });
}

const UpdateSkillSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().min(1).max(300).optional(),
    instructions: z.string().trim().min(1).max(20000).optional(),
    autoLoad: z.boolean().optional(),
    capabilities: CapabilitiesSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Empty patch." });

export async function PATCH(req: NextRequest) {
  const crossSite = crossSiteRejection(req);
  if (crossSite) return crossSite;

  const userId = await getUserId();
  if (!userId) return unauthorized();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id query parameter." }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = UpdateSkillSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  let patch: Partial<
    Pick<Skill, "name" | "description" | "instructions" | "autoLoad" | "capabilities">
  > = parsed.data;
  if (parsed.data.capabilities) {
    const dependencies = await resolveCapabilitySkills(
      userId,
      parsed.data.capabilities.skills
    );
    if (dependencies.unknown.length) {
      return NextResponse.json(
        { error: `Unknown skill capabilities: ${dependencies.unknown.join(", ")}` },
        { status: 400 }
      );
    }
    if (dependencies.ids.includes(id)) {
      return NextResponse.json(
        { error: "A skill cannot depend on itself." },
        { status: 400 }
      );
    }
    patch = {
      ...parsed.data,
      capabilities: {
        tools: parsed.data.capabilities.tools as ToolName[],
        skills: dependencies.ids,
      },
    };
  }
  const updated = await updateSkill(userId, id, patch);
  if (!updated) {
    return NextResponse.json({ error: "Skill not found." }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id query parameter." }, { status: 400 });
  }
  const deleted = await deleteSkill(userId, id);
  if (!deleted) {
    return NextResponse.json({ error: "Skill not found." }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
