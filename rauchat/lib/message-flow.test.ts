import { describe, expect, it } from "vitest";
import type { ToolEvent } from "./types";
import { buildAssistantFlow } from "./message-flow";

function sketch(id: string, textOffset: number): ToolEvent {
  return {
    id,
    tool: "svg_render",
    status: "done",
    title: id,
    textOffset,
  };
}

describe("buildAssistantFlow", () => {
  it("places a sketch between the prose emitted before and after its call", () => {
    const flow = buildAssistantFlow("Before the sketch. After it.", [
      sketch("orbit", 18),
    ]);

    expect(flow.map((part) => part.kind)).toEqual([
      "text",
      "sketch",
      "text",
    ]);
    expect(flow[0]).toMatchObject({ content: "Before the sketch." });
    expect(flow[2]).toMatchObject({ content: " After it." });
  });

  it("keeps simultaneous sketch calls in model order", () => {
    const flow = buildAssistantFlow("Intro", [sketch("a", 5), sketch("b", 5)]);
    expect(
      flow.filter((part) => part.kind === "sketch").map((part) => part.event.id),
    ).toEqual(["a", "b"]);
  });

  it("waits for smoothed streaming text to reach the recorded anchor", () => {
    const flow = buildAssistantFlow("Short", [sketch("later", 12)]);
    expect(flow).toEqual([{ kind: "text", content: "Short", key: "text:0" }]);
  });
});
