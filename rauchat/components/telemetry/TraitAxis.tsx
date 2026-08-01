"use client";

/**
 * TraitAxis — one bipolar axis row (DESIGN.md §6.2).
 *
 * Anatomy: 16px label line (+pole · signed value · −pole), 6px gap, 8px
 * diverging bar with centre tick, ±0.5 gridlines, a scaled fill and a 2px
 * score marker. Everything that moves is `transform` or `opacity` only —
 * the fill is `scaleX`, the marker is a `translateX` carrier, so no layout
 * is touched while telemetry updates.
 *
 * Direction is never carried by hue alone: the signed numeral and the
 * emphasised pole label are the redundant cues (§6.2 accessibility).
 */

import { useEffect, useRef, useState } from "react";
import { TRAIT_AXES, type TraitId } from "@/lib/types";
import { CaretDownIcon, CaretUpIcon } from "./icons";
import s from "./telemetry.module.css";

export type TraitAxisProps = {
  traitId: TraitId;
  /** −1..1, or null when the axis has no reading (dormant / not reporting). */
  score: number | null;
  /** 0..1. Modulates fill opacity; < 0.35 renders the fill hollow. */
  confidence?: number;
  /** Change against the previous turn; renders the delta chip for 6s. */
  delta?: number | null;
  /** No update for ≥ 2 turns → dimmed fill, tertiary numeral. */
  stale?: boolean;
  /** Panel-wide dormant treatment: full scaffolding, em-dash value. */
  dormant?: boolean;
  /** First-connect stagger (§6.6): 24ms × row index. */
  revealDelayMs?: number;
};

/** 2px of a 144px half-track — the minimum legible width for a nonzero value. */
const MIN_SCALE = 2 / 144;
const HOLLOW_BELOW = 0.35;
const DELTA_TTL_MS = 6000;
const MINUS = "−";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Signed, two-decimal, typographic minus. */
function formatScore(v: number): string {
  const rounded = Math.round(v * 100) / 100;
  const sign = rounded < 0 ? MINUS : "+";
  return `${sign}${Math.abs(rounded).toFixed(2)}`;
}

/**
 * Counts to the new value over --rau-dur-telemetry, stepping the hundredths
 * digit. Snaps on first paint and under reduced motion (§6.6 step 3).
 */
function useRolledNumber(target: number | null): number | null {
  const [display, setDisplay] = useState<number | null>(target);
  const displayRef = useRef<number | null>(target);
  const seenRef = useRef(false);

  useEffect(() => {
    if (target === null) {
      displayRef.current = null;
      seenRef.current = false;
      setDisplay(null);
      return;
    }

    const from = displayRef.current;
    if (from === null || !seenRef.current || prefersReducedMotion()) {
      seenRef.current = true;
      displayRef.current = target;
      setDisplay(target);
      return;
    }
    if (Math.abs(from - target) < 0.005) {
      displayRef.current = target;
      setDisplay(target);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / 240);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (target - from) * eased;
      const snapped = Math.round(v * 100) / 100;
      displayRef.current = snapped;
      setDisplay(snapped);
      if (p < 1) raf = requestAnimationFrame(step);
      else {
        displayRef.current = target;
        setDisplay(target);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return display;
}

export function TraitAxis({
  traitId,
  score,
  confidence = 1,
  delta,
  stale = false,
  dormant = false,
  revealDelayMs = 0,
}: TraitAxisProps) {
  const axis = TRAIT_AXES[traitId];
  const value = dormant ? null : score;
  const rolled = useRolledNumber(value);

  // Delta chip lives for 6s after a change (§6.2 item 4).
  const [showDelta, setShowDelta] = useState(false);
  useEffect(() => {
    if (delta === null || delta === undefined || Math.abs(delta) < 0.005) {
      setShowDelta(false);
      return;
    }
    setShowDelta(true);
    const id = setTimeout(() => setShowDelta(false), DELTA_TTL_MS);
    return () => clearTimeout(id);
  }, [delta]);

  // Active pole flashes to primary for 240ms on update (§6.2 "updating").
  const [flash, setFlash] = useState(false);
  const prevValue = useRef<number | null>(value);
  useEffect(() => {
    if (value === null || prevValue.current === null) {
      prevValue.current = value;
      return;
    }
    if (Math.abs(value - prevValue.current) < 0.005) return;
    prevValue.current = value;
    setFlash(true);
    const id = setTimeout(() => setFlash(false), 240);
    return () => clearTimeout(id);
  }, [value]);

  const v = value ?? 0;
  const positive = v > 0.0001;
  const negative = v < -0.0001;
  const hollow = !dormant && value !== null && confidence < HOLLOW_BELOW;
  const opacity = dormant || value === null ? 1 : 0.45 + 0.55 * clamp01(confidence);

  const scalePos = positive ? Math.max(Math.abs(v), MIN_SCALE) : 0;
  const scaleNeg = negative ? Math.max(Math.abs(v), MIN_SCALE) : 0;
  const markerShift = value === null ? 0 : -v * 50; // % of the track width

  const magnitudeStrong = value !== null && Math.abs(v) >= 0.15;
  const delay = revealDelayMs ? `${revealDelayMs}ms` : undefined;

  const readout =
    value === null || rolled === null ? "—" : formatScore(rolled);

  const ariaLabel =
    value === null
      ? `${axis.positivePole} versus ${axis.negativePole}: no reading`
      : `${axis.positivePole} versus ${axis.negativePole}: ${
          v < 0 ? "minus" : "plus"
        } ${Math.abs(v).toFixed(2)}, confidence ${clamp01(confidence).toFixed(2)}`;

  return (
    <div
      className={s.axisRow}
      role="meter"
      tabIndex={0}
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={value ?? undefined}
      aria-valuetext={value === null ? "no reading" : formatScore(v)}
      aria-label={ariaLabel}
      title={
        value === null
          ? `${axis.positivePole} / ${axis.negativePole} — unmeasured`
          : `${axis.positivePole} / ${axis.negativePole}  ${formatScore(v)}  ·  confidence ${clamp01(confidence).toFixed(2)}${stale ? "  ·  stale" : ""}`
      }
    >
      <div className={s.labelLine}>
        <span
          className={[
            s.pole,
            dormant ? s.poleDormant : "",
            positive ? (flash ? s.poleFlash : s.poleActive) : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {axis.positivePole}
        </span>

        <span
          className={[
            s.value,
            value === null ? s.valueDormant : "",
            magnitudeStrong && !stale ? s.valueStrong : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {readout}
        </span>

        <span
          className={[
            s.pole,
            s.poleNeg,
            dormant ? s.poleDormant : "",
            negative ? (flash ? s.poleFlash : s.poleActive) : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {axis.negativePole}
        </span>

        {showDelta && delta !== null && delta !== undefined ? (
          <span
            className={`${s.delta} ${positive ? s.deltaPos : s.deltaNeg}`}
            aria-hidden
          >
            {delta > 0 ? <CaretUpIcon size={8} /> : <CaretDownIcon size={8} />}
            {Math.abs(delta).toFixed(2)}
          </span>
        ) : null}
      </div>

      <div className={s.bar}>
        <span className={`${s.grid} ${s.gridPos}`} aria-hidden />
        <span className={`${s.grid} ${s.gridNeg}`} aria-hidden />

        <span
          className={[s.fill, s.fillPos, stale ? s.fillPosStale : "", hollow ? s.fillHollow : ""]
            .filter(Boolean)
            .join(" ")}
          style={{
            transform: `scaleX(${scalePos.toFixed(4)})`,
            opacity,
            transitionDelay: delay,
          }}
          aria-hidden
        />
        <span
          className={[s.fill, s.fillNeg, stale ? s.fillNegStale : "", hollow ? s.fillHollow : ""]
            .filter(Boolean)
            .join(" ")}
          style={{
            transform: `scaleX(${scaleNeg.toFixed(4)})`,
            opacity,
            transitionDelay: delay,
          }}
          aria-hidden
        />

        <span
          className={`${s.centerTick} ${dormant ? s.centerTickDormant : ""}`}
          aria-hidden
        />

        <span
          className={s.markerCarrier}
          style={{
            transform: `translateX(${markerShift.toFixed(3)}%)`,
            transitionDelay: delay,
          }}
          aria-hidden
        >
          <span
            className={[
              s.marker,
              value === null ? s.markerDormant : "",
              stale ? s.markerStale : "",
            ]
              .filter(Boolean)
              .join(" ")}
          />
        </span>
      </div>
    </div>
  );
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export default TraitAxis;
