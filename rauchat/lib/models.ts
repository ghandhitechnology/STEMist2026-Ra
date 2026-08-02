/**
 * lib/models.ts — the model catalog shared by client and server.
 *
 * All six models are served through OpenRouter (OPENROUTER_API_KEY); the
 * `openrouterId` is the catalog id sent on the wire. Thinking levels map to
 * OpenRouter's unified `reasoning` request parameter — see
 * lib/server/openrouter.ts for the exact per-family mapping.
 *
 * Thinking levels match OpenRouter's unified `reasoning.effort` scale:
 * max | xhigh | high | medium | low | minimal | none. Locally, "off" omits
 * the parameter (Claude) or is unused (OpenAI models start at "minimal").
 */

export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type ModelFamily = "openai" | "anthropic" | "xai";

export type ModelInfo = {
  /** Rauchat-local id, stored on conversations. */
  id: string;
  /** OpenRouter catalog id sent on the wire. */
  openrouterId: string;
  /** Full display name for the selector list. */
  label: string;
  /** Compact name shown next to the chat title. */
  shortLabel: string;
  family: ModelFamily;
  /** One-line positioning shown in the selector. */
  description: string;
  /** Thinking levels this model accepts, in ascending order. */
  thinkingLevels: ThinkingLevel[];
  defaultThinking: ThinkingLevel;
};

export const MODELS: ModelInfo[] = [
  {
    id: "claude-sonnet-5",
    openrouterId: "anthropic/claude-sonnet-5",
    label: "Claude Sonnet 5",
    shortLabel: "Sonnet 5",
    family: "anthropic",
    description: "Fast, balanced — the default.",
    thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max"],
    defaultThinking: "off",
  },
  {
    id: "claude-opus-5",
    openrouterId: "anthropic/claude-opus-5",
    label: "Claude Opus 5",
    shortLabel: "Opus 5",
    family: "anthropic",
    description: "Deep reasoning and hard problems.",
    thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max"],
    defaultThinking: "medium",
  },
  {
    id: "gpt-5.6-sol",
    openrouterId: "openai/gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    shortLabel: "Sol",
    family: "openai",
    description: "OpenAI's flagship generalist.",
    thinkingLevels: ["minimal", "low", "medium", "high", "xhigh", "max"],
    defaultThinking: "medium",
  },
  {
    id: "gpt-5.6-luna",
    openrouterId: "openai/gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    shortLabel: "Luna",
    family: "openai",
    description: "Fast and light; also names your chats.",
    thinkingLevels: ["minimal", "low", "medium", "high", "xhigh", "max"],
    defaultThinking: "low",
  },
  {
    id: "gpt-5.6-terra",
    openrouterId: "openai/gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    shortLabel: "Terra",
    family: "openai",
    description: "Long-horizon reasoning specialist.",
    thinkingLevels: ["minimal", "low", "medium", "high", "xhigh", "max"],
    defaultThinking: "medium",
  },
  {
    id: "grok-4.5",
    openrouterId: "x-ai/grok-4.5",
    label: "Grok 4.5",
    shortLabel: "Grok 4.5",
    family: "xai",
    description: "xAI's frontier reasoning model.",
    thinkingLevels: ["off", "low", "medium", "high"],
    defaultThinking: "medium",
  },
];

export const DEFAULT_MODEL_ID = "claude-sonnet-5";

/** The model used for automatic chat titling (per product spec: GPT-5.6 Luna). */
export const TITLE_MODEL_ID = "gpt-5.6-luna";

export function getModel(id: string | undefined | null): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? MODELS.find((m) => m.id === DEFAULT_MODEL_ID)!;
}

export function clampThinking(model: ModelInfo, level: string | undefined | null): ThinkingLevel {
  if (level && (model.thinkingLevels as string[]).includes(level)) {
    return level as ThinkingLevel;
  }
  return model.defaultThinking;
}
