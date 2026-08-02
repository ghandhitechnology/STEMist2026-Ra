"use client";

/**
 * components/chat/ModelSelector.tsx
 *
 * The expandable model selector that sits beside the conversation title in the
 * chat top bar (DESIGN.md §3.4). Resting state is a quiet ghost trigger showing
 * the active model's shortLabel plus its thinking level ("GPT 5.6 Luna · Max");
 * clicking expands a §4.10 popover listing every
 * model in lib/models.ts grouped by family, plus a continuous thinking slider
 * that snaps to the active model's supported levels.
 *
 * Availability comes from GET /api/models (OpenRouter catalog, cached
 * server-side). If the call fails we fall back silently to the static catalog
 * and treat everything as available — a selector that can't reach the catalog
 * must not look broken (DESIGN.md §1.7).
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  MODELS,
  clampThinking,
  getModel,
  type ModelFamily,
  type ModelInfo,
  type ThinkingLevel,
} from "@/lib/models";
import styles from "./ModelSelector.module.css";
import { IconCheck, IconChevronDown } from "./icons";

/** Shape returned by GET /api/models. */
type ModelsResponse = {
  models: (ModelInfo & { available: boolean | null })[];
  configured: boolean;
};

export type ModelSelectorProps = {
  /** Rauchat model id (lib/models.ts). Unknown ids fall back to the default. */
  modelId: string;
  /** Current thinking level; clamped to the active model's supported levels. */
  thinking: string;
  onChange: (modelId: string, thinking: string) => void;
  /** Renders the trigger inert — used while the caller has no change handler. */
  disabled?: boolean;
};

const FAMILY_ORDER: ModelFamily[] = ["anthropic", "openai", "xai"];

const FAMILY_LABEL: Record<ModelFamily, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  xai: "xAI",
};

const THINKING_LABEL: Record<ThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
  max: "Max",
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function ratioForLevel(levels: readonly ThinkingLevel[], level: ThinkingLevel): number {
  if (levels.length <= 1) return 0;
  const idx = Math.max(0, levels.indexOf(level));
  return idx / (levels.length - 1);
}

function levelForRatio(
  levels: readonly ThinkingLevel[],
  ratio: number
): ThinkingLevel {
  if (levels.length === 0) return "off";
  if (levels.length === 1) return levels[0];
  const idx = Math.round(clamp01(ratio) * (levels.length - 1));
  return levels[idx] ?? levels[0];
}

/** Solid fill color: accent yellow at 0 → danger red at 1. */
function heatColor(ratio: number): string {
  const t = clamp01(ratio);
  const from = [232, 163, 61]; // --rau-accent
  const to = [220, 74, 80]; // --rau-danger
  const r = Math.round(from[0] + (to[0] - from[0]) * t);
  const g = Math.round(from[1] + (to[1] - from[1]) * t);
  const b = Math.round(from[2] + (to[2] - from[2]) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export function ModelSelector({
  modelId,
  thinking,
  onChange,
  disabled = false,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [highlight, setHighlight] = useState(0);
  /**
   * idle — follow committed level (spring on change)
   * dragging — finger/pointer owns a continuous ratio, no transition
   * settling — spring from release point to the nearest notch
   */
  const [sliderPhase, setSliderPhase] = useState<"idle" | "dragging" | "settling">(
    "idle"
  );
  const [visualRatio, setVisualRatio] = useState<number | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseRef = useRef<"idle" | "dragging" | "settling">("idle");
  phaseRef.current = sliderPhase;

  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (id: string) => `${baseId}-opt-${id}`;

  const model = getModel(modelId);
  const level = clampThinking(model, thinking);
  const levels = model.thinkingLevels;
  const committedRatio = ratioForLevel(levels, level);
  const ratio = visualRatio ?? committedRatio;
  const springy = sliderPhase !== "dragging";

  /* ---- availability, fetched once ---- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/models");
        if (!res.ok) return;
        const data = (await res.json()) as ModelsResponse;
        if (cancelled || !Array.isArray(data.models)) return;
        const next: Record<string, boolean> = {};
        for (const m of data.models) {
          // null means "catalog unreachable" — treat as available.
          if (m && typeof m.id === "string" && m.available === false) next[m.id] = false;
          else if (m && typeof m.id === "string") next[m.id] = true;
        }
        setAvailability(next);
      } catch {
        /* silent — static catalog is the fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isAvailable = useCallback(
    (id: string) => availability[id] !== false,
    [availability]
  );

  /** Display order: grouped by family, flattened for keyboard traversal. */
  const ordered = useMemo(
    () =>
      FAMILY_ORDER.flatMap((family) => MODELS.filter((m) => m.family === family)),
    []
  );

  const groups = useMemo(
    () =>
      FAMILY_ORDER.map((family) => ({
        family,
        models: MODELS.filter((m) => m.family === family),
      })).filter((g) => g.models.length > 0),
    []
  );

  /* ---- open/close ---- */
  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const toggle = useCallback(() => {
    if (disabled) return;
    setOpen((prev) => {
      if (prev) return false;
      const idx = ordered.findIndex((m) => m.id === model.id);
      setHighlight(idx >= 0 ? idx : 0);
      return true;
    });
  }, [disabled, model.id, ordered]);

  // Click-outside + Esc, mirroring the composer's skill picker.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const el = wrapRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  // Move focus into the list so arrow keys land somewhere predictable.
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  /* ---- selection ---- */
  const selectModel = useCallback(
    (next: ModelInfo) => {
      if (!isAvailable(next.id)) return;
      onChange(next.id, clampThinking(next, thinking));
      close(true);
    },
    [close, isAvailable, onChange, thinking]
  );

  const selectThinking = useCallback(
    (next: ThinkingLevel) => {
      onChange(model.id, next);
    },
    [model.id, onChange]
  );

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current !== null) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  // Drop in-flight drag when the model (and its level set) changes under us.
  useEffect(() => {
    clearSettleTimer();
    setVisualRatio(null);
    setSliderPhase("idle");
  }, [model.id, levels, clearSettleTimer]);

  useEffect(() => () => clearSettleTimer(), [clearSettleTimer]);

  const ratioFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return clamp01((clientX - rect.left) / rect.width);
  }, []);

  const endDrag = useCallback(
    (clientX: number) => {
      if (phaseRef.current !== "dragging") return;
      const release = ratioFromClientX(clientX);
      const next = levelForRatio(levels, release);
      const snap = ratioForLevel(levels, next);
      // 1) flip to settling while still at the release point (spring armed)
      // 2) next frame aim at the notch so width/left actually transition
      setVisualRatio(release);
      setSliderPhase("settling");
      selectThinking(next);
      clearSettleTimer();
      // Double rAF: let the spring class paint at the release point before
      // aiming at the notch, otherwise some engines skip the transition.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setVisualRatio(snap);
        });
      });
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null;
        setVisualRatio(null);
        setSliderPhase("idle");
      }, 720);
    },
    [clearSettleTimer, levels, ratioFromClientX, selectThinking]
  );

  const onSliderPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      clearSettleTimer();
      setSliderPhase("dragging");
      e.currentTarget.setPointerCapture(e.pointerId);
      setVisualRatio(ratioFromClientX(e.clientX));
    },
    [clearSettleTimer, ratioFromClientX]
  );

  const onSliderPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (phaseRef.current !== "dragging") return;
      setVisualRatio(ratioFromClientX(e.clientX));
    },
    [ratioFromClientX]
  );

  const onSliderPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      endDrag(e.clientX);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    },
    [endDrag]
  );

  /* ---- roving highlight ---- */
  const step = useCallback(
    (from: number, delta: number) => {
      const n = ordered.length;
      for (let i = 1; i <= n; i += 1) {
        const idx = (from + delta * i + n * n) % n;
        if (isAvailable(ordered[idx].id)) return idx;
      }
      return from;
    },
    [isAvailable, ordered]
  );

  const onListKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => step(h, 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => step(h, -1));
      } else if (e.key === "Home") {
        e.preventDefault();
        setHighlight(step(-1, 1));
      } else if (e.key === "End") {
        e.preventDefault();
        setHighlight(step(ordered.length, -1));
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const target = ordered[highlight];
        if (target) selectModel(target);
      }
      // Tab is left alone so focus can move on into the thinking control.
    },
    [highlight, ordered, selectModel, step]
  );

  const onSliderKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const idx = levels.indexOf(level);
      if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = levels[Math.min(levels.length - 1, idx + 1)];
        if (next) selectThinking(next);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = levels[Math.max(0, idx - 1)];
        if (next) selectThinking(next);
      } else if (e.key === "Home") {
        e.preventDefault();
        if (levels[0]) selectThinking(levels[0]);
      } else if (e.key === "End") {
        e.preventDefault();
        const last = levels[levels.length - 1];
        if (last) selectThinking(last);
      }
    },
    [level, levels, selectThinking]
  );

  const fillPct = `${(ratio * 100).toFixed(3)}%`;
  const fillColor = heatColor(ratio);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${open ? styles.triggerOpen : ""}`}
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Model: ${model.label}. Thinking: ${THINKING_LABEL[level]}`}
        title={disabled ? model.label : `${model.label} · thinking ${THINKING_LABEL[level]}`}
      >
        <span className={styles.triggerLabel}>{model.shortLabel}</span>
        <span className={styles.triggerDot} aria-hidden="true">
          ·
        </span>
        <span className={styles.triggerEffort} aria-hidden="true">
          {THINKING_LABEL[level]}
        </span>
        <IconChevronDown
          size={12}
          className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}
        />
      </button>

      {open ? (
        <div className={styles.panel}>
          <div
            ref={listRef}
            id={listId}
            className={styles.list}
            role="listbox"
            tabIndex={-1}
            aria-label="Model"
            aria-activedescendant={
              ordered[highlight] ? optionId(ordered[highlight].id) : undefined
            }
            onKeyDown={onListKeyDown}
          >
            {groups.map((group) => (
              <div key={group.family} role="group" aria-label={FAMILY_LABEL[group.family]}>
                <div className={styles.groupLabel} aria-hidden="true">
                  {FAMILY_LABEL[group.family]}
                </div>
                {group.models.map((m) => {
                  const available = isAvailable(m.id);
                  const active = m.id === model.id;
                  const highlighted = ordered[highlight]?.id === m.id;
                  return (
                    <div
                      key={m.id}
                      id={optionId(m.id)}
                      role="option"
                      aria-selected={active}
                      aria-disabled={!available}
                      className={[
                        styles.item,
                        highlighted && available ? styles.itemHighlighted : "",
                        available ? "" : styles.itemUnavailable,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => selectModel(m)}
                      onMouseEnter={() => {
                        const idx = ordered.findIndex((o) => o.id === m.id);
                        if (available && idx >= 0) setHighlight(idx);
                      }}
                    >
                      <span className={styles.itemText}>
                        <span className={styles.itemLabel}>{m.label}</span>
                        <span className={styles.itemDesc}>{m.description}</span>
                      </span>
                      {!available ? (
                        <span className={styles.hint}>unavailable</span>
                      ) : active ? (
                        <span className={styles.check}>
                          <IconCheck size={12} />
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className={styles.separator} />

          <div className={styles.thinking}>
            <div className={styles.thinkingHead}>
              <span className={styles.thinkingLabel} id={`${baseId}-thinking`}>
                Thinking
              </span>
              <span
                className={`${styles.thinkingValue} ${
                  springy ? "" : styles.thinkingValueLive
                }`}
                style={{ color: fillColor }}
                aria-live="polite"
              >
                {THINKING_LABEL[levelForRatio(levels, ratio)]}
              </span>
            </div>
            <div
              ref={trackRef}
              className={`${styles.slider} ${springy ? styles.sliderSpring : ""}`}
              role="slider"
              tabIndex={0}
              aria-labelledby={`${baseId}-thinking`}
              aria-valuemin={0}
              aria-valuemax={levels.length - 1}
              aria-valuenow={Math.max(0, levels.indexOf(level))}
              aria-valuetext={THINKING_LABEL[level]}
              onKeyDown={onSliderKeyDown}
              onPointerDown={onSliderPointerDown}
              onPointerMove={onSliderPointerMove}
              onPointerUp={onSliderPointerUp}
              onPointerCancel={onSliderPointerUp}
            >
              <div className={styles.sliderTrack} aria-hidden="true">
                <div
                  className={styles.sliderFill}
                  style={{ width: fillPct, backgroundColor: fillColor }}
                />
                <div className={styles.sliderTicks}>
                  {levels.map((lv, i) => {
                    const left =
                      levels.length <= 1
                        ? "0%"
                        : `${((i / (levels.length - 1)) * 100).toFixed(3)}%`;
                    const reached = ratioForLevel(levels, lv) <= ratio + 0.001;
                    return (
                      <span
                        key={lv}
                        className={`${styles.sliderTick} ${
                          reached ? styles.sliderTickOn : ""
                        }`}
                        style={{ left }}
                      />
                    );
                  })}
                </div>
                <span className={styles.sliderThumb} style={{ left: fillPct }} />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ModelSelector;
