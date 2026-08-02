"use client";

/**
 * components/chat/MessageItem.tsx
 *
 * One turn (DESIGN.md §3.5). The assistant never gets a bubble — asymmetry
 * (document vs. block) is the read cue, not colour. §4.9 action bar appears
 * on turn hover / focus-within. §4.8 streaming caret + thinking indicator.
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { Diagram, Message, ToolEvent } from "@/lib/types";
import styles from "./chat.module.css";
import { Markdown } from "./Markdown";
import { ToolEventList, toolRunningVerb } from "./ToolEventCard";
import {
  IconBranch,
  IconCheck,
  IconCopy,
  IconMore,
  IconRegenerate,
  IconThumbDown,
  IconThumbUp,
} from "./icons";

const MAX_TURN_HEIGHT = 1600; // §8 long message truncation

export type MessageActions = {
  onRegenerate?: (message: Message) => void;
  onBranch?: (message: Message) => void;
  onFeedback?: (message: Message, value: "good" | "bad" | null) => void;
  onMore?: (message: Message, anchor: HTMLElement) => void;
  onRetryToolEvent?: (event: ToolEvent) => void;
  onInstallSkill?: (event: ToolEvent) => void | Promise<void>;
  /** Opens a diagram produced in this turn in the side panel. */
  onOpenDiagram?: (diagram: Diagram) => void;
  /** Id of the open diagram, so its inline card reads as active. */
  openDiagramId?: string | null;
  resolveDownloadUrl?: (target: string) => string;
};

export type MessageItemProps = {
  message: Message;
  /** True while this is the in-flight assistant turn. */
  isStreaming?: boolean;
  /** Overrides the thinking-indicator label. */
  statusLabel?: string | null;
  /** Name shown in the assistant header row. */
  assistantName?: string;
} & MessageActions;

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------
   Action bar (§4.9)
   ------------------------------------------------------------------ */

function ActionButton({
  label,
  latched,
  onClick,
  children,
}: {
  label: string;
  latched?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`${styles.actionBtn} ${latched ? styles.actionBtnLatched : ""}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function ActionBar({
  message,
  className,
  onRegenerate,
  onBranch,
  onFeedback,
  onMore,
}: { message: Message; className?: string } & MessageActions) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"good" | "bad" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const copy = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard
      .writeText(message.content)
      .then(() => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => undefined);
  }, [message.content]);

  const vote = useCallback(
    (value: "good" | "bad") => {
      const next = feedback === value ? null : value;
      setFeedback(next);
      onFeedback?.(message, next);
    },
    [feedback, message, onFeedback]
  );

  const isAssistant = message.role === "assistant";

  return (
    <div className={className ? `${styles.actionBar} ${className}` : styles.actionBar}>
      <ActionButton label={copied ? "Copied" : "Copy"} onClick={copy}>
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      </ActionButton>
      {isAssistant && onRegenerate ? (
        <ActionButton label="Regenerate" onClick={() => onRegenerate(message)}>
          <IconRegenerate size={14} />
        </ActionButton>
      ) : null}
      {onBranch ? (
        <ActionButton label="Branch" onClick={() => onBranch(message)}>
          <IconBranch size={14} />
        </ActionButton>
      ) : null}
      {isAssistant ? (
        <>
          <ActionButton
            label="Good response"
            latched={feedback === "good"}
            onClick={() => vote("good")}
          >
            <IconThumbUp size={14} />
          </ActionButton>
          <ActionButton
            label="Bad response"
            latched={feedback === "bad"}
            onClick={() => vote("bad")}
          >
            <IconThumbDown size={14} />
          </ActionButton>
        </>
      ) : null}
      {onMore ? (
        <ActionButton label="More" onClick={(e) => onMore(message, e.currentTarget)}>
          <IconMore size={14} />
        </ActionButton>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------
   Turn
   ------------------------------------------------------------------ */

export const MessageItem = memo(function MessageItem({
  message,
  isStreaming = false,
  statusLabel,
  assistantName = "Rauchat",
  onRetryToolEvent,
  onInstallSkill,
  onOpenDiagram,
  openDiagramId,
  resolveDownloadUrl,
  ...actions
}: MessageItemProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [clamped, setClamped] = useState(false);
  const [expandedTurn, setExpandedTurn] = useState(false);

  // §8 — clamp very tall completed assistant turns. Measured once the turn
  // settles; never while streaming (the height is still moving).
  useEffect(() => {
    if (message.role !== "assistant" || isStreaming || expandedTurn) return;
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const tall = el.scrollHeight > MAX_TURN_HEIGHT;
      setClamped((prev) => (prev === tall ? prev : tall));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [message.role, message.content, isStreaming, expandedTurn]);

  if (message.role === "user") {
    return (
      <article className={`${styles.turn} ${styles.userTurn}`} data-role="user">
        <div className={styles.userBlock}>{message.content}</div>
        <ActionBar message={message} className={styles.userActions} {...actions} />
      </article>
    );
  }

  const toolEvents = message.toolEvents ?? [];
  const runningTool = toolEvents.find((e) => e.status === "running");
  const showThinking = isStreaming && message.content.length === 0;
  const thinkingLabel =
    statusLabel ?? (runningTool ? toolRunningVerb(runningTool.tool) : "Thinking");

  const showClamp = clamped && !expandedTurn;

  return (
    <article
      className={styles.turn}
      data-role="assistant"
      aria-live={isStreaming ? "off" : "polite"}
    >
      <header className={styles.assistantHeader}>
        <span className={styles.glyphBox} aria-hidden="true">
          <span className={styles.glyph} />
        </span>
        <span className={styles.assistantName}>{assistantName}</span>
        <time className={styles.timestamp} suppressHydrationWarning>
          {formatTime(message.createdAt)}
        </time>
      </header>

      <div
        ref={bodyRef}
        className={`${styles.assistantBody} ${showClamp ? styles.clamped : ""}`}
      >
        {toolEvents.length > 0 ? (
          <ToolEventList
            events={toolEvents}
            onRetry={onRetryToolEvent}
            onInstallSkill={onInstallSkill}
            onOpenDiagram={onOpenDiagram}
            openDiagramId={openDiagramId}
            resolveDownloadUrl={resolveDownloadUrl}
          />
        ) : null}

        {message.content ? (
          <Markdown
            content={message.content}
            className={isStreaming ? styles.streaming : undefined}
          />
        ) : null}

        {showThinking ? (
          <div className={styles.thinking}>
            <span className={styles.thinkingSquares} aria-hidden="true">
              <span className={styles.thinkingSquare} />
              <span className={styles.thinkingSquare} />
              <span className={styles.thinkingSquare} />
            </span>
            <span className={styles.thinkingLabel}>{thinkingLabel}</span>
          </div>
        ) : null}
      </div>

      {showClamp ? (
        <div className={styles.clampFooter}>
          <button
            type="button"
            className={styles.showMoreBtn}
            onClick={() => setExpandedTurn(true)}
          >
            Show more
          </button>
        </div>
      ) : null}

      {!isStreaming && message.content ? (
        <ActionBar message={message} {...actions} />
      ) : null}
    </article>
  );
});

export default MessageItem;
