/**
 * app/api/files/upload/route.ts
 *   POST multipart/form-data -> { files: UploadedFile[] }
 *
 * Accepts one or more `file` parts from the composer, writes them under
 * `uploads/` in the signed-in user's workspace, and returns the sandbox
 * paths the chat turn will reference.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getUserId, unauthorized } from "@/lib/server/auth";
import { crossSiteRejection } from "@/lib/server/http";
import {
  WorkspacePathError,
  writeWorkspaceBytes,
} from "@/lib/server/workspace";

export const runtime = "nodejs";

/** DESIGN.md §8 — "PDF exceeds 32 MB." */
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 8;

export type UploadedFile = {
  path: string;
  name: string;
  size: number;
  mimeType: string;
};

function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop()?.trim() || "file";
  const cleaned = base
    .replace(/[^\w.\- ()[\]]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return cleaned || "file";
}

export async function POST(req: NextRequest) {
  const crossSite = crossSiteRejection(req, { allowMultipart: true });
  if (crossSite) return crossSite;

  const userId = await getUserId();
  if (!userId) return unauthorized();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected a multipart form body." },
      { status: 400 }
    );
  }

  const parts = form
    .getAll("file")
    .filter((part): part is File => typeof part === "object" && part !== null);

  if (parts.length === 0) {
    return NextResponse.json(
      { error: "Attach at least one file." },
      { status: 400 }
    );
  }
  if (parts.length > MAX_FILES_PER_REQUEST) {
    return NextResponse.json(
      { error: `You can attach at most ${MAX_FILES_PER_REQUEST} files at once.` },
      { status: 400 }
    );
  }

  const stamp = Date.now();
  const uploaded: UploadedFile[] = [];

  try {
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.size > MAX_FILE_BYTES) {
        const mb = Math.round(MAX_FILE_BYTES / (1024 * 1024));
        return NextResponse.json(
          { error: `${part.name || "File"} exceeds ${mb} MB.` },
          { status: 400 }
        );
      }
      const safeName = sanitizeFileName(part.name || `file-${i + 1}`);
      const relPath = `uploads/${stamp}-${i}-${safeName}`;
      const bytes = Buffer.from(await part.arrayBuffer());
      await writeWorkspaceBytes(userId, relPath, bytes);
      uploaded.push({
        path: relPath,
        name: part.name || safeName,
        size: bytes.byteLength,
        mimeType: part.type || "application/octet-stream",
      });
    }
  } catch (err) {
    if (err instanceof WorkspacePathError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to upload file." },
      { status: 500 }
    );
  }

  return NextResponse.json({ files: uploaded });
}
