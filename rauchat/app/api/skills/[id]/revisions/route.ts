import { getUserId, unauthorized } from "@/lib/server/auth";
import { listSkillRevisions } from "@/lib/server/skills";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  try {
    return Response.json({ revisions: await listSkillRevisions(userId, id) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to read revisions." },
      { status: 400 }
    );
  }
}
