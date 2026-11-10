import type { Conversation } from "./types";

/**
 * True when `query` is a case-insensitive substring of the conversation's
 * title or any of its message bodies. Substring-only (no tokenizing/ranking)
 * keeps this cheap enough to re-run on every keystroke against the full
 * in-memory list — sidebar search has no index, just already-loaded state.
 */
export function conversationMatchesQuery(
  conversation: Conversation,
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (conversation.title.toLowerCase().includes(q)) return true;
  return conversation.messages.some((m) => m.content.toLowerCase().includes(q));
}

/**
 * Sidebar search filter. Purely client-side over conversations already held
 * in state — does not touch lib/store.ts sync or fetch anything.
 */
export function filterConversations(
  conversations: readonly Conversation[],
  query: string
): Conversation[] {
  const q = query.trim();
  if (!q) return conversations as Conversation[];
  return conversations.filter((c) => conversationMatchesQuery(c, q));
}
