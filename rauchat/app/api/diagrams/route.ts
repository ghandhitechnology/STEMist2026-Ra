/**
 * app/api/diagrams/route.ts — GET the diagram library (newest first).
 * Version bodies are omitted; fetch /api/diagrams/<id> for full history.
 */

import { listDiagrams } from "@/lib/server/diagrams";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json({ diagrams: await listDiagrams() });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to list diagrams." },
      { status: 500 }
    );
  }
}
