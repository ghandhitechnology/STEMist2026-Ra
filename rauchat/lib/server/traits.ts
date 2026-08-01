/**
 * lib/server/traits.ts — the Gemma 4 12B trait-projection evaluator client.
 *
 * ============================================================================
 * GEMMA 4 12B REMOTE CONTRACT (implemented by ../gemma-evaluator)
 * ============================================================================
 *
 * Rauchat expects `GEMMA_ENDPOINT_URL` to serve two HTTP endpoints. Both
 * requests include `Authorization: Bearer <GEMMA_API_KEY>` when
 * GEMMA_API_KEY is set.
 *
 * 1. GET {GEMMA_ENDPOINT_URL}/health
 *
 *    Response 200 JSON:
 *    {
 *      "status": "ok",
 *      "model": "gemma-4-12b",
 *      "layerInfo"?: {
 *        "layerRange": string,       // e.g. "36"
 *        "projectionRank": number,   // e.g. 8
 *        "vectorBuild": string       // e.g. "2026-07-30-persona-v3"
 *      }
 *    }
 *
 *    `layerInfo` is optional and, when present, is surfaced verbatim in the
 *    Substrate (reserved) section of the telemetry panel (DESIGN.md §6.4).
 *    Used by GET /api/traits/status.
 *
 * 2. POST {GEMMA_ENDPOINT_URL}/project
 *
 *    Request JSON: { "prompt": string, "response": string }
 *
 *    Response 200 JSON:
 *    {
 *      "readings": [
 *        { "traitId": "factual", "score": -1..1, "confidence": 0..1 },
 *        ... one entry per TraitId (lib/types.ts) — 8 total, any order.
 *      ]
 *    }
 *
 *    `traitId` must be one of: factual, serious, casual, creative, honest,
 *    confident, empathetic, calm (see TRAIT_AXES in lib/types.ts for the
 *    pole names). `score` is signed — positive leans toward the axis's
 *    positivePole, negative toward its negativePole. Entries with an
 *    unrecognized traitId or non-finite score/confidence are dropped by the
 *    server, not rejected outright.
 *
 *    Used by POST /api/traits, and internally by app/api/chat/route.ts after
 *    every completed assistant turn to build the streamed 'trait_snapshot'
 *    SSE event.
 * ============================================================================
 */

import type {
  TraitId,
  TraitReading,
  TraitSnapshot,
  TelemetryStatus,
} from "@/lib/types";
import { TRAIT_AXES } from "@/lib/types";

const HEALTH_TIMEOUT_MS = 4000;
const PROJECT_TIMEOUT_MS = Number(process.env.GEMMA_PROJECT_TIMEOUT_MS) || 60000;

export type LayerInfo = {
  layerRange?: string;
  projectionRank?: number;
  vectorBuild?: string;
};

export type TraitStatusResponse = {
  status: TelemetryStatus;
  model: "gemma-4-12b";
  layerInfo?: LayerInfo;
  /** Human-readable detail for the 'error' status (DESIGN.md §6.1 detail line). */
  detail?: string;
};

export type TraitProjectionInput = {
  /** Latest user request plus any reference/tool evidence used for the answer. */
  prompt: string;
  /** Completed assistant response whose response-token activations are projected. */
  response: string;
};

function endpointHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const apiKey = process.env.GEMMA_API_KEY;
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  return headers;
}

function baseUrl(): string | null {
  const url = process.env.GEMMA_ENDPOINT_URL;
  if (!url) return null;
  return url.replace(/\/+$/, "");
}

/**
 * GET /api/traits/status backing logic. Never throws — every failure mode
 * (unset env, timeout, non-2xx, network error) resolves to a status value
 * instead of rejecting.
 */
export async function getTraitStatus(): Promise<TraitStatusResponse> {
  const url = baseUrl();
  if (!url) {
    return { status: "disconnected", model: "gemma-4-12b" };
  }

  try {
    const res = await fetch(`${url}/health`, {
      headers: endpointHeaders(),
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => ({}))) as {
      status?: unknown;
      layerInfo?: LayerInfo;
      detail?: unknown;
    };
    if (!res.ok) {
      if (
        res.status === 503 &&
        (data.status === "loading" || data.status === "connecting")
      ) {
        return {
          status: "connecting",
          model: "gemma-4-12b",
          layerInfo: data.layerInfo,
          detail: typeof data.detail === "string" ? data.detail : "loading model",
        };
      }
      return {
        status: "error",
        model: "gemma-4-12b",
        detail:
          typeof data.detail === "string"
            ? data.detail
            : `remote refused (${res.status})`,
      };
    }
    return {
      status: "live",
      model: "gemma-4-12b",
      layerInfo: data?.layerInfo,
    };
  } catch (err) {
    return {
      status: "error",
      model: "gemma-4-12b",
      detail: err instanceof Error ? err.message : "connection failed",
    };
  }
}

/**
 * POST {GEMMA_ENDPOINT_URL}/project and build a TraitSnapshot.
 *
 * Returns `null` when GEMMA_ENDPOINT_URL is unset (disconnected) or the
 * response contained no usable readings. Throws on timeout / non-2xx /
 * network error so callers can distinguish "not configured" from "errored".
 */
export async function getTraitSnapshot(
  input: TraitProjectionInput,
  turnIndex: number
): Promise<TraitSnapshot | null> {
  const url = baseUrl();
  if (!url) return null;

  const res = await fetch(`${url}/project`, {
    method: "POST",
    headers: endpointHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(PROJECT_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Gemma endpoint returned ${res.status}`);
  }

  const data = (await res.json()) as { readings?: unknown };
  const readings = parseReadings(data?.readings);
  if (!readings.length) return null;

  return {
    turnIndex,
    timestamp: Date.now(),
    readings,
  };
}

function parseReadings(raw: unknown): TraitReading[] {
  if (!Array.isArray(raw)) return [];
  const validIds = new Set<string>(Object.keys(TRAIT_AXES));
  const seenIds = new Set<string>();
  const out: TraitReading[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const traitId = record.traitId;
    const score = Number(record.score);
    const confidence = Number(record.confidence);
    if (typeof traitId !== "string" || !validIds.has(traitId)) continue;
    if (seenIds.has(traitId)) continue;
    if (!Number.isFinite(score) || !Number.isFinite(confidence)) continue;
    seenIds.add(traitId);
    out.push({
      traitId: traitId as TraitId,
      score: Math.max(-1, Math.min(1, score)),
      confidence: Math.max(0, Math.min(1, confidence)),
    });
  }
  return out;
}
