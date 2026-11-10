/**
 * lib/server/openrouter.ts — the single OpenRouter client for Rauchat.
 *
 * Every model (OpenAI GPT-5.6 Sol/Luna/Terra, Anthropic Sonnet/Opus 5, and xAI
 * Grok 4.5) is reached through OpenRouter's OpenAI-compatible endpoint with the
 * one OPENROUTER_API_KEY. Thinking levels are expressed via OpenRouter's unified
 * `reasoning` parameter, which it translates per-provider.
 */

import OpenAI from "openai";
import type { ModelInfo, ThinkingLevel } from "@/lib/models";

export function getOpenRouter(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured on the server.");
  }
  return new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      // Attribution headers per OpenRouter docs (optional but recommended).
      "HTTP-Referer": process.env.RAUCHAT_PUBLIC_URL || "http://localhost:3000",
      "X-Title": "Rauchat",
    },
  });
}

/**
 * OpenRouter's unified reasoning parameter for a given model + level.
 * Returned as a partial request body to spread into the create() params.
 *
 * Allowed effort values per the OpenRouter reasoning-tokens docs:
 * max | xhigh | high | medium | low | minimal | none. "off" omits the
 * parameter entirely — Claude models then default to no extended thinking.
 */
export function reasoningParam(
  model: ModelInfo,
  level: ThinkingLevel
): { reasoning?: Record<string, unknown> } {
  if (level === "off") {
    return {};
  }
  return { reasoning: { effort: level } };
}

/**
 * Extracts human-readable reasoning text from a streamed delta. OpenRouter
 * emits `delta.reasoning_details` (array of typed detail objects, e.g.
 * { type: "reasoning.text", text }); some providers also mirror a plain
 * `delta.reasoning` string. Returns "" when the delta carries no reasoning.
 */
export function reasoningDeltaText(delta: unknown): string {
  if (!delta || typeof delta !== "object") return "";
  const d = delta as {
    reasoning?: unknown;
    reasoning_details?: Array<{ type?: string; text?: unknown; summary?: unknown }>;
  };
  if (typeof d.reasoning === "string" && d.reasoning) return d.reasoning;
  if (Array.isArray(d.reasoning_details)) {
    return d.reasoning_details
      .map((r) =>
        typeof r?.text === "string"
          ? r.text
          : typeof r?.summary === "string"
            ? r.summary
            : ""
      )
      .join("");
  }
  return "";
}
