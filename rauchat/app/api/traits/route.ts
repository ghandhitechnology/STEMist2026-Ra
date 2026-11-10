/**
 * app/api/traits/route.ts — POST { prompt, response, turnIndex? } -> TraitSnapshot
 *
 * Standalone trait-projection endpoint (ad hoc telemetry, not the internal
 * per-turn call app/api/chat/route.ts makes directly against
 * lib/server/traits.ts). Forwards to GEMMA_ENDPOINT_URL /project; see
 * lib/server/traits.ts for the full remote contract.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getTraitSnapshot } from "@/lib/server/traits";
import { getUserId, unauthorized } from "@/lib/server/auth";

export const runtime = "nodejs";

const TraitsRequestSchema = z.object({
  prompt: z.string().min(1, "prompt must not be empty"),
  response: z.string().min(1, "response must not be empty"),
  turnIndex: z.number().int().optional().default(0),
});

export async function POST(req: NextRequest) {
  if (!(await getUserId())) return unauthorized();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = TraitsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (!process.env.GEMMA_ENDPOINT_URL) {
    return NextResponse.json(
      { error: "Gemma evaluator is not configured.", status: "disconnected" },
      { status: 503 }
    );
  }

  try {
    const snapshot = await getTraitSnapshot(
      {
        prompt: parsed.data.prompt,
        response: parsed.data.response,
      },
      parsed.data.turnIndex
    );
    if (!snapshot) {
      return NextResponse.json(
        { error: "Gemma endpoint returned no usable readings.", status: "error" },
        { status: 502 }
      );
    }
    return NextResponse.json(snapshot);
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Gemma request failed.",
        status: "error",
      },
      { status: 502 }
    );
  }
}
