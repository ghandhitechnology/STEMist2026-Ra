/**
 * lib/types.ts — the SHARED CONTRACT for Rauchat.
 * Other agents import from this file; do not rename or remove exports.
 */

/** The eight trait axes tracked by the telemetry evaluator (DESIGN.md §6.2). */
export type TraitId =
  | "factual"
  | "serious"
  | "casual"
  | "creative"
  | "honest"
  | "confident"
  | "empathetic"
  | "calm";

/**
 * Axis pole names. `positivePole` is the FIRST-named pole (left, accent,
 * score > 0); `negativePole` is the SECOND-named pole (right, gray, score < 0).
 * Order of keys is the fixed display order.
 */
export const TRAIT_AXES: Record<
  TraitId,
  { positivePole: string; negativePole: string }
> = {
  factual: { positivePole: "factual", negativePole: "hallucinatory" },
  serious: { positivePole: "serious", negativePole: "funny" },
  casual: { positivePole: "casual", negativePole: "formal" },
  creative: { positivePole: "creative", negativePole: "empirical" },
  honest: { positivePole: "honest", negativePole: "sycophantic" },
  confident: { positivePole: "confident", negativePole: "unsure" },
  empathetic: { positivePole: "empathetic", negativePole: "unempathetic" },
  calm: { positivePole: "calm", negativePole: "anxious" },
};

/** One axis reading. `score` is -1..1 (positive → positivePole); `confidence` is 0..1. */
export type TraitReading = {
  traitId: TraitId;
  score: number;
  confidence: number;
};

/** All axis readings for a single turn. */
export type TraitSnapshot = {
  turnIndex: number;
  timestamp: number;
  readings: TraitReading[];
};

export type TelemetryStatus = "disconnected" | "connecting" | "live" | "error";

export type ToolName =
  | "web_search"
  | "research"
  | "pdf_create"
  | "file_read"
  | "file_write"
  | "skill_make"
  | "diagram";

/**
 * How a diagram is rendered. `html`/`react`/`svg` run in a sandboxed
 * iframe; `markdown` renders as prose; `code` is read-only highlighted text.
 */
export type DiagramKind = "html" | "react" | "svg" | "markdown" | "code";

export const DIAGRAM_KINDS: DiagramKind[] = [
  "html",
  "react",
  "svg",
  "markdown",
  "code",
];

/** One saved revision of a diagram. */
export type DiagramVersion = {
  version: number;
  content: string;
  createdAt: number;
};

/**
 * A model-authored document rendered in its own panel. Identified by a
 * stable slug so later turns can revise it in place; every write appends a
 * version rather than overwriting.
 */
export type Diagram = {
  id: string;
  title: string;
  kind: DiagramKind;
  /** Highlighting hint for `code` diagrams (e.g. "python"). */
  language?: string;
  /** Newest version's content, denormalized for the inline card. */
  content: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  versions?: DiagramVersion[];
};

export type ToolEvent = {
  id: string;
  tool: ToolName;
  status: "running" | "done" | "error";
  title: string;
  detail?: string;
  result?: unknown;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  toolEvents?: ToolEvent[];
  traitSnapshot?: TraitSnapshot;
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  /** Rauchat model id (lib/models.ts). Absent on conversations created before model selection existed. */
  modelId?: string;
  /** Thinking level for this conversation (lib/models.ts ThinkingLevel). */
  thinking?: string;
  /** Number of messages the current title was generated from — drives regeneration on exit. */
  titledAtCount?: number;
};

export type Skill = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  createdAt: number;
  /** Auto-loaded into every conversation without being selected in the picker. */
  autoLoad?: boolean;
};
