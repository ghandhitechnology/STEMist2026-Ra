import { z } from "zod";
import type { NextRequest } from "next/server";
import { getUserId, unauthorized } from "@/lib/server/auth";
import { crossSiteRejection } from "@/lib/server/http";
import { writeSkillPackageFile } from "@/lib/server/skills";

export const runtime = "nodejs";

const FileSchema = z.object({
  path: z.string().min(1).max(240),
  content: z.string().max(1_000_000).nullable(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const crossSite = crossSiteRejection(req);
  if (crossSite) return crossSite;
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const parsed = FileSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid package file." }, { status: 400 });
  }
  const { id } = await params;
  try {
    const skill = await writeSkillPackageFile(
      userId,
      id,
      parsed.data.path,
      parsed.data.content
    );
    if (!skill) return Response.json({ error: "Skill not found." }, { status: 404 });
    return Response.json(skill);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to write package file." },
      { status: 400 }
    );
  }
}
