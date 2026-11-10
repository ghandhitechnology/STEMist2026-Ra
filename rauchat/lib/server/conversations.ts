/**
 * lib/server/conversations.ts — durable, per-user chat history.
 *
 * One JSON file per conversation at
 * `<RAUCHAT_WORKSPACE>/conversations/<userId>/<conversationId>.json`. Like
 * profiles and memory this lives OUTSIDE the per-user workspace sandbox, so
 * the file_read / file_write tools can never read or rewrite transcripts —
 * only app/api/conversations/* writes here.
 *
 * The client (lib/store.ts) keeps localStorage as a warm cache and treats
 * this store as the cross-device source of truth: whole-conversation
 * last-write-wins, no merging of individual messages server-side.
 */

import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Conversation } from "@/lib/types";
import { conversationFile, conversationsDirFor } from "./paths";

/**
 * Upper bound on one serialized conversation. Generous — transcripts with
 * tool results run tens of KB — while still bounding what one PUT can pin
 * into memory and onto the disk.
 */
export const MAX_CONVERSATION_BYTES = 5 * 1024 * 1024;

export class ConversationTooLargeError extends Error {
  constructor() {
    super("Conversation exceeds the maximum stored size.");
    this.name = "ConversationTooLargeError";
  }
}

/**
 * Every stored conversation for the user, unsorted (the client orders by
 * updatedAt). A file that fails to parse is skipped rather than failing the
 * whole listing — one corrupt write must not take the user's history down.
 */
export async function listConversations(
  userId: string
): Promise<Conversation[]> {
  let files: string[];
  try {
    files = await readdir(conversationsDirFor(userId));
  } catch {
    return [];
  }
  const conversations: Conversation[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(
        conversationFile(userId, file.slice(0, -".json".length)),
        "utf8"
      );
      const parsed = JSON.parse(raw) as Conversation;
      if (parsed && typeof parsed.id === "string") conversations.push(parsed);
    } catch {
      // Corrupt or mid-rename file — skip.
    }
  }
  return conversations;
}

/**
 * Upserts one conversation. Write-temp-then-rename: a crash or concurrent
 * save mid-write must never leave a half-written file where history was.
 */
export async function saveConversation(
  userId: string,
  conversation: Conversation
): Promise<void> {
  const body = JSON.stringify(conversation);
  if (Buffer.byteLength(body, "utf8") > MAX_CONVERSATION_BYTES) {
    throw new ConversationTooLargeError();
  }
  await mkdir(conversationsDirFor(userId), { recursive: true });
  const file = conversationFile(userId, conversation.id);
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, body, "utf8");
  await rename(tmp, file);
}

/** Removes one conversation; deleting a conversation that never synced is a no-op. */
export async function deleteConversation(
  userId: string,
  conversationId: string
): Promise<void> {
  await rm(conversationFile(userId, conversationId), { force: true });
}
