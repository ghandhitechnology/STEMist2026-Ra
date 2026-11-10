import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "@/lib/types";

// WORKSPACE_BASE_ROOT is resolved from the environment at module load, so
// each test gets a fresh temp workspace via resetModules + dynamic import.
let workspace: string;

async function loadStore() {
  vi.resetModules();
  vi.stubEnv("RAUCHAT_WORKSPACE", workspace);
  return await import("./conversations");
}

function conversation(id: string, title = "Test chat"): Conversation {
  return {
    id,
    title,
    createdAt: 1,
    updatedAt: 2,
    messages: [{ id: "m1", role: "user", content: "hi", createdAt: 1 }],
  };
}

beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "rauchat-conversations-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(workspace, { recursive: true, force: true });
});

describe("conversations store", () => {
  it("lists nothing for a user who never saved", async () => {
    const store = await loadStore();
    expect(await store.listConversations("user_a")).toEqual([]);
  });

  it("round-trips a saved conversation", async () => {
    const store = await loadStore();
    const saved = conversation("conv-1");
    await store.saveConversation("user_a", saved);
    expect(await store.listConversations("user_a")).toEqual([saved]);
  });

  it("upserts in place rather than duplicating", async () => {
    const store = await loadStore();
    await store.saveConversation("user_a", conversation("conv-1", "before"));
    await store.saveConversation("user_a", conversation("conv-1", "after"));
    const listed = await store.listConversations("user_a");
    expect(listed).toHaveLength(1);
    expect(listed[0].title).toBe("after");
  });

  it("keeps users' histories separate", async () => {
    const store = await loadStore();
    await store.saveConversation("user_a", conversation("conv-1"));
    expect(await store.listConversations("user_b")).toEqual([]);
  });

  it("deletes one conversation and tolerates deleting a missing one", async () => {
    const store = await loadStore();
    await store.saveConversation("user_a", conversation("conv-1"));
    await store.deleteConversation("user_a", "conv-1");
    await store.deleteConversation("user_a", "conv-1");
    expect(await store.listConversations("user_a")).toEqual([]);
  });

  it("rejects an oversized conversation", async () => {
    const store = await loadStore();
    const huge = conversation("conv-1");
    huge.messages[0].content = "x".repeat(store.MAX_CONVERSATION_BYTES + 1);
    await expect(store.saveConversation("user_a", huge)).rejects.toThrow(
      store.ConversationTooLargeError
    );
  });

  it("rejects path-traversal conversation ids", async () => {
    const store = await loadStore();
    await expect(
      store.saveConversation("user_a", conversation("../escape"))
    ).rejects.toThrow(/invalid conversation id/i);
  });

  it("skips a corrupt file instead of failing the listing", async () => {
    const store = await loadStore();
    await store.saveConversation("user_a", conversation("conv-1"));
    const { writeFile } = await import("node:fs/promises");
    const dir = path.join(workspace, "conversations", "user_a");
    await writeFile(path.join(dir, "broken.json"), "{not json", "utf8");
    const listed = await store.listConversations("user_a");
    expect(listed.map((c) => c.id)).toEqual(["conv-1"]);
    expect(await readdir(dir)).toContain("broken.json");
  });
});
