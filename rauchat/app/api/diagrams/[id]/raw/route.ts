/**
 * app/api/diagrams/[id]/raw/route.ts — serves a runnable diagram as a
 * standalone page ("open in new tab"), or the raw source for kinds that are
 * not documents. `?v=<n>` selects a specific revision.
 *
 * SECURITY: this returns model-authored HTML/JS on the app's own origin. That
 * is acceptable for local single-user development; before this moves to a
 * shared cloud server it must be served from a separate sandbox origin so a
 * generated page can never touch the app's cookies or storage. The in-app
 * preview does not have this caveat — it runs in a sandboxed iframe with no
 * same-origin access.
 */

import { contentAtVersion, readDiagram } from "@/lib/server/diagrams";
import { buildDiagramDocument, isRunnable } from "@/lib/diagram-runtime";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const diagram = await readDiagram(id);
  if (!diagram) {
    return new Response("Diagram not found.", { status: 404 });
  }

  const versionParam = new URL(req.url).searchParams.get("v");
  const version = versionParam ? Number(versionParam) : null;
  const content = contentAtVersion(
    diagram,
    Number.isFinite(version) ? version : null
  );

  if (isRunnable(diagram.kind)) {
    return new Response(
      buildDiagramDocument(diagram.kind, content, diagram.title),
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
