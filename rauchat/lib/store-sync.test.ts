import { describe, expect, it } from "vitest";
import { mergeConversations } from "./store";
import type { Conversation } from "./types";

function conversation(
  id: string,
  updatedAt: number,
  title = `title-${id}`
): Conversation {
  return { id, title, createdAt: 1, updatedAt, messages: [] };
}

describe("mergeConversations", () => {
  it("keeps local-only conversations (pre-server history migrates up)", () => {
    const local = [conversation("a", 10)];
    expect(mergeConversations(local, [])).toEqual(local);
  });

  it("adds remote-only conversations", () => {
    const remote = [conversation("b", 20)];
    expect(mergeConversations([], remote)).toEqual(remote);
  });

  it("newer updatedAt wins per conversation, either direction", () => {
    const localNewer = conversation("a", 30, "local");
    const remoteNewer = conversation("b", 40, "remote");
    const merged = mergeConversations(
      [localNewer, conversation("b", 5, "stale")],
      [conversation("a", 5, "stale"), remoteNewer]
    );
    expect(merged).toContain(localNewer);
    expect(merged).toContain(remoteNewer);
    expect(merged).toHaveLength(2);
  });

  it("equal timestamps take the server copy (renames do not bump updatedAt)", () => {
    const remote = conversation("a", 10, "renamed on another device");
    const [winner] = mergeConversations([conversation("a", 10)], [remote]);
    expect(winner).toBe(remote);
  });

  it("preserves local ordering and appends remote-only entries", () => {
    const merged = mergeConversations(
      [conversation("a", 1), conversation("b", 2)],
      [conversation("c", 3)]
    );
    expect(merged.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
});
