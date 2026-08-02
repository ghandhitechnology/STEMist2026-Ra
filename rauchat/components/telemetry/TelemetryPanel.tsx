"use client";

/**
 * TelemetryPanel — the right column (DESIGN.md §3.6, §6).
 *
 * Sections, in order: A Connection → B Axes → C Turn history → D Substrate
 * (pinned footer). The default state is dormant: the Gemma 4 12B evaluator is
 * a remote overlay whose weights are not resident, and the panel renders that
 * as a powered-down instrument — full scaffolding, em-dash values, no spinner,
 * no skeleton, no error colour (§1.7, §6.5).
 *
 * Snapshots are produced by the chat stream and passed in by the page; this
 * component only derives per-axis state (latest reading, delta, staleness).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  TRAIT_AXES,
  type TelemetryStatus,
  type TraitId,
  type TraitSnapshot,
} from "@/lib/types";
import { ConnectionCard } from "./ConnectionCard";
import { TraitAxis } from "./TraitAxis";
import { TraitRadar } from "./TraitRadar";
import { TraitHistory } from "./TraitHistory";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PolygonIcon,
  RowsIcon,
} from "./icons";
import s from "./telemetry.module.css";

export type TelemetryPanelProps = {
  /** Transport state from `useTelemetry`. */
  status: TelemetryStatus;
  /** Per-turn trait readings, chronological. */
  snapshots: TraitSnapshot[];
  /** Collapsed → the 44px vertical rail (§6.7). */
  collapsed: boolean;
  onToggle: () => void;
  /** Evaluator metadata, when reported. */
  model?: string;
  layerInfo?: string;
  vectorSet?: string;
  latencyMs?: number | null;
  error?: string | null;
  /** Quiet reconnect action shown in the connection block. */
  onRetry?: () => void;
  /** Click a turn in the history → scroll the transcript to it. */
  onSelectTurn?: (turnIndex: number) => void;
};

const TRAIT_ORDER: TraitId[] = [
  "factual",
  "serious",
  "casual",
  "creative",
  "honest",
  "confident",
  "empathetic",
  "calm",
];

/** Three axes summarised by the hexagon radar (bars keep all eight). */
const RADAR_TRAITS: TraitId[] = ["factual", "honest", "calm"];

type AxisState = {
  score: number | null;
  confidence: number;
  delta: number | null;
  stale: boolean;
};

const EMPTY_AXIS: AxisState = {
  score: null,
  confidence: 1,
  delta: null,
  stale: false,
};

/** Which reading of section B is on screen (§6.2). Persisted per browser. */
type AxisView = "bars" | "radar";
const AXIS_VIEW_KEY = "rauchat:telemetry-axis-view";

export function TelemetryPanel({
  status,
  snapshots,
  collapsed,
  onToggle,
  model,
  layerInfo,
  vectorSet,
  latencyMs,
  error,
  onRetry,
  onSelectTurn,
}: TelemetryPanelProps) {
  const hasData = snapshots.length > 0;
  const dormant = !hasData && status !== "live";

  const { axes, latestTurn, reportingAxes } = useMemo(
    () => deriveAxes(snapshots, status),
    [snapshots, status],
  );

  const [axisView, setAxisView] = useState<AxisView>("bars");
  useEffect(() => {
    const stored = window.localStorage.getItem(AXIS_VIEW_KEY);
    if (stored === "bars" || stored === "radar") setAxisView(stored);
  }, []);
  const selectAxisView = (next: AxisView) => {
    setAxisView(next);
    try {
      window.localStorage.setItem(AXIS_VIEW_KEY, next);
    } catch {
      // Private-mode storage failures are not worth surfacing.
    }
  };

  const radarData = useMemo(
    () =>
      RADAR_TRAITS.map((traitId) => ({
        traitId,
        score: axes[traitId].score,
        stale: axes[traitId].stale,
      })),
    [axes],
  );

  // §6.6 — on the first turn that lands, stubs expand staggered by row index.
  const revealedRef = useRef(false);
  const [revealing, setRevealing] = useState(false);
  useEffect(() => {
    if (revealedRef.current || !hasData) return;
    revealedRef.current = true;
    setRevealing(true);
    const id = setTimeout(() => setRevealing(false), 420);
    return () => clearTimeout(id);
  }, [hasData]);

  if (collapsed) {
    return (
      <TelemetryRail
        status={status}
        axes={axes}
        reportingAxes={reportingAxes}
        onToggle={onToggle}
      />
    );
  }

  return (
    <aside
      className={s.panel}
      role="complementary"
      aria-label="Model telemetry"
    >
      <header className={s.header}>
        <h2 className={s.headerTitle}>Model telemetry</h2>
        <span className={s.headerStatus}>
          <span
            className={`${s.dot} ${dotClassFor(status, reportingAxes)}`}
            aria-hidden
          />
          <span className={s.headerStatusLabel}>
            {headerStatusLabel(status, reportingAxes)}
          </span>
        </span>
        <button
          type="button"
          className={s.iconBtn}
          onClick={onToggle}
          aria-label="Collapse telemetry panel"
          aria-expanded
          title="Collapse telemetry panel"
        >
          <ChevronRightIcon size={16} />
        </button>
      </header>

      <div className={s.body}>
        <section className={s.section} aria-label="Evaluator connection">
          <div className={s.sectionLabelRow}>
            <h3 className={s.sectionLabel}>Connection</h3>
          </div>
          <ConnectionCard
            status={status}
            model={model}
            layerInfo={layerInfo}
            vectorSet={vectorSet}
            latencyMs={latencyMs}
            turnCount={latestTurn >= 0 ? latestTurn + 1 : 0}
            reportingAxes={hasData ? reportingAxes : null}
            error={error}
            onRetry={onRetry}
          />
        </section>

        <section className={s.section} aria-label="Trait axes">
          <div className={s.sectionLabelRow}>
            <h3 className={s.sectionLabel}>Trait axes</h3>
            <AxisViewSwitch view={axisView} onSelect={selectAxisView} />
          </div>

          {status === "live" && hasData && reportingAxes < TRAIT_ORDER.length ? (
            <p className={s.degradedStrip}>
              {reportingAxes}/{TRAIT_ORDER.length} axes reporting
            </p>
          ) : null}

          {axisView === "radar" ? (
            <TraitRadar data={radarData} dormant={dormant} />
          ) : (
            <div className={s.axisList}>
              {TRAIT_ORDER.map((traitId, i) => {
                const a = axes[traitId];
                return (
                  <TraitAxis
                    key={traitId}
                    traitId={traitId}
                    score={a.score}
                    confidence={a.confidence}
                    delta={a.delta}
                    stale={a.stale}
                    dormant={dormant}
                    revealDelayMs={revealing ? i * 24 : 0}
                  />
                );
              })}
            </div>
          )}
        </section>

        <section className={s.section}>
          <TraitHistory
            snapshots={snapshots}
            dormant={dormant}
            onSelectTurn={onSelectTurn}
          />
        </section>
      </div>

      <div className={`${s.section} ${s.sectionLast} ${s.footer}`}>
        <div className={s.sectionLabelRow}>
          <h3 className={s.sectionLabel}>Substrate</h3>
        </div>
        <SubstrateSlot layerInfo={layerInfo} vectorSet={vectorSet} />
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* B — axis view switch (§6.2)                                          */
/* ------------------------------------------------------------------ */

const AXIS_VIEWS: Array<{
  id: AxisView;
  label: string;
  Icon: typeof RowsIcon;
}> = [
  { id: "bars", label: "Bars", Icon: RowsIcon },
  { id: "radar", label: "Radar", Icon: PolygonIcon },
];

/**
 * A single quiet affordance that expands in place into the two readings —
 * closed it is just the current mode's glyph, so the label row stays calm.
 */
function AxisViewSwitch({
  view,
  onSelect,
}: {
  view: AxisView;
  onSelect: (next: AxisView) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = AXIS_VIEWS.find((v) => v.id === view) ?? AXIS_VIEWS[0];

  if (!open) {
    return (
      <button
        type="button"
        className={s.viewSwitchTrigger}
        onClick={() => setOpen(true)}
        aria-expanded={false}
        aria-label={`Axis view: ${current.label}. Change view`}
        title={`Axis view: ${current.label}`}
      >
        <current.Icon size={12} />
      </button>
    );
  }

  return (
    <div
      className={s.viewSwitch}
      role="group"
      aria-label="Axis view"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      {AXIS_VIEWS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          autoFocus={id === view}
          className={`${s.viewSwitchOption} ${id === view ? s.viewSwitchOptionOn : ""}`}
          onClick={() => {
            onSelect(id);
            setOpen(false);
          }}
          aria-pressed={id === view}
        >
          <Icon size={12} />
          {label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* D — reserved substrate slot (§6.4)                                   */
/* ------------------------------------------------------------------ */

function SubstrateSlot({
  layerInfo,
  vectorSet,
}: {
  layerInfo?: string;
  vectorSet?: string;
}) {
  const rows: Array<[string, string | undefined]> = [
    ["layer range", layerInfo],
    ["projection rank", undefined],
    ["steering α", undefined],
    ["vector build", vectorSet],
  ];
  const populated = rows.some(([, v]) => Boolean(v));

  return (
    <div className={`${s.substrate} ${populated ? s.substrateLive : ""}`}>
      <dl>
        {rows.map(([label, value]) => (
          <div className={s.metaRow} key={label}>
            <dt className={s.metaKey}>{label}</dt>
            <dd
              className={`${s.metaVal} ${value ? "" : s.metaValPending}`}
              title={value ?? undefined}
            >
              {value ?? "—"}
            </dd>
          </div>
        ))}
      </dl>
      <p className={s.substrateNote}>
        Reserved — populated when the evaluator reports layer metadata.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Collapsed rail (§6.7)                                                */
/* ------------------------------------------------------------------ */

function TelemetryRail({
  status,
  axes,
  reportingAxes,
  onToggle,
}: {
  status: TelemetryStatus;
  axes: Record<TraitId, AxisState>;
  reportingAxes: number;
  onToggle: () => void;
}) {
  return (
    <aside
      className={s.rail}
      role="complementary"
      aria-label="Model telemetry, collapsed"
      onClick={onToggle}
    >
      <div className={s.railHeader}>
        <button
          type="button"
          className={s.iconBtn}
          onClick={(e) => {
            // The whole rail is clickable; don't let the button toggle twice.
            e.stopPropagation();
            onToggle();
          }}
          aria-label="Expand telemetry panel"
          title="Expand telemetry panel"
        >
          <ChevronLeftIcon size={16} />
        </button>
      </div>

      <div className={s.railDotSlot}>
        <span
          className={`${s.dot} ${dotClassFor(status, reportingAxes)}`}
          aria-hidden
        />
      </div>

      <div className={s.railBars}>
        {TRAIT_ORDER.map((traitId) => {
          const a = axes[traitId];
          const axis = TRAIT_AXES[traitId];
          const v = a.score;
          const label =
            v === null
              ? `${axis.positivePole} / ${axis.negativePole} — unmeasured`
              : `${axis.positivePole} / ${axis.negativePole}  ${
                  v < 0 ? "−" : "+"
                }${Math.abs(v).toFixed(2)}`;
          const pos = v !== null && v > 0 ? Math.min(1, v) : 0;
          const neg = v !== null && v < 0 ? Math.min(1, -v) : 0;

          return (
            <span className={s.railBar} key={traitId} title={label}>
              <span className={s.railTick} aria-hidden />
              {v === null ? <span className={s.railStub} aria-hidden /> : null}
              <span
                className={`${s.railFill} ${s.railFillPos}`}
                style={{ transform: `scaleY(${pos.toFixed(4)})` }}
                aria-hidden
              />
              <span
                className={`${s.railFill} ${s.railFillNeg}`}
                style={{ transform: `scaleY(${neg.toFixed(4)})` }}
                aria-hidden
              />
            </span>
          );
        })}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* derivation                                                           */
/* ------------------------------------------------------------------ */

function deriveAxes(
  snapshots: TraitSnapshot[],
  status: TelemetryStatus,
): {
  axes: Record<TraitId, AxisState>;
  latestTurn: number;
  reportingAxes: number;
} {
  const axes = {} as Record<TraitId, AxisState>;
  const live = status === "live";

  if (snapshots.length === 0) {
    for (const id of TRAIT_ORDER) {
      // Live with zero turns: axes sit at exactly 0.00 (§8), not dormant.
      axes[id] = live ? { ...EMPTY_AXIS, score: 0 } : EMPTY_AXIS;
    }
    return { axes, latestTurn: -1, reportingAxes: live ? TRAIT_ORDER.length : 0 };
  }

  const ordered = [...snapshots].sort((a, b) => a.turnIndex - b.turnIndex);
  const latestTurn = ordered[ordered.length - 1].turnIndex;

  let reportingAxes = 0;
  for (const id of TRAIT_ORDER) {
    // Walk backwards for the two most recent readings of this axis.
    let last: { score: number; confidence: number; turn: number } | null = null;
    let prev: number | null = null;

    for (let i = ordered.length - 1; i >= 0; i--) {
      const snap = ordered[i];
      const r = snap.readings.find((x) => x.traitId === id);
      if (!r) continue;
      if (!last) {
        last = { score: r.score, confidence: r.confidence, turn: snap.turnIndex };
        continue;
      }
      prev = r.score;
      break;
    }

    if (!last) {
      axes[id] = EMPTY_AXIS;
      continue;
    }

    if (last.turn === latestTurn) reportingAxes += 1;

    axes[id] = {
      score: clampScore(last.score),
      confidence: clamp01(last.confidence),
      delta: prev === null ? null : clampScore(last.score) - clampScore(prev),
      stale: latestTurn - last.turn >= 2,
    };
  }

  return { axes, latestTurn, reportingAxes };
}

function dotClassFor(status: TelemetryStatus, reportingAxes: number): string {
  if (status === "connecting") return s.dotConnecting;
  if (status === "error") return s.dotError;
  if (status === "live") {
    return reportingAxes > 0 && reportingAxes < TRAIT_ORDER.length
      ? s.dotDegraded
      : s.dotLive;
  }
  return s.dotDormant;
}

function headerStatusLabel(
  status: TelemetryStatus,
  reportingAxes: number,
): string {
  if (status === "connecting") return "connecting";
  if (status === "error") return "disconnected";
  if (status === "live") {
    return reportingAxes > 0 && reportingAxes < TRAIT_ORDER.length
      ? "degraded"
      : "live";
  }
  return "dormant";
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}

function clampScore(n: number): number {
  return Math.min(1, Math.max(-1, Number.isFinite(n) ? n : 0));
}

export default TelemetryPanel;
