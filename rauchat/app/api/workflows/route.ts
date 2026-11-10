import type { NextRequest } from "next/server";
import { getUserId, unauthorized } from "@/lib/server/auth";
import { listWorkflows } from "@/lib/server/workflows/runner";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  return Response.json({
    runs: await listWorkflows(
      userId,
      req.nextUrl.searchParams.get("conversationId") ?? undefined,
    ),
  });
}
