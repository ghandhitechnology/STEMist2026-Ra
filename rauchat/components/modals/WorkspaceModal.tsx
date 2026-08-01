"use client";

/**
 * components/modals/WorkspaceModal.tsx
 * Server workspace file browser: GET /api/files → { files } lists entries,
 * GET /api/files?path=... returns { path, content } for the monospace
 * viewer, POST /api/files creates a new file.
 */

import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { IconFile } from "./icons";
import styles from "./WorkspaceModal.module.css";

export type WorkspaceFileEntry = {
  path: string;
  size?: number;
  updatedAt?: number;
};

export type WorkspaceModalProps = {
  open: boolean;
  onClose: () => void;
};

type ListState = "idle" | "loading" | "loaded" | "error";
type ContentState = "idle" | "loading" | "loaded" | "error";

export function WorkspaceModal({ open, onClose }: WorkspaceModalProps) {
  const [files, setFiles] = useState<WorkspaceFileEntry[]>([]);
  const [listState, setListState] = useState<ListState>("idle");
  const [listError, setListError] = useState<string | null>(null);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [contentState, setContentState] = useState<ContentState>("idle");
  const [contentError, setContentError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [newContent, setNewContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function loadFiles() {
    setListState("loading");
    setListError(null);
    fetch("/api/files")
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json();
      })
      .then((data: { files: WorkspaceFileEntry[] }) => {
        setFiles(Array.isArray(data.files) ? data.files : []);
        setListState("loaded");
      })
      .catch((err: unknown) => {
        setListError(
          err instanceof Error ? err.message : "Failed to list workspace files"
        );
        setListState("error");
      });
  }

  useEffect(() => {
    if (!open) return;
    loadFiles();
    setSelectedPath(null);
    setContent("");
    setContentState("idle");
    setShowForm(false);
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function openFile(path: string) {
    setSelectedPath(path);
    setContentState("loading");
    setContentError(null);
    fetch(`/api/files?path=${encodeURIComponent(path)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json();
      })
      .then((data: { path: string; content: string }) => {
        setContent(data.content ?? "");
        setContentState("loaded");
      })
      .catch((err: unknown) => {
        setContentError(
          err instanceof Error ? err.message : "Failed to read file"
        );
        setContentState("error");
      });
  }

  async function handleCreate() {
    if (!newPath.trim()) {
      setFormError("Path is required.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: newPath.trim(), content: newContent }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setNewPath("");
      setNewContent("");
      setShowForm(false);
      loadFiles();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create file");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Workspace" size="large">
      <div className={styles.toolbar}>
        <span className={styles.count}>
          {listState === "loaded" ? `${files.length} files` : " "}
        </span>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonSecondary} ${styles.buttonSmall}`}
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? "Close" : "New file"}
        </button>
      </div>

      <div className={styles.layout}>
        <div className={styles.fileList}>
          {listState === "loading" && (
            <span className={styles.stateText}>Loading…</span>
          )}
          {listState === "error" && (
            <span className={styles.errorText}>{listError}</span>
          )}
          {listState === "loaded" && files.length === 0 && (
            <span className={styles.stateText}>No files yet.</span>
          )}
          {files.map((file) => (
            <button
              key={file.path}
              type="button"
              className={`${styles.fileRow} ${
                selectedPath === file.path ? styles.fileRowActive : ""
              }`}
              onClick={() => openFile(file.path)}
              title={file.path}
            >
              <IconFile size={14} />
              <span>{file.path}</span>
            </button>
          ))}
        </div>

        <div className={styles.pane}>
          {selectedPath ? (
            <>
              <div className={styles.paneHeader}>
                <span className={styles.panePath}>{selectedPath}</span>
              </div>
              <div className={styles.viewer}>
                {contentState === "loading" && (
                  <span className={styles.stateText}>Loading…</span>
                )}
                {contentState === "error" && (
                  <span className={styles.errorText}>{contentError}</span>
                )}
                {contentState === "loaded" && (
                  <pre className={styles.viewerContent}>{content}</pre>
                )}
              </div>
            </>
          ) : (
            <div className={styles.placeholder}>
              Select a file to view its contents.
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <div className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="rau-file-path">
              Path
            </label>
            <input
              id="rau-file-path"
              className={styles.input}
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder="notes/todo.md"
              spellCheck={false}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="rau-file-content">
              Content
            </label>
            <textarea
              id="rau-file-content"
              className={styles.textarea}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder=""
              rows={6}
            />
          </div>
          {formError && <span className={styles.errorText}>{formError}</span>}
          <div className={styles.formActions}>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonGhost}`}
              onClick={() => setShowForm(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              disabled={submitting}
              onClick={handleCreate}
            >
              {submitting ? "Creating…" : "Create file"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
