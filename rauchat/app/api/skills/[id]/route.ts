import { getUserId, unauthorized } from "@/lib/server/auth";
import { listSkillRevisions, viewSkillPackage } from "@/lib/server/skills";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const url = new URL(req.url);
  const revisionRaw = url.searchParams.get("revision");
  const revision = revisionRaw ? Number(revisionRaw) : undefined;
  if (revisionRaw && (!Number.isSafeInteger(revision) || revision! < 1)) {
    return Response.json({ error: "Invalid revision." }, { status: 400 });
  }
  try {
    const view = await viewSkillPackage(userId, id, {
      path: url.searchParams.get("path") ?? undefined,
      revision,
    });
    if (!view) return Response.json({ error: "Skill not found." }, { status: 404 });
    return Response.json({ ...view, revisions: await listSkillRevisions(userId, id) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to read skill." },
      { status: 400 }
    );
  }
}
