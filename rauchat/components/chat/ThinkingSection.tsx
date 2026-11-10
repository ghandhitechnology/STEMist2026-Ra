"use client";

/**
 * components/chat/ThinkingSection.tsx
 *
 * The "Thinking" disclosure at the top of an assistant turn (right under
 * the header row): the model's reasoning
 * trace (or provider summary) plus its working tool activity — searches,
 * browser sessions, file reads/writes, running builds. Deliverable results
 * (artifacts, sketches, PDFs, skills) stay inline in the transcript and never
 * appear here; this is the process, not the product.
 *
 * Opens itself while the turn is streaming so the reasoning can be watched
 * live, then folds shut when the turn settles — unless the user has toggled
 * it, which always wins. Expansion animates via grid-template-rows, matching
 * the tool-card pattern (§7).
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Diagram, ToolEvent } from "@/lib/types";
import styles from "./chat.module.css";
import { Markdown } from "./Markdown";
import { ToolEventList } from "./ToolEventCard";
import { IconChevronDown } from "./icons";

/**
 * Open/collapsed state of the live turn's section, module-scoped so it
 * survives the unmount/remount that navigating away mid-turn (e.g. branching)
 * causes. Only one turn streams at a time and each turn brings a new key, so
 * one slot is enough. `userOpen: null` = mounted before, never toggled.
 */
let liveLatch: { key: string; userOpen: boolean | null } | null = null;

/**
 * ChatGPT-style reasoning traces section their text with a lone
 * `**Bold header**` line, often separated from the surrounding prose by only
 * a single newline. Markdown treats that as a soft break, so the header gets
 * glued to the tail of the previous paragraph. Promote any line that is
 * purely a bold span into a real `####` heading — the reasoningProse styles
 * already tame headings to body scale, so it gains block spacing without
 * shouting. The extra blank lines around it are harmless; markdown
 * collapses them.
 */
const BOLD_HEADER_LINE = /(^|\n)[ \t]*\*\*((?:[^\n*]|\*(?!\*))+)\*\*[ \t]*(?=\n|$)/g;

function normalizeThinking(text: string): string {
  return text.replace(BOLD_HEADER_LINE, "$1\n#### $2\n");
}

export type ThinkingSectionProps = {
  /** Accumulated reasoning text; may be empty when only tools ran. */
  thinking: string;
  /** Trace tool events (running, errored, and non-deliverable completions). */
  events: ToolEvent[];
  /** True while this turn is still streaming. */
  isStreaming: boolean;
  /**
   * Identity of the live turn this section belongs to. When set, the
   * open/collapsed state survives a remount — leaving and re-entering the
   * conversation mid-turn must neither reopen what the user collapsed nor
   * replay the expansion. Omitted for settled turns, which never need it.
   */
  latchKey?: string;
  onRetry?: (event: ToolEvent) => void;
  onInstallSkill?: (event: ToolEvent) => void | Promise<void>;
  onOpenDiagram?: (diagram: Diagram) => void;
  openDiagramId?: string | null;
  resolveDownloadUrl?: (target: string) => string;
};

export const ThinkingSection = memo(function ThinkingSection({
  thinking,
  events,
  isStreaming,
  latchKey,
  onRetry,
  onInstallSkill,
  onOpenDiagram,
  openDiagramId,
  resolveDownloadUrl,
}: ThinkingSectionProps) {
  // A remount of the same live turn restores its previous state instead of
  // starting over (initializers only run on mount, so this read is one-shot).
  const restored = latchKey !== undefined && liveLatch?.key === latchKey;
  // null = no explicit choice yet; the section then follows the stream
  // (open while live, closed once done). A click latches the user's choice.
  const [userOpen, setUserOpenState] = useState<boolean | null>(
    restored ? liveLatch!.userOpen : null
  );
  // Auto-open lags isStreaming by one effect tick so the section mounts
  // closed and the grid transition plays the expansion (and the collapse
  // when the stream settles). A restored live section skips the animation:
  // it was already open (or held closed by the user) before the remount.
  const [autoOpen, setAutoOpen] = useState(restored && isStreaming);
  useEffect(() => {
    setAutoOpen(isStreaming);
  }, [isStreaming]);
  // Record that this turn's section has mounted, so a later remount takes
  // the restore path above. A new turn (new key) resets the slot.
  useEffect(() => {
    if (latchKey !== undefined && liveLatch?.key !== latchKey) {
      liveLatch = { key: latchKey, userOpen: null };
    }
  }, [latchKey]);

  const setUserOpen = (next: boolean) => {
    setUserOpenState(next);
    if (latchKey !== undefined) liveLatch = { key: latchKey, userOpen: next };
  };

  const hasError = events.some((e) => e.status === "error");
  const open = userOpen ?? (autoOpen || hasError);

  // Follow the tail of the reasoning text while it streams.
  const proseRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = proseRef.current;
    if (el && isStreaming) el.scrollTop = el.scrollHeight;
  }, [thinking, isStreaming]);

  const normalizedThinking = useMemo(() => normalizeThinking(thinking), [thinking]);

  if (!thinking && events.length === 0) return null;

  const active = isStreaming;
  const stepCount = events.length;

  return (
    <div className={styles.reasoning}>
      <button
        type="button"
        className={styles.reasoningHeader}
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
      >
        <span
          className={`${styles.reasoningChevron} ${
            open ? styles.reasoningChevronOpen : ""
          }`}
          aria-hidden="true"
        >
          <IconChevronDown size={12} />
        </span>
        <span
          className={`${styles.reasoningLabel} ${
            active ? styles.reasoningLabelActive : ""
          }`}
        >
          {active ? "Thinking…" : "Thinking"}
        </span>
        {stepCount > 0 ? (
          <span className={styles.reasoningCount}>
            {stepCount} {stepCount === 1 ? "step" : "steps"}
          </span>
        ) : null}
      </button>

      <div
        className={`${styles.reasoningGrid} ${open ? styles.reasoningGridOpen : ""}`}
      >
        <div className={styles.reasoningClip}>
          <div className={styles.reasoningBody}>
            {thinking ? (
              <div ref={proseRef} className={styles.reasoningText}>
                <Markdown
                  content={normalizedThinking}
                  className={styles.reasoningProse}
                  streaming={isStreaming}
                />
              </div>
            ) : null}
            {events.length > 0 ? (
              <ToolEventList
                events={events}
                onRetry={onRetry}
                onInstallSkill={onInstallSkill}
                onOpenDiagram={onOpenDiagram}
                openDiagramId={openDiagramId}
                resolveDownloadUrl={resolveDownloadUrl}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
});

export default ThinkingSection;
