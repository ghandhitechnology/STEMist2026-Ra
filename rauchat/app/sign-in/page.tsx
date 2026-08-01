"use client";

/**
 * app/sign-in/page.tsx — branded password sign-in (DESIGN.md §4.1, §4.3, §4.12).
 *
 * Posts to /api/auth/sign-in. When WorkOS requires email verification the card
 * body swaps in place to a 6-digit code step against /api/auth/verify; either
 * way a success means the session cookie is set and we hard-navigate to "/"
 * so the middleware re-runs with a real session.
 */

import { useEffect, useState, type FormEvent } from "react";
import styles from "./auth.module.css";

const OAUTH_ERRORS: Record<string, string> = {
  cancelled: "Sign-in was cancelled.",
  state: "That sign-in link expired. Try again.",
  exchange: "Could not complete sign-in. Try again.",
  config: "Auth is not configured.",
  provider: "That sign-in option isn't available. Try another.",
};

/** Seconds the resend button stays inert after a code is sent. */
const RESEND_COOLDOWN_S = 30;

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);

  // Surface a failed provider round-trip (and a completed password reset)
  // without pulling in useSearchParams, which would force a Suspense boundary
  // on this route.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reason = params.get("error");
    // Any unrecognized reason still surfaces something — an unexplained
    // bounce back to sign-in reads as the app being broken.
    if (reason) {
      setError(OAUTH_ERRORS[reason] ?? "Could not complete sign-in. Try again.");
    }
    if (params.get("reset") === "1") {
      setNotice("Password updated. Sign in with your new password.");
    }
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function handleSignIn(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok) {
        window.location.href = "/";
        return;
      }
      if (data?.verify && data?.pendingAuthenticationToken) {
        setPendingToken(data.pendingAuthenticationToken as string);
        setCode("");
        setCooldown(RESEND_COOLDOWN_S);
        setBusy(false);
        return;
      }
      setError(data?.error ?? "Incorrect email or password.");
      setBusy(false);
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  async function handleVerify(event: FormEvent) {
    event.preventDefault();
    if (busy || !pendingToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pendingAuthenticationToken: pendingToken,
          code: code.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok) {
        window.location.href = "/";
        return;
      }
      setError(data?.error ?? "That code is incorrect or has expired.");
      setBusy(false);
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  /**
   * Re-runs the original password authentication. WorkOS answers
   * `email_verification_required` again, which both mails a fresh code and
   * hands back a new pending token — the old one is superseded, so it has to
   * replace the one in state.
   */
  async function handleResend() {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok) {
        window.location.href = "/";
        return;
      }
      if (data?.verify && data?.pendingAuthenticationToken) {
        setPendingToken(data.pendingAuthenticationToken as string);
        setCode("");
        setCooldown(RESEND_COOLDOWN_S);
        setBusy(false);
        return;
      }
      setError(data?.error ?? "Could not send a new code. Try again.");
      setBusy(false);
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.wordmark}>
          <span className={styles.notch} />
          <span className={styles.wordmarkRau}>Rau</span>
          <span className={styles.wordmarkChat}>chat</span>
        </div>

        <div className={styles.card}>
          {pendingToken ? (
            <>
              <h1 className={styles.heading}>Verify your email</h1>
              <p className={styles.subheading}>
                We emailed a code to {email || "your inbox"}.
              </p>
              <form className={styles.form} onSubmit={handleVerify}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="code">
                    Verification code
                  </label>
                  <input
                    id="code"
                    className={`${styles.input} ${styles.codeInput}`}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="000000"
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    autoFocus
                    required
                  />
                </div>
                {error ? (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                ) : null}
                <button
                  type="submit"
                  className={styles.submit}
                  disabled={busy || code.length !== 6}
                >
                  {busy ? "Verifying…" : "Verify"}
                </button>
                <div className={styles.ghostRow}>
                  <button
                    type="button"
                    className={styles.ghostLink}
                    onClick={() => {
                      setPendingToken(null);
                      setError(null);
                    }}
                  >
                    Use a different account
                  </button>
                  <button
                    type="button"
                    className={styles.ghostLink}
                    onClick={handleResend}
                    disabled={busy || cooldown > 0}
                  >
                    {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
              <h1 className={styles.heading}>Sign in to Rauchat</h1>
              <p className={styles.subheading}>
                Your workspace, conversations, and skills.
              </p>
              {notice ? <p className={styles.notice}>{notice}</p> : null}
              <form className={styles.form} onSubmit={handleSignIn}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="email">
                    Email
                  </label>
                  <input
                    id="email"
                    className={styles.input}
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className={styles.field}>
                  <div className={styles.labelRow}>
                    <label className={styles.label} htmlFor="password">
                      Password
                    </label>
                    <a className={styles.ghostLink} href="/reset-password">
                      Forgot password?
                    </a>
                  </div>
                  <input
                    id="password"
                    className={styles.input}
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                {error ? (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                ) : null}
                <button type="submit" className={styles.submit} disabled={busy}>
                  {busy ? "Signing in…" : "Sign in"}
                </button>
              </form>

              <div className={styles.divider}>
                <span className={styles.dividerRule} />
                <span className={styles.dividerLabel}>or</span>
                <span className={styles.dividerRule} />
              </div>

              <div className={styles.providers}>
                <button
                  type="button"
                  className={styles.providerButton}
                  disabled={busy}
                  onClick={() => {
                    window.location.href =
                      "/api/auth/oauth?provider=GoogleOAuth";
                  }}
                >
                  Continue with Google
                </button>
                <button
                  type="button"
                  className={styles.providerButton}
                  disabled={busy}
                  onClick={() => {
                    window.location.href =
                      "/api/auth/oauth?provider=GitHubOAuth";
                  }}
                >
                  Continue with GitHub
                </button>
              </div>
            </>
          )}
        </div>

        <p className={styles.footer}>
          New to Rauchat?{" "}
          <a className={styles.footerLink} href="/sign-up">
            Create an account
          </a>
        </p>
      </div>
    </main>
  );
}
