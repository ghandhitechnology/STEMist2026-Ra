/**
 * app/api/diagrams/route.ts — GET the diagram library (newest first).
 * Version bodies are omitted; fetch /api/diagrams/<id> for full history.
 */

import { listDiagrams } from "@/lib/server/diagrams";
import { getUserId, unauthorized } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  try {
    return Response.json({ diagrams: await listDiagrams(userId) });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to list diagrams." },
      { status: 500 }
    );
  }
}
