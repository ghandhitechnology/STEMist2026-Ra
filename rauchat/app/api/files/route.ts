/**
 * app/api/files/route.ts
 *   GET            -> { files: WorkspaceFileEntry[] }  (recursive listing)
 *   GET ?path=...  -> { path, content }                (read one file)
 *   POST           -> { path, content }                (write one file)
 *
 * Backed by, and path-sandboxed via, lib/server/workspace.ts.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  WorkspacePathError,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
} from "@/lib/server/workspace";
import { getUserId, unauthorized } from "@/lib/server/auth";
import { crossSiteRejection } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const path = req.nextUrl.searchParams.get("path");
  try {
    if (path) {
      const content = await readWorkspaceFile(userId, path);
      return NextResponse.json({ path, content });
    }
    const entries = await listWorkspaceFiles(userId);
    // WorkspaceModal only browses files, not directories, and expects
    // `updatedAt` (its field name) rather than `mtime`.
    const files = entries
      .filter((e) => !e.isDirectory)
      .map((e) => ({ path: e.path, size: e.size, updatedAt: e.mtime }));
    return NextResponse.json({ files });
  } catch (err) {
    if (err instanceof WorkspacePathError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to read workspace." },
      { status: 500 }
    );
  }
}

const WriteFileSchema = z.object({
  path: z.string().min(1, "path must not be empty"),
  content: z.string(),
});

export async function POST(req: NextRequest) {
  const crossSite = crossSiteRejection(req);
  if (crossSite) return crossSite;

  const userId = await getUserId();
  if (!userId) return unauthorized();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = WriteFileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    await writeWorkspaceFile(userId, parsed.data.path, parsed.data.content);
    return NextResponse.json({ success: true, path: parsed.data.path });
  } catch (err) {
    if (err instanceof WorkspacePathError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to write file." },
      { status: 500 }
    );
  }
}
