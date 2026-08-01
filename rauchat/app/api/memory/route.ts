/**
 * app/api/memory/route.ts — GET (read) / PUT (replace) the signed-in user's
 * long-term agent memory, backed by lib/server/memory.ts
 * (<RAUCHAT_WORKSPACE>/profiles/<userId>.memory.md).
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readMemory, replaceMemory } from "@/lib/server/memory";
import { getUserId, unauthorized } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const memory = await readMemory(userId);
  return NextResponse.json({ memory });
}

const ReplaceMemorySchema = z.object({
  memory: z.string().max(20000, "memory must be at most 20000 characters"),
});

export async function PUT(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = ReplaceMemorySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  await replaceMemory(userId, parsed.data.memory);
  return NextResponse.json({ ok: true });
}
