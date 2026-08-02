"use client";

/**
 * components/chat/MessageList.tsx
 *
 * The transcript scroller (DESIGN.md §3.4) with §4.8 scroll behaviour:
 * auto-follow while pinned within 48px of the bottom; the moment the user
 * scrolls up, follow detaches and the "Jump to latest" pill appears.
 *
 * Sending a message anchors it to the top of the viewport (ChatGPT-style):
 * a tail spacer grows the scroll range so the turn can reach the top, the
 * streamed reply (thinking included) fills the space below, and auto-follow
 * stays off for the run so nothing slides under the composer. The spacer
 * shrinks as the reply grows and is trimmed once the run ends.
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
const ANCHOR_TOP = 12; // breathing room above an anchored user turn

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
  const spacerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const anchoredRef = useRef(false);
  const scrolledRef = useRef(false);
  const countRef = useRef(messages.length);
  const [detached, setDetached] = useState(false);

  /* Size the tail spacer so the last user turn can sit ANCHOR_TOP from the
     top of the viewport; it shrinks as the streamed reply grows into it.
     Returns the anchor element so callers can scroll to it. */
  const sizeAnchorSpacer = useCallback(() => {
    const el = scrollerRef.current;
    const col = columnRef.current;
    const spacer = spacerRef.current;
    if (!el || !col || !spacer) return null;
    const userTurns = col.querySelectorAll<HTMLElement>('[data-role="user"]');
    const anchor = userTurns[userTurns.length - 1];
    if (!anchor) return null;
    const below = spacer.offsetTop - anchor.offsetTop;
    spacer.style.height = `${Math.max(0, el.clientHeight - ANCHOR_TOP - below)}px`;
    return anchor;
  }, []);

  /* A new turn adjusts scroll (declared first so it wins the layout pass):
     a just-sent user message anchors to the top of the viewport; anything
     else (conversation switch, history load) re-pins to the tail. */
  useLayoutEffect(() => {
    if (countRef.current === messages.length) return;
    const appended = messages.length === countRef.current + 1;
    countRef.current = messages.length;
    const last = messages[messages.length - 1];

    if (appended && last?.role === "user") {
      anchoredRef.current = true;
      pinnedRef.current = false;
      setDetached(false);
      const el = scrollerRef.current;
      const anchor = sizeAnchorSpacer();
      if (el && anchor) el.scrollTop = anchor.offsetTop - ANCHOR_TOP;
    } else if (anchoredRef.current && last?.role === "assistant") {
      // The streamed turn just committed: hold the anchored position.
    } else {
      anchoredRef.current = false;
      if (spacerRef.current) spacerRef.current.style.height = "0px";
      pinnedRef.current = true;
      setDetached(false);
    }
  }, [messages, sizeAnchorSpacer]);

  /* Follow the tail on every commit while pinned (no dep array: streaming
     text mutates content, not identity of anything we could depend on). */
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  });

  /* Async growth (markdown, images, tool bodies) keeps the tail pinned,
     or — while anchored — shrinks the spacer as the reply grows into it. */
  useEffect(() => {
    const el = scrollerRef.current;
    const col = columnRef.current;
    if (!el || !col || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (anchoredRef.current) sizeAnchorSpacer();
      else if (pinnedRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(col);
    return () => ro.disconnect();
  }, [sizeAnchorSpacer]);

  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    /* While anchored the run's scroll is free-form: no pin takeover, no
       pill (the spacer would make the "latest" target blank space). */
    if (!anchoredRef.current) {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const pinned = distance <= PIN_THRESHOLD;
      pinnedRef.current = pinned;
      setDetached(!pinned);
    }

    const scrolled = el.scrollTop > SCROLLED_THRESHOLD;
    if (scrolled !== scrolledRef.current) {
      scrolledRef.current = scrolled;
      onScrolledChange?.(scrolled);
    }
  }, [onScrolledChange]);

  /* The run ended: release the anchor and trim the spacer to the viewport
     bottom (no visual jump), then let the pin machinery take over again. */
  useEffect(() => {
    if (isStreaming || !anchoredRef.current) return;
    anchoredRef.current = false;
    const el = scrollerRef.current;
    const spacer = spacerRef.current;
    if (el && spacer) {
      const viewBottom = el.scrollTop + el.clientHeight;
      spacer.style.height = `${Math.max(0, viewBottom - spacer.offsetTop)}px`;
    }
    handleScroll();
  }, [isStreaming, handleScroll]);

  const jumpToLatest = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (spacerRef.current) spacerRef.current.style.height = "0px";
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
        {/* Tail spacer: gives an anchored user turn room to reach the top. */}
        <div className={styles.tailSpacer} ref={spacerRef} aria-hidden="true" />
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
