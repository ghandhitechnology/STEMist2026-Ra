"use client";

/**
 * components/chat/AnimatedTitle.tsx — the animated conversation title.
 *
 * Conversation names are written by GPT-5.6 Luna (POST /api/title, driven by
 * `lib/useAutoTitle.ts`). They arrive *after* the conversation already exists,
 * so the title has to change under the user's eyes. Rather than a silent swap,
 * the change is typed out — the same affordance the transcript uses for
 * streaming text (DESIGN.md §4.8).
 *
 *   'type'   first naming: types in character-by-character
 *   'retype' regeneration: erases the old title right-to-left (faster than it
 *            types, per §5.3 "any exit is quicker than its entrance"), then
 *            types the new one
 *   'none'   instant swap (rename, restore from storage, hydration)
 *
 * Motion notes:
 *  - One `requestAnimationFrame` loop drives both phases. No CSS keyframes are
 *    used for the text itself — keyframes cannot express a dynamic string, and
 *    width-based fakes break on ellipsis truncation in the 48px top bar (§3.4).
 *  - The only CSS animation here is the caret blink, which is exactly the
 *    §4.8 streaming caret: a 2px amber bar, `steps(1, end)`, 530ms on / off.
 *  - `prefers-reduced-motion: reduce` (§5.6) swaps instantly and never renders
 *    a blinking caret.
 *  - A title that changes mid-animation does not restart from a blank line: the
 *    loop erases from whatever is currently on screen back to the point where
 *    old and new diverge, then types forward. Nothing ever jumps.
 *
 * Accessibility: assistive tech reads the finished title once (a visually
 * hidden node); the animating glyphs are `aria-hidden`, so a screen reader
 * never announces a title one character at a time.
 */

import { useEffect, useRef, useState } from "react";

/** Animation applied when `title` changes. */
export type TitleAnimateMode = "type" | "retype" | "none";

export type AnimatedTitleProps = {
  /** The title to display. */
  title: string;
  /** How to transition into `title`. Default `"none"`. */
  animate?: TitleAnimateMode;
  /** ms per character while typing. Default 24. Erasing runs at ~0.6×. */
  charInterval?: number;
  /** Fires once the displayed text has settled on `title` (animated runs only). */
  onAnimationEnd?: () => void;
  className?: string;
  /** Native tooltip text. Defaults to the full title (useful when truncated). */
  titleAttr?: string;
};

/** ms per character while erasing (DESIGN.md §5.3 — exits are faster). */
const ERASE_INTERVAL = 14;
/** Default typing cadence. */
const TYPE_INTERVAL = 24;
/** Ceiling on catch-up steps in a single frame (tab-restore, jank). */
const MAX_STEPS_PER_FRAME = 8;

const CARET_CLASS = "rau-animated-title-caret";

const CARET_CSS = `
.${CARET_CLASS} {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 2px;
  vertical-align: -0.14em;
  border-radius: 1px;
  background: var(--rau-accent);
  animation: rauTitleCaretBlink 1060ms steps(1, end) infinite;
}
@keyframes rauTitleCaretBlink {
  0%, 49.99% { opacity: 1; }
  50%, 100%  { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .${CARET_CLASS} { animation: none; opacity: 1; }
}
`;

// The caret rule lives in a single <style> shared by every instance — a
// sidebar full of conversation rows must not each carry their own copy.
let caretStyleUsers = 0;
let caretStyleEl: HTMLStyleElement | null = null;

function useCaretStyleSheet() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    caretStyleUsers += 1;
    if (!caretStyleEl) {
      caretStyleEl = document.createElement("style");
      caretStyleEl.setAttribute("data-rau-animated-title", "");
      caretStyleEl.textContent = CARET_CSS;
      document.head.appendChild(caretStyleEl);
    }
    return () => {
      caretStyleUsers -= 1;
      if (caretStyleUsers <= 0) {
        caretStyleUsers = 0;
        caretStyleEl?.remove();
        caretStyleEl = null;
      }
    };
  }, []);
}

const SR_ONLY: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

const ROOT_STYLE: React.CSSProperties = {
  display: "inline-block",
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "pre",
  verticalAlign: "bottom",
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Length of the shared leading run of two strings. */
function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
}

export function AnimatedTitle({
  title,
  animate = "none",
  charInterval = TYPE_INTERVAL,
  onAnimationEnd,
  className,
  titleAttr,
}: AnimatedTitleProps) {
  // `text` is what the DOM shows; `textRef` mirrors it for the rAF loop so the
  // loop never reads stale closure state. Mounting with an animation mode
  // already set starts from an empty line, so a title that arrives at the same
  // moment its row appears still types in.
  const initial = animate === "none" ? title : "";
  const [text, setText] = useState(initial);
  const [animating, setAnimating] = useState(false);
  const textRef = useRef(initial);
  const animatingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const endRef = useRef(onAnimationEnd);
  endRef.current = onAnimationEnd;

  useCaretStyleSheet();

  useEffect(() => {
    const cancel = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    const settle = (value: string, notify: boolean) => {
      cancel();
      textRef.current = value;
      setText(value);
      animatingRef.current = false;
      setAnimating(false);
      if (notify) endRef.current?.();
    };

    // Instant paths: no animation requested, nothing to do, or the user asked
    // the interface to hold still (§5.6).
    if (animate === "none") {
      if (textRef.current !== title) settle(title, false);
      return cancel;
    }
    if (textRef.current === title) {
      cancel();
      animatingRef.current = false;
      setAnimating(false);
      return cancel;
    }
    if (prefersReducedMotion()) {
      settle(title, true);
      return cancel;
    }

    // 'retype' always empties the line first; 'type' only rewinds as far as the
    // point where the current text and the new title diverge (normally 0, i.e.
    // a clean type-in from empty).
    const floor =
      animate === "retype" ? 0 : commonPrefixLength(textRef.current, title);
    const typeMs = Math.max(1, charInterval);
    const eraseMs = Math.max(1, Math.min(ERASE_INTERVAL, typeMs));

    // A 'type' that starts from rest is a pure type-in: whatever placeholder
    // was sitting there ("New chat") is dropped in the same frame rather than
    // being erased letter by letter. A 'type' that interrupts a run in progress
    // rewinds visibly instead, so the text never jumps.
    if (animate === "type" && !animatingRef.current) {
      textRef.current = title.slice(0, floor);
      setText(textRef.current);
    }

    animatingRef.current = true;
    setAnimating(true);
    let nextAt = -1;
    // Strictly two phases: erase down to `floor`, then only ever type forward.
    // (Without the latch, typing past `floor` would look like an erase target
    // again and the title would stutter between two characters forever.)
    let erasing = textRef.current.length > floor;

    const step = (now: number) => {
      rafRef.current = null;
      if (nextAt < 0) nextAt = now;

      let steps = 0;
      while (now >= nextAt && steps < MAX_STEPS_PER_FRAME) {
        const current = textRef.current;
        if (erasing && current.length > floor) {
          textRef.current = current.slice(0, current.length - 1);
          nextAt += eraseMs;
        } else {
          erasing = false;
          if (current.length >= title.length) break;
          textRef.current = title.slice(0, current.length + 1);
          nextAt += typeMs;
        }
        steps += 1;
      }

      // A long stall (backgrounded tab) must not leave a debt of thousands of
      // queued steps that fire as a burst on return.
      if (nextAt < now) nextAt = now;

      setText(textRef.current);
      if (textRef.current === title) {
        animatingRef.current = false;
        setAnimating(false);
        endRef.current?.();
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return cancel;
    // `onAnimationEnd` is read through a ref so an inline callback cannot
    // restart the animation on every render.
  }, [title, animate, charInterval]);

  return (
    <span
      className={className}
      style={ROOT_STYLE}
      title={titleAttr ?? title}
      data-animating={animating || undefined}
    >
      <span aria-hidden="true">{text}</span>
      {animating ? <span aria-hidden="true" className={CARET_CLASS} /> : null}
      <span style={SR_ONLY}>{title}</span>
    </span>
  );
}

export default AnimatedTitle;
