"use client";

/**
 * lib/useTelemetry.ts — connection state for the Model Telemetry panel.
 *
 * Polls `GET /api/traits/status`, which is expected to answer
 *   { status: TelemetryStatus, model?: string, layerInfo?: string }
 *
 * Trait *snapshots* do NOT come through here — they arrive on the chat stream
 * and are handed to <TelemetryPanel snapshots={...} /> by the page. This hook
 * owns only the question "is the Gemma 4 12B evaluator reachable?".
 *
 * Design note (DESIGN.md §1.7, §6.1): a missing endpoint is NOT an error. If
 * the route is absent (404) or the response carries no usable status, we settle
 * on "disconnected" — the designed dormant default — never on "error".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { TelemetryStatus } from "@/lib/types";

export type TelemetryStatusPayload = {
  status: TelemetryStatus;
  model?: string;
  layerInfo?: string;
  vectorSet?: string;
  /** Human-readable reason, populated when `status === "error"`. */
  detail?: string;
};

export type UseTelemetryOptions = {
  /** Status endpoint. Default `/api/traits/status`. */
  endpoint?: string;
  /** Re-poll cadence in ms. Default 20000. Set 0 to poll once on mount. */
  pollIntervalMs?: number;
  /** Faster cadence while a handshake is in flight. Default 2000. */
  connectingIntervalMs?: number;
  /** Skip network entirely (tests / storybook). */
  enabled?: boolean;
};

export type UseTelemetryResult = {
  status: TelemetryStatus;
  /** Model identifier reported by the evaluator, e.g. `gemma-4-12b`. */
  model?: string;
  /** Free-form layer/weight description reported by the evaluator. */
  layerInfo?: string;
  /** Vector-build tag reported by the evaluator. */
  vectorSet?: string;
  /** Round-trip time of the most recent successful poll, ms. */
  latencyMs: number | null;
  /** Epoch ms of the last completed poll, or null before the first. */
  lastCheckedAt: number | null;
  /** Short human reason when `status === "error"`. */
  error: string | null;
  /** Manual reconnect: flips to "connecting" and re-polls immediately. */
  retry: () => void;
};

const VALID: readonly TelemetryStatus[] = [
  "disconnected",
  "connecting",
  "live",
  "error",
];

function isTelemetryStatus(v: unknown): v is TelemetryStatus {
  return typeof v === "string" && (VALID as readonly string[]).includes(v);
}

/** Truncated, chrome-safe reason string (DESIGN.md §6.1 error detail line). */
function reasonFor(res: Response): string {
  const code = res.status;
  if (code === 503) return "remote refused (503)";
  if (code === 429) return "rate limited (429)";
  if (code >= 500) return `remote error (${code})`;
  if (code === 401 || code === 403) return `not authorised (${code})`;
  return `request failed (${code})`;
}

export function useTelemetry(
  options: UseTelemetryOptions = {},
): UseTelemetryResult {
  const {
    endpoint = "/api/traits/status",
    pollIntervalMs = 20_000,
    connectingIntervalMs = 2_000,
    enabled = true,
  } = options;

  const [status, setStatus] = useState<TelemetryStatus>("disconnected");
  const [model, setModel] = useState<string | undefined>(undefined);
  const [layerInfo, setLayerInfo] = useState<string | undefined>(undefined);
  const [vectorSet, setVectorSet] = useState<string | undefined>(undefined);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Latest status without re-triggering the polling effect.
  const statusRef = useRef<TelemetryStatus>(status);
  statusRef.current = status;

  const retry = useCallback(() => {
    setError(null);
    setStatus("connecting");
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const schedule = () => {
      if (cancelled) return;
      const base =
        statusRef.current === "connecting" ? connectingIntervalMs : pollIntervalMs;
      if (!base || base <= 0) return;
      timer = setTimeout(poll, base);
    };

    const poll = async () => {
      if (cancelled) return;
      const startedAt = performance.now();
      try {
        const res = await fetch(endpoint, {
          method: "GET",
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (cancelled) return;

        const rtt = Math.round(performance.now() - startedAt);
        setLastCheckedAt(Date.now());

        // No evaluator wired up yet → dormant, by design. Not an error.
        if (res.status === 404 || res.status === 501) {
          setStatus("disconnected");
          setError(null);
          setLatencyMs(null);
          schedule();
          return;
        }

        if (!res.ok) {
          setStatus("error");
          setError(reasonFor(res));
          setLatencyMs(null);
          schedule();
          return;
        }

        const raw: unknown = await res.json().catch(() => null);
        if (cancelled) return;

        const body = (raw ?? {}) as Partial<TelemetryStatusPayload>;
        const next = isTelemetryStatus(body.status) ? body.status : "disconnected";

        setStatus(next);
        setModel(typeof body.model === "string" ? body.model : undefined);
        setLayerInfo(
          typeof body.layerInfo === "string" ? body.layerInfo : undefined,
        );
        setVectorSet(
          typeof body.vectorSet === "string" ? body.vectorSet : undefined,
        );
        setLatencyMs(next === "live" ? rtt : null);
        setError(
          next === "error" && typeof body.detail === "string"
            ? body.detail
            : null,
        );
        schedule();
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLastCheckedAt(Date.now());
        setLatencyMs(null);
        // Unreachable host: the substrate simply is not there. Stay dormant on
        // the very first attempt so a cold load never opens on red.
        if (statusRef.current === "connecting") {
          setStatus("error");
          setError("evaluator unreachable");
        } else {
          setStatus("disconnected");
          setError(null);
        }
        schedule();
      }
    };

    void poll();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [endpoint, pollIntervalMs, connectingIntervalMs, enabled, nonce]);

  return {
    status,
    model,
    layerInfo,
    vectorSet,
    latencyMs,
    lastCheckedAt,
    error,
    retry,
  };
}

export default useTelemetry;
