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

import { memo, useEffect, useRef, useState } from "react";
import type { Diagram, ToolEvent } from "@/lib/types";
import styles from "./chat.module.css";
import { Markdown } from "./Markdown";
import { ToolEventList } from "./ToolEventCard";
import { IconChevronDown } from "./icons";

export type ThinkingSectionProps = {
  /** Accumulated reasoning text; may be empty when only tools ran. */
  thinking: string;
  /** Trace tool events (running, errored, and non-deliverable completions). */
  events: ToolEvent[];
  /** True while this turn is still streaming. */
  isStreaming: boolean;
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
  onRetry,
  onInstallSkill,
  onOpenDiagram,
  openDiagramId,
  resolveDownloadUrl,
}: ThinkingSectionProps) {
  // null = no explicit choice yet; the section then follows the stream
  // (open while live, closed once done). A click latches the user's choice.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  // Auto-open lags isStreaming by one effect tick so the section mounts
  // closed and the grid transition plays the expansion (and the collapse
  // when the stream settles).
  const [autoOpen, setAutoOpen] = useState(false);
  useEffect(() => {
    setAutoOpen(isStreaming);
  }, [isStreaming]);

  const hasError = events.some((e) => e.status === "error");
  const open = userOpen ?? (autoOpen || hasError);

  // Follow the tail of the reasoning text while it streams.
  const proseRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = proseRef.current;
    if (el && isStreaming) el.scrollTop = el.scrollHeight;
  }, [thinking, isStreaming]);

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
                  content={thinking}
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
