import { describe, expect, it } from "vitest";
import type { Conversation, Message } from "./types";
import { conversationMatchesQuery, filterConversations } from "./conversation-search";

function message(content: string): Message {
  return { id: content, role: "user", content, createdAt: 0 };
}

function conversation(title: string, ...bodies: string[]): Conversation {
  return {
    id: title,
    title,
    createdAt: 0,
    updatedAt: 0,
    messages: bodies.map(message),
  };
}

describe("conversationMatchesQuery", () => {
  it("matches a substring of the title, case-insensitively", () => {
    const c = conversation("Photosynthesis basics");
    expect(conversationMatchesQuery(c, "photo")).toBe(true);
    expect(conversationMatchesQuery(c, "PHOTOSYNTHESIS")).toBe(true);
  });

  it("matches a substring inside any message body", () => {
    const c = conversation("Untitled", "hello", "the mitochondria is the powerhouse");
    expect(conversationMatchesQuery(c, "powerhouse")).toBe(true);
  });

  it("returns false when neither title nor messages contain the query", () => {
    const c = conversation("Photosynthesis basics", "chlorophyll absorbs light");
    expect(conversationMatchesQuery(c, "mitosis")).toBe(false);
  });

  it("treats an empty or whitespace-only query as matching everything", () => {
    const c = conversation("Anything");
    expect(conversationMatchesQuery(c, "")).toBe(true);
    expect(conversationMatchesQuery(c, "   ")).toBe(true);
  });
});

describe("filterConversations", () => {
  const list = [
    conversation("Photosynthesis basics", "chlorophyll absorbs light"),
    conversation("Trip planning", "let's go to the mountains"),
    conversation("Untitled", "mitochondria is the powerhouse of the cell"),
  ];

  it("returns the full list unchanged when the query is empty", () => {
    expect(filterConversations(list, "")).toEqual(list);
  });

  it("filters to conversations matching by title", () => {
    expect(filterConversations(list, "trip").map((c) => c.id)).toEqual([
      "Trip planning",
    ]);
  });

  it("filters to conversations matching by message content", () => {
    expect(filterConversations(list, "mountains").map((c) => c.id)).toEqual([
      "Trip planning",
    ]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterConversations(list, "quantum entanglement")).toEqual([]);
  });
});
