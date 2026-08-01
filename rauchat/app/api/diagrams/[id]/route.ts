/**
 * app/api/diagrams/[id]/route.ts — GET one diagram with its full version
 * history, so the panel can offer revision browsing after a page reload.
 */

import { readDiagram } from "@/lib/server/diagrams";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const diagram = await readDiagram(id);
    if (!diagram) {
      return Response.json({ error: "Diagram not found." }, { status: 404 });
    }
    return Response.json({ diagram });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to read diagram." },
      { status: 500 }
    );
  }
}
