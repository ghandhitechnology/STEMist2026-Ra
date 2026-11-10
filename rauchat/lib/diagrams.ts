"use client";

/**
 * lib/diagrams.ts — reads diagrams back out of a conversation.
 *
 * Diagrams are not stored separately on the client: every `diagram` tool
 * event already carries the record the server saved, so the conversation's
 * own messages are the source of truth. Walking them in order yields each
 * diagram's revision history for free, and nothing can drift out of sync
 * with the transcript.
 */

import type { Diagram, DiagramKind, Message, ToolEvent } from "./types";
import { DIAGRAM_KINDS } from "./types";

/** Narrows a tool event's untyped `result` to an Diagram. */
export function diagramFromEvent(event: ToolEvent): Diagram | null {
  if (event.tool !== "diagram" || event.status !== "done") return null;
  const rec = event.result;
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return null;
  const r = rec as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.content !== "string") return null;
  if (!(DIAGRAM_KINDS as string[]).includes(String(r.kind))) return null;

  return {
    id: r.id,
    title: typeof r.title === "string" && r.title ? r.title : r.id,
    kind: r.kind as DiagramKind,
    language: typeof r.language === "string" ? r.language : undefined,
    content: r.content,
    version: typeof r.version === "number" ? r.version : 1,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now(),
  };
}

/**
 * Every diagram in a conversation, keyed by id, each carrying the revisions
 * seen in this transcript. Later writes win for the head content.
 */
export function collectDiagrams(messages: readonly Message[]): Diagram[] {
  const byId = new Map<string, Diagram>();

  for (const message of messages) {
    for (const event of message.toolEvents ?? []) {
      const diagram = diagramFromEvent(event);
      if (!diagram) continue;

      const previous = byId.get(diagram.id);
      const versions = [
        ...(previous?.versions ?? []),
        {
          version: diagram.version,
          content: diagram.content,
          createdAt: diagram.updatedAt,
        },
      ];
      byId.set(diagram.id, {
        ...diagram,
        createdAt: previous?.createdAt ?? diagram.createdAt,
        versions,
      });
    }
  }

  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Content of a given revision, defaulting to the newest. */
export function contentAtVersion(
  diagram: Diagram,
  version?: number | null
): string {
  if (version == null) return diagram.content;
  return (
    diagram.versions?.find((v) => v.version === version)?.content ??
    diagram.content
  );
}

/** Label shown on the diagram's kind badge. */
export function kindLabel(kind: DiagramKind, language?: string): string {
  switch (kind) {
    case "react":
      return "React";
    case "html":
      return "HTML";
    case "svg":
      return "SVG";
    case "markdown":
      return "Markdown";
    case "code":
      return language ? language.toLowerCase() : "Code";
  }
}

/** Language hint for the code view of any diagram kind. */
export function codeLanguageFor(diagram: Diagram): string {
  switch (diagram.kind) {
    case "react":
      return "tsx";
    case "html":
      return "html";
    case "svg":
      return "html";
    case "markdown":
      return "markdown";
    case "code":
      return diagram.language ?? "";
  }
}
