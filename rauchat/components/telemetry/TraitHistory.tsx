"use client";

/**
 * TraitHistory — Telemetry section C, per-turn history (DESIGN.md §6.3).
 *
 * Eight stacked 18px rows: [abbr 34px][sparkline 1fr][value 34px], showing the
 * last 24 turns. Hovering anywhere in the section drops a single 1px crosshair
 * across ALL eight rows at the hovered turn and swaps every row's value to that
 * turn's reading — the synchronised crosshair is the section's reason to exist.
 *
 * Missing turns break the polyline (never interpolated) and are marked with a
 * 1px × 3px tick on the centreline.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { TRAIT_AXES, type TraitId, type TraitSnapshot } from "@/lib/types";
import s from "./telemetry.module.css";

export type TraitHistoryProps = {
  /** Chronological snapshots; only the last `window` turns are drawn. */
  snapshots: TraitSnapshot[];
  /** Dormant treatment: centrelines only, em-dash values (§6.5). */
  dormant?: boolean;
  /** Click a turn → scroll the transcript to it. */
  onSelectTurn?: (turnIndex: number) => void;
  /** Turns shown. Default 24. */
  window?: number;
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

const ABBR: Record<TraitId, string> = {
  factual: "FCT",
  serious: "SER",
  casual: "CAS",
  creative: "CRE",
  honest: "HON",
  confident: "CNF",
  empathetic: "EMP",
  calm: "CLM",
};

const PLOT_H = 14;
const MID_Y = PLOT_H / 2;
const AMPLITUDE = 6; // ±1 maps to ±6px around the centreline
/** 34px abbr + 6px gap + 6px gap + 34px value = the non-plot width. */
const SIDE_W = 80;
const MINUS = "−";

type Slot = {
  turnIndex: number;
  timestamp: number | null;
  values: Partial<Record<TraitId, number>>;
  present: boolean;
};

function formatScore(v: number): string {
  const r = Math.round(v * 100) / 100;
  return `${r < 0 ? MINUS : "+"}${Math.abs(r).toFixed(2)}`;
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Observes the section width so the plot can be laid out in real pixels
 *  (no viewBox stretch — a non-uniform scale would deform the head dot). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width] as const;
}

export function TraitHistory({
  snapshots,
  dormant = false,
  onSelectTurn,
  window: windowSize = 24,
}: TraitHistoryProps) {
  const [surfaceRef, surfaceWidth] = useWidth<HTMLDivElement>();
  const [hovered, setHovered] = useState<number | null>(null);
  const [stacked, setStacked] = useState(false);

  const plotWidth = Math.max(0, surfaceWidth - SIDE_W);

  const slots: Slot[] = useMemo(() => {
    if (dormant || snapshots.length === 0) return [];
    const byTurn = new Map<number, TraitSnapshot>();
    let latest = -Infinity;
    for (const snap of snapshots) {
      byTurn.set(snap.turnIndex, snap);
      if (snap.turnIndex > latest) latest = snap.turnIndex;
    }
    const first = latest - windowSize + 1;
    const out: Slot[] = [];
    for (let t = first; t <= latest; t++) {
      const snap = byTurn.get(t);
      if (!snap) {
        out.push({ turnIndex: t, timestamp: null, values: {}, present: false });
        continue;
      }
      const values: Partial<Record<TraitId, number>> = {};
      for (const r of snap.readings) values[r.traitId] = r.score;
      out.push({
        turnIndex: t,
        timestamp: snap.timestamp,
        values,
        present: true,
      });
    }
    return out;
  }, [snapshots, dormant, windowSize]);

  const firstPresent = useMemo(
    () => slots.findIndex((slot) => slot.present),
    [slots],
  );

  const xFor = useCallback(
    (i: number) => {
      if (plotWidth <= 0) return 0;
      if (windowSize <= 1) return plotWidth / 2;
      const x = (i / (windowSize - 1)) * plotWidth;
      return Math.min(plotWidth - 0.5, Math.max(0.5, x));
    },
    [plotWidth, windowSize],
  );

  const slotFromClientX = useCallback(
    (clientX: number, el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left - 40; // abbr column + gap
      if (plotWidth <= 0) return null;
      const ratio = Math.min(1, Math.max(0, x / plotWidth));
      return Math.round(ratio * (windowSize - 1));
    },
    [plotWidth, windowSize],
  );

  const handleMove = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (slots.length === 0) return;
      const i = slotFromClientX(e.clientX, e.currentTarget);
      setHovered(i);
    },
    [slots.length, slotFromClientX],
  );

  const handleClick = useCallback(() => {
    if (hovered === null || !onSelectTurn) return;
    const slot = slots[hovered];
    if (slot?.present) onSelectTurn(slot.turnIndex);
  }, [hovered, onSelectTurn, slots]);

  const latestSlotIndex = useMemo(() => {
    for (let i = slots.length - 1; i >= 0; i--) if (slots[i].present) return i;
    return -1;
  }, [slots]);

  const activeIndex = hovered ?? latestSlotIndex;
  const activeSlot = activeIndex >= 0 ? slots[activeIndex] : undefined;

  // §6.6 step 4 — the sparklines draw once, on the turn the first data lands.
  const drawnRef = useRef(false);
  const [drawing, setDrawing] = useState(false);
  useEffect(() => {
    if (drawnRef.current || slots.length === 0 || plotWidth <= 0) return;
    drawnRef.current = true;
    setDrawing(true);
    const id = setTimeout(() => setDrawing(false), 240);
    return () => clearTimeout(id);
  }, [slots.length, plotWidth]);

  const caption = (() => {
    if (dormant) return "Substrate dormant — no turn history.";
    if (slots.length === 0) return "Awaiting first turn.";
    if (!activeSlot || !activeSlot.present) return `turn ${activeSlot?.turnIndex ?? "—"} · no reading`;
    return `turn ${activeSlot.turnIndex} · ${
      activeSlot.timestamp ? formatClock(activeSlot.timestamp) : "—"
    }`;
  })();

  const crosshairX =
    hovered !== null && plotWidth > 0 ? 40 + xFor(hovered) : null;

  return (
    <section aria-label="Trait history by turn">
      <div className={s.sectionLabelRow}>
        <h3 className={s.sectionLabel}>Turn history</h3>
        <button
          type="button"
          className={`${s.ghostLink} ${stacked ? s.ghostLinkOn : ""}`}
          onClick={() => setStacked((v) => !v)}
          aria-pressed={stacked}
        >
          {stacked ? "sparklines" : "stacked"}
        </button>
      </div>

      <p className={s.histCaption}>{caption}</p>

      <div
        ref={surfaceRef}
        className={`${s.histSurface} ${s.histRows}`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHovered(null)}
        onClick={handleClick}
      >
        {TRAIT_ORDER.map((traitId) => {
          const axis = TRAIT_AXES[traitId];
          const value =
            activeSlot && activeSlot.present
              ? activeSlot.values[traitId]
              : undefined;

          return (
            <div className={s.histRow} key={traitId}>
              <span className={s.histAbbr}>{ABBR[traitId]}</span>

              <div className={s.histPlot}>
                {stacked ? (
                  <StackedRow slots={slots} traitId={traitId} count={windowSize} />
                ) : (
                  <Sparkline
                    slots={slots}
                    traitId={traitId}
                    width={plotWidth}
                    xFor={xFor}
                    firstPresent={firstPresent}
                    drawing={drawing}
                  />
                )}
              </div>

              <span
                className={`${s.histValue} ${
                  value === undefined ? s.histValueDormant : ""
                }`}
              >
                {value === undefined ? "—" : formatScore(value)}
              </span>

              <span className={s.srOnly}>
                {axis.positivePole} versus {axis.negativePole}:{" "}
                {value === undefined ? "no reading" : formatScore(value)}
              </span>
            </div>
          );
        })}

        {crosshairX !== null ? (
          <span
            className={s.crosshair}
            style={{ left: `${crosshairX}px` }}
            aria-hidden
          />
        ) : null}
      </div>
    </section>
  );
}

function Sparkline({
  slots,
  traitId,
  width,
  xFor,
  firstPresent,
  drawing,
}: {
  slots: Slot[];
  traitId: TraitId;
  width: number;
  xFor: (i: number) => number;
  firstPresent: number;
  drawing: boolean;
}) {
  const segments: string[] = [];
  const gapTicks: number[] = [];
  let current: string[] = [];
  let headX: number | null = null;
  let headY: number | null = null;

  slots.forEach((slot, i) => {
    const v = slot.present ? slot.values[traitId] : undefined;
    if (v === undefined) {
      if (current.length) {
        segments.push(current.join(" "));
        current = [];
      }
      if (firstPresent >= 0 && i > firstPresent) gapTicks.push(xFor(i));
      return;
    }
    const x = xFor(i);
    const y = MID_Y - Math.max(-1, Math.min(1, v)) * AMPLITUDE;
    current.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    headX = x;
    headY = y;
  });
  if (current.length) segments.push(current.join(" "));

  return (
    <svg
      className={s.histSvg}
      width={width || undefined}
      height={PLOT_H}
      aria-hidden
      focusable={false}
    >
      <line
        className={s.sparkCenterline}
        x1={0}
        y1={MID_Y + 0.5}
        x2={width}
        y2={MID_Y + 0.5}
        shapeRendering="crispEdges"
      />

      {gapTicks.map((x, i) => (
        <line
          key={`g${i}`}
          className={s.sparkGapTick}
          x1={x}
          y1={MID_Y - 1}
          x2={x}
          y2={MID_Y + 2}
          shapeRendering="crispEdges"
        />
      ))}

      {segments.map((pts, i) => (
        <polyline
          key={`s${i}`}
          className={`${s.spark} ${drawing ? s.sparkDraw : ""}`}
          points={pts}
          pathLength={1}
          strokeDasharray={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {headX !== null && headY !== null ? (
        <circle className={s.sparkHead} cx={headX} cy={headY} r={2.5} />
      ) : null}
    </svg>
  );
}

function StackedRow({
  slots,
  traitId,
  count,
}: {
  slots: Slot[];
  traitId: TraitId;
  count: number;
}) {
  const cells = Array.from({ length: count }, (_, i) => slots[i]);
  return (
    <div
      className={s.stackRow}
      style={{ "--tel-cells": String(count) } as CSSProperties}
    >
      {cells.map((slot, i) => {
        const v = slot?.present ? slot.values[traitId] : undefined;
        if (v === undefined) {
          return <span className={s.stackCell} key={i} />;
        }
        const mag = Math.min(1, Math.abs(v));
        return (
          <span
            className={s.stackCell}
            key={i}
            style={{
              background: v >= 0 ? "var(--rau-tel-pos)" : "var(--rau-tel-neg)",
              opacity: 0.25 + 0.75 * mag,
            }}
          />
        );
      })}
    </div>
  );
}

export default TraitHistory;
