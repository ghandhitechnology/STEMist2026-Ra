import { getUserId, unauthorized } from "@/lib/server/auth";
import type { NextRequest } from "next/server";
import { crossSiteRejection } from "@/lib/server/http";
import { restoreSkillRevision } from "@/lib/server/skills";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; revision: string }> }
) {
  const crossSite = crossSiteRejection(req);
  if (crossSite) return crossSite;
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id, revision: rawRevision } = await params;
  const revision = Number(rawRevision);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    return Response.json({ error: "Invalid revision." }, { status: 400 });
  }
  try {
    const skill = await restoreSkillRevision(userId, id, revision);
    if (!skill) {
      return Response.json({ error: "Skill or revision not found." }, { status: 404 });
    }
    return Response.json(skill);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to restore revision." },
      { status: 400 }
    );
  }
}
