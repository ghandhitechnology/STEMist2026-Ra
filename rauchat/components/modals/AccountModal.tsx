"use client";

/**
 * components/modals/AccountModal.tsx
 * The signed-in user's account surface (DESIGN.md §4.14 modal).
 * Sections: Profile (name / nickname / preferred language, PUT /api/profile),
 * Connections (link an OAuth provider), Session (sign out), Danger
 * (two-step account deletion via DELETE /api/account).
 *
 * Shapes here mirror lib/server/profile.ts and GET /api/profile; they're
 * declared locally so this client component never imports a server module.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "./Modal";
import styles from "./AccountModal.module.css";

/** Same option list as the first-run /setup page. */
export const LANGUAGE_OPTIONS = [
  "English",
  "한국어 (Korean)",
  "日本語 (Japanese)",
  "中文 (Chinese)",
  "Español",
  "Français",
  "Deutsch",
  "Other…",
] as const;

/** Browsers swallow hover on a disabled button, so this also sits on the row. */
const CONNECT_DIRTY_TITLE =
  "Save your profile changes before connecting a provider.";

async function endSession(): Promise<void> {
  const res = await fetch("/signout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(String(res.status));
  window.location.href = "/sign-in";
}

export type AccountProfile = {
  firstName: string;
  lastName: string;
  nickname: string;
  preferredLanguage: string;
  createdAt: number;
  updatedAt: number;
};

export type AccountUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profilePictureUrl: string | null;
};

export type Account = {
  profile: AccountProfile;
  user: AccountUser;
};

/** 1–2 characters for the square avatar fallback: two words give two
 * initials, anything else gives a single leading character. */
export function accountInitials(account: Account | null): string {
  const source =
    account?.profile.nickname?.trim() ||
    account?.user.firstName?.trim() ||
    account?.user.email?.trim() ||
    "";
  if (!source) return "";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return source[0].toUpperCase();
}

export function accountFullName(account: Account): string {
  const full = `${account.profile.firstName} ${account.profile.lastName}`.trim();
  return full || account.profile.nickname || account.user.email;
}

type FormState = {
  firstName: string;
  lastName: string;
  nickname: string;
  preferredLanguage: string;
};

function formFor(account: Account | null): FormState {
  return {
    firstName: account?.profile.firstName ?? "",
    lastName: account?.profile.lastName ?? "",
    nickname: account?.profile.nickname ?? "",
    preferredLanguage: account?.profile.preferredLanguage ?? LANGUAGE_OPTIONS[0],
  };
}

export type AccountModalProps = {
  open: boolean;
  onClose: () => void;
  account: Account | null;
  /** Fired after a successful save so the parent can re-fetch /api/profile. */
  onUpdated?: () => void;
};

export function AccountModal({
  open,
  onClose,
  account,
  onUpdated,
}: AccountModalProps) {
  const [form, setForm] = useState<FormState>(() => formFor(account));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Seed the form once per open (and again if the account arrives while the
  // modal is already up), so an abandoned edit never survives into the next
  // visit and a post-save refresh doesn't wipe the confirmation line.
  const seededRef = useRef<Account | null | undefined>(undefined);
  useEffect(() => {
    if (!open) {
      seededRef.current = undefined;
      return;
    }
    const seeded = seededRef.current;
    if (seeded !== undefined && !(seeded === null && account !== null)) return;
    seededRef.current = account;
    setForm(formFor(account));
    setSaving(false);
    setSaved(false);
    setError(null);
    setConfirmingDelete(false);
    setDeleteConfirmText("");
    setDeleting(false);
    setSigningOut(false);
  }, [open, account]);

  const dirty = useMemo(() => {
    const base = formFor(account);
    return (
      base.firstName !== form.firstName ||
      base.lastName !== form.lastName ||
      base.nickname !== form.nickname ||
      base.preferredLanguage !== form.preferredLanguage
    );
  }, [account, form]);

  const busy = saving || deleting || signingOut;
  const canSave = Boolean(account) && dirty && !busy && form.nickname.trim().length > 0;

  // Deletion is irreversible, so it is never one click away from another
  // click: the user has to type this word out first. The saved nickname is
  // the challenge; accounts that never set one use their email local-part.
  const deleteChallenge = useMemo(() => {
    const nickname = account?.profile.nickname.trim();
    if (nickname) return nickname;
    return account?.user.email.split("@")[0]?.trim() ?? "";
  }, [account]);

  const deleteArmed =
    deleteChallenge.length > 0 &&
    deleteConfirmText.trim().toLowerCase() === deleteChallenge.toLowerCase();

  function patch(next: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...next }));
    setSaved(false);
    setError(null);
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          nickname: form.nickname.trim(),
          preferredLanguage: form.preferredLanguage,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSaved(true);
      onUpdated?.();
    } catch {
      setError("Could not save changes. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function armDelete() {
    setConfirmingDelete(true);
    setDeleteConfirmText("");
    setError(null);
  }

  function cancelDelete() {
    setConfirmingDelete(false);
    setDeleteConfirmText("");
  }

  async function handleDelete() {
    if (!confirmingDelete || !deleteArmed || busy) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      await endSession();
    } catch {
      setDeleting(false);
      setError("Could not delete the account. Try again.");
    }
  }

  async function handleSignOut() {
    if (busy) return;
    setSigningOut(true);
    setError(null);
    try {
      await endSession();
    } catch {
      setSigningOut(false);
      setError("Could not sign out. Try again.");
    }
  }

  const avatarUrl = account?.user.profilePictureUrl ?? null;
  const initials = accountInitials(account);

  return (
    <Modal open={open} onClose={onClose} title="Account">
      <section className={styles.section}>
        <h3 className={styles.sectionLabel}>Profile</h3>

        <div className={styles.identity}>
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className={styles.avatarLarge}
              src={avatarUrl}
              alt=""
              width={40}
              height={40}
            />
          ) : (
            <span className={styles.avatarLarge} aria-hidden="true">
              {initials}
            </span>
          )}
          <span className={styles.identityText}>
            <span className={styles.identityName}>
              {account ? accountFullName(account) : "—"}
            </span>
            <span className={styles.identityEmail}>
              {account?.user.email ?? "—"}
            </span>
          </span>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <div className={styles.fieldGrid}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="rau-account-first">
                First name
              </label>
              <input
                id="rau-account-first"
                className={styles.input}
                type="text"
                value={form.firstName}
                autoComplete="given-name"
                disabled={!account || busy}
                onChange={(event) => patch({ firstName: event.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="rau-account-last">
                Last name
              </label>
              <input
                id="rau-account-last"
                className={styles.input}
                type="text"
                value={form.lastName}
                autoComplete="family-name"
                disabled={!account || busy}
                onChange={(event) => patch({ lastName: event.target.value })}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="rau-account-nickname">
              Nickname
            </label>
            <input
              id="rau-account-nickname"
              className={styles.input}
              type="text"
              value={form.nickname}
              spellCheck={false}
              disabled={!account || busy}
              onChange={(event) => patch({ nickname: event.target.value })}
              placeholder="What Rauchat calls you"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="rau-account-language">
              Preferred language
            </label>
            <select
              id="rau-account-language"
              className={styles.select}
              value={form.preferredLanguage}
              disabled={!account || busy}
              onChange={(event) => patch({ preferredLanguage: event.target.value })}
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              {form.preferredLanguage &&
              !LANGUAGE_OPTIONS.includes(
                form.preferredLanguage as (typeof LANGUAGE_OPTIONS)[number]
              ) ? (
                <option value={form.preferredLanguage}>
                  {form.preferredLanguage}
                </option>
              ) : null}
            </select>
          </div>

          <div className={styles.actions}>
            <span
              className={styles.actionsNote}
              role="status"
              aria-live="polite"
            >
              {error ? (
                <span className={styles.errorText}>{error}</span>
              ) : saved ? (
                "Saved."
              ) : (
                ""
              )}
            </span>
            <button
              type="submit"
              className={`${styles.button} ${styles.buttonPrimary}`}
              disabled={!canSave}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionLabel}>Connections</h3>
        {/* Both buttons leave the page, so they stay disabled while the
            profile form has unsaved edits — otherwise the edits vanish. */}
        <div
          className={styles.connectRow}
          title={dirty ? CONNECT_DIRTY_TITLE : undefined}
        >
          <button
            type="button"
            className={`${styles.button} ${styles.buttonSecondary}`}
            disabled={busy || dirty}
            title={dirty ? CONNECT_DIRTY_TITLE : undefined}
            onClick={() => {
              window.location.href = "/api/auth/oauth?provider=GoogleOAuth";
            }}
          >
            Connect Google
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonSecondary}`}
            disabled={busy || dirty}
            title={dirty ? CONNECT_DIRTY_TITLE : undefined}
            onClick={() => {
              window.location.href = "/api/auth/oauth?provider=GitHubOAuth";
            }}
          >
            Connect GitHub
          </button>
        </div>
        <p className={styles.note}>
          Signing in with a provider that uses this email address links it.
          Signing in with a different address starts a different account.
        </p>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionLabel}>Session</h3>
        <div className={styles.sessionRow}>
          <span className={styles.note}>
            Ends this session on this device.
          </span>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonSecondary}`}
            disabled={busy}
            onClick={handleSignOut}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </section>

      <section className={styles.dangerSection}>
        <h3 className={styles.sectionLabel}>Danger</h3>
        <div className={styles.dangerRow}>
          <div className={styles.dangerCopy}>
            <span className={styles.dangerTitle}>Delete account</span>
            <span className={styles.dangerHint}>
              {confirmingDelete
                ? "This deletes your account, files, skills, diagrams, and memory. It cannot be undone."
                : "Removes your account and everything stored with it."}
            </span>
          </div>
          <div className={styles.dangerActions}>
            {confirmingDelete && !deleting && (
              <button
                key="cancel-delete"
                type="button"
                className={`${styles.button} ${styles.buttonGhost}`}
                onClick={cancelDelete}
              >
                Cancel
              </button>
            )}
            {/* Distinct keys: the confirm button is a different node, so it
                never inherits the hover/focus state of the arm button. */}
            {confirmingDelete ? (
              <button
                key="confirm-delete"
                type="button"
                className={`${styles.button} ${styles.buttonDangerSolid}`}
                disabled={busy || !deleteArmed}
                onClick={() => void handleDelete()}
              >
                {deleting ? "Deleting…" : "Confirm delete"}
              </button>
            ) : (
              <button
                key="arm-delete"
                type="button"
                className={`${styles.button} ${styles.buttonDanger}`}
                disabled={busy || deleteChallenge.length === 0}
                onClick={armDelete}
              >
                Delete account
              </button>
            )}
          </div>
        </div>

        {confirmingDelete && (
          <div className={styles.dangerConfirm}>
            <label
              className={styles.dangerLabel}
              htmlFor="rau-account-delete-confirm"
            >
              Type {deleteChallenge} to confirm
            </label>
            <input
              id="rau-account-delete-confirm"
              className={`${styles.input} ${styles.dangerInput}`}
              type="text"
              value={deleteConfirmText}
              autoComplete="off"
              spellCheck={false}
              disabled={deleting}
              placeholder={deleteChallenge}
              onChange={(event) => setDeleteConfirmText(event.target.value)}
            />
          </div>
        )}
      </section>
    </Modal>
  );
}
