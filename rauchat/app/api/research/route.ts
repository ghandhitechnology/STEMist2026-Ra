/**
 * app/api/research/route.ts — POST { query, depth?, model? } -> SSE stream.
 *
 * Multi-turn research loop: search -> the selected model synthesizes +
 * proposes a follow-up query -> repeat up to `depth` times -> final report,
 * streamed as SSE 'tool_event' progress updates plus a final streamed
 * 'text' report. All model calls go through OpenRouter.
 *
 * Event contract (same envelope as /api/chat):
 *   event: text        data: { delta: string }
 *   event: tool_event  data: ToolEvent
 *   event: done         data: {}
 *   event: error        data: { message: string }
 */

import type { NextRequest } from "next/server";
import type OpenAI from "openai";
import { z } from "zod";
import type { ToolEvent } from "@/lib/types";
import { getModel } from "@/lib/models";
import { createSSEResponse } from "@/lib/server/sse";
import { getOpenRouter } from "@/lib/server/openrouter";
import { webSearch, type WebSearchResult } from "@/lib/server/tools";

export const runtime = "nodejs";

const ResearchRequestSchema = z.object({
  query: z.string().min(1, "query must not be empty"),
  depth: z.number().int().min(1).max(6).optional().default(3),
  model: z.string().optional(),
});

function formatResults(results: WebSearchResult[]): string {
  if (!results.length) return "(no results)";
  return results
    .map((r, i) => `${i + 1}. ${r.title} — ${r.url}\n   ${r.snippet}`)
    .join("\n");
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = ResearchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { query, depth } = parsed.data;
  const model = getModel(parsed.data.model);

  let client: OpenAI;
  try {
    client = getOpenRouter();
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Server misconfigured." },
      { status: 500 }
    );
  }

  return createSSEResponse(async (send, signal) => {
    const researchEventId = `research-${Date.now()}`;
    const allSources: WebSearchResult[] = [];
    let notes = "";
    let currentQuery = query;
    let stepsRun = 0;

    const emitResearchStep = (status: ToolEvent["status"], detail?: string) => {
      send("tool_event", {
        id: researchEventId,
        tool: "research",
        status,
        title: `"${query}"`,
        detail,
      } satisfies ToolEvent);
    };

    emitResearchStep("running", `Step 1/${depth} · searching`);

    try {
      for (let i = 0; i < depth; i++) {
        if (signal.aborted) return;
        stepsRun = i + 1;

        const searchEventId = `${researchEventId}-search-${i}`;
        send("tool_event", {
          id: searchEventId,
          tool: "web_search",
          status: "running",
          title: `"${currentQuery}"`,
        } satisfies ToolEvent);

        let results: WebSearchResult[];
        try {
          results = await webSearch(currentQuery);
          send("tool_event", {
            id: searchEventId,
            tool: "web_search",
            status: "done",
            title: `"${currentQuery}"`,
            detail: `${results.length} result${results.length === 1 ? "" : "s"}`,
            result: results,
          } satisfies ToolEvent);
        } catch (err) {
          results = [];
          send("tool_event", {
            id: searchEventId,
            tool: "web_search",
            status: "error",
            title: `"${currentQuery}"`,
            detail: err instanceof Error ? err.message : "Search failed.",
          } satisfies ToolEvent);
        }
        allSources.push(...results);

        const isLastStep = i === depth - 1;
        const synthesisPrompt = `Research objective: ${query}

Notes so far:
${notes || "(none yet)"}

Latest search results for query "${currentQuery}":
${formatResults(results)}

Write 2-4 sentences synthesizing the new information into the running notes. Then, on its own final line, write exactly "NEXT_QUERY: <query>" proposing the single most valuable follow-up search query to deepen the research — or "NEXT_QUERY: DONE" if enough information has been gathered to write the final report.`;

        const synthesis = await client.chat.completions.create({
          model: model.openrouterId,
          max_tokens: 1024,
          messages: [{ role: "user", content: synthesisPrompt }],
        });
        const synthesisText = synthesis.choices?.[0]?.message?.content ?? "";

        const match = synthesisText.match(/NEXT_QUERY:\s*(.+?)\s*$/i);
        const nextQuery = match?.[1]?.trim();
        const noteAddition = synthesisText.replace(/NEXT_QUERY:.*/is, "").trim();
        notes += (notes ? "\n\n" : "") + noteAddition;

        if (isLastStep || !nextQuery || /^DONE$/i.test(nextQuery)) {
          break;
        }
        currentQuery = nextQuery;
        emitResearchStep("running", `Step ${i + 2}/${depth} · searching`);
      }

      emitResearchStep("running", "Writing final report");

      const reportPrompt = `Research objective: ${query}

Research notes:
${notes || "(none)"}

Sources:
${allSources.map((s) => `- ${s.title} (${s.url})`).join("\n") || "(none)"}

Write a well-organized markdown report answering the research objective. Cite sources inline using [Title](url) markdown links where relevant. Do not fabricate information beyond what the notes and sources support.`;

      const reportStream = await client.chat.completions.create({
        model: model.openrouterId,
        max_tokens: 4096,
        stream: true,
        messages: [{ role: "user", content: reportPrompt }],
      });
      for await (const chunk of reportStream) {
        if (signal.aborted) {
          reportStream.controller.abort();
          return;
        }
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) send("text", { delta });
      }

      emitResearchStep("done", `${allSources.length} sources · ${stepsRun} steps`);
    } catch (err) {
      emitResearchStep(
        "error",
        err instanceof Error ? err.message : "Research failed."
      );
      send("error", {
        message: err instanceof Error ? err.message : "Research failed.",
      });
      return;
    }

    send("done", {});
  });
}
