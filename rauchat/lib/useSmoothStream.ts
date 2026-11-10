"use client";

/**
 * lib/useSmoothStream.ts — smooths streamed assistant text.
 *
 * useChatStream coalesces network deltas into one state update per animation
 * frame, but a large chunk still lands as one hard cut. This hook meters the
 * reveal: the returned string trails the real content and catches up a few
 * characters per frame, so text flows in steadily no matter how bursty the
 * network is. The rate adapts to the backlog — far behind means faster — so
 * the tail never lags the stream by more than a beat.
 *
 * Mounting mid-stream (switching back to a generating conversation) starts
 * from the full current text rather than replaying it; only growth after
 * mount is metered. When `active` is false the text passes through untouched.
 */

import { useEffect, useRef, useState } from "react";

/** Fraction of the backlog revealed per frame; higher catches up faster. */
const CATCH_UP_RATE = 0.15;
/** Floor of characters per frame, so short backlogs still finish quickly. */
const MIN_CHARS_PER_FRAME = 2;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useSmoothText(text: string, active: boolean): string {
  // Revealed character count. Initialised to the full length so historical
  // messages (and mid-stream mounts) never replay.
  const [shown, setShown] = useState(text.length);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const raf = useRef<number | null>(null);

  useEffect(() => {
    // Content replaced or truncated (regenerate): resync instantly.
    if (text.length < shownRef.current) {
      setShown(text.length);
      return;
    }
    if (!active || prefersReducedMotion()) {
      if (shownRef.current !== text.length) setShown(text.length);
      return;
    }
    if (shownRef.current === text.length) return;

    const step = () => {
      const backlog = text.length - shownRef.current;
      if (backlog <= 0) {
        raf.current = null;
        return;
      }
      const advance = Math.max(
        MIN_CHARS_PER_FRAME,
        Math.round(backlog * CATCH_UP_RATE)
      );
      setShown(Math.min(text.length, shownRef.current + advance));
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [text, active]);

  return text.slice(0, shown);
}
