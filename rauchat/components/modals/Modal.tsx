"use client";

/**
 * components/modals/Modal.tsx — shared modal primitive (DESIGN.md §4.14).
 * Overlay scrim (no blur), focus trap, Esc to close, scale/fade enter,
 * fade-only exit. Portals to document.body so it always sits above the
 * three-column app shell regardless of where it's rendered from.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import styles from "./Modal.module.css";
import { IconX } from "./icons";

const EXIT_MS = 130;

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: "default" | "large";
  children: ReactNode;
  footer?: ReactNode;
  /** Optional id used for aria-describedby on the panel. */
  describedById?: string;
};

export function Modal({
  open,
  onClose,
  title,
  size = "default",
  children,
  footer,
  describedById,
}: ModalProps) {
  const [rendered, setRendered] = useState(open);
  const [entered, setEntered] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mount / unmount lifecycle so the fade-out can actually play.
  useEffect(() => {
    if (open) {
      if (exitTimer.current) clearTimeout(exitTimer.current);
      setRendered(true);
      // Next frame so the enter transition runs from the initial state.
      const raf = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(raf);
    }
    setEntered(false);
    exitTimer.current = setTimeout(() => setRendered(false), EXIT_MS);
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, [open]);

  // Focus management: capture prior focus, move focus into the panel,
  // restore on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (first ?? panel)?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const firstEl = focusable[0];
      const lastEl = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === firstEl || !panel.contains(active)) {
          event.preventDefault();
          lastEl.focus();
        }
      } else if (active === lastEl || !panel.contains(active)) {
        event.preventDefault();
        firstEl.focus();
      }
    },
    [onClose]
  );

  if (!rendered || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`${styles.scrim} ${entered ? styles.scrimEnter : styles.scrimExit}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={describedById}
        tabIndex={-1}
        className={[
          styles.panel,
          size === "large" ? styles.panelLarge : "",
          entered ? styles.panelEnter : styles.panelExit,
        ]
          .filter(Boolean)
          .join(" ")}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button
            type="button"
            className={styles.closeButton}
            aria-label="Close"
            onClick={onClose}
          >
            <IconX size={16} />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}
