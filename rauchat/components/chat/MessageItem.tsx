"use client";

/**
 * components/chat/MessageItem.tsx
 *
 * One turn (DESIGN.md §3.5). The assistant never gets a bubble — asymmetry
 * (document vs. block) is the read cue, not colour. §4.9 action bar appears
 * on turn hover / focus-within. §4.8 streaming caret + thinking indicator.
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { Diagram, Message, ToolEvent, ToolName } from "@/lib/types";
import { useSmoothText } from "@/lib/useSmoothStream";
import styles from "./chat.module.css";
import { Markdown } from "./Markdown";
import { ThinkingSection } from "./ThinkingSection";
import {
  ToolEventCard,
  ToolEventList,
  toolRunningVerb,
} from "./ToolEventCard";
import {
  buildAssistantFlow,
  hasInlineSketchAnchor,
} from "@/lib/message-flow";
import {
  IconBranch,
  IconCheck,
  IconCopy,
  IconMore,
  IconRegenerate,
  IconThumbDown,
  IconThumbUp,
} from "./icons";

/**
 * Tools whose completed result is the deliverable itself (an artifact card,
 * an inline sketch, a download, an installable skill). They render inline in
 * the transcript; everything else is working trace and lives in the
 * "Thinking" disclosure. Running/errored calls always count as trace.
 */
const DELIVERABLE_TOOLS: ReadonlySet<ToolName> = new Set([
  "diagram",
  "svg_render",
  "pdf_create",
  "skill_make",
]);

const isDeliverable = (e: ToolEvent) =>
  e.status === "done" && DELIVERABLE_TOOLS.has(e.tool);

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
  assistantName = "Assistant",
  onRetryToolEvent,
  onInstallSkill,
  onOpenDiagram,
  openDiagramId,
  resolveDownloadUrl,
  ...actions
}: MessageItemProps) {
  // §4.8 — while streaming, the shown text trails the real content a few
  // characters per frame so bursty chunks flow in instead of cutting in.
  const smoothContent = useSmoothText(
    message.content,
    isStreaming && message.role === "assistant"
  );

  if (message.role === "user") {
    const attachments = message.attachments ?? [];
    return (
      <article className={`${styles.turn} ${styles.userTurn}`} data-role="user">
        <div className={styles.userBlock}>
          {attachments.length > 0 ? (
            <div className={styles.messageAttachRow}>
              {attachments.map((att) => (
                <span
                  key={att.path}
                  className={styles.messageAttachChip}
                  title={att.path}
                >
                  <span className={styles.attachName}>{att.name}</span>
                </span>
              ))}
            </div>
          ) : null}
          {message.content}
        </div>
        <ActionBar message={message} className={styles.userActions} {...actions} />
      </article>
    );
  }

  const toolEvents = message.toolEvents ?? [];
  const deliverableEvents = toolEvents.filter(isDeliverable);
  const anchoredSketches = deliverableEvents.filter(hasInlineSketchAnchor);
  const unanchoredDeliverables = deliverableEvents.filter(
    (event) => !hasInlineSketchAnchor(event),
  );
  const traceEvents = toolEvents.filter((e) => !isDeliverable(e));
  const thinkingText = message.thinking ?? "";
  const hasTrace = thinkingText.length > 0 || traceEvents.length > 0;

  const runningTool = toolEvents.find((e) => e.status === "running");
  // The bare squares indicator only covers the gap before anything at all
  // has streamed — once reasoning or tool trace exists, the "Thinking"
  // disclosure is the live surface.
  const showThinking = isStreaming && smoothContent.length === 0 && !hasTrace;
  const thinkingLabel =
    statusLabel ?? (runningTool ? toolRunningVerb(runningTool.tool) : "Thinking");
  const responseFlow = buildAssistantFlow(smoothContent, anchoredSketches);
  let lastTextIndex = -1;
  responseFlow.forEach((part, index) => {
    if (part.kind === "text") lastTextIndex = index;
  });

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

      <div className={styles.assistantBody}>
        {hasTrace ? (
          <ThinkingSection
            thinking={thinkingText}
            events={traceEvents}
            isStreaming={isStreaming}
            latchKey={
              isStreaming ? `${message.id}:${message.createdAt}` : undefined
            }
            onRetry={onRetryToolEvent}
            onInstallSkill={onInstallSkill}
            onOpenDiagram={onOpenDiagram}
            openDiagramId={openDiagramId}
            resolveDownloadUrl={resolveDownloadUrl}
          />
        ) : null}

        {unanchoredDeliverables.length > 0 ? (
          <ToolEventList
            events={unanchoredDeliverables}
            onRetry={onRetryToolEvent}
            onInstallSkill={onInstallSkill}
            onOpenDiagram={onOpenDiagram}
            openDiagramId={openDiagramId}
            resolveDownloadUrl={resolveDownloadUrl}
          />
        ) : null}

        {responseFlow.map((part, index) =>
          part.kind === "text" ? (
            <Markdown
              key={part.key}
              content={part.content}
              className={
                isStreaming && index === lastTextIndex
                  ? styles.streaming
                  : undefined
              }
              streaming={isStreaming}
            />
          ) : (
            <div className={styles.inlineSketchBlock} key={part.key}>
              <ToolEventCard
                event={part.event}
                onRetry={onRetryToolEvent}
                onInstallSkill={onInstallSkill}
                onOpenDiagram={onOpenDiagram}
                openDiagramId={openDiagramId}
                resolveDownloadUrl={resolveDownloadUrl}
              />
            </div>
          ),
        )}

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

      {!isStreaming && message.content ? (
        <ActionBar message={message} {...actions} />
      ) : null}
    </article>
  );
});

export default MessageItem;
