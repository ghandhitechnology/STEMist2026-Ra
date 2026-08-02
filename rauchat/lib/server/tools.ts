/**
 * lib/server/tools.ts — implementations for every tool Rauchat exposes to
 * the model, plus the Anthropic tool-definition schemas (ANTHROPIC_TOOLS)
 * and a name -> implementation dispatcher (executeTool) used by
 * app/api/chat/route.ts's agentic tool loop.
 */

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type Anthropic from "@anthropic-ai/sdk";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { SkillDraft, ToolName } from "@/lib/types";
import { writeDiagram } from "./diagrams";
import { appendMemory } from "./memory";
import {
  ensureWorkspaceDirs,
  readWorkspaceFile,
  resolveWorkspacePath,
  writeWorkspaceFile,
} from "./workspace";

// ---------------------------------------------------------------------------
// web_search
// ---------------------------------------------------------------------------

export type WebSearchResult = { title: string; url: string; snippet: string };

/**
 * Uses the Tavily Search API when TAVILY_API_KEY is set, otherwise falls
 * back to scraping DuckDuckGo's key-less HTML results page.
 */
export async function webSearch(query: string): Promise<WebSearchResult[]> {
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (tavilyKey) {
    return tavilySearch(query, tavilyKey);
  }
  return duckDuckGoSearch(query);
}

async function tavilySearch(
  query: string,
  apiKey: string
): Promise<WebSearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: 5,
      include_answer: false,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`Tavily search failed (${res.status})`);
  }
  const data: unknown = await res.json();
  const results = Array.isArray((data as { results?: unknown })?.results)
    ? (data as { results: unknown[] }).results
    : [];
  return results.slice(0, 5).map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      title: String(r.title ?? r.url ?? "Untitled"),
      url: String(r.url ?? ""),
      snippet: String(r.content ?? r.snippet ?? "").slice(0, 400),
    };
  });
}

async function duckDuckGoSearch(query: string): Promise<WebSearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Rauchat/1.0)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`DuckDuckGo search failed (${res.status})`);
  }
  const html = await res.text();
  return parseDuckDuckGoHtml(html).slice(0, 5);
}

function parseDuckDuckGoHtml(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const blockRegex =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(html)) !== null) {
    const rawUrl = decodeHtmlEntities(match[1]);
    const title = decodeHtmlEntities(stripTags(match[2]));
    const snippet = decodeHtmlEntities(stripTags(match[3]));
    if (!title && !rawUrl) continue;
    results.push({ title, url: resolveDdgUrl(rawUrl), snippet });
  }
  return results;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function resolveDdgUrl(href: string): string {
  // DuckDuckGo's HTML results wrap real URLs as /l/?uddg=<encoded>&...
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const target = u.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : href;
  } catch {
    return href;
  }
}

// ---------------------------------------------------------------------------
// pdf_create
// ---------------------------------------------------------------------------

export type PdfCreateResult = { path: string; pages: number; bytes: number };

/** Renders a simply-styled PDF and saves it under the user's exports dir. */
export async function pdfCreate(
  userId: string,
  title: string,
  markdownBody: string
): Promise<PdfCreateResult> {
  await ensureWorkspaceDirs(userId);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 612; // US Letter, points
  const pageHeight = 792;
  const margin = 56;
  const maxWidth = pageWidth - margin * 2;
  const titleSize = 20;
  const bodySize = 11;
  const lineHeight = 16;

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const newPage = () => {
    page = doc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  };

  for (const line of wrapText(title || "Untitled", boldFont, titleSize, maxWidth)) {
    if (y < margin) newPage();
    page.drawText(line, {
      x: margin,
      y,
      size: titleSize,
      font: boldFont,
      color: rgb(0.09, 0.09, 0.11),
    });
    y -= titleSize + 6;
  }
  y -= 12;

  const paragraphs = markdownBody.split(/\n{2,}/);
  for (const para of paragraphs) {
    const cleaned = stripMarkdown(para.trim());
    if (!cleaned) {
      y -= lineHeight / 2;
      continue;
    }
    for (const line of wrapText(cleaned, font, bodySize, maxWidth)) {
      if (y < margin) newPage();
      page.drawText(line, {
        x: margin,
        y,
        size: bodySize,
        font,
        color: rgb(0.14, 0.14, 0.16),
      });
      y -= lineHeight;
    }
    y -= lineHeight / 2;
  }

  const bytes = await doc.save();
  const slug = slugify(title) || "document";
  const relPath = `exports/${slug}-${Date.now()}.pdf`;
  const absPath = resolveWorkspacePath(userId, relPath);
  await writeFile(absPath, bytes);

  return { path: relPath, pages: doc.getPageCount(), bytes: bytes.byteLength };
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[-*]\s+/gm, "• ")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

// ---------------------------------------------------------------------------
// file_read / file_write — sandboxed to the workspace dir
// ---------------------------------------------------------------------------

export async function fileRead(
  userId: string,
  relPath: string
): Promise<{ path: string; content: string }> {
  const content = await readWorkspaceFile(userId, relPath);
  return { path: relPath, content };
}

export async function fileWrite(
  userId: string,
  relPath: string,
  content: string
): Promise<{ path: string; bytesWritten: number }> {
  await writeWorkspaceFile(userId, relPath, content);
  return { path: relPath, bytesWritten: Buffer.byteLength(content, "utf8") };
}

// ---------------------------------------------------------------------------
// skill_make
// ---------------------------------------------------------------------------

export async function skillMake(
  name: string,
  description: string,
  instructions: string,
  capabilities?: SkillDraft["capabilities"]
): Promise<SkillDraft> {
  const cleanName = name.trim();
  const cleanDescription = description.trim();
  const cleanInstructions = instructions.trim();
  if (!cleanName || !cleanDescription || !cleanInstructions) {
    throw new Error("Skill drafts require a name, description, and instructions.");
  }
  // Deliberately not persisted: the transcript renders this draft for review,
  // and installation happens only after the user confirms it.
  return {
    draftId: randomUUID(),
    source: "generated",
    status: "draft",
    name: cleanName,
    description: cleanDescription,
    instructions: cleanInstructions,
    capabilities: {
      tools: capabilities?.tools ?? [],
      skills: capabilities?.skills ?? [],
    },
  };
}

// ---------------------------------------------------------------------------
// diagram
// ---------------------------------------------------------------------------

export async function diagramWrite(
  userId: string,
  input: {
    id: string;
    title?: string;
    kind?: string;
    language?: string;
    content: string;
  }
) {
  return writeDiagram(userId, input);
}

// ---------------------------------------------------------------------------
// memory_add
// ---------------------------------------------------------------------------

export async function memoryAdd(
  userId: string,
  content: string
): Promise<{ saved: true; content: string }> {
  await appendMemory(userId, content);
  return { saved: true, content };
}

// ---------------------------------------------------------------------------
// Anthropic tool definitions + dispatcher
// ---------------------------------------------------------------------------

export const ANTHROPIC_TOOLS: Anthropic.Tool[] = [
  {
    name: "web_search",
    description:
      "Search the web for current information. Returns up to 5 results, each with a title, url, and short snippet.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." },
      },
      required: ["query"],
    },
  },
  {
    name: "pdf_create",
    description:
      "Render a simple styled PDF document from a title and a markdown body, and save it into the workspace exports folder. Use for deliverables the user asked to receive as a document.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The document title." },
        markdownBody: {
          type: "string",
          description:
            "The document body in simple markdown (headings, bold/italic, bullet lists, links).",
        },
      },
      required: ["title", "markdownBody"],
    },
  },
  {
    name: "file_read",
    description:
      "Read a text file from the workspace. Paths are relative to the workspace root and sandboxed — traversal outside it is rejected.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
      },
      required: ["path"],
    },
  },
  {
    name: "file_write",
    description:
      "Write a text file into the workspace, creating parent directories as needed. Paths are relative to the workspace root and sandboxed — traversal outside it is rejected.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
        content: { type: "string", description: "The file content to write." },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "skill_make",
    description:
      "Draft a reusable skill for the user to review. This does not install or persist the skill; the user confirms installation from the draft card.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short skill name." },
        description: {
          type: "string",
          description: "One-line description shown in the Skills list.",
        },
        instructions: {
          type: "string",
          description: "The full instructions the model should follow when this skill is active.",
        },
        tools: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "web_search",
              "research",
              "pdf_create",
              "file_read",
              "file_write",
              "skill_make",
              "diagram",
              "memory_add",
            ],
          },
          description: "Tool capabilities this skill needs when active.",
        },
        skills: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional installed skill names or ids this skill depends on.",
        },
      },
      required: ["name", "description", "instructions"],
    },
  },
  {
    name: "diagram",
    description:
      "Create or revise a self-contained document that the user views and interacts with in a dedicated panel: an interactive React component, a standalone HTML page, an SVG graphic, a long markdown document, or a code file. Use this for anything substantial the user will read, run, reuse, or iterate on — apps, visualizations, charts, games, tools, reports, full programs. Do NOT use it for short answers, explanations, or snippets under ~15 lines; those belong in the reply. Reuse the SAME id to revise an existing diagram (each write saves a new version), and always send the COMPLETE new content — content is never merged or patched. React diagrams must import from 'react' (React 19, plus react-dom/client) and export a default component; Tailwind CSS utility classes are available in html and react diagrams. Do not reference local files, imports, or assets that do not exist — a diagram must run standalone.",
    input_schema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description:
            "Stable kebab-case identifier, e.g. 'sorting-visualizer'. Reuse it to revise that diagram.",
        },
        title: {
          type: "string",
          description: "Human-readable title shown in the panel header.",
        },
        kind: {
          type: "string",
          enum: ["html", "react", "svg", "markdown", "code"],
          description:
            "html = standalone page; react = interactive component (TSX); svg = vector graphic; markdown = prose document; code = a file shown as highlighted read-only text. Required when creating.",
        },
        language: {
          type: "string",
          description:
            "For kind='code' only: the source language, e.g. 'python'.",
        },
        content: {
          type: "string",
          description: "The COMPLETE diagram source. Never partial or diffed.",
        },
      },
      required: ["id", "title", "kind", "content"],
    },
  },
  {
    name: "memory_add",
    description:
      "Save a lasting fact about the user to persistent memory that will be available in all future conversations. Use when the user shares a durable preference or fact about themselves, or explicitly asks you to remember something. Keep it to one concise sentence.",
    input_schema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description:
            "The fact to remember, as one concise single-line sentence written about the user.",
        },
      },
      required: ["content"],
    },
  },
];

/**
 * The same tools in OpenAI function-calling format, for the OpenRouter
 * chat path (lib/server/openrouter.ts). Derived from ANTHROPIC_TOOLS so the
 * two catalogs can never drift.
 */
export const OPENAI_TOOLS = ANTHROPIC_TOOLS.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description ?? "",
    parameters: t.input_schema as Record<string, unknown>,
  },
}));

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** A short human-readable primary-argument label for a tool call, used as the ToolEvent title. */
export function toolEventTitle(
  tool: ToolName,
  input: Record<string, unknown>
): string {
  switch (tool) {
    case "web_search":
    case "research":
      return `"${String(input.query ?? "")}"`;
    case "pdf_create":
      return String(input.title ?? "document");
    case "file_read":
    case "file_write":
      return String(input.path ?? "");
    case "skill_make":
      return String(input.name ?? "new skill");
    case "diagram":
      return String(input.title ?? input.id ?? "diagram");
    case "memory_add":
      return `"${truncate(String(input.content ?? ""), 72)}"`;
    default:
      return "";
  }
}

/**
 * Executes one of the Anthropic-facing tools by name. Throws on
 * failure — callers are responsible for catching and emitting an error
 * ToolEvent.
 */
export async function executeTool(
  userId: string,
  tool: ToolName,
  input: Record<string, unknown>
): Promise<{
  /** Fed back to the model as the tool result. */
  result: unknown;
  detail?: string;
  /** Sent to the UI instead of `result` when the two must differ. */
  clientResult?: unknown;
}> {
  switch (tool) {
    case "web_search": {
      const query = String(input.query ?? "");
      const results = await webSearch(query);
      return {
        result: results,
        detail: `${results.length} result${results.length === 1 ? "" : "s"}`,
      };
    }
    case "pdf_create": {
      const title = String(input.title ?? "Untitled");
      const body = String(input.markdownBody ?? "");
      const doc = await pdfCreate(userId, title, body);
      return {
        result: doc,
        detail: `${doc.pages} page${doc.pages === 1 ? "" : "s"}`,
      };
    }
    case "file_read": {
      const relPath = String(input.path ?? "");
      const file = await fileRead(userId, relPath);
      return { result: file };
    }
    case "file_write": {
      const relPath = String(input.path ?? "");
      const content = String(input.content ?? "");
      const written = await fileWrite(userId, relPath, content);
      return { result: written, detail: `${written.bytesWritten} bytes` };
    }
    case "skill_make": {
      const name = String(input.name ?? "");
      const description = String(input.description ?? "");
      const instructions = String(input.instructions ?? "");
      const validToolNames = new Set<ToolName>([
        "web_search",
        "research",
        "pdf_create",
        "file_read",
        "file_write",
        "skill_make",
        "diagram",
        "memory_add",
      ]);
      const capabilityTools = Array.isArray(input.tools)
        ? input.tools.filter(
            (tool): tool is ToolName =>
              typeof tool === "string" && validToolNames.has(tool as ToolName)
          )
        : [];
      const capabilitySkills = Array.isArray(input.skills)
        ? input.skills
            .filter((skill): skill is string => typeof skill === "string")
            .map((skill) => skill.trim())
            .filter(Boolean)
        : [];
      const draft = await skillMake(name, description, instructions, {
        tools: capabilityTools,
        skills: capabilitySkills,
      });
      return { result: draft, detail: "Draft ready for review" };
    }
    case "diagram": {
      const diagram = await diagramWrite(userId, {
        id: String(input.id ?? ""),
        title: input.title === undefined ? undefined : String(input.title),
        kind: input.kind === undefined ? undefined : String(input.kind),
        language:
          input.language === undefined ? undefined : String(input.language),
        content: String(input.content ?? ""),
      });
      const { versions, content, ...summary } = diagram;
      void versions;
      return {
        // Echoing the body back to the model would double the diagram's
        // cost in context — it already knows what it just wrote.
        result: { ...summary, contentLength: content.length, saved: true },
        // The UI does need the body, to render the panel without a round trip.
        clientResult: { ...summary, content },
        detail:
          diagram.version === 1
            ? `${diagram.kind} · created`
            : `${diagram.kind} · v${diagram.version}`,
      };
    }
    case "memory_add": {
      const content = String(input.content ?? "");
      const saved = await memoryAdd(userId, content);
      return { result: saved, detail: truncate(content, 96) };
    }
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}
