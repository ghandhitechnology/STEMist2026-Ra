"use client";

/**
 * app/sign-up/page.tsx — branded account creation (DESIGN.md §4.1, §4.3, §4.12).
 *
 * Shares app/sign-in/auth.module.css so the two screens are one lockup. Posts
 * to /api/auth/sign-up; when the WorkOS environment requires email
 * verification the card body swaps to the 6-digit code step.
 */

import { useEffect, useState, type FormEvent } from "react";
import { authMessage } from "@/lib/auth-client";
import styles from "../sign-in/auth.module.css";

/** Seconds the resend button stays inert after a code is sent. */
const RESEND_COOLDOWN_S = 30;

export default function SignUpPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function handleSignUp(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/sign-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
        }),
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
      setError(authMessage(data, "Could not create your account. Try again."));
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
      setError(authMessage(data, "That code is incorrect or has expired."));
      setBusy(false);
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  /**
   * By this point the account exists — re-posting to /api/auth/sign-up would
   * only trip "email already exists". Re-running the password authentication
   * is what re-triggers verification: WorkOS mails a fresh code and returns a
   * new pending token, which supersedes the one in state.
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
      setError(authMessage(data, "Could not send a new code. Try again."));
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
                    Use a different email
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
              <h1 className={styles.heading}>Create your Rauchat account</h1>
              <p className={styles.subheading}>
                A private workspace for your conversations, files, and skills.
              </p>
              <form className={styles.form} onSubmit={handleSignUp}>
                <div className={styles.nameRow}>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="firstName">
                      First name
                    </label>
                    <input
                      id="firstName"
                      className={styles.input}
                      autoComplete="given-name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="lastName">
                      Last name
                    </label>
                    <input
                      id="lastName"
                      className={styles.input}
                      autoComplete="family-name"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                    />
                  </div>
                </div>
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
                  <label className={styles.label} htmlFor="password">
                    Password
                  </label>
                  <input
                    id="password"
                    className={styles.input}
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 10 characters"
                    minLength={10}
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
                  {busy ? "Creating account…" : "Create account"}
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
          Already have an account?{" "}
          <a className={styles.footerLink} href="/sign-in">
            Sign in
          </a>
        </p>
      </div>
    </main>
  );
}
