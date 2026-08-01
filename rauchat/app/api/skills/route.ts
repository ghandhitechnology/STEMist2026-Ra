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
import { getUserId, unauthorized } from "@/lib/server/auth";
import { crossSiteRejection } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const skills = await listSkills(userId);
  return NextResponse.json({ skills });
}

const CreateSkillSchema = z.object({
  name: z.string().min(1, "name must not be empty"),
  description: z.string().min(1, "description must not be empty"),
  instructions: z.string().min(1, "instructions must not be empty"),
});

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

  const skill = await createSkill(userId, parsed.data);
  return NextResponse.json(skill, { status: 201 });
}

const UpdateSkillSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    instructions: z.string().min(1).optional(),
    autoLoad: z.boolean().optional(),
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
  const updated = await updateSkill(userId, id, parsed.data);
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
