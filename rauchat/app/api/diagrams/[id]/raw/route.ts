/**
 * app/api/diagrams/[id]/raw/route.ts — serves a runnable diagram as a
 * standalone page ("open in new tab"), or the raw source for kinds that are
 * not documents. `?v=<n>` selects a specific revision.
 *
 * SECURITY: this returns model-authored HTML/JS from the app's own origin, so
 * every runnable response carries `Content-Security-Policy: sandbox`. That
 * directive drops the document into a unique opaque origin — no access to the
 * session cookie, no same-origin fetches back into the API — which is the same
 * guarantee the in-app sandboxed-iframe preview already has. Without it, a
 * generated page could read the signed-in user's data via the app's own APIs.
 */

import { contentAtVersion, readDiagram } from "@/lib/server/diagrams";
import { buildDiagramDocument, isRunnable } from "@/lib/diagram-runtime";
import { getUserId, unauthorized } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const diagram = await readDiagram(userId, id);
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
          // Opaque origin: scripts run, but the page is not "us".
          "Content-Security-Policy":
            "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-presentation",
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
