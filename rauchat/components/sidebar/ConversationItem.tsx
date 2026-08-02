"use client";

/**
 * components/sidebar/ConversationItem.tsx — a single sidebar conversation
 * row (DESIGN.md §4.4). Double-click to rename inline; delete shows a
 * small inline confirm bar in place of the row (no browser confirm()).
 */

import {
  useEffect,
  useRef,
  useState,
  type AnimationEvent,
  type KeyboardEvent,
} from "react";
import type { Conversation } from "@/lib/types";
import { AnimatedTitle } from "../chat/AnimatedTitle";
import { IconPencil, IconTrash } from "../modals/icons";
import styles from "./ConversationItem.module.css";

export type ConversationItemProps = {
  conversation: Conversation;
  isActive: boolean;
  /** True when this conversation is generating in the background. */
  isStreaming?: boolean;
  /** Auto-naming animation for this row: 'type' on first naming, 'retype' on regeneration. */
  titleAnimate?: "type" | "retype" | "none";
  onTitleAnimationEnd?: (id: string) => void;
  /** True while the row pops in (freshly created conversation). */
  isEntering?: boolean;
  /** True while the row pops out; the store deletes it once it lands. */
  isLeaving?: boolean;
  /** Fires when a pop animation ends, so the store can settle the row. */
  onRowAnimationEnd?: (id: string) => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
};

export function ConversationItem({
  conversation,
  isActive,
  isStreaming = false,
  titleAnimate = "none",
  onTitleAnimationEnd,
  isEntering = false,
  isLeaving = false,
  onRowAnimationEnd,
  onSelect,
  onRename,
  onDelete,
}: ConversationItemProps) {
  const [mode, setMode] = useState<"idle" | "renaming" | "confirmDelete">(
    "idle"
  );
  const [draftTitle, setDraftTitle] = useState(conversation.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "renaming") {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [mode]);

  function startRename() {
    setDraftTitle(conversation.title);
    setMode("renaming");
  }

  function commitRename() {
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== conversation.title) {
      onRename(conversation.id, trimmed);
    }
    setMode("idle");
  }

  function handleRenameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraftTitle(conversation.title);
      setMode("idle");
    }
  }

  if (mode === "renaming") {
    return (
      <div className={styles.row}>
        <input
          ref={inputRef}
          className={styles.renameInput}
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onKeyDown={handleRenameKeyDown}
          onBlur={commitRename}
          aria-label="Rename conversation"
        />
      </div>
    );
  }

  if (mode === "confirmDelete") {
    return (
      <div className={styles.confirmRow}>
        <span className={styles.confirmText}>Delete “{conversation.title}”?</span>
        <div className={styles.confirmActions}>
          <button
            type="button"
            className={styles.confirmButton}
            onClick={() => setMode("idle")}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.confirmButton} ${styles.confirmButtonDanger}`}
            onClick={() => onDelete(conversation.id)}
          >
            Delete
          </button>
        </div>
      </div>
    );
  }

  // A row on its way out never re-enters: the leave class wins.
  const popClass = isLeaving
    ? styles.rowLeaving
    : isEntering
      ? styles.rowEntering
      : "";

  // Both halves of a pop (size + fade) end here, and animations from the
  // title caret bubble up — only the row's own settle the row.
  function handleAnimationEnd(event: AnimationEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (!isEntering && !isLeaving) return;
    onRowAnimationEnd?.(conversation.id);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      // A row playing its farewell is scenery: unfocusable, unreachable, and
      // invisible to assistive tech for the ~190ms it still exists.
      inert={isLeaving || undefined}
      className={`${styles.row} ${isActive ? styles.rowSelected : ""} ${popClass}`}
      onAnimationEnd={handleAnimationEnd}
      onClick={() => onSelect(conversation.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(conversation.id);
        }
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        startRename();
      }}
      title={conversation.title}
    >
      {isActive && <span className={styles.selectedBar} />}
      <span className={styles.title}>
        <AnimatedTitle
          title={conversation.title}
          animate={titleAnimate}
          onAnimationEnd={
            onTitleAnimationEnd
              ? () => onTitleAnimationEnd(conversation.id)
              : undefined
          }
        />
      </span>
      {isStreaming && <span className={styles.streamingDot} />}
      <span className={styles.actions}>
        <button
          type="button"
          className={styles.actionButton}
          aria-label="Rename conversation"
          onClick={(e) => {
            e.stopPropagation();
            startRename();
          }}
        >
          <IconPencil size={13} />
        </button>
        <button
          type="button"
          className={`${styles.actionButton} ${styles.actionButtonDanger}`}
          aria-label="Delete conversation"
          onClick={(e) => {
            e.stopPropagation();
            setMode("confirmDelete");
          }}
        >
          <IconTrash size={13} />
        </button>
      </span>
    </div>
  );
}
