"use client";

/**
 * components/modals/SkillsModal.tsx
 * Lists skills (GET /api/skills → { skills: Skill[] }), creates a skill
 * (POST /api/skills), deletes a skill (DELETE /api/skills/:id), and lets
 * the user toggle a skill "active for this session" — a client-only flag,
 * lifted to the parent if `activeSkillIds`/`onToggleActive` are supplied,
 * otherwise held internally. Also lets the user toggle a skill's
 * "Auto-load" flag (PATCH /api/skills?id=<id> { autoLoad }), which the
 * server injects into every conversation's system prompt regardless of
 * per-session selection.
 */

import { useEffect, useState } from "react";
import type { Skill } from "@/lib/types";
import { Modal } from "./Modal";
import { IconTrash } from "./icons";
import styles from "./SkillsModal.module.css";

export type SkillsModalProps = {
  open: boolean;
  onClose: () => void;
  /** Controlled active-set; omit to let the modal manage it internally. */
  activeSkillIds?: string[];
  onToggleActive?: (id: string, active: boolean) => void;
};

type LoadState = "idle" | "loading" | "loaded" | "error";

export function SkillsModal({
  open,
  onClose,
  activeSkillIds,
  onToggleActive,
}: SkillsModalProps) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [internalActive, setInternalActive] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formInstructions, setFormInstructions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const activeSet =
    activeSkillIds !== undefined ? new Set(activeSkillIds) : internalActive;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadState("loading");
    setLoadError(null);
    fetch("/api/skills")
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json();
      })
      .then((data: { skills: Skill[] }) => {
        if (cancelled) return;
        setSkills(Array.isArray(data.skills) ? data.skills : []);
        setLoadState("loaded");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load skills");
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setConfirmDeleteId(null);
      setShowForm(false);
      setFormError(null);
    }
  }, [open]);

  function toggleActive(id: string) {
    const isActive = activeSet.has(id);
    if (onToggleActive) {
      onToggleActive(id, !isActive);
      return;
    }
    setInternalActive((prev) => {
      const next = new Set(prev);
      if (isActive) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDelete(id: string) {
    const previous = skills;
    setSkills((prev) => prev.filter((s) => s.id !== id));
    setConfirmDeleteId(null);
    try {
      const res = await fetch(`/api/skills?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
    } catch {
      setSkills(previous);
      setLoadError("Couldn't delete skill. Try again.");
    }
  }

  async function handleToggleAutoLoad(id: string, nextAutoLoad: boolean) {
    const previous = skills;
    setSkills((prev) =>
      prev.map((s) => (s.id === id ? { ...s, autoLoad: nextAutoLoad } : s))
    );
    try {
      const res = await fetch(`/api/skills?id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoLoad: nextAutoLoad }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setSkills(previous);
      setLoadError("Couldn't update auto-load. Try again.");
    }
  }

  async function handleCreate() {
    if (!formName.trim() || !formInstructions.trim()) {
      setFormError("Name and instructions are required.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName.trim(),
          description: formDescription.trim(),
          instructions: formInstructions,
        }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const created: Skill = await res.json();
      setSkills((prev) => [created, ...prev]);
      setFormName("");
      setFormDescription("");
      setFormInstructions("");
      setShowForm(false);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Failed to create skill"
      );
    } finally {
      setSubmitting(false);
    }
  }

  const isEmpty = loadState === "loaded" && skills.length === 0 && !showForm;

  return (
    <Modal open={open} onClose={onClose} title="Skills" size="large">
      <div className={styles.toolbar}>
        <span className={styles.count}>
          {loadState === "loaded" ? `${skills.length} installed` : " "}
        </span>
        {!showForm && (
          <button
            type="button"
            className={`${styles.button} ${styles.buttonSecondary} ${styles.buttonSmall}`}
            onClick={() => setShowForm(true)}
          >
            New skill
          </button>
        )}
      </div>

      <p className={styles.explainer}>
        Auto-loaded skills are active in every conversation.
      </p>

      {loadState === "loading" && (
        <p className={styles.stateText}>Loading skills…</p>
      )}
      {loadState === "error" && (
        <p className={styles.errorText}>{loadError}</p>
      )}

      {isEmpty && (
        <div className={styles.empty}>
          <p className={styles.emptyHeadline}>No skills installed</p>
          <p className={styles.emptyBody}>
            Skills are reusable procedures. Ask Rauchat to build one, or
            install from a file.
          </p>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonSecondary}`}
            onClick={() => setShowForm(true)}
          >
            New skill
          </button>
        </div>
      )}

      {loadState === "loaded" && skills.length > 0 && (
        <div className={styles.list}>
          {skills.map((skill) => (
            <div key={skill.id} className={styles.row}>
              <div className={styles.rowBody}>
                <span className={styles.rowName}>
                  {skill.name}
                  <span className={styles.tag}>Generated</span>
                  {skill.autoLoad && (
                    <span className={styles.autoTag}>
                      <span className={styles.autoDot} />
                      auto
                    </span>
                  )}
                </span>
                <span className={styles.rowDesc}>{skill.description}</span>
              </div>
              <div className={styles.rowActions}>
                {confirmDeleteId === skill.id ? (
                  <div className={styles.confirmRow}>
                    <span className={styles.confirmText}>Delete skill?</span>
                    <div className={styles.confirmActions}>
                      <button
                        type="button"
                        className={`${styles.button} ${styles.buttonGhost} ${styles.buttonSmall}`}
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className={`${styles.button} ${styles.buttonDanger} ${styles.buttonSmall}`}
                        onClick={() => handleDelete(skill.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className={styles.deleteIcon}
                      aria-label={`Delete ${skill.name}`}
                      onClick={() => setConfirmDeleteId(skill.id)}
                    >
                      <IconTrash size={14} />
                    </button>
                    <div className={styles.autoLoadControl}>
                      <span className={styles.autoLoadLabel}>Auto-load</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={skill.autoLoad ?? false}
                        aria-label={`Auto-load ${skill.name} in every conversation`}
                        className={styles.switch}
                        data-on={skill.autoLoad ?? false}
                        onClick={() =>
                          handleToggleAutoLoad(skill.id, !(skill.autoLoad ?? false))
                        }
                      >
                        <span className={styles.switchKnob} />
                      </button>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={activeSet.has(skill.id)}
                      aria-label={`Activate ${skill.name} for this session`}
                      className={styles.switch}
                      data-on={activeSet.has(skill.id)}
                      onClick={() => toggleActive(skill.id)}
                    >
                      <span className={styles.switchKnob} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="rau-skill-name">
              Name
            </label>
            <input
              id="rau-skill-name"
              className={styles.input}
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Weekly digest"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="rau-skill-desc">
              Description
            </label>
            <input
              id="rau-skill-desc"
              className={styles.input}
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Summarizes the week's changes"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="rau-skill-instructions">
              Instructions
            </label>
            <textarea
              id="rau-skill-instructions"
              className={styles.textarea}
              value={formInstructions}
              onChange={(e) => setFormInstructions(e.target.value)}
              placeholder="Step-by-step instructions the model should follow…"
              rows={6}
            />
          </div>
          {formError && <span className={styles.errorText}>{formError}</span>}
          <div className={styles.formActions}>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonGhost}`}
              onClick={() => {
                setShowForm(false);
                setFormError(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              disabled={submitting}
              onClick={handleCreate}
            >
              {submitting ? "Creating…" : "Create skill"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
