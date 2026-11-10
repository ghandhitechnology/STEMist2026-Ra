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

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Diagram } from "@/lib/types";
import { codeLanguageFor, contentAtVersion, kindLabel } from "@/lib/diagrams";
import {
  DIAGRAM_SANDBOX,
  DIAGRAM_MESSAGE_SOURCE,
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
  IconFullscreen,
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

type KeyboardNavigator = Navigator & {
  keyboard?: {
    lock: (keys?: string[]) => Promise<void>;
    unlock: () => void;
  };
};

type DiagramMessage = {
  source?: unknown;
  type?: unknown;
  detail?: { active?: unknown; message?: unknown } | null;
};

export const DiagramPanel = memo(function DiagramPanel({
  diagram,
  onClose,
}: DiagramPanelProps) {
  const [tab, setTab] = useState<Tab>("preview");
  const [version, setVersion] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [frameFocused, setFrameFocused] = useState(false);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const diagramId = diagram?.id ?? null;
  const runnable = diagram ? isRunnable(diagram.kind) : false;

  const postToFrame = useCallback((type: string) => {
    frameRef.current?.contentWindow?.postMessage(
      { source: DIAGRAM_MESSAGE_SOURCE, type },
      "*"
    );
  }, []);

  const focusPreview = useCallback(() => {
    frameRef.current?.focus();
    postToFrame("focus");
  }, [postToFrame]);

  const leaveImmersive = useCallback(async () => {
    postToFrame("exit-pointer-lock");
    (navigator as KeyboardNavigator).keyboard?.unlock?.();
    if (document.fullscreenElement === panelRef.current) {
      await document.exitFullscreen().catch(() => undefined);
    }
    setImmersive(false);
    setPointerLocked(false);
  }, [postToFrame]);

  const enterImmersive = useCallback(async () => {
    const panel = panelRef.current;
    if (!panel) return;
    setInteractionError(null);
    setImmersive(true);
    try {
      if (!document.fullscreenElement && panel.requestFullscreen) {
        await panel.requestFullscreen({ navigationUI: "hide" });
      }
    } catch {
      // The fixed-position fallback still provides an immersive workspace.
    }
    try {
      await (navigator as KeyboardNavigator).keyboard?.lock?.();
    } catch {
      // Keyboard Lock is optional; normal focused keyboard input still works.
    }
    requestAnimationFrame(focusPreview);
  }, [focusPreview]);

  const toggleImmersive = useCallback(() => {
    if (immersive) void leaveImmersive();
    else void enterImmersive();
  }, [immersive, enterImmersive, leaveImmersive]);

  // A new diagram starts on its newest version, and on the tab that suits
  // its kind (non-runnable kinds have no meaningful preview/code split).
  useEffect(() => {
    void leaveImmersive();
    setVersion(null);
    setReloadKey((k) => k + 1);
    setTab("preview");
    setFrameReady(false);
    setFrameFocused(false);
    setPointerLocked(false);
    setInteractionError(null);
  }, [diagramId, leaveImmersive]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<DiagramMessage>) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const message = event.data;
      if (!message || message.source !== DIAGRAM_MESSAGE_SOURCE) return;
      if (message.type === "ready") setFrameReady(true);
      if (message.type === "focus") {
        setFrameFocused(message.detail?.active === true);
      }
      if (message.type === "pointerlock") {
        setPointerLocked(message.detail?.active === true);
        setInteractionError(null);
      }
      if (message.type === "pointerlockerror") {
        setPointerLocked(false);
        setInteractionError(
          typeof message.detail?.message === "string"
            ? message.detail.message
            : "Pointer lock was denied."
        );
      }
      if (message.type === "escape" && immersive) void leaveImmersive();
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [immersive, leaveImmersive]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (document.fullscreenElement === panelRef.current) return;
      if (immersive && document.fullscreenElement === null) {
        (navigator as KeyboardNavigator).keyboard?.unlock?.();
        setImmersive(false);
        setPointerLocked(false);
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [immersive]);

  useEffect(
    () => () => {
      (navigator as KeyboardNavigator).keyboard?.unlock?.();
      postToFrame("exit-pointer-lock");
    },
    [postToFrame]
  );

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
    <div
      ref={panelRef}
      className={`${styles.panel} ${immersive ? styles.panelImmersive : ""}`}
      aria-label="Diagram"
    >
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
              onClick={toggleImmersive}
              aria-pressed={immersive}
              aria-label={immersive ? "Exit immersive mode" : "Enter immersive mode"}
              title={immersive ? "Exit immersive mode" : "Enter immersive mode"}
            >
              <IconFullscreen size={15} />
            </button>
          ) : null}
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
            onClick={() => {
              void leaveImmersive();
              onClose();
            }}
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
            onClick={() => {
              if (immersive) void leaveImmersive();
              setTab("code");
            }}
          >
            Source
          </button>
        </div>

        {runnable && showPreview ? (
          <div className={styles.interactionControls}>
            <button
              type="button"
              className={styles.interactionButton}
              onClick={focusPreview}
            >
              Focus controls
            </button>
            <span
              className={`${styles.interactionStatus} ${
                pointerLocked
                  ? styles.interactionStatusLocked
                  : frameFocused
                    ? styles.interactionStatusActive
                    : ""
              }`}
              title={interactionError ?? undefined}
            >
              <span className={styles.interactionDot} aria-hidden />
              {interactionError
                ? "interaction blocked"
                : pointerLocked
                  ? "pointer locked"
                  : frameFocused
                    ? "keyboard active"
                    : frameReady
                      ? "click to focus"
                      : "starting"}
            </span>
          </div>
        ) : null}

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
              ref={frameRef}
              className={`${styles.frame} ${
                frameFocused || pointerLocked ? styles.frameActive : ""
              }`}
              srcDoc={doc}
              sandbox={DIAGRAM_SANDBOX}
              allow="fullscreen"
              allowFullScreen
              tabIndex={0}
              onLoad={() => {
                setFrameReady(true);
                if (immersive) requestAnimationFrame(focusPreview);
              }}
              onFocus={() => setFrameFocused(true)}
              onBlur={() => {
                if (!pointerLocked) setFrameFocused(false);
              }}
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
      {immersive && showPreview ? (
        <div className={styles.immersiveHint} role="status">
          <span>{pointerLocked ? "Pointer locked" : "Interactive mode"}</span>
          <span>Keyboard input is routed to the artifact · Esc exits</span>
        </div>
      ) : null}
    </div>
  );
});

export default DiagramPanel;
