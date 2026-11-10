"use client";

/**
 * ConnectionCard — Telemetry section A (DESIGN.md §6.1, §6.5).
 *
 * The DEFAULT state is `disconnected`: the Gemma 4 12B evaluator weights are
 * not resident. That state is *designed*, not broken — a powered-down
 * instrument. No spinner, no skeleton, no red, and never the word "error".
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { TelemetryStatus } from "@/lib/types";
import { RetryIcon } from "./icons";
import s from "./telemetry.module.css";

/** Visual state, which is richer than the transport-level TelemetryStatus. */
type ConnectionView = "dormant" | "connecting" | "live" | "degraded" | "error";

export type ConnectionCardProps = {
  status: TelemetryStatus;
  /** Model id reported by the evaluator, e.g. `gemma-4-12b`. */
  model?: string;
  /** Layer window / projection description reported by the evaluator. */
  layerInfo?: string;
  /** Trait-vector build identifier, when the evaluator reports one. */
  vectorSet?: string;
  /** Round-trip latency of the last poll, ms. */
  latencyMs?: number | null;
  /** Number of turns evaluated so far. */
  turnCount?: number;
  /** Axes reporting on the latest turn (0–8). < 8 while live → degraded. */
  reportingAxes?: number | null;
  /** Short reason shown on the detail line when status is `error`. */
  error?: string | null;
  /** Env var the deployment reads the endpoint from. */
  endpointVar?: string;
  /** Quiet reconnect action. */
  onRetry?: () => void;
};

const AXIS_COUNT = 8;
const DEFAULT_MODEL = "Gemma 4 12B · trait projection";

function viewFor(
  status: TelemetryStatus,
  reportingAxes: number | null | undefined,
): ConnectionView {
  if (status === "live") {
    if (typeof reportingAxes === "number" && reportingAxes < AXIS_COUNT) {
      return "degraded";
    }
    return "live";
  }
  if (status === "connecting") return "connecting";
  if (status === "error") return "error";
  return "dormant";
}

/** Seconds since the handshake began; only ticks while connecting. */
function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  const startedAt = useRef<number>(0);

  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    startedAt.current = Date.now();
    setSeconds(0);
    const id = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  return seconds;
}

export function ConnectionCard({
  status,
  model,
  layerInfo,
  vectorSet,
  latencyMs,
  turnCount = 0,
  reportingAxes,
  error,
  endpointVar = "GEMMA_ENDPOINT_URL",
  onRetry,
}: ConnectionCardProps) {
  const view = viewFor(status, reportingAxes);
  const elapsed = useElapsedSeconds(view === "connecting");

  const { label, detail } = useMemo(() => {
    switch (view) {
      case "connecting":
        return { label: "Connecting", detail: `handshake · ${elapsed}s` };
      case "live":
        return {
          label: "Live",
          detail: `${model ?? "gemma-4-12b"} · ${latencyMs ?? "—"} ms · turn ${turnCount}`,
        };
      case "degraded":
        return {
          label: "Degraded",
          detail: `partial axes · ${reportingAxes ?? 0}/${AXIS_COUNT} reporting`,
        };
      case "error":
        return {
          label: "Disconnected",
          detail: error ?? "remote refused",
        };
      default:
        return {
          label: "Awaiting substrate",
          detail: "gemma-4-12b · weights not loaded",
        };
    }
  }, [view, elapsed, model, latencyMs, turnCount, reportingAxes, error]);

  const dotClass =
    view === "connecting"
      ? s.dotConnecting
      : view === "live"
        ? s.dotLive
        : view === "degraded"
          ? s.dotDegraded
          : view === "error"
            ? s.dotError
            : s.dotDormant;

  const dormantish = view === "dormant" || view === "error";

  return (
    <div>
      <div
        className={`${s.connBlock} ${view === "error" ? s.connBlockError : ""}`}
        role="status"
        aria-live="polite"
      >
        <span className={`${s.dot} ${dotClass}`} aria-hidden />

        <span className={s.connText}>
          <span className={s.connLabel}>{label}</span>
          <span className={s.connDetail} title={detail}>
            {detail}
          </span>
        </span>

        {/* Dormant deliberately carries no in-block action: the full-width
            "Load evaluator" button below is the single affordance (§6.5), and
            giving the detail line the whole block keeps it from truncating. */}

        {view === "error" && onRetry ? (
          <button
            type="button"
            className={`${s.ghostBtn} ${s.ghostBtnDanger}`}
            onClick={onRetry}
          >
            Retry
          </button>
        ) : null}

        {(view === "live" || view === "degraded") && onRetry ? (
          <button
            type="button"
            className={`${s.iconBtn} ${s.iconBtnSm}`}
            onClick={onRetry}
            aria-label="Re-poll the evaluator"
            title="Re-poll the evaluator"
          >
            <RetryIcon size={14} />
          </button>
        ) : null}

        {view === "connecting" ? (
          <span className={s.connSweepTrack} aria-hidden>
            <span className={s.connSweepRunner}>
              <span className={s.connSweepSeg} />
            </span>
          </span>
        ) : null}
      </div>

      <dl className={s.metaList}>
        <MetaRow
          label="endpoint"
          value={endpointVar}
          pending={dormantish}
          hint={`Read from process.env.${endpointVar}`}
        />
        <MetaRow
          label="model"
          value={model ? `${model} · trait projection` : DEFAULT_MODEL}
          pending={dormantish}
        />
        <MetaRow
          label="layer window"
          value={layerInfo ?? "pending"}
          pending={!layerInfo}
        />
        <MetaRow
          label="vector set"
          value={vectorSet ?? "pending"}
          pending={!vectorSet}
        />
      </dl>

      {view === "dormant" ? (
        <div className={s.connActions}>
          <button type="button" className={s.secondaryBtn} onClick={onRetry}>
            Load evaluator
          </button>
          <p className={s.connCaption}>Gemma 4 12B · remote · not resident</p>
        </div>
      ) : null}
    </div>
  );
}

function MetaRow({
  label,
  value,
  pending,
  hint,
}: {
  label: string;
  value: string;
  pending?: boolean;
  hint?: string;
}) {
  return (
    <div className={s.metaRow}>
      <dt className={s.metaKey}>{label}</dt>
      <dd
        className={`${s.metaVal} ${pending ? s.metaValPending : ""}`}
        title={hint ?? value}
      >
        {value}
      </dd>
    </div>
  );
}

export default ConnectionCard;
