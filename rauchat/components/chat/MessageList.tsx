"use client";

/**
 * components/chat/MessageList.tsx
 *
 * The transcript scroller (DESIGN.md §3.4) with §4.8 scroll behaviour:
 * auto-follow while pinned within 48px of the bottom; the moment the user
 * scrolls up, follow detaches and the "Jump to latest" pill appears.
 */

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Message } from "@/lib/types";
import styles from "./chat.module.css";
import { MessageItem, type MessageActions } from "./MessageItem";
import { IconArrowDown } from "./icons";

const PIN_THRESHOLD = 48; // §4.8
const SCROLLED_THRESHOLD = 4; // §3.4 top-bar hairline

export const DEFAULT_SUGGESTIONS = [
  "Explain a paper I paste in",
  "Research a topic with sources",
  "Draft a PDF report",
  "Build a reusable skill",
];

export type MessageListProps = {
  messages: Message[];
  /** The in-flight assistant turn, if any. */
  streamingMessage?: Message | null;
  isStreaming?: boolean;
  statusLabel?: string | null;
  /** Generation failure shown in place of the assistant turn (§8). */
  error?: string | null;
  requestId?: string | null;
  onRetry?: () => void;
  assistantName?: string;
  suggestions?: string[];
  onSuggestionSelect?: (text: string) => void;
  /** Fires only when the boolean flips, so the top bar re-renders rarely. */
  onScrolledChange?: (scrolled: boolean) => void;
} & MessageActions;

export const MessageList = memo(function MessageList({
  messages,
  streamingMessage = null,
  isStreaming = false,
  statusLabel,
  error = null,
  requestId = null,
  onRetry,
  assistantName,
  suggestions = DEFAULT_SUGGESTIONS,
  onSuggestionSelect,
  onScrolledChange,
  ...actions
}: MessageListProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const scrolledRef = useRef(false);
  const countRef = useRef(messages.length);
  const [detached, setDetached] = useState(false);

  /* A new turn always re-pins. Declared first so it wins the layout pass. */
  useLayoutEffect(() => {
    if (countRef.current !== messages.length) {
      countRef.current = messages.length;
      pinnedRef.current = true;
      setDetached(false);
    }
  }, [messages.length]);

  /* Follow the tail on every commit while pinned (no dep array: streaming
     text mutates content, not identity of anything we could depend on). */
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  });

  /* Async growth (markdown, images, tool bodies) keeps the tail pinned. */
  useEffect(() => {
    const el = scrollerRef.current;
    const col = columnRef.current;
    if (!el || !col || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (pinnedRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(col);
    return () => ro.disconnect();
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const pinned = distance <= PIN_THRESHOLD;
    pinnedRef.current = pinned;
    setDetached(!pinned);

    const scrolled = el.scrollTop > SCROLLED_THRESHOLD;
    if (scrolled !== scrolledRef.current) {
      scrolledRef.current = scrolled;
      onScrolledChange?.(scrolled);
    }
  }, [onScrolledChange]);

  const jumpToLatest = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    pinnedRef.current = true;
    setDetached(false);
    el.scrollTop = el.scrollHeight;
  }, []);

  const isEmpty = messages.length === 0 && !streamingMessage && !error;

  return (
    <div className={styles.listWrap}>
      <div className={styles.scroller} ref={scrollerRef} onScroll={handleScroll}>
        <div className={styles.column} ref={columnRef} role="log">
          {isEmpty ? (
            <div className={styles.emptyState}>
              <div className={`${styles.wordmark} ${styles.emptyWordmark}`}>
                Rau<span className={styles.wordmarkTail}>chat</span>
              </div>
              <p className={styles.emptyCopy}>
                Start a conversation. Tools are off by default.
              </p>
              <div className={styles.suggestions}>
                {suggestions.slice(0, 4).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={styles.suggestionChip}
                    onClick={() => onSuggestionSelect?.(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((m) => (
                <MessageItem
                  key={m.id}
                  message={m}
                  assistantName={assistantName}
                  {...actions}
                />
              ))}

              {streamingMessage ? (
                <MessageItem
                  key={streamingMessage.id}
                  message={streamingMessage}
                  isStreaming={isStreaming}
                  statusLabel={statusLabel}
                  assistantName={assistantName}
                  {...actions}
                />
              ) : null}

              {error ? (
                <div className={`${styles.turn} ${styles.turnError}`} role="alert">
                  <div className={styles.turnErrorMessage}>{error}</div>
                  <div className={styles.turnErrorActions}>
                    {onRetry ? (
                      <button
                        type="button"
                        className={styles.secondaryBtn}
                        onClick={onRetry}
                      >
                        Retry
                      </button>
                    ) : null}
                    {requestId ? (
                      <span className={styles.cardDur}>{requestId}</span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className={styles.jumpWrap}>
        <button
          type="button"
          className={`${styles.jumpPill} ${detached ? styles.jumpPillVisible : ""}`}
          onClick={jumpToLatest}
          tabIndex={detached ? 0 : -1}
          aria-hidden={!detached}
        >
          <IconArrowDown size={12} />
          Jump to latest
        </button>
      </div>
    </div>
  );
});

export default MessageList;
