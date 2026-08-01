"use client";

/**
 * components/chat/ToolEventCard.tsx
 *
 * Inline transcript cards for the six tools (DESIGN.md §7).
 * States: running / success / empty / error, collapsible body,
 * per-tool body specs, and grouping of 3+ consecutive same-tool events.
 *
 * `ToolEvent.result` is `unknown` in the shared contract, so every body
 * reads it defensively and degrades to the plain `detail` line.
 */

import { Fragment, memo, useCallback, useEffect, useRef, useState } from "react";
import type { ToolEvent, ToolName } from "@/lib/types";
import styles from "./chat.module.css";
import {
  IconChevronDown,
  IconDownload,
  IconExternal,
  IconFileRead,
  IconFileWrite,
  IconPdf,
  IconResearch,
  IconSkill,
  IconWebSearch,
  type IconProps,
} from "./icons";

/* ------------------------------------------------------------------
   Safe readers for the untyped `result` payload
   ------------------------------------------------------------------ */

type Rec = Record<string, unknown>;

const asRec = (v: unknown): Rec | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null;
const asStr = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const asNum = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function pickStr(rec: Rec | null, ...keys: string[]): string | undefined {
  if (!rec) return undefined;
  for (const k of keys) {
    const v = asStr(rec[k]);
    if (v) return v;
  }
  return undefined;
}
function pickNum(rec: Rec | null, ...keys: string[]): number | undefined {
  if (!rec) return undefined;
  for (const k of keys) {
    const v = asNum(rec[k]);
    if (v !== undefined) return v;
  }
  return undefined;
}

/* ------------------------------------------------------------------
   Formatting
   ------------------------------------------------------------------ */

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function middleTruncate(value: string, max = 56): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] ?? url;
  }
}

/** Default: real URLs pass through; anything else is a server-side file path. */
export function defaultResolveDownloadUrl(target: string): string {
  if (/^(https?:|data:|blob:)/i.test(target)) return target;
  return `/api/files?path=${encodeURIComponent(target)}`;
}

/** Finds a downloadable path/url anywhere in a result payload. */
export function extractDownload(
  result: unknown
): { target: string; filename: string } | null {
  const rec = asRec(result);
  if (!rec) return null;
  const target =
    pickStr(rec, "url", "downloadUrl", "href", "path", "filePath", "file", "output") ??
    pickStr(asRec(rec.file), "url", "path");
  if (!target) return null;
  const filename =
    pickStr(rec, "filename", "name") ?? target.split(/[\\/]/).pop() ?? target;
  return { target, filename };
}

/* ------------------------------------------------------------------
   Tool metadata
   ------------------------------------------------------------------ */

type ToolMeta = {
  label: string;
  Icon: (p: IconProps) => React.JSX.Element;
  /** Header argument renders in mono (paths). */
  monoArg?: boolean;
  /** The result is the deliverable — stays expanded on completion (§7). */
  keepExpanded?: boolean;
  /** Header argument is quoted (queries). */
  quoteArg?: boolean;
};

const TOOL_META: Record<ToolName, ToolMeta> = {
  web_search: { label: "Web search", Icon: IconWebSearch, quoteArg: true },
  research: { label: "Research", Icon: IconResearch },
  pdf_create: { label: "Create PDF", Icon: IconPdf, keepExpanded: true },
  file_read: { label: "Read file", Icon: IconFileRead, monoArg: true },
  file_write: { label: "Write file", Icon: IconFileWrite, monoArg: true },
  skill_make: { label: "Skill maker", Icon: IconSkill, keepExpanded: true },
};

const TOOL_VERBS: Record<ToolName, string> = {
  web_search: "Searching the web",
  research: "Researching",
  pdf_create: "Building the document",
  file_read: "Reading file",
  file_write: "Writing file",
  skill_make: "Authoring skill",
};

/** Present-tense verb for the thinking indicator (§4.8). */
export function toolRunningVerb(tool: ToolName): string {
  return TOOL_VERBS[tool] ?? "Working";
}

/** Display label for a tool, e.g. in the composer's toggle row. */
export function toolLabel(tool: ToolName): string {
  return TOOL_META[tool]?.label ?? tool;
}

/* ------------------------------------------------------------------
   Duration — counts up at 10Hz while running, freezes on completion
   ------------------------------------------------------------------ */

function useElapsed(running: boolean): number {
  const startRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (running) {
      if (startRef.current === null) startRef.current = Date.now();
      const start = startRef.current;
      setElapsed(Date.now() - start);
      const id = setInterval(() => setElapsed(Date.now() - start), 100);
      return () => clearInterval(id);
    }
    if (startRef.current !== null) {
      setElapsed(Date.now() - startRef.current);
      startRef.current = null;
    }
    return undefined;
  }, [running]);

  return elapsed;
}

/* ------------------------------------------------------------------
   Shared body pieces
   ------------------------------------------------------------------ */

function Shimmer({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.shimmerRow} style={{ width: `${88 - i * 18}%` }} />
      ))}
    </div>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <div className={styles.cardEmptyLine}>{children}</div>;
}

/* ------------------------------------------------------------------
   Per-tool bodies (§7)
   ------------------------------------------------------------------ */

type BodyProps = {
  event: ToolEvent;
  resolveDownloadUrl: (target: string) => string;
  onInstallSkill?: (event: ToolEvent) => void;
};

function WebSearchBody({ event }: BodyProps) {
  const rec = asRec(event.result);
  const raw = Array.isArray(event.result) ? event.result : asArr(rec?.results ?? rec?.items);
  const [showAll, setShowAll] = useState(false);

  const results: Array<{ url: string; title: string; favicon?: string }> = [];
  for (const entry of raw) {
    const item = asRec(entry);
    if (!item) continue;
    const url = pickStr(item, "url", "link", "href") ?? "";
    const title = pickStr(item, "title", "name") ?? url;
    if (!title) continue;
    results.push({ url, title, favicon: pickStr(item, "favicon", "icon") });
  }

  if (results.length === 0) {
    if (event.status === "running") return <Shimmer />;
    return <EmptyLine>No results.</EmptyLine>;
  }

  const visible = showAll ? results : results.slice(0, 5);

  return (
    <div>
      {visible.map((r, i) => {
        const domain = r.url ? domainOf(r.url) : "";
        return (
          <a
            key={`${r.url}-${i}`}
            className={styles.resultRow}
            href={r.url || undefined}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className={styles.favicon}>
              {r.favicon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.faviconImg} src={r.favicon} alt="" />
              ) : (
                (domain || r.title).charAt(0)
              )}
            </span>
            <span className={styles.resultTitle}>{r.title}</span>
            {domain ? <span className={styles.resultDomain}>{domain}</span> : null}
          </a>
        );
      })}
      {results.length > 5 && !showAll ? (
        <button type="button" className={styles.showAll} onClick={() => setShowAll(true)}>
          Show all ({results.length})
        </button>
      ) : null}
    </div>
  );
}

function ResearchBody({ event }: BodyProps) {
  const rec = asRec(event.result);
  const steps = asArr(rec?.steps)
    .map((s) => {
      const step = asRec(s);
      if (!step) return typeof s === "string" ? { label: s, status: "done", ms: undefined } : null;
      const label = pickStr(step, "label", "title", "name", "objective");
      if (!label) return null;
      return {
        label,
        status: pickStr(step, "status", "state") ?? "done",
        ms: pickNum(step, "durationMs", "ms", "elapsedMs"),
      };
    })
    .filter((s): s is { label: string; status: string; ms: number | undefined } => s !== null);

  if (steps.length === 0) {
    if (event.status === "running") return <Shimmer rows={4} />;
    return <EmptyLine>{event.detail ?? "No steps recorded."}</EmptyLine>;
  }

  const sources = pickNum(rec, "sources", "sourceCount");
  const total = pickNum(rec, "elapsedMs", "durationMs");

  return (
    <div>
      {steps.map((s, i) => {
        const nodeCls =
          s.status === "running"
            ? styles.stepNodeRunning
            : s.status === "failed" || s.status === "error"
              ? styles.stepNodeFailed
              : s.status === "pending" || s.status === "queued"
                ? ""
                : styles.stepNodeDone;
        return (
          <div key={i} className={styles.stepRow}>
            <span className={styles.stepGutter}>
              <span className={styles.stepConnector} />
              <span className={`${styles.stepNode} ${nodeCls}`} />
            </span>
            <span
              className={`${styles.stepLabel} ${s.status === "running" ? styles.stepLabelActive : ""}`}
            >
              {s.label}
            </span>
            {s.ms !== undefined ? (
              <span className={styles.stepDur}>{formatDuration(s.ms)}</span>
            ) : null}
          </div>
        );
      })}
      <div className={styles.ledgerSummary}>
        {[
          sources !== undefined ? `${sources} sources` : null,
          `${steps.length} steps`,
          total !== undefined ? formatDuration(total) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
    </div>
  );
}

function PdfBody({ event, resolveDownloadUrl }: BodyProps) {
  const rec = asRec(event.result);
  const download = extractDownload(event.result);

  if (!download) {
    if (event.status === "running") return <Shimmer rows={2} />;
    return <EmptyLine>{event.detail ?? "No document produced."}</EmptyLine>;
  }

  const pages = pickNum(rec, "pages", "pageCount");
  const bytes = pickNum(rec, "bytes", "size", "byteLength");
  const href = resolveDownloadUrl(download.target);

  return (
    <div className={styles.artifactRow}>
      <span className={styles.pageThumb} aria-hidden="true">
        <span className={styles.pageThumbLine} />
        <span className={styles.pageThumbLine} />
        <span className={styles.pageThumbLine} />
      </span>
      <span className={styles.artifactMeta}>
        <span className={styles.artifactName}>{download.filename}</span>
        <span className={styles.artifactSub}>
          {[
            pages !== undefined ? `${pages} pages` : null,
            bytes !== undefined ? formatBytes(bytes) : null,
          ]
            .filter(Boolean)
            .join(" · ") || download.target}
        </span>
      </span>
      <span className={styles.artifactActions}>
        <a className={styles.downloadLink} href={href} download={download.filename}>
          <IconDownload size={12} />
          Download
        </a>
        <a
          className={styles.previewLink}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          <IconExternal size={12} />
          Preview
        </a>
      </span>
    </div>
  );
}

const MAX_FILE_LINES = 20;

function FileReadBody({ event }: BodyProps) {
  const rec = asRec(event.result);
  const content = pickStr(rec, "content", "text", "body") ?? asStr(event.result);

  if (!content) {
    if (event.status === "running") return <Shimmer rows={4} />;
    return <EmptyLine>{event.detail ?? "Empty file."}</EmptyLine>;
  }

  const allLines = content.split("\n");
  const lines = allLines.slice(0, MAX_FILE_LINES);
  const declaredTotal = pickNum(rec, "totalLines", "lines") ?? allLines.length;
  const remaining = Math.max(0, declaredTotal - lines.length);

  return (
    <div>
      <div className={styles.fileCode}>
        <div className={styles.lineNums} aria-hidden="true">
          {lines.map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <pre className={styles.fileLines}>
          <code>{lines.join("\n")}</code>
        </pre>
      </div>
      {remaining > 0 ? (
        <div className={styles.moreLines}>⋯ {remaining} more lines</div>
      ) : null}
    </div>
  );
}

function classifyDiffLine(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
    return styles.diffMeta;
  }
  if (line.startsWith("+")) return styles.diffAdd;
  if (line.startsWith("-")) return styles.diffDel;
  return "";
}

function FileWriteBody({ event }: BodyProps) {
  const rec = asRec(event.result);
  const diff = pickStr(rec, "diff", "patch", "content") ?? asStr(event.result);

  if (!diff) {
    if (event.status === "running") return <Shimmer rows={4} />;
    return <EmptyLine>{event.detail ?? "File written."}</EmptyLine>;
  }

  const lines = diff.split("\n");

  return (
    <div className={styles.diff}>
      {lines.map((line, i) => (
        <div key={i} className={`${styles.diffLine} ${classifyDiffLine(line)}`}>
          {line || " "}
        </div>
      ))}
    </div>
  );
}

function SkillBody({ event, onInstallSkill }: BodyProps) {
  const rec = asRec(event.result);

  if (!rec) {
    if (event.status === "running") return <Shimmer rows={3} />;
    return <EmptyLine>{event.detail ?? "No skill produced."}</EmptyLine>;
  }

  const name = pickStr(rec, "name", "title") ?? event.title;
  const description = pickStr(rec, "description", "summary") ?? event.detail;
  const installed = rec.installed === true;

  const meta: Array<[string, string | undefined]> = [
    ["trigger", pickStr(rec, "trigger", "when")],
    [
      "tools",
      Array.isArray(rec.tools)
        ? rec.tools.filter((t): t is string => typeof t === "string").join(", ")
        : pickStr(rec, "tools"),
    ],
    [
      "files",
      Array.isArray(rec.files)
        ? String(rec.files.length)
        : pickStr(rec, "files") ?? pickNum(rec, "fileCount")?.toString(),
    ],
    ["scope", pickStr(rec, "scope") ?? "Workspace"],
  ];

  return (
    <div>
      <div className={styles.skillName}>{name}</div>
      {description ? <div className={styles.skillDesc}>{description}</div> : null}
      <div className={styles.skillDivider} />
      <div className={styles.skillGrid}>
        {meta.map(([label, value]) => (
          <Fragment key={label}>
            <span className={styles.skillLabel}>{label}</span>
            <span className={styles.skillValue}>{value ?? "—"}</span>
          </Fragment>
        ))}
      </div>
      {installed ? (
        <div className={styles.skillInstalled}>Installed to Workspace › Skills</div>
      ) : (
        <div className={styles.skillFooter}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => onInstallSkill?.(event)}
          >
            Install skill
          </button>
        </div>
      )}
    </div>
  );
}

const BODIES: Record<ToolName, (p: BodyProps) => React.JSX.Element> = {
  web_search: WebSearchBody,
  research: ResearchBody,
  pdf_create: PdfBody,
  file_read: FileReadBody,
  file_write: FileWriteBody,
  skill_make: SkillBody,
};

/* ------------------------------------------------------------------
   Card
   ------------------------------------------------------------------ */

export type ToolEventCardProps = {
  event: ToolEvent;
  /** Retry handler for the error state's ghost button. */
  onRetry?: (event: ToolEvent) => void;
  onInstallSkill?: (event: ToolEvent) => void;
  /** Maps a result path/url to something the browser can fetch. */
  resolveDownloadUrl?: (target: string) => string;
};

function defaultExpanded(event: ToolEvent): boolean {
  if (event.status === "running" || event.status === "error") return true;
  return TOOL_META[event.tool]?.keepExpanded === true;
}

export const ToolEventCard = memo(function ToolEventCard({
  event,
  onRetry,
  onInstallSkill,
  resolveDownloadUrl = defaultResolveDownloadUrl,
}: ToolEventCardProps) {
  const meta = TOOL_META[event.tool] ?? {
    label: event.tool,
    Icon: IconWebSearch,
  };
  const running = event.status === "running";
  const errored = event.status === "error";

  const [expanded, setExpanded] = useState(() => defaultExpanded(event));
  const prevStatus = useRef(event.status);
  useEffect(() => {
    if (prevStatus.current !== event.status) {
      prevStatus.current = event.status;
      setExpanded(defaultExpanded(event));
    }
  }, [event]);

  const elapsed = useElapsed(running);
  const resultMs = pickNum(asRec(event.result), "durationMs", "elapsedMs", "ms");
  const shownMs = resultMs ?? elapsed;

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  const arg = event.title;
  const argText = meta.monoArg ? middleTruncate(arg) : meta.quoteArg ? `“${arg}”` : arg;
  const Body = BODIES[event.tool];

  return (
    <section
      className={`${styles.card} ${
        running ? styles.cardRuleRunning : errored ? styles.cardRuleError : ""
      }`}
    >
      <button
        type="button"
        className={styles.cardHeader}
        onClick={toggle}
        aria-expanded={expanded}
      >
        <span
          className={`${styles.cardIcon} ${
            running ? styles.cardIconRunning : errored ? styles.cardIconError : ""
          }`}
        >
          <meta.Icon size={14} />
        </span>
        <span
          className={`${styles.cardName} ${
            running || errored ? styles.cardNameActive : ""
          }`}
        >
          {meta.label}
        </span>
        <span className={`${styles.cardArg} ${meta.monoArg ? styles.cardArgMono : ""}`}>
          {argText}
        </span>
        {errored ? (
          <span className={`${styles.cardDur} ${styles.cardDurFailed}`}>failed</span>
        ) : shownMs > 0 ? (
          <span className={styles.cardDur}>{formatDuration(shownMs)}</span>
        ) : null}
        <span className={`${styles.chevron} ${expanded ? styles.chevronOpen : ""}`}>
          <IconChevronDown size={12} />
        </span>
      </button>

      <div className={`${styles.cardBodyGrid} ${expanded ? styles.cardBodyGridOpen : ""}`}>
        <div className={styles.cardBodyClip}>
          <div className={styles.cardBody}>
            {errored ? (
              <>
                <div className={styles.cardErrorBody}>
                  {event.detail ?? "The tool call failed."}
                </div>
                {onRetry ? (
                  <div className={styles.cardErrorActions}>
                    <button
                      type="button"
                      className={styles.ghostBtn}
                      onClick={() => onRetry(event)}
                    >
                      Retry
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <Body
                event={event}
                resolveDownloadUrl={resolveDownloadUrl}
                onInstallSkill={onInstallSkill}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
});

/* ------------------------------------------------------------------
   Grouping (§7): 3+ consecutive completed events of the same tool
   collapse into one card.
   ------------------------------------------------------------------ */

function ToolEventGroup({
  events,
  ...rest
}: { events: ToolEvent[] } & Omit<ToolEventCardProps, "event">) {
  const [expanded, setExpanded] = useState(false);
  const meta = TOOL_META[events[0].tool];

  return (
    <section className={styles.card}>
      <button
        type="button"
        className={styles.cardHeader}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={styles.cardIcon}>
          <meta.Icon size={14} />
        </span>
        <span className={styles.cardName}>{meta.label}</span>
        <span className={styles.cardArg}>{events.length} calls</span>
        <span className={`${styles.chevron} ${expanded ? styles.chevronOpen : ""}`}>
          <IconChevronDown size={12} />
        </span>
      </button>
      <div className={`${styles.cardBodyGrid} ${expanded ? styles.cardBodyGridOpen : ""}`}>
        <div className={styles.cardBodyClip}>
          <div className={styles.groupChildren}>
            {events.map((e) => (
              <ToolEventCard key={e.id} event={e} {...rest} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export type ToolEventListProps = {
  events: ToolEvent[];
} & Omit<ToolEventCardProps, "event">;

export const ToolEventList = memo(function ToolEventList({
  events,
  ...rest
}: ToolEventListProps) {
  if (events.length === 0) return null;

  const nodes: React.JSX.Element[] = [];
  let i = 0;
  while (i < events.length) {
    const tool = events[i].tool;
    let j = i;
    while (j < events.length && events[j].tool === tool && events[j].status === "done") {
      j += 1;
    }
    const runLength = j - i;
    if (runLength >= 3) {
      nodes.push(
        <ToolEventGroup key={events[i].id} events={events.slice(i, j)} {...rest} />
      );
      i = j;
    } else {
      nodes.push(<ToolEventCard key={events[i].id} event={events[i]} {...rest} />);
      i += 1;
    }
  }

  return <div className={styles.toolList}>{nodes}</div>;
});

export default ToolEventCard;
