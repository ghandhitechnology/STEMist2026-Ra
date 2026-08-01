/**
 * lib/server/tools.ts — implementations for every tool Rauchat exposes to
 * the model, plus the Anthropic tool-definition schemas (ANTHROPIC_TOOLS)
 * and a name -> implementation dispatcher (executeTool) used by
 * app/api/chat/route.ts's agentic tool loop.
 */

import { writeFile } from "node:fs/promises";
import type Anthropic from "@anthropic-ai/sdk";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { ToolName } from "@/lib/types";
import { createSkill } from "./skills";
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

/** Renders a simply-styled PDF and saves it under workspace/exports. */
export async function pdfCreate(
  title: string,
  markdownBody: string
): Promise<PdfCreateResult> {
  await ensureWorkspaceDirs();

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
  const absPath = resolveWorkspacePath(relPath);
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
  relPath: string
): Promise<{ path: string; content: string }> {
  const content = await readWorkspaceFile(relPath);
  return { path: relPath, content };
}

export async function fileWrite(
  relPath: string,
  content: string
): Promise<{ path: string; bytesWritten: number }> {
  await writeWorkspaceFile(relPath, content);
  return { path: relPath, bytesWritten: Buffer.byteLength(content, "utf8") };
}

// ---------------------------------------------------------------------------
// skill_make
// ---------------------------------------------------------------------------

export async function skillMake(
  name: string,
  description: string,
  instructions: string
) {
  return createSkill({ name, description, instructions });
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
      "Persist a new reusable skill (name, description, and instructions) to the workspace skills library, so it can be enabled on future conversations.",
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
      },
      required: ["name", "description", "instructions"],
    },
  },
];

/**
 * The same five tools in OpenAI function-calling format, for the OpenRouter
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
    default:
      return "";
  }
}

/**
 * Executes one of the five Anthropic-facing tools by name. Throws on
 * failure — callers are responsible for catching and emitting an error
 * ToolEvent.
 */
export async function executeTool(
  tool: ToolName,
  input: Record<string, unknown>
): Promise<{ result: unknown; detail?: string }> {
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
      const doc = await pdfCreate(title, body);
      return {
        result: doc,
        detail: `${doc.pages} page${doc.pages === 1 ? "" : "s"}`,
      };
    }
    case "file_read": {
      const relPath = String(input.path ?? "");
      const file = await fileRead(relPath);
      return { result: file };
    }
    case "file_write": {
      const relPath = String(input.path ?? "");
      const content = String(input.content ?? "");
      const written = await fileWrite(relPath, content);
      return { result: written, detail: `${written.bytesWritten} bytes` };
    }
    case "skill_make": {
      const name = String(input.name ?? "");
      const description = String(input.description ?? "");
      const instructions = String(input.instructions ?? "");
      const skill = await skillMake(name, description, instructions);
      return { result: skill };
    }
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}
