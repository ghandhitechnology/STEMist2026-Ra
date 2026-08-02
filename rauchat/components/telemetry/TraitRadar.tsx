"use client";

/**
 * TraitRadar — a focused three-axis reading of the trait panel (DESIGN.md §6.2).
 *
 * Bars keep all eight axes; this view summarises three bipolar pairs
 * (factual↔hallucinatory, honest↔sycophantic, calm↔anxious) as ONE closed
 * hexagon. Each axis contributes two vertices placed exactly opposite each
 * other, so the polygon leans toward whichever poles are reading strongly.
 * Positive poles occupy the top half; their opposites hang below.
 *
 * The whole shape washes from dark red to dark green with the combined
 * reading (washed-out, ~half transparent). Direction is never carried by
 * hue alone: every vertex is labelled, and the caption prints a signed
 * value for the hovered or strongest pole.
 *
 * The shape is never still: vertices ease toward their targets and carry a
 * small per-vertex drift. Geometry is written straight to the SVG nodes
 * from one rAF loop — React never re-renders per frame. Prefer-reduced-
 * motion freezes it to a static hexagon.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { TRAIT_AXES, type TraitId } from "@/lib/types";
import s from "./telemetry.module.css";

export type TraitRadarDatum = {
  traitId: TraitId;
  /** −1..1, or null when the axis has no reading. */
  score: number | null;
  /** No update for ≥ 2 turns — both of the axis's vertices dim. */
  stale: boolean;
};

export type TraitRadarProps = {
  /** Three axes in display order; each contributes two opposing vertices. */
  data: TraitRadarDatum[];
  /** Panel-wide dormant treatment. */
  dormant?: boolean;
};

const SIZE = 120;
const CENTER = SIZE / 2;
/** Padding around the figure so corner labels sit outside the ring. */
const PAD = 18;
/** Outer ring radius, in viewBox units. */
const R = 40;
/** How far past the outer ring each corner label sits. */
const LABEL_OUT = 9;
/** Vertical squash — the figure reads as a flattened hexagon, not a circle. */
const FLATTEN = 0.9;
/**
 * A zeroed axis parks both of its poles on the neutral ring; a reading pushes
 * one pole out and pulls its opposite in by the same amount. The polygon
 * therefore always closes as a full hexagon that leans, rather than a star
 * that collapses toward the centre.
 */
const NEUTRAL = 0.62;
const SWING = 0.38;
/** Ambient per-vertex wander, in radius fraction. */
const DRIFT = 0.03;
const RINGS = [NEUTRAL - SWING, NEUTRAL, 1];

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function formatScore(v: number): string {
  const rounded = Math.round(v * 100) / 100;
  return `${rounded < 0 ? "−" : "+"}${Math.abs(rounded).toFixed(2)}`;
}

/**
 * Average of the measured scores, −1..1. Null-only / dormant → 0 (mid grey).
 * Positive lean → green; negative lean → red.
 */
function combinedLean(
  data: TraitRadarDatum[],
  dormant: boolean,
): number {
  if (dormant) return 0;
  let sum = 0;
  let n = 0;
  for (const d of data) {
    if (d.score === null) continue;
    sum += Math.min(1, Math.max(-1, d.score));
    n += 1;
  }
  return n === 0 ? 0 : sum / n;
}

function radarColor(t: number): string {
  const target = t >= 0 ? "--rau-tel-radar-pos" : "--rau-tel-radar-neg";
  const pct = Math.round(Math.abs(t) * 100);
  return `color-mix(in oklab, var(${target}) ${pct}%, var(--rau-tel-radar-mid))`;
}

/** Anchor a corner label so it reads outside its vertex. */
function labelAnchor(ux: number, uy: number): {
  textAnchor: "start" | "middle" | "end";
  dy: string;
} {
  const textAnchor =
    Math.abs(ux) < 0.28 ? "middle" : ux > 0 ? "start" : "end";
  const dy =
    Math.abs(uy) < 0.28 ? "0.35em" : uy > 0 ? "0.95em" : "-0.2em";
  return { textAnchor, dy };
}

export function TraitRadar({ data, dormant = false }: TraitRadarProps) {
  const axisCount = data.length;
  const spokeCount = axisCount * 2;

  const [hovered, setHovered] = useState<number | null>(null);

  const shapeRef = useRef<SVGPolygonElement>(null);
  const dotsRef = useRef<(SVGCircleElement | null)[]>([]);
  const hitsRef = useRef<(SVGCircleElement | null)[]>([]);

  /**
   * Unit vectors per spoke — spoke k and k+axisCount are 180° apart.
   * Offset so positive poles fan across the top half.
   */
  const unit = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    const offset = (axisCount - 1) / 2;
    for (let k = 0; k < spokeCount; k += 1) {
      const a =
        ((-90 + (360 / spokeCount) * (k - offset)) * Math.PI) / 180;
      out.push({ x: Math.cos(a), y: Math.sin(a) * FLATTEN });
    }
    return out;
  }, [axisCount, spokeCount]);

  /** Where each vertex wants to sit, 0..1 of the outer ring. */
  const targets = useMemo(() => {
    const out: number[] = [];
    for (let k = 0; k < spokeCount; k += 1) {
      const datum = data[k % axisCount];
      const score = dormant ? null : (datum?.score ?? null);
      if (score === null) {
        out.push(NEUTRAL);
        continue;
      }
      const lean = Math.min(1, Math.max(-1, score)) * (k < axisCount ? 1 : -1);
      out.push(NEUTRAL + SWING * lean);
    }
    return out;
  }, [axisCount, data, dormant, spokeCount]);

  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const currentRef = useRef<number[]>(targets.slice());
  if (currentRef.current.length !== targets.length) {
    currentRef.current = targets.slice();
  }

  const paint = useCallback(
    (elapsedMs: number, still: boolean) => {
      const current = currentRef.current;
      const points: string[] = [];

      for (let k = 0; k < current.length; k += 1) {
        const drift = still
          ? 0
          : Math.sin(elapsedMs * 0.0011 + k * 1.31) * DRIFT;
        const r = Math.min(1.04, Math.max(0.06, current[k] + drift)) * R;
        const x = CENTER + unit[k].x * r;
        const y = CENTER + unit[k].y * r;
        points.push(`${x.toFixed(2)},${y.toFixed(2)}`);

        const dot = dotsRef.current[k];
        if (dot) {
          dot.setAttribute("cx", x.toFixed(2));
          dot.setAttribute("cy", y.toFixed(2));
        }
        const hit = hitsRef.current[k];
        if (hit) {
          hit.setAttribute("cx", x.toFixed(2));
          hit.setAttribute("cy", y.toFixed(2));
        }
      }

      shapeRef.current?.setAttribute("points", points.join(" "));
    },
    [unit],
  );

  useEffect(() => {
    if (prefersReducedMotion()) {
      currentRef.current = targetsRef.current.slice();
      paint(0, true);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const current = currentRef.current;
      const goal = targetsRef.current;
      for (let k = 0; k < current.length; k += 1) {
        current[k] += (goal[k] - current[k]) * 0.085;
      }
      paint(now - start, false);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paint]);

  /** Static grid geometry — concentric hexagons plus one spoke per pole. */
  const rings = useMemo(
    () =>
      RINGS.map((factor) =>
        unit
          .map((u) => {
            const x = CENTER + u.x * R * factor;
            const y = CENTER + u.y * R * factor;
            return `${x.toFixed(2)},${y.toFixed(2)}`;
          })
          .join(" "),
      ),
    [unit],
  );

  const poleLabel = useCallback(
    (k: number) => {
      const datum = data[k % axisCount];
      if (!datum) return "";
      const axis = TRAIT_AXES[datum.traitId];
      return k < axisCount ? axis.positivePole : axis.negativePole;
    },
    [axisCount, data],
  );

  const cornerLabels = useMemo(
    () =>
      unit.map((u, k) => {
        const lr = R + LABEL_OUT;
        const { textAnchor, dy } = labelAnchor(u.x, u.y);
        return {
          spoke: k,
          label: poleLabel(k),
          x: CENTER + u.x * lr,
          y: CENTER + u.y * lr,
          textAnchor,
          dy,
        };
      }),
    [poleLabel, unit],
  );

  const lean = useMemo(
    () => combinedLean(data, dormant),
    [data, dormant],
  );
  const shapeColor = dormant ? undefined : radarColor(lean);

  /** Caption: the hovered pole, else whichever axis is reading loudest. */
  const caption = useMemo(() => {
    if (hovered !== null) {
      const datum = data[hovered % axisCount];
      const score = dormant ? null : (datum?.score ?? null);
      return {
        label: poleLabel(hovered),
        value: score === null ? "—" : formatScore(score),
      };
    }
    if (dormant) return { label: "unmeasured", value: "—" };

    let best = -1;
    let bestMagnitude = -1;
    for (let i = 0; i < data.length; i += 1) {
      const score = data[i].score;
      if (score === null) continue;
      const magnitude = Math.abs(score);
      if (magnitude <= bestMagnitude) continue;
      bestMagnitude = magnitude;
      best = i;
    }
    if (best < 0) return { label: "unmeasured", value: "—" };

    const datum = data[best];
    const axis = TRAIT_AXES[datum.traitId];
    const score = datum.score ?? 0;
    return {
      label: score < 0 ? axis.negativePole : axis.positivePole,
      value: formatScore(score),
    };
  }, [axisCount, data, dormant, hovered, poleLabel]);

  const summary = data
    .map((datum) => {
      const axis = TRAIT_AXES[datum.traitId];
      return datum.score === null || dormant
        ? `${axis.positivePole} versus ${axis.negativePole}: no reading`
        : `${axis.positivePole} versus ${axis.negativePole}: ${formatScore(datum.score)}`;
    })
    .join(". ");

  return (
    <div
      className={s.radarWrap}
      style={
        shapeColor
          ? ({ ["--tel-radar-color"]: shapeColor } as CSSProperties)
          : undefined
      }
    >
      <svg
        className={`${s.radarSvg} ${dormant ? s.radarSvgDormant : ""}`}
        viewBox={`${-PAD} ${-PAD} ${SIZE + PAD * 2} ${SIZE + PAD * 2}`}
        role="img"
        aria-label={`Trait axes hexagon. ${summary}`}
      >
        <g className={s.radarGrid} aria-hidden>
          {rings.map((points, i) => (
            <polygon
              key={i}
              points={points}
              className={RINGS[i] === NEUTRAL ? s.radarRingZero : undefined}
            />
          ))}
          {unit.map((u, k) => (
            <line
              key={k}
              x1={CENTER}
              y1={CENTER}
              x2={(CENTER + u.x * R).toFixed(2)}
              y2={(CENTER + u.y * R).toFixed(2)}
            />
          ))}
        </g>

        <polygon
          ref={shapeRef}
          className={`${s.radarShape} ${dormant ? s.radarShapeDormant : ""}`}
          points=""
          aria-hidden
        />

        {unit.map((_, k) => (
          <circle
            key={`dot-${k}`}
            ref={(node) => {
              dotsRef.current[k] = node;
            }}
            className={[
              s.radarDot,
              data[k % axisCount]?.stale ? s.radarDotStale : "",
              hovered === k ? s.radarDotActive : "",
            ]
              .filter(Boolean)
              .join(" ")}
            r={hovered === k ? 2.1 : 1.3}
            aria-hidden
          />
        ))}

        {cornerLabels.map(({ spoke, label, x, y, textAnchor, dy }) => (
          <text
            key={`lab-${spoke}`}
            className={[
              s.radarCornerLabel,
              hovered === spoke ? s.radarCornerLabelActive : "",
            ]
              .filter(Boolean)
              .join(" ")}
            x={x.toFixed(2)}
            y={y.toFixed(2)}
            textAnchor={textAnchor}
            dy={dy}
            onMouseEnter={() => setHovered(spoke)}
            onMouseLeave={() =>
              setHovered((prev) => (prev === spoke ? null : prev))
            }
          >
            {label}
          </text>
        ))}

        {unit.map((_, k) => (
          <circle
            key={`hit-${k}`}
            ref={(node) => {
              hitsRef.current[k] = node;
            }}
            className={s.radarHit}
            r={7}
            onMouseEnter={() => setHovered(k)}
            onMouseLeave={() => setHovered((prev) => (prev === k ? null : prev))}
          >
            <title>{poleLabel(k)}</title>
          </circle>
        ))}
      </svg>

      <p className={s.radarCaption}>
        <span className={s.radarCaptionLabel}>{caption.label}</span>
        <span className={s.radarCaptionValue}>{caption.value}</span>
      </p>
    </div>
  );
}

export default TraitRadar;
