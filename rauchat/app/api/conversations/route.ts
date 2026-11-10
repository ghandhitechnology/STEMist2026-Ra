/**
 * app/api/conversations/route.ts — GET the signed-in user's full stored chat
 * history, backed by lib/server/conversations.ts
 * (<RAUCHAT_WORKSPACE>/conversations/<userId>/). Mutations go through
 * /api/conversations/[id].
 */

import { NextResponse } from "next/server";
import { listConversations } from "@/lib/server/conversations";
import { getUserId, unauthorized } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const conversations = await listConversations(userId);
  return NextResponse.json({ conversations });
}
