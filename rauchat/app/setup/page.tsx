"use client";

/**
 * app/setup/page.tsx — first-run onboarding, shown once right after sign-in.
 *
 * On mount, GET /api/profile decides what to render: a missing session sends
 * the user to /sign-in, an existing profile means onboarding already
 * happened so we bounce straight to "/", and otherwise we show the form.
 * Submitting PUTs lib/server/profile.ts's shape and lands on "/".
 *
 * While that request is in flight — and while the browser is navigating away
 * — the card shell stays on screen rather than a blank page. If /api/profile
 * has not answered within LOAD_TIMEOUT_MS the shell flips to a retryable
 * error instead of waiting forever.
 *
 * No state swap here is a hard cut. The card and its wordmark never unmount;
 * the body inside is re-keyed per phase so setup.module.css can replay a
 * zoom-and-fade on it, and its measured height is written back onto the
 * wrapper so the card grows into the form instead of snapping. Submitting
 * plays one exit frame before the navigation. All of it collapses to an
 * instant swap under prefers-reduced-motion.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { IconChevronDown } from "@/components/modals/icons";
import styles from "./setup.module.css";

type ProfileUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profilePictureUrl: string | null;
};

const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "English", label: "English" },
  { value: "Korean", label: "한국어 (Korean)" },
  { value: "Japanese", label: "日本語 (Japanese)" },
  { value: "Chinese", label: "中文 (Chinese)" },
  { value: "Spanish", label: "Español" },
  { value: "French", label: "Français" },
  { value: "German", label: "Deutsch" },
];
const OTHER_VALUE = "__other__";

/** How long we wait on GET /api/profile before offering "Try again". */
const LOAD_TIMEOUT_MS = 8000;

/** Length of .cardLeaving in setup.module.css — keep the two in step. */
const EXIT_MS = 240;

type LoadState = "loading" | "ready" | "redirecting" | "failed";

/**
 * Which body the card is showing. "loading" and "redirecting" render the same
 * note, so they share a phase and do not blink between each other.
 */
function phaseOf(state: LoadState): "pending" | "ready" | "failed" {
  return state === "ready" || state === "failed" ? state : "pending";
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The lockup at the top of the card, shown in every state. */
function Wordmark() {
  return (
    <div className={styles.wordmark}>
      <span className={styles.notch}>
        <span className={styles.notchDot} />
      </span>
      <span className={styles.wordmarkText}>
        <span className={styles.wordmarkRau}>Rau</span>
        <span className={styles.wordmarkChat}>chat</span>
      </span>
    </div>
  );
}

export default function SetupPage() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nickname, setNickname] = useState("");
  const [languageChoice, setLanguageChoice] = useState<string>(LANGUAGE_OPTIONS[0].value);
  const [customLanguage, setCustomLanguage] = useState("");
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The card body is re-keyed per phase, so the height that .body animates to
   * has to be measured from whichever body is live. A ref callback re-arms the
   * observer on every swap; it also catches the "Other…" language input
   * appearing, which changes the height without changing the phase.
   */
  const [bodyHeight, setBodyHeight] = useState<number | null>(null);
  const bodyObserver = useRef<ResizeObserver | null>(null);
  const measureBody = useCallback((node: HTMLDivElement | null) => {
    bodyObserver.current?.disconnect();
    bodyObserver.current = null;
    if (!node) return;
    setBodyHeight(node.offsetHeight);
    if (typeof ResizeObserver === "undefined") return;
    bodyObserver.current = new ResizeObserver(() => setBodyHeight(node.offsetHeight));
    bodyObserver.current.observe(node);
  }, []);

  useEffect(() => () => bodyObserver.current?.disconnect(), []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);

    async function load() {
      try {
        const res = await fetch("/api/profile", { signal: controller.signal });
        if (res.status === 401) {
          window.location.href = "/sign-in";
          return;
        }
        if (!res.ok) {
          throw new Error("Failed to load profile.");
        }
        const data = (await res.json()) as { profile: unknown; user: ProfileUser };
        if (cancelled) return;
        if (data.profile) {
          setLoadState("redirecting");
          window.location.replace("/");
          return;
        }
        setFirstName(data.user.firstName ?? "");
        setLastName(data.user.lastName ?? "");
        setLoadState("ready");
      } catch {
        if (!cancelled) {
          setLoadError("Couldn't reach Rauchat.");
          setLoadState("failed");
        }
      } finally {
        clearTimeout(timer);
      }
    }

    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [loadAttempt]);

  function handleRetry() {
    setLoadError(null);
    setLoadState("loading");
    setLoadAttempt((n) => n + 1);
  }

  const preferredLanguage =
    languageChoice === OTHER_VALUE ? customLanguage.trim() : languageChoice;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    const trimmedNickname = nickname.trim();
    if (!trimmedFirst || !trimmedLast || !trimmedNickname || !preferredLanguage) {
      setError("Fill in every field before continuing.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: trimmedFirst,
          lastName: trimmedLast,
          nickname: trimmedNickname,
          preferredLanguage,
        }),
      });
      if (res.status === 401) {
        window.location.href = "/sign-in";
        return;
      }
      if (!res.ok) {
        throw new Error("Failed to save profile.");
      }
      // One exit frame before the hard navigation, so leaving reads as
      // intentional. `saving` stays true throughout — the form is done.
      if (prefersReducedMotion()) {
        window.location.href = "/";
        return;
      }
      setLeaving(true);
      window.setTimeout(() => {
        window.location.href = "/";
      }, EXIT_MS);
    } catch {
      setError("Couldn't save your profile. Try again.");
      setSaving(false);
    }
  }

  const phase = phaseOf(loadState);
  let body: ReactNode;

  if (phase === "failed") {
    body = (
      <div className={styles.status}>
        <p className={styles.error} role="alert">
          {loadError}
        </p>
        <button type="button" className={`${styles.submit} ${styles.retry}`} onClick={handleRetry}>
          Try again
        </button>
      </div>
    );
  } else if (phase === "pending") {
    body = <p className={styles.statusNote}>Preparing your workspace.</p>;
  } else {
    body = (
      <>
        <h1 className={styles.heading}>Welcome to Rauchat</h1>
        <p className={styles.subcopy}>
          The assistant personalizes replies with what you tell it here.
        </p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="rau-setup-first-name">
                First name
              </label>
              <input
                id="rau-setup-first-name"
                className={styles.input}
                type="text"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                autoComplete="given-name"
                required
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="rau-setup-last-name">
                Last name
              </label>
              <input
                id="rau-setup-last-name"
                className={styles.input}
                type="text"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                autoComplete="family-name"
                required
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="rau-setup-nickname">
              Nickname
            </label>
            <input
              id="rau-setup-nickname"
              className={styles.input}
              type="text"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="What should we call you?"
              maxLength={32}
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="rau-setup-language">
              Preferred language
            </label>
            <div className={styles.selectWrap}>
              <select
                id="rau-setup-language"
                className={styles.select}
                value={languageChoice}
                onChange={(event) => setLanguageChoice(event.target.value)}
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
                <option value={OTHER_VALUE}>Other…</option>
              </select>
              <IconChevronDown size={14} className={styles.selectChevron} />
            </div>
            {languageChoice === OTHER_VALUE && (
              <input
                className={styles.input}
                type="text"
                value={customLanguage}
                onChange={(event) => setCustomLanguage(event.target.value)}
                placeholder="Type a language"
                maxLength={40}
                autoFocus
                required
              />
            )}
          </div>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <button type="submit" className={styles.submit} disabled={saving}>
            {saving ? "Saving…" : "Enter Rauchat"}
          </button>
        </form>
      </>
    );
  }

  return (
    <div className={styles.page} aria-busy={phase === "pending" ? "true" : undefined}>
      <div className={leaving ? `${styles.card} ${styles.cardLeaving}` : styles.card}>
        <Wordmark />
        <div
          className={styles.body}
          style={bodyHeight === null ? undefined : { height: bodyHeight }}
        >
          {/* Keyed so each phase replays the enter animation; ref measures it. */}
          <div key={phase} ref={measureBody} className={styles.bodyInner}>
            {body}
          </div>
        </div>
      </div>
    </div>
  );
}
