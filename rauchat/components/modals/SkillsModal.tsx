"use client";

/**
 * components/modals/SkillsModal.tsx
 * Lists, creates, imports, deletes, and configures skills through /api/skills.
 * Skills can declare tool capabilities and dependencies on other skills. It lets
 * the user toggle a skill "active for this session" — a client-only flag,
 * lifted to the parent if `activeSkillIds`/`onToggleActive` are supplied,
 * otherwise held internally. Also lets the user toggle a skill's
 * "Auto-load" flag (PATCH /api/skills?id=<id> { autoLoad }), which the
 * server injects into every conversation's system prompt regardless of
 * per-session selection.
 */

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { Skill, ToolName } from "@/lib/types";
import { Modal } from "./Modal";
import { IconPencil, IconTrash } from "./icons";
import styles from "./SkillsModal.module.css";

export type SkillsModalProps = {
  open: boolean;
  onClose: () => void;
  /** Controlled active-set; omit to let the modal manage it internally. */
  activeSkillIds?: string[];
  onToggleActive?: (id: string, active: boolean) => void;
};

type LoadState = "idle" | "loading" | "loaded" | "error";

const CAPABILITY_TOOLS: Array<{ id: ToolName; label: string }> = [
  { id: "web_search", label: "Web search" },
  { id: "research", label: "Research mode" },
  { id: "pdf_create", label: "Create PDFs" },
  { id: "file_read", label: "Read files" },
  { id: "file_write", label: "Write files" },
  { id: "skill_make", label: "Draft skills" },
  { id: "diagram", label: "Create artifacts" },
  { id: "svg_render", label: "Inline sketch lean-in" },
  { id: "memory_add", label: "Save memory" },
  { id: "browser_use", label: "Browser use" },
];

type SkillInput = {
  name: string;
  description: string;
  instructions: string;
  source?: NonNullable<Skill["source"]>;
  capabilities: NonNullable<Skill["capabilities"]>;
  /** Original id from an imported file; used only to remap dependencies. */
  importId?: string;
};

function sourceLabel(skill: Skill): string {
  if (skill.source === "generated") return "Generated";
  if (skill.source === "imported") return "Imported";
  return "Manual";
}

function capabilitySummary(skill: Skill): string {
  const toolCount = skill.capabilities?.tools.length ?? 0;
  const skillCount = skill.capabilities?.skills.length ?? 0;
  const parts: string[] = [];
  if (toolCount) parts.push(`${toolCount} tool${toolCount === 1 ? "" : "s"}`);
  if (skillCount) parts.push(`${skillCount} skill${skillCount === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function importableSkill(raw: unknown): SkillInput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const description =
    typeof record.description === "string" ? record.description.trim() : "";
  const instructions =
    typeof record.instructions === "string" ? record.instructions.trim() : "";
  if (
    !name ||
    name.length > 100 ||
    !description ||
    description.length > 300 ||
    !instructions ||
    instructions.length > 20000
  ) {
    return null;
  }

  const rawCapabilities =
    record.capabilities && typeof record.capabilities === "object"
      ? (record.capabilities as Record<string, unknown>)
      : record;
  const tools = Array.isArray(rawCapabilities.tools)
    ? rawCapabilities.tools.filter(
        (tool): tool is ToolName =>
          typeof tool === "string" &&
          CAPABILITY_TOOLS.some((candidate) => candidate.id === tool)
      )
    : [];
  const skills = Array.isArray(rawCapabilities.skills)
    ? rawCapabilities.skills
        .filter((skill): skill is string => typeof skill === "string")
        .map((skill) => skill.trim())
        .filter(Boolean)
    : [];
  return {
    name,
    description,
    instructions,
    source: "imported",
    capabilities: { tools, skills },
    ...(typeof record.id === "string" ? { importId: record.id } : {}),
  };
}

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formInstructions, setFormInstructions] = useState("");
  const [formTools, setFormTools] = useState<Set<ToolName>>(new Set());
  const [formSkills, setFormSkills] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

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
      setImportStatus(null);
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

  async function postSkill(input: SkillInput): Promise<Skill> {
    const res = await fetch("/api/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: unknown }
        | null;
      throw new Error(
        typeof body?.error === "string" ? body.error : `Request failed (${res.status})`
      );
    }
    return (await res.json()) as Skill;
  }

  function resetForm() {
    setFormName("");
    setFormDescription("");
    setFormInstructions("");
    setFormTools(new Set());
    setFormSkills(new Set());
    setFormError(null);
    setEditingId(null);
  }

  function openNewSkillForm() {
    resetForm();
    setShowForm(true);
  }

  function openEditSkillForm(skill: Skill) {
    setEditingId(skill.id);
    setFormName(skill.name);
    setFormDescription(skill.description);
    setFormInstructions(skill.instructions);
    setFormTools(new Set(skill.capabilities?.tools ?? []));
    setFormSkills(new Set(skill.capabilities?.skills ?? []));
    setFormError(null);
    setShowForm(true);
  }

  async function handleSubmit() {
    if (!formName.trim() || !formDescription.trim() || !formInstructions.trim()) {
      setFormError("Name, description, and instructions are required.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const payload = {
        name: formName.trim(),
        description: formDescription.trim(),
        instructions: formInstructions.trim(),
        capabilities: {
          tools: Array.from(formTools),
          skills: Array.from(formSkills),
        },
      };
      if (editingId) {
        const response = await fetch(
          `/api/skills?id=${encodeURIComponent(editingId)}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify(payload),
          }
        );
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as
            | { error?: unknown }
            | null;
          throw new Error(
            typeof body?.error === "string"
              ? body.error
              : `Request failed (${response.status})`
          );
        }
        const updated = (await response.json()) as Skill;
        setSkills((previous) =>
          previous.map((skill) => (skill.id === updated.id ? updated : skill))
        );
      } else {
        const created = await postSkill({
          ...payload,
          source: "manual",
        });
        setSkills((prev) => [created, ...prev]);
      }
      resetForm();
      setShowForm(false);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Failed to create skill"
      );
    } finally {
      setSubmitting(false);
    }
  }

  function toggleFormTool(tool: ToolName) {
    setFormTools((previous) => {
      const next = new Set(previous);
      if (next.has(tool)) next.delete(tool);
      else next.add(tool);
      return next;
    });
  }

  function toggleFormSkill(id: string) {
    setFormSkills((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 1_000_000) {
      setImportStatus("Skill files must be smaller than 1 MB.");
      return;
    }

    setImporting(true);
    setImportStatus(null);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const container =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
      const rawSkills = Array.isArray(parsed)
        ? parsed
        : Array.isArray(container?.skills)
          ? container.skills
          : container?.skill
            ? [container.skill]
            : [parsed];
      const pending = rawSkills.map(importableSkill);
      if (pending.some((skill) => skill === null)) {
        throw new Error(
          "Each imported skill needs a name, description, and instructions."
        );
      }

      const queue = pending as SkillInput[];
      const importedIdToName = new Map(
        queue
          .filter((skill) => skill.importId)
          .map((skill) => [skill.importId!, skill.name] as const)
      );
      for (const skill of queue) {
        skill.capabilities = {
          ...skill.capabilities,
          skills: skill.capabilities.skills.map(
            (reference) => importedIdToName.get(reference) ?? reference
          ),
        };
      }
      const available = [...skills];
      const knownReferences = new Set([
        ...available.flatMap((skill) => [skill.id, skill.name.toLowerCase()]),
        ...queue.map((skill) => skill.name.toLowerCase()),
      ]);
      const unknownReference = queue
        .flatMap((skill) => skill.capabilities.skills)
        .find(
          (reference) =>
            !knownReferences.has(reference) &&
            !knownReferences.has(reference.toLowerCase())
        );
      if (unknownReference) {
        throw new Error(`Unknown skill capability: ${unknownReference}`);
      }
      const installed: Skill[] = [];
      while (queue.length) {
        const pendingNames = new Set(queue.map((skill) => skill.name.toLowerCase()));
        const index = queue.findIndex((skill) =>
          skill.capabilities.skills.every((reference) => {
            const normalized = reference.toLowerCase();
            return (
              available.some(
                (candidate) =>
                  candidate.id === reference ||
                  candidate.name.toLowerCase() === normalized
              ) || !pendingNames.has(normalized)
            );
          })
        );
        if (index === -1) {
          throw new Error("Imported skills contain a circular dependency.");
        }
        const [next] = queue.splice(index, 1);
        const { importId: _importId, ...payload } = next;
        void _importId;
        const created = await postSkill(payload);
        available.push(created);
        installed.push(created);
      }

      setSkills((previous) => [
        ...installed,
        ...previous.filter(
          (skill) => !installed.some((created) => created.id === skill.id)
        ),
      ]);
      setImportStatus(
        `Installed ${installed.length} skill${installed.length === 1 ? "" : "s"} from ${file.name}.`
      );
    } catch (error) {
      setImportStatus(
        error instanceof Error ? error.message : "The skill file could not be imported."
      );
    } finally {
      setImporting(false);
    }
  }

  const isEmpty = loadState === "loaded" && skills.length === 0 && !showForm;

  return (
    <Modal open={open} onClose={onClose} title="Skills" size="large">
      <div className={styles.toolbar}>
        <span className={styles.count}>
          {loadState === "loaded" ? `${skills.length} installed` : " "}
        </span>
        <div className={styles.toolbarActions}>
          <input
            ref={importInputRef}
            className={styles.fileInput}
            type="file"
            accept=".json,application/json"
            onChange={(event) => void handleImport(event)}
          />
          <button
            type="button"
            className={`${styles.button} ${styles.buttonGhost} ${styles.buttonSmall}`}
            disabled={importing}
            onClick={() => importInputRef.current?.click()}
          >
            {importing ? "Installing…" : "Install from file"}
          </button>
          {!showForm && (
            <button
              type="button"
              className={`${styles.button} ${styles.buttonSecondary} ${styles.buttonSmall}`}
              onClick={openNewSkillForm}
            >
              New skill
            </button>
          )}
        </div>
      </div>

      <p className={styles.explainer}>
        Select one skill for this session, or auto-load skills in every conversation.
      </p>

      {importStatus ? (
        <p className={styles.importStatus} role="status">
          {importStatus}
        </p>
      ) : null}

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
            onClick={openNewSkillForm}
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
                  <span className={styles.tag}>{sourceLabel(skill)}</span>
                  {skill.autoLoad && (
                    <span className={styles.autoTag}>
                      <span className={styles.autoDot} />
                      auto
                    </span>
                  )}
                </span>
                <span className={styles.rowDesc}>
                  {skill.description}
                  {capabilitySummary(skill) ? (
                    <span className={styles.capabilitySummary}>
                      {` · ${capabilitySummary(skill)}`}
                    </span>
                  ) : null}
                </span>
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
                      className={styles.editIcon}
                      aria-label={`Edit ${skill.name}`}
                      onClick={() => openEditSkillForm(skill)}
                    >
                      <IconPencil size={14} />
                    </button>
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
          <div className={styles.formHeading}>
            {editingId ? "Edit skill" : "New skill"}
          </div>
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
          <fieldset className={styles.capabilityFieldset}>
            <legend className={styles.label}>Tool capabilities</legend>
            <span className={styles.fieldHint}>
              These tools become available whenever the skill is active.
            </span>
            <div className={styles.capabilityGrid}>
              {CAPABILITY_TOOLS.map((tool) => (
                <label className={styles.capabilityOption} key={tool.id}>
                  <input
                    type="checkbox"
                    checked={formTools.has(tool.id)}
                    onChange={() => toggleFormTool(tool.id)}
                  />
                  <span>{tool.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className={styles.capabilityFieldset}>
            <legend className={styles.label}>Skill capabilities</legend>
            <span className={styles.fieldHint}>
              Activate these installed skills as dependencies.
            </span>
            {skills.some((skill) => skill.id !== editingId) ? (
              <div className={styles.capabilityGrid}>
                {skills
                  .filter((skill) => skill.id !== editingId)
                  .map((skill) => (
                  <label className={styles.capabilityOption} key={skill.id}>
                    <input
                      type="checkbox"
                      checked={formSkills.has(skill.id)}
                      onChange={() => toggleFormSkill(skill.id)}
                    />
                    <span>{skill.name}</span>
                  </label>
                  ))}
              </div>
            ) : (
              <span className={styles.fieldHint}>No other skills installed.</span>
            )}
          </fieldset>
          {formError && <span className={styles.errorText}>{formError}</span>}
          <div className={styles.formActions}>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonGhost}`}
              onClick={() => {
                resetForm();
                setShowForm(false);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              disabled={submitting}
              onClick={handleSubmit}
            >
              {submitting
                ? editingId
                  ? "Saving…"
                  : "Creating…"
                : editingId
                  ? "Save changes"
                  : "Create skill"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
