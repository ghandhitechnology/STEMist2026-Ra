"use client";

/**
 * components/diagrams/DiagramPanel.tsx — the diagram viewer column.
 *
 * Header (title, kind, actions) → Preview/Code tabs + version picker → body.
 * Runnable kinds render in a sandboxed iframe built by lib/diagram-runtime;
 * markdown renders as prose and code as highlighted read-only text.
 *
 * The iframe is keyed on (id, version, reload) so switching revisions or
 * hitting Reload remounts it — reassigning srcDoc alone does not reliably
 * re-run scripts in an already-loaded frame.
 */

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { Diagram } from "@/lib/types";
import { codeLanguageFor, contentAtVersion, kindLabel } from "@/lib/diagrams";
import {
  DIAGRAM_SANDBOX,
  buildDiagramDocument,
  extensionFor,
  isRunnable,
} from "@/lib/diagram-runtime";
// Imported by path rather than through the chat barrel: ToolEventCard pulls
// in DiagramCard, so going through the barrel would form an import cycle.
import { CodeBlock, Markdown } from "@/components/chat/Markdown";
import {
  IconCheck,
  IconCopy,
  IconDownload,
  IconExternal,
  IconRegenerate,
  IconX,
} from "@/components/chat/icons";
import chatStyles from "@/components/chat/chat.module.css";
import styles from "./diagrams.module.css";

export type DiagramPanelProps = {
  diagram: Diagram | null;
  onClose: () => void;
};

type Tab = "preview" | "code";

export const DiagramPanel = memo(function DiagramPanel({
  diagram,
  onClose,
}: DiagramPanelProps) {
  const [tab, setTab] = useState<Tab>("preview");
  const [version, setVersion] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);

  const diagramId = diagram?.id ?? null;
  const runnable = diagram ? isRunnable(diagram.kind) : false;

  // A new diagram starts on its newest version, and on the tab that suits
  // its kind (non-runnable kinds have no meaningful preview/code split).
  useEffect(() => {
    setVersion(null);
    setReloadKey((k) => k + 1);
    setTab("preview");
  }, [diagramId]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(id);
  }, [copied]);

  const content = diagram ? contentAtVersion(diagram, version) : "";

  const doc = useMemo(
    () =>
      diagram && runnable
        ? buildDiagramDocument(diagram.kind, content, diagram.title)
        : "",
    [diagram, runnable, content]
  );

  const copy = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard
      .writeText(content)
      .then(() => setCopied(true))
      .catch(() => undefined);
  }, [content]);

  const download = useCallback(() => {
    if (!diagram) return;
    const ext = extensionFor(diagram.kind, diagram.language);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${diagram.id}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [diagram, content]);

  if (!diagram) {
    return (
      <div className={styles.panel}>
        <div className={styles.empty}>No diagram selected.</div>
      </div>
    );
  }

  const versions = diagram.versions ?? [];
  const showingVersion = version ?? diagram.version;
  const isStale = showingVersion !== diagram.version;
  const showPreview = tab === "preview";

  return (
    <div className={styles.panel} aria-label="Diagram">
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <span className={styles.title} title={diagram.title}>
            {diagram.title}
          </span>
          <span className={styles.badge}>
            {kindLabel(diagram.kind, diagram.language)}
          </span>
        </div>
        <div className={styles.headerActions}>
          {runnable && showPreview ? (
            <button
              type="button"
              className={`${chatStyles.iconBtn} ${chatStyles.iconBtnSm}`}
              onClick={() => setReloadKey((k) => k + 1)}
              aria-label="Reload preview"
              title="Reload preview"
            >
              <IconRegenerate size={15} />
            </button>
          ) : null}
          <button
            type="button"
            className={`${chatStyles.iconBtn} ${chatStyles.iconBtnSm}`}
            onClick={copy}
            aria-label={copied ? "Copied" : "Copy source"}
            title={copied ? "Copied" : "Copy source"}
          >
            {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
          </button>
          <button
            type="button"
            className={`${chatStyles.iconBtn} ${chatStyles.iconBtnSm}`}
            onClick={download}
            aria-label="Download"
            title="Download"
          >
            <IconDownload size={15} />
          </button>
          <a
            className={`${chatStyles.iconBtn} ${chatStyles.iconBtnSm}`}
            href={`/api/diagrams/${diagram.id}/raw?v=${showingVersion}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open in new tab"
            title="Open in new tab"
          >
            <IconExternal size={15} />
          </a>
          <button
            type="button"
            className={`${chatStyles.iconBtn} ${chatStyles.iconBtnSm}`}
            onClick={onClose}
            aria-label="Close diagram"
            title="Close diagram"
          >
            <IconX size={15} />
          </button>
        </div>
      </header>

      <div className={styles.subbar}>
        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={showPreview}
            className={`${styles.tab} ${showPreview ? styles.tabOn : ""}`}
            onClick={() => setTab("preview")}
          >
            {runnable ? "Preview" : "Rendered"}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!showPreview}
            className={`${styles.tab} ${!showPreview ? styles.tabOn : ""}`}
            onClick={() => setTab("code")}
          >
            Source
          </button>
        </div>

        <div className={styles.versions}>
          {isStale ? <span className={styles.staleFlag}>older version</span> : null}
          {versions.length > 1 ? (
            <select
              className={styles.versionSelect}
              value={String(showingVersion)}
              onChange={(e) => {
                const next = Number(e.target.value);
                setVersion(next === diagram.version ? null : next);
                setReloadKey((k) => k + 1);
              }}
              aria-label="Version"
            >
              {versions.map((v) => (
                <option key={v.version} value={String(v.version)}>
                  v{v.version}
                </option>
              ))}
            </select>
          ) : (
            <span>v{showingVersion}</span>
          )}
        </div>
      </div>

      <div className={styles.body}>
        {showPreview ? (
          runnable ? (
            <iframe
              key={`${diagram.id}:${showingVersion}:${reloadKey}`}
              className={styles.frame}
              srcDoc={doc}
              sandbox={DIAGRAM_SANDBOX}
              title={diagram.title}
            />
          ) : diagram.kind === "markdown" ? (
            <div className={styles.proseScroll}>
              <Markdown content={content} />
            </div>
          ) : (
            <div className={styles.scroll}>
              <CodeBlock code={content} language={codeLanguageFor(diagram)} />
            </div>
          )
        ) : (
          <div className={styles.scroll}>
            <CodeBlock code={content} language={codeLanguageFor(diagram)} />
          </div>
        )}
      </div>
    </div>
  );
});

export default DiagramPanel;
