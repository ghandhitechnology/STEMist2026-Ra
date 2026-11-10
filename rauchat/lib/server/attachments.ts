/**
 * lib/server/attachments.ts — enrich a chat turn with composer uploads.
 *
 * Images become vision parts; text-like files are inlined (capped); other
 * binaries are listed by workspace path so the model can use file_read when
 * UTF-8-safe.
 */

import type OpenAI from "openai";
import type { MessageAttachment } from "@/lib/types";
import { readWorkspaceBytes, readWorkspaceFile } from "./workspace";

const MAX_INLINE_CHARS = 80_000;
const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "jsonl",
  "csv",
  "tsv",
  "yml",
  "yaml",
  "xml",
  "html",
  "htm",
  "css",
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "sh",
  "bash",
  "zsh",
  "sql",
  "toml",
  "ini",
  "env",
  "log",
  "r",
  "php",
  "vue",
  "svelte",
]);

function extOf(pathOrName: string): string {
  const base = pathOrName.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function isImage(att: MessageAttachment): boolean {
  return att.mimeType.startsWith("image/");
}

function isTextLike(att: MessageAttachment): boolean {
  if (att.mimeType.startsWith("text/")) return true;
  if (
    att.mimeType === "application/json" ||
    att.mimeType === "application/xml" ||
    att.mimeType === "application/javascript" ||
    att.mimeType === "application/typescript"
  ) {
    return true;
  }
  return TEXT_EXTENSIONS.has(extOf(att.path) || extOf(att.name));
}

function fenceLang(att: MessageAttachment): string {
  const ext = extOf(att.path) || extOf(att.name);
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "ts" || ext === "tsx") return "typescript";
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") {
    return "javascript";
  }
  if (ext === "py") return "python";
  if (ext === "yml" || ext === "yaml") return "yaml";
  if (ext === "sh" || ext === "bash" || ext === "zsh") return "bash";
  return ext || "";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Builds the OpenRouter user message for the latest turn, incorporating
 * workspace uploads. Falls back to plain text when there are no attachments.
 */
export async function buildUserMessageWithAttachments(
  userId: string,
  text: string,
  attachments: MessageAttachment[] | undefined
): Promise<OpenAI.Chat.Completions.ChatCompletionUserMessageParam> {
  const list = attachments ?? [];
  if (!list.length) {
    return { role: "user", content: text };
  }

  const textParts: string[] = [text.trim() || "See attached file(s)."];
  const inventory: string[] = [];
  const imageParts: OpenAI.Chat.Completions.ChatCompletionContentPartImage[] =
    [];

  for (const att of list) {
    inventory.push(`- \`${att.path}\` (${att.name}, ${formatBytes(att.size)})`);

    if (isImage(att)) {
      try {
        const bytes = await readWorkspaceBytes(userId, att.path);
        const mime = att.mimeType || "image/png";
        const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
        imageParts.push({
          type: "image_url",
          image_url: { url: dataUrl },
        });
      } catch {
        textParts.push(
          `\n[Could not load image attachment \`${att.path}\` from the workspace.]`
        );
      }
      continue;
    }

    if (isTextLike(att)) {
      try {
        let content = await readWorkspaceFile(userId, att.path);
        let truncated = false;
        if (content.length > MAX_INLINE_CHARS) {
          content = content.slice(0, MAX_INLINE_CHARS);
          truncated = true;
        }
        const lang = fenceLang(att);
        textParts.push(
          `\nAttached file \`${att.path}\`${truncated ? " (truncated)" : ""}:\n\`\`\`${lang}\n${content}\n\`\`\``
        );
      } catch {
        textParts.push(
          `\n[Could not read text attachment \`${att.path}\` from the workspace.]`
        );
      }
      continue;
    }

    textParts.push(
      `\nBinary attachment at \`${att.path}\` (${formatBytes(att.size)}, ${att.mimeType}). Content is not inlined; use file_read only if the file is UTF-8 text.`
    );
  }

  if (inventory.length) {
    textParts.splice(
      1,
      0,
      `\nAttached files in the workspace:\n${inventory.join("\n")}`
    );
  }

  const combinedText = textParts.join("\n").trim();
  if (!imageParts.length) {
    return { role: "user", content: combinedText };
  }

  return {
    role: "user",
    content: [
      { type: "text", text: combinedText },
      ...imageParts,
    ],
  };
}
