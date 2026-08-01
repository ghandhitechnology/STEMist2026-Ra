"use client";

/**
 * components/chat/Composer.tsx
 *
 * The composer dock (DESIGN.md §3.4 dock, §4.5 shell, §4.6 tool toggles).
 *
 * The draft lives here, not in ChatView, so typing never re-renders the
 * transcript. ChatView drives it imperatively through ComposerHandle.
 */

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Skill, ToolName } from "@/lib/types";
import styles from "./chat.module.css";
import {
  IconArrowUp,
  IconAttach,
  IconCheck,
  IconChevronDown,
  IconFileRead,
  IconFileWrite,
  IconPdf,
  IconResearch,
  IconSkill,
  IconWebSearch,
  IconX,
  type IconProps,
} from "./icons";

const MIN_H = 52; // --rau-composer-min-h
const MAX_H = 240; // --rau-composer-max-h
const COMPACT_W = 640; // §4.6 — below this the chips go icon-only

/** §4.6 fixed order. */
const TOOL_CHIPS: Array<{
  tool: ToolName;
  label: string;
  Icon: (p: IconProps) => React.JSX.Element;
}> = [
  { tool: "web_search", label: "Web search", Icon: IconWebSearch },
  { tool: "research", label: "Research", Icon: IconResearch },
  { tool: "pdf_create", label: "PDF", Icon: IconPdf },
  { tool: "file_read", label: "Read file", Icon: IconFileRead },
  { tool: "file_write", label: "Write file", Icon: IconFileWrite },
  { tool: "skill_make", label: "Skill maker", Icon: IconSkill },
];

export type ComposerSubmission = {
  text: string;
  /** Tool toggles that were on when the message was sent. */
  tools: ToolName[];
  /** Skill selected in the picker, if any. */
  skillId: string | null;
  files: File[];
  /** True when sent with Cmd/Ctrl+Enter — the tool set is forced on (§4.5). */
  forceTools: boolean;
};

export type ComposerHandle = {
  focus: () => void;
  /** Replace the draft (used by the empty-state suggestion chips). */
  setDraft: (text: string) => void;
  clear: () => void;
};

export type ComposerProps = {
  onSend: (submission: ComposerSubmission) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  /** Tools executing this turn — drives the running underline (§4.6). */
  runningTools?: readonly ToolName[];
  /** Tools that cannot be used, mapped to the reason shown on hover. */
  unavailableTools?: Partial<Record<ToolName, string>>;
  defaultTools?: readonly ToolName[];
  skills?: readonly Skill[];
  activeSkillId?: string | null;
  onSelectSkill?: (id: string | null) => void;
  onAttach?: (files: File[]) => void;
  /** Composer-level error strip, e.g. "PDF exceeds 32 MB." (§4.5) */
  error?: string | null;
  /** Bar above the shell for offline / rate-limit copy (§8). */
  notice?: { tone: "neutral" | "warning"; message: string } | null;
  placeholder?: string;
};

export const Composer = memo(
  forwardRef<ComposerHandle, ComposerProps>(function Composer(
    {
      onSend,
      onStop,
      isStreaming = false,
      disabled = false,
      runningTools,
      unavailableTools,
      defaultTools,
      skills,
      activeSkillId = null,
      onSelectSkill,
      onAttach,
      error = null,
      notice = null,
      placeholder = "Message Rauchat",
    },
    ref
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const shellRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepth = useRef(0);

    const [draft, setDraftState] = useState("");
    const [tools, setTools] = useState<Set<ToolName>>(
      () => new Set(defaultTools ?? [])
    );
    const [files, setFiles] = useState<File[]>([]);
    const [grown, setGrown] = useState(false);
    const [scrolling, setScrolling] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [compact, setCompact] = useState(false);
    const [skillOpen, setSkillOpen] = useState(false);

    /* ---- auto-grow (§4.5) ---- */
    const resize = useCallback(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "auto";
      const natural = el.scrollHeight;
      el.style.height = `${Math.min(Math.max(natural, MIN_H), MAX_H)}px`;
      setGrown(natural > MIN_H + 2);
      setScrolling(natural > MAX_H);
    }, []);

    useLayoutEffect(resize, [draft, resize]);

    /* ---- compact chips below 640px composer width (§4.6) ---- */
    useEffect(() => {
      const el = shellRef.current;
      if (!el || typeof ResizeObserver === "undefined") return;
      const ro = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width ?? 0;
        setCompact(w < COMPACT_W);
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => textareaRef.current?.focus(),
        setDraft: (text: string) => {
          setDraftState(text);
          requestAnimationFrame(() => {
            const el = textareaRef.current;
            if (!el) return;
            el.focus();
            el.setSelectionRange(text.length, text.length);
          });
        },
        clear: () => {
          setDraftState("");
          setFiles([]);
        },
      }),
      []
    );

    const canSend = draft.trim().length > 0 && !disabled && !isStreaming;

    const submit = useCallback(
      (forceTools: boolean) => {
        const text = draft.trim();
        if (!text || disabled || isStreaming) return;
        onSend({
          text,
          tools: Array.from(tools),
          skillId: activeSkillId,
          files,
          forceTools,
        });
        setDraftState("");
        setFiles([]);
      },
      [activeSkillId, disabled, draft, files, isStreaming, onSend, tools]
    );

    const onKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Escape") {
          if (isStreaming) {
            e.preventDefault();
            onStop?.();
          } else {
            textareaRef.current?.blur();
          }
          return;
        }
        if (e.key !== "Enter") return;
        if (e.shiftKey) return; // newline
        if (e.nativeEvent.isComposing) return; // IME
        e.preventDefault();
        submit(e.metaKey || e.ctrlKey);
      },
      [isStreaming, onStop, submit]
    );

    const toggleTool = useCallback((tool: ToolName) => {
      setTools((prev) => {
        const next = new Set(prev);
        if (next.has(tool)) next.delete(tool);
        else next.add(tool);
        return next;
      });
    }, []);

    /* ---- attachments ---- */
    const addFiles = useCallback(
      (incoming: File[]) => {
        if (incoming.length === 0) return;
        setFiles((prev) => [...prev, ...incoming]);
        onAttach?.(incoming);
      },
      [onAttach]
    );

    const onDrop = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragOver(false);
        addFiles(Array.from(e.dataTransfer.files ?? []));
      },
      [addFiles]
    );

    /* ---- skill picker ---- */
    useEffect(() => {
      if (!skillOpen) return;
      const close = (e: MouseEvent) => {
        const el = shellRef.current;
        if (el && e.target instanceof Node && el.contains(e.target)) return;
        setSkillOpen(false);
      };
      const onEsc = (e: KeyboardEvent) => {
        if (e.key === "Escape") setSkillOpen(false);
      };
      document.addEventListener("mousedown", close);
      document.addEventListener("keydown", onEsc);
      return () => {
        document.removeEventListener("mousedown", close);
        document.removeEventListener("keydown", onEsc);
      };
    }, [skillOpen]);

    const activeSkill = skills?.find((s) => s.id === activeSkillId) ?? null;

    return (
      <div className={styles.composerDock}>
        <div className={styles.composerInner}>
          {notice ? (
            <div className={styles.statusBar} role="status">
              <span
                className={`${styles.statusDot} ${
                  notice.tone === "warning" ? styles.statusDotWarning : ""
                }`}
              />
              {notice.message}
            </div>
          ) : null}

          <div
            ref={shellRef}
            className={[
              styles.shell,
              disabled || isStreaming ? styles.shellDisabled : "",
              error ? styles.shellError : "",
              dragOver ? styles.shellDragOver : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onDragEnter={(e) => {
              e.preventDefault();
              dragDepth.current += 1;
              setDragOver(true);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={() => {
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setDragOver(false);
            }}
            onDrop={onDrop}
          >
            {dragOver ? (
              <div className={styles.dropLabel}>Drop to attach</div>
            ) : (
              <>
                {files.length > 0 ? (
                  <div className={styles.attachRow}>
                    {files.map((f, i) => (
                      <span key={`${f.name}-${i}`} className={styles.attachChip}>
                        <span className={styles.attachName}>{f.name}</span>
                        <button
                          type="button"
                          className={styles.attachRemove}
                          aria-label={`Remove ${f.name}`}
                          onClick={() =>
                            setFiles((prev) => prev.filter((_, j) => j !== i))
                          }
                        >
                          <IconX size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}

                <textarea
                  ref={textareaRef}
                  className={`${styles.textarea} ${
                    scrolling ? styles.textareaScrolling : ""
                  }`}
                  value={draft}
                  onChange={(e) => setDraftState(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={isStreaming ? "Generating…" : placeholder}
                  disabled={disabled}
                  rows={1}
                  aria-label="Message"
                />
              </>
            )}

            <div
              className={`${styles.toolbar} ${grown ? styles.toolbarDivided : ""}`}
            >
              <div className={styles.toolStrip} role="group" aria-label="Tools">
                {TOOL_CHIPS.map(({ tool, label, Icon }) => {
                  const on = tools.has(tool);
                  const unavailable = unavailableTools?.[tool];
                  const running = runningTools?.includes(tool) ?? false;
                  return (
                    <button
                      key={tool}
                      type="button"
                      className={[
                        styles.chip,
                        on ? styles.chipOn : "",
                        running ? styles.chipRunning : "",
                        compact ? styles.chipIconOnly : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => toggleTool(tool)}
                      disabled={Boolean(unavailable)}
                      title={unavailable ?? label}
                      aria-pressed={on}
                      aria-label={label}
                    >
                      <span className={styles.chipIcon}>
                        <Icon size={14} />
                      </span>
                      {compact ? null : label}
                    </button>
                  );
                })}
              </div>

              <div className={styles.toolbarRight}>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className={styles.srOnly}
                  onChange={(e) => {
                    addFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                  tabIndex={-1}
                />
                <button
                  type="button"
                  className={`${styles.iconBtn} ${styles.iconBtnSm}`}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach files"
                  title="Attach files"
                >
                  <IconAttach size={16} />
                </button>

                {skills ? (
                  <div className={styles.popoverWrap}>
                    <button
                      type="button"
                      className={styles.selectorBtn}
                      onClick={() => setSkillOpen((v) => !v)}
                      aria-haspopup="menu"
                      aria-expanded={skillOpen}
                    >
                      <span className={styles.selectorLabel}>
                        {activeSkill ? activeSkill.name : "Skill"}
                      </span>
                      <IconChevronDown size={12} />
                    </button>
                    {skillOpen ? (
                      <div className={styles.popover} role="menu">
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={activeSkillId === null}
                          className={styles.popoverItem}
                          onClick={() => {
                            onSelectSkill?.(null);
                            setSkillOpen(false);
                          }}
                        >
                          <span className={styles.popoverItemLabel}>No skill</span>
                          {activeSkillId === null ? (
                            <span className={styles.popoverCheck}>
                              <IconCheck size={12} />
                            </span>
                          ) : null}
                        </button>
                        {skills.length > 0 ? (
                          <div className={styles.popoverSeparator} />
                        ) : null}
                        {skills.length === 0 ? (
                          <div className={styles.popoverEmpty}>
                            No skills installed.
                          </div>
                        ) : (
                          skills.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              role="menuitemradio"
                              aria-checked={s.id === activeSkillId}
                              className={styles.popoverItem}
                              onClick={() => {
                                onSelectSkill?.(s.id);
                                setSkillOpen(false);
                              }}
                            >
                              <span className={styles.popoverItemLabel}>{s.name}</span>
                              {s.id === activeSkillId ? (
                                <span className={styles.popoverCheck}>
                                  <IconCheck size={12} />
                                </span>
                              ) : null}
                            </button>
                          ))
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {isStreaming ? (
                  <button
                    type="button"
                    className={`${styles.sendBtn} ${styles.stopBtn}`}
                    onClick={onStop}
                    aria-label="Stop generating"
                    title="Stop generating"
                  >
                    <span className={styles.stopGlyph} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`${styles.sendBtn} ${canSend ? styles.sendBtnReady : ""}`}
                    onClick={() => submit(false)}
                    disabled={!canSend}
                    aria-label="Send message"
                    title="Send message"
                  >
                    <IconArrowUp size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {error ? (
            <div className={styles.errorStrip} role="alert">
              {error}
            </div>
          ) : null}

          <div className={styles.hints}>
            {isStreaming ? (
              <span>
                <span className={styles.hintKey}>Esc</span> to stop
              </span>
            ) : (
              <>
                <span>
                  <span className={styles.hintKey}>Enter</span> to send
                </span>
                <span>
                  <span className={styles.hintKey}>Shift+Enter</span> for newline
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    );
  })
);

export default Composer;
