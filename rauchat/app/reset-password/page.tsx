"use client";

/**
 * app/reset-password/page.tsx — password recovery (DESIGN.md §4.1, §4.3, §4.12).
 *
 * Shares app/sign-in/auth.module.css so recovery is the same lockup as the two
 * auth screens. Step 1 asks for the address and posts to
 * /api/auth/password-reset, which always answers `ok` — the confirmation copy
 * is therefore deliberately conditional ("if an account exists"). Step 2 takes
 * the emailed code plus a new password, posts to
 * /api/auth/password-reset/confirm, and hands off to /sign-in?reset=1.
 */

import { useState, type FormEvent } from "react";
import { authMessage } from "@/lib/auth-client";
import styles from "../sign-in/auth.module.css";

export default function ResetPasswordPage() {
  const [step, setStep] = useState<"request" | "confirm">("request");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleRequest(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok) {
        setStep("confirm");
        setBusy(false);
        return;
      }
      setError(authMessage(data, "Could not start a reset. Try again."));
      setBusy(false);
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  async function handleConfirm(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok) {
        window.location.href = "/sign-in?reset=1";
        return;
      }
      setError(authMessage(data, "That reset code is invalid or has expired."));
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
          {step === "confirm" ? (
            <>
              <h1 className={styles.heading}>Set a new password</h1>
              <p className={styles.subheading}>
                If an account exists for {email.trim() || "that address"}, a
                reset code is on its way.
              </p>
              <form className={styles.form} onSubmit={handleConfirm}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="token">
                    Reset code
                  </label>
                  <input
                    id="token"
                    className={styles.input}
                    autoComplete="one-time-code"
                    spellCheck={false}
                    autoCapitalize="off"
                    placeholder="Paste the code from your email"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="newPassword">
                    New password
                  </label>
                  <input
                    id="newPassword"
                    className={styles.input}
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
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
                  disabled={busy || !token.trim() || newPassword.length < 8}
                >
                  {busy ? "Updating…" : "Update password"}
                </button>
                <button
                  type="button"
                  className={styles.ghostLink}
                  onClick={() => {
                    setStep("request");
                    setToken("");
                    setNewPassword("");
                    setError(null);
                  }}
                >
                  Use a different email
                </button>
              </form>
            </>
          ) : (
            <>
              <h1 className={styles.heading}>Reset your password</h1>
              <p className={styles.subheading}>
                We&rsquo;ll email a code you can use to choose a new one.
              </p>
              <form className={styles.form} onSubmit={handleRequest}>
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
                    autoFocus
                    required
                  />
                </div>
                {error ? (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                ) : null}
                <button type="submit" className={styles.submit} disabled={busy}>
                  {busy ? "Sending…" : "Send reset link"}
                </button>
              </form>
            </>
          )}
        </div>

        <p className={styles.footer}>
          Remembered it?{" "}
          <a className={styles.footerLink} href="/sign-in">
            Back to sign in
          </a>
        </p>
      </div>
    </main>
  );
}
