"use client";

/**
 * components/chat/ChatView.tsx
 *
 * The centre column (DESIGN.md §3.4): top bar → transcript → composer dock.
 *
 * State ownership:
 *   - the draft lives in <Composer/> (typing never re-renders the transcript)
 *   - scroll position lives in <MessageList/> (only the scrolled boolean is
 *     lifted, and only when it flips, to toggle the top bar hairline)
 *   - everything else arrives as props.
 */

import { memo, useCallback, useMemo, useRef, useState } from "react";
import type { Conversation, Message, Skill, ToolName } from "@/lib/types";
import type { StreamingState } from "@/lib/useChatStream";
import styles from "./chat.module.css";
import { Composer, type ComposerHandle, type ComposerSubmission } from "./Composer";
import { MessageList } from "./MessageList";
import type { MessageActions } from "./MessageItem";
import { ModelSelector } from "./ModelSelector";
import { AnimatedTitle, type TitleAnimateMode } from "./AnimatedTitle";
import { DEFAULT_MODEL_ID, getModel } from "@/lib/models";
import { IconBranch, IconMore, IconPanelRight, IconShare } from "./icons";

const STREAMING_ID = "__rauchat_streaming__";

/** Stable no-op so the read-only selector keeps a referentially stable prop. */
const noopModelChange = () => {};

export type ChatViewProps = {
  /** Null renders the new-chat empty state (§8). */
  conversation: Conversation | null;
  /** The in-flight turn, straight from useChatStream().state. */
  streamingState: StreamingState;
  onSendMessage: (submission: ComposerSubmission) => void | Promise<void>;
  onStop?: () => void;
  /** Retry after a failed generation (§8). */
  onRetry?: () => void;

  /* top bar */
  /**
   * @deprecated Superseded by the inline <ModelSelector/>; still accepted so
   * existing callers keep compiling, but no longer rendered.
   */
  modelLabel?: string;
  /** Rauchat model id (lib/models.ts). Defaults to the catalog default. */
  modelId?: string;
  /** Thinking level (lib/models.ts ThinkingLevel); clamped to the model. */
  thinking?: string;
  /**
   * Absent → the selector renders the current model read-only (non-interactive).
   */
  onModelChange?: (modelId: string, thinking: string) => void;
  /** Animate the header title (auto-naming): 'type' on first naming, 'retype' on regeneration. */
  titleAnimate?: TitleAnimateMode;
  onTitleAnimationEnd?: () => void;
  assistantName?: string;
  telemetryOpen?: boolean;
  onToggleTelemetry?: () => void;
  onShare?: () => void;
  onBranchConversation?: () => void;
  onOverflow?: (anchor: HTMLElement) => void;

  /* composer */
  defaultTools?: readonly ToolName[];
  unavailableTools?: Partial<Record<ToolName, string>>;
  /** "/auto" mode: all tools loaded every turn, agent decides usage. */
  autoTools?: boolean;
  onToggleAutoTools?: () => void;
  skills?: readonly Skill[];
  activeSkillId?: string | null;
  onSelectSkill?: (id: string | null) => void;
  onAttach?: (files: File[]) => void;
  composerError?: string | null;
  onDismissComposerError?: () => void;
  notice?: { tone: "neutral" | "warning"; message: string } | null;
  suggestions?: string[];
} & MessageActions;

export const ChatView = memo(function ChatView({
  conversation,
  streamingState,
  onSendMessage,
  onStop,
  onRetry,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  modelLabel, // deprecated: superseded by <ModelSelector/>; destructured so it
  //            never leaks into the {...messageActions} spread below.
  modelId,
  thinking,
  onModelChange,
  titleAnimate,
  onTitleAnimationEnd,
  assistantName,
  telemetryOpen,
  onToggleTelemetry,
  onShare,
  onBranchConversation,
  onOverflow,
  defaultTools,
  unavailableTools,
  autoTools,
  onToggleAutoTools,
  skills,
  activeSkillId,
  onSelectSkill,
  onAttach,
  composerError = null,
  onDismissComposerError,
  notice = null,
  suggestions,
  ...messageActions
}: ChatViewProps) {
  const [scrolled, setScrolled] = useState(false);
  const composerRef = useRef<ComposerHandle>(null);
  const turnStartedAt = useRef(Date.now());
  const wasStreaming = useRef(false);

  const messages = conversation?.messages ?? [];
  const { isStreaming, content, toolEvents, error } = streamingState;

  // Stamp the in-flight turn once, when it starts.
  if (isStreaming && !wasStreaming.current) turnStartedAt.current = Date.now();
  wasStreaming.current = isStreaming;

  // Show the synthetic turn while streaming, and afterwards until the caller
  // has committed the finished assistant message to the conversation.
  const lastRole = messages.length > 0 ? messages[messages.length - 1].role : null;
  const showStreamingTurn =
    isStreaming ||
    ((content.length > 0 || toolEvents.length > 0) && lastRole !== "assistant");

  const streamingMessage = useMemo<Message | null>(
    () =>
      showStreamingTurn
        ? {
            id: STREAMING_ID,
            role: "assistant",
            content,
            createdAt: turnStartedAt.current,
            toolEvents,
          }
        : null,
    [showStreamingTurn, content, toolEvents]
  );

  const runningTools = useMemo<ToolName[]>(
    () =>
      toolEvents.filter((e) => e.status === "running").map((e) => e.tool),
    [toolEvents]
  );

  const handleSuggestion = useCallback((text: string) => {
    composerRef.current?.setDraft(text);
  }, []);

  const handleScrolledChange = useCallback((next: boolean) => {
    setScrolled(next);
  }, []);

  const title = conversation?.title ?? "New chat";

  // The selector is driven by explicit props first, then by whatever the
  // conversation was created with, then by the catalog default.
  const activeModelId = modelId ?? conversation?.modelId ?? DEFAULT_MODEL_ID;
  const activeThinking =
    thinking ?? conversation?.thinking ?? getModel(activeModelId).defaultThinking;

  return (
    <div className={styles.chat}>
      <button
        type="button"
        className={styles.skipLink}
        onClick={() => composerRef.current?.focus()}
      >
        Skip to composer
      </button>

      <header className={`${styles.topbar} ${scrolled ? styles.topbarScrolled : ""}`}>
        <div className={styles.topbarTitleGroup}>
          <h1 className={styles.topbarTitle} title={title}>
            <AnimatedTitle
              title={title}
              animate={titleAnimate ?? "none"}
              onAnimationEnd={onTitleAnimationEnd}
            />
          </h1>
          <ModelSelector
            modelId={activeModelId}
            thinking={activeThinking}
            onChange={onModelChange ?? noopModelChange}
            disabled={!onModelChange}
          />
        </div>
        <div className={styles.topbarSpacer} />
        <div className={styles.topbarActions}>
          {onShare ? (
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onShare}
              aria-label="Share conversation"
              title="Share conversation"
            >
              <IconShare size={16} />
            </button>
          ) : null}
          {onBranchConversation ? (
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onBranchConversation}
              aria-label="Branch conversation"
              title="Branch conversation"
            >
              <IconBranch size={16} />
            </button>
          ) : null}
          {onOverflow ? (
            <button
              type="button"
              className={styles.iconBtn}
              onClick={(e) => onOverflow(e.currentTarget)}
              aria-label="More options"
              title="More options"
            >
              <IconMore size={16} />
            </button>
          ) : null}
          {onToggleTelemetry ? (
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onToggleTelemetry}
              aria-pressed={telemetryOpen ?? false}
              aria-label="Toggle model telemetry"
              title="Toggle model telemetry"
            >
              <IconPanelRight size={16} />
            </button>
          ) : null}
        </div>
      </header>

      <div className={styles.chatBody}>
        <MessageList
          messages={messages}
          streamingMessage={streamingMessage}
          isStreaming={isStreaming}
          error={error}
          onRetry={onRetry}
          assistantName={assistantName}
          suggestions={suggestions}
          onSuggestionSelect={handleSuggestion}
          onScrolledChange={handleScrolledChange}
          {...messageActions}
        />

        <Composer
          ref={composerRef}
          onSend={onSendMessage}
          onStop={onStop}
          isStreaming={isStreaming}
          runningTools={runningTools}
          unavailableTools={unavailableTools}
          defaultTools={defaultTools}
          autoTools={autoTools}
          onToggleAutoTools={onToggleAutoTools}
          skills={skills}
          activeSkillId={activeSkillId}
          onSelectSkill={onSelectSkill}
          onAttach={onAttach}
          error={composerError}
          onDismissError={onDismissComposerError}
          notice={notice}
        />
      </div>
    </div>
  );
});

export default ChatView;
