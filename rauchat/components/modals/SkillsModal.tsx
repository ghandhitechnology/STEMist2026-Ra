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
import { TOOL_NAMES, type Skill, type ToolName } from "@/lib/types";
import type {
  SkillPackage,
  SkillPackageView,
  SkillRevision,
} from "@/lib/skill-types";
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
type PackageDetail = SkillPackageView & { revisions: SkillRevision[] };

const TOOL_LABELS: Record<ToolName, string> = {
  web_search: "Web search",
  research: "Research mode",
  pdf_create: "Create PDFs",
  file_read: "Read workspace files",
  file_write: "Write workspace files",
  skill_make: "Create skills",
  diagram: "Create artifacts",
  svg_render: "Inline sketches",
  memory_add: "Save memory",
  browser_use: "Browser",
  bash: "Run shell commands",
  read: "Read sandbox files",
  write: "Write sandbox files",
  edit: "Edit sandbox files",
  ls: "List sandbox files",
  find: "Find sandbox files",
  grep: "Search sandbox files",
  web_fetch: "Fetch web pages",
  skills_list: "Find skills",
  skill_view: "View skills",
  skill_manage: "Manage skills",
  workflow_run: "Run workflows",
};

const CAPABILITY_TOOLS = TOOL_NAMES.map((id) => ({ id, label: TOOL_LABELS[id] }));

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
  const [skills, setSkills] = useState<SkillPackage[]>([]);
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
  const [packageDetail, setPackageDetail] = useState<PackageDetail | null>(null);
  const [packageLoading, setPackageLoading] = useState(false);
  const [packageError, setPackageError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
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
      .then((data: { skills: SkillPackage[] }) => {
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
      setPackageDetail(null);
      setPackageError(null);
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
    if (packageDetail?.skill.id === id) setPackageDetail(null);
    try {
      const res = await fetch(`/api/skills?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: "{}",
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
      if (packageDetail?.skill.id === id) await loadPackage(id);
    } catch {
      setSkills(previous);
      setLoadError("Couldn't update auto-load. Try again.");
    }
  }

  async function postSkill(input: SkillInput): Promise<SkillPackage> {
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
    return (await res.json()) as SkillPackage;
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
        const updated = (await response.json()) as SkillPackage;
        setSkills((previous) =>
          previous.map((skill) => (skill.id === updated.id ? updated : skill))
        );
        if (packageDetail?.skill.id === updated.id) setPackageDetail(null);
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
      const installed: SkillPackage[] = [];
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

  async function loadPackage(
    id: string,
    revision?: number,
    filePath = "SKILL.md"
  ) {
    setPackageLoading(true);
    setPackageError(null);
    try {
      const query = new URLSearchParams({ path: filePath });
      if (revision) query.set("revision", String(revision));
      const response = await fetch(
        `/api/skills/${encodeURIComponent(id)}?${query.toString()}`
      );
      const body = (await response.json().catch(() => null)) as
        | (PackageDetail & { error?: string })
        | null;
      if (!response.ok || !body) {
        throw new Error(body?.error ?? `Request failed (${response.status})`);
      }
      setPackageDetail(body);
    } catch (error) {
      setPackageError(
        error instanceof Error ? error.message : "Failed to load skill package."
      );
    } finally {
      setPackageLoading(false);
    }
  }

  function togglePackage(skill: SkillPackage) {
    if (packageDetail?.skill.id === skill.id) {
      setPackageDetail(null);
      setPackageError(null);
      return;
    }
    void loadPackage(skill.id);
  }

  async function restoreRevision(revision: number) {
    if (!packageDetail) return;
    setRestoring(true);
    setPackageError(null);
    try {
      const response = await fetch(
        `/api/skills/${encodeURIComponent(packageDetail.skill.id)}/revisions/${revision}/restore`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }
      );
      const body = (await response.json().catch(() => null)) as
        | (SkillPackage & { error?: string })
        | null;
      if (!response.ok || !body) {
        throw new Error(body?.error ?? `Request failed (${response.status})`);
      }
      setSkills((previous) =>
        previous.map((skill) => (skill.id === body.id ? body : skill))
      );
      await loadPackage(body.id);
    } catch (error) {
      setPackageError(
        error instanceof Error ? error.message : "Failed to restore revision."
      );
    } finally {
      setRestoring(false);
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
                      className={styles.packageButton}
                      aria-expanded={packageDetail?.skill.id === skill.id}
                      onClick={() => togglePackage(skill)}
                    >
                      Package
                    </button>
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

      {(packageLoading || packageError || packageDetail) && (
        <section className={styles.packagePanel} aria-label="Skill package">
          {packageLoading && !packageDetail ? (
            <p className={styles.stateText}>Loading package…</p>
          ) : null}
          {packageError ? <p className={styles.errorText}>{packageError}</p> : null}
          {packageDetail ? (
            <>
              <div className={styles.packageHeading}>
                <div>
                  <div className={styles.formHeading}>{packageDetail.skill.name}</div>
                  <span className={styles.fieldHint}>
                    Revision {packageDetail.revision.revision} of {packageDetail.skill.revision}
                  </span>
                </div>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonGhost} ${styles.buttonSmall}`}
                  onClick={() => setPackageDetail(null)}
                >
                  Close
                </button>
              </div>

              <div className={styles.packageColumns}>
                <div className={styles.packageSidebar}>
                  <span className={styles.packageLabel}>Files</span>
                  {packageDetail.revision.files.map((file) => (
                    <button
                      type="button"
                      key={file}
                      className={styles.fileButton}
                      data-active={packageDetail.path === file}
                      onClick={() =>
                        void loadPackage(
                          packageDetail.skill.id,
                          packageDetail.revision.revision,
                          file
                        )
                      }
                    >
                      {file}
                    </button>
                  ))}
                  <span className={styles.packageLabel}>History</span>
                  {packageDetail.revisions.map((revision) => (
                    <div className={styles.revisionRow} key={revision.revision}>
                      <button
                        type="button"
                        className={styles.revisionButton}
                        data-active={
                          packageDetail.revision.revision === revision.revision
                        }
                        onClick={() =>
                          void loadPackage(packageDetail.skill.id, revision.revision)
                        }
                      >
                        <span>Revision {revision.revision}</span>
                        <span>{new Date(revision.createdAt).toLocaleString()}</span>
                      </button>
                      {revision.revision !== packageDetail.skill.revision ? (
                        <button
                          type="button"
                          className={styles.restoreButton}
                          disabled={restoring}
                          onClick={() => void restoreRevision(revision.revision)}
                        >
                          Restore
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className={styles.packageFile}>
                  <div className={styles.packageFileName}>
                    {packageDetail.path ?? "Select a file"}
                  </div>
                  <pre className={styles.packageContent}>
                    {packageDetail.content ?? ""}
                  </pre>
                </div>
              </div>
            </>
          ) : null}
        </section>
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
