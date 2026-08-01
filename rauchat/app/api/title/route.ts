/**
 * app/api/title/route.ts — automatic conversation naming.
 *
 * POST { messages: [{role, content}], previousTitle? } -> { title }
 *
 * Uses GPT-5.6 Luna via OpenRouter (per product spec) with reasoning
 * excluded and a tight token cap. The client animates the returned title
 * (typing on first naming, erase-and-retype on regeneration) — the server
 * just returns the string.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { MODELS, TITLE_MODEL_ID } from "@/lib/models";
import { getOpenRouter } from "@/lib/server/openrouter";

export const runtime = "nodejs";

const TitleRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    )
    .min(1),
  previousTitle: z.string().optional(),
});

// Prompt adapted from Vercel ai-chatbot's title generator (lib/ai/prompts.ts,
// Apache-2.0) with LibreChat's 40-char cap; see sources.md.
const TITLE_SYSTEM = `Generate a short chat title (2-5 words, max 40 characters) summarizing the conversation.

Output ONLY the title text. No prefixes, no formatting.

Examples:
- "what's the weather in nyc" → Weather in NYC
- "help me write an essay about space" → Space Essay Help
- "debug my python code" → Python Debugging

Use the same language as the conversation. Never output hashtags, prefixes like "Title:", quotes, or trailing punctuation.`;

const MAX_TRANSCRIPT_CHARS = 6000;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = TitleRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  let transcript = parsed.data.messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    // Keep the head and tail — titles come from how a conversation opened
    // and where it ended up.
    const half = MAX_TRANSCRIPT_CHARS / 2;
    transcript = `${transcript.slice(0, half)}\n\n[...]\n\n${transcript.slice(-half)}`;
  }

  const userContent = parsed.data.previousTitle
    ? `The conversation has continued since it was titled "${parsed.data.previousTitle}". Retitle it to reflect the full conversation now.\n\n${transcript}`
    : transcript;

  try {
    const client = getOpenRouter();
    const titleModel = MODELS.find((m) => m.id === TITLE_MODEL_ID)!;
    const completion = await client.chat.completions.create({
      model: titleModel.openrouterId,
      messages: [
        { role: "system", content: TITLE_SYSTEM },
        { role: "user", content: userContent },
      ],
      max_tokens: 200,
      reasoning: { effort: "minimal", exclude: true },
    } as Parameters<typeof client.chat.completions.create>[0]);

    const choice = (completion as { choices?: Array<{ message?: { content?: string | null } }> })
      .choices?.[0];
    let title = (choice?.message?.content ?? "").trim();
    // Strip wrapping quotes and trailing punctuation defensively.
    title = title.replace(/^["'“‘]+|["'”’]+$/g, "").replace(/[.。!?]+$/, "").trim();
    if (title.length > 60) title = `${title.slice(0, 57).trimEnd()}…`;
    if (!title) {
      return Response.json({ error: "Empty title returned." }, { status: 502 });
    }
    return Response.json({ title });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Title generation failed." },
      { status: 500 }
    );
  }
}
