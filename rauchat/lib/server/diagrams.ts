/**
 * lib/server/diagrams.ts — durable store for model-authored diagrams.
 *
 * One JSON file per diagram under `workspace/diagrams/<id>.json`, holding
 * every revision. Writes are append-only: revising a diagram pushes a new
 * version instead of replacing the old content, so the panel can offer
 * history and the model can never destroy earlier work.
 *
 * Ids are slugs chosen by the model and reused across turns to revise in
 * place; they are sanitized here because they become filenames.
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Diagram, DiagramKind, DiagramVersion } from "@/lib/types";
import { DIAGRAM_KINDS } from "@/lib/types";
import { workspaceRootFor } from "./workspace";

export function diagramsDirFor(userId: string): string {
  return path.join(workspaceRootFor(userId), "diagrams");
}

/** Revisions kept per diagram; older ones are dropped from the head of the list. */
const MAX_VERSIONS = 20;

export class DiagramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiagramError";
  }
}

/** Diagram ids become filenames, so restrict them to a safe slug alphabet. */
export function normalizeDiagramId(raw: unknown): string {
  const slug = String(raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64);
  if (!slug) {
    throw new DiagramError("Diagram id must contain at least one letter or digit.");
  }
  return slug;
}

function normalizeKind(raw: unknown): DiagramKind {
  const kind = String(raw ?? "").toLowerCase().trim();
  if ((DIAGRAM_KINDS as string[]).includes(kind)) return kind as DiagramKind;
  throw new DiagramError(
    `Unknown diagram kind "${kind}". Use one of: ${DIAGRAM_KINDS.join(", ")}.`
  );
}

function fileFor(userId: string, id: string): string {
  return path.join(diagramsDirFor(userId), `${id}.json`);
}

async function ensureDir(userId: string): Promise<void> {
  await mkdir(diagramsDirFor(userId), { recursive: true });
}

/** Reads one diagram with its full version history, or null if absent. */
export async function readDiagram(
  userId: string,
  rawId: string
): Promise<Diagram | null> {
  const id = normalizeDiagramId(rawId);
  try {
    const raw = await readFile(fileFor(userId, id), "utf8");
    const parsed = JSON.parse(raw) as Diagram;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.versions)) {
      return null;
    }
    return parsed;
  } catch {
    // Missing or corrupt — treated the same as "no such diagram".
    return null;
  }
}

/** All diagrams, newest first, without version bodies (list view). */
export async function listDiagrams(userId: string): Promise<Diagram[]> {
  await ensureDir(userId);
  let names: string[];
  try {
    names = await readdir(diagramsDirFor(userId));
  } catch {
    return [];
  }
  const diagrams: Diagram[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const diagram = await readDiagram(userId, name.slice(0, -".json".length));
    if (diagram) diagrams.push({ ...diagram, versions: undefined });
  }
  return diagrams.sort((a, b) => b.updatedAt - a.updatedAt);
}

export type WriteDiagramInput = {
  id: string;
  title?: string;
  kind?: string;
  language?: string;
  content: string;
};

/**
 * Creates a diagram or appends a revision to an existing one. `kind` is
 * required on creation and optional (inherited) on revision.
 */
export async function writeDiagram(
  userId: string,
  input: WriteDiagramInput
): Promise<Diagram> {
  await ensureDir(userId);
  const id = normalizeDiagramId(input.id);
  const content = typeof input.content === "string" ? input.content : "";
  if (!content.trim()) {
    throw new DiagramError("Diagram content must not be empty.");
  }

  const existing = await readDiagram(userId, id);
  const kind = input.kind ? normalizeKind(input.kind) : existing?.kind;
  if (!kind) {
    throw new DiagramError("kind is required when creating a new diagram.");
  }

  const now = Date.now();
  const priorVersions: DiagramVersion[] = existing?.versions ?? [];
  const version = (existing?.version ?? 0) + 1;
  const versions = [...priorVersions, { version, content, createdAt: now }].slice(
    -MAX_VERSIONS
  );

  const diagram: Diagram = {
    id,
    title: input.title?.trim() || existing?.title || id,
    kind,
    language: input.language?.trim() || existing?.language,
    content,
    version,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    versions,
  };

  await writeFile(fileFor(userId, id), JSON.stringify(diagram, null, 2), "utf8");
  return diagram;
}

/** Content of a specific version, defaulting to the newest. */
export function contentAtVersion(
  diagram: Diagram,
  version?: number | null
): string {
  if (version == null) return diagram.content;
  const match = diagram.versions?.find((v) => v.version === version);
  return match ? match.content : diagram.content;
}
