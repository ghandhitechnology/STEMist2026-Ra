/**
 * app/api/conversations/[id]/route.ts — PUT (upsert whole conversation) /
 * DELETE one stored conversation for the signed-in user.
 *
 * PUT replaces the file wholesale — the client owns conversation state and
 * this store is last-write-wins, so there is no server-side message merging.
 * DELETE sends a `{}` JSON body purely so the shared cross-site guard (which
 * keys on Content-Type) applies to it like every other mutation.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ConversationTooLargeError,
  deleteConversation,
  saveConversation,
} from "@/lib/server/conversations";
import { WorkspacePathError } from "@/lib/server/paths";
import { getUserId, unauthorized } from "@/lib/server/auth";
import { crossSiteRejection } from "@/lib/server/http";
import type { Conversation } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Core shape only, loose everywhere else: messages carry evolving optional
 * payloads (tool events, trait snapshots, attachments, thinking traces) and
 * the store must not silently drop fields added by a newer client.
 */
const MessageSchema = z.looseObject({
  id: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdAt: z.number(),
});

const ConversationSchema = z.looseObject({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, "invalid conversation id"),
  title: z.string().max(500),
  createdAt: z.number(),
  updatedAt: z.number(),
  messages: z.array(MessageSchema).max(5000),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const parsed = ConversationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid conversation.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { id } = await params;
  if (parsed.data.id !== id) {
    return NextResponse.json(
      { error: "Conversation id does not match the URL." },
      { status: 400 }
    );
  }

  try {
    await saveConversation(userId, parsed.data as Conversation);
  } catch (err) {
    if (err instanceof ConversationTooLargeError) {
      return NextResponse.json({ error: err.message }, { status: 413 });
    }
    throw err;
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const crossSite = crossSiteRejection(req);
  if (crossSite) return crossSite;

  const userId = await getUserId();
  if (!userId) return unauthorized();

  const { id } = await params;
  try {
    await deleteConversation(userId, id);
  } catch (err) {
    if (err instanceof WorkspacePathError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  return NextResponse.json({ ok: true });
}
