"use client";

/**
 * components/chat/ModelSelector.tsx
 *
 * The expandable model selector that sits beside the conversation title in the
 * chat top bar (DESIGN.md §3.4). Resting state is a quiet ghost trigger showing
 * the active model's shortLabel; clicking expands a §4.10 popover listing every
 * model in lib/models.ts grouped by family, plus a §4.13 segmented control for
 * the active model's thinking levels.
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
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
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
};

export function ModelSelector({
  modelId,
  thinking,
  onChange,
  disabled = false,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [highlight, setHighlight] = useState(0);

  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (id: string) => `${baseId}-opt-${id}`;

  const model = getModel(modelId);
  const level = clampThinking(model, thinking);

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

  const onSegKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const levels = model.thinkingLevels;
      const idx = levels.indexOf(level);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const delta = e.key === "ArrowRight" ? 1 : -1;
        const next = levels[(idx + delta + levels.length) % levels.length];
        if (next) selectThinking(next);
      }
    },
    [level, model.thinkingLevels, selectThinking]
  );

  const segCount = model.thinkingLevels.length;
  const segIndex = Math.max(0, model.thinkingLevels.indexOf(level));
  const indicatorStyle: CSSProperties = {
    width: `calc((100% - 4px) / ${segCount})`,
    transform: `translateX(${segIndex * 100}%)`,
  };

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
              <span className={styles.thinkingModel}>{model.shortLabel}</span>
            </div>
            <div
              className={styles.segTrack}
              role="radiogroup"
              aria-labelledby={`${baseId}-thinking`}
              onKeyDown={onSegKeyDown}
            >
              <span className={styles.segIndicator} style={indicatorStyle} aria-hidden="true" />
              {model.thinkingLevels.map((lv) => {
                const on = lv === level;
                return (
                  <button
                    key={lv}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    tabIndex={on ? 0 : -1}
                    className={`${styles.seg} ${on ? styles.segOn : ""}`}
                    onClick={() => selectThinking(lv)}
                  >
                    {THINKING_LABEL[lv]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ModelSelector;
