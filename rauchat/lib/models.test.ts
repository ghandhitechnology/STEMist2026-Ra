import { describe, expect, it } from "vitest";
import { MODELS, clampThinking, getModel } from "./models";

describe("model catalog", () => {
  it("registers Grok 4.5 under the xAI provider with its OpenRouter id", () => {
    const grok = MODELS.find((model) => model.id === "grok-4.5");

    expect(grok).toMatchObject({
      openrouterId: "x-ai/grok-4.5",
      label: "Grok 4.5",
      family: "xai",
      defaultThinking: "medium",
    });
  });

  it("clamps unsupported Grok reasoning levels to its default", () => {
    const grok = getModel("grok-4.5");

    expect(clampThinking(grok, "xhigh")).toBe("medium");
    expect(clampThinking(grok, "max")).toBe("medium");
    expect(clampThinking(grok, "high")).toBe("high");
  });

  it("exposes xhigh and max on Claude and GPT models", () => {
    for (const id of [
      "claude-sonnet-5",
      "claude-opus-5",
      "gpt-5.6-sol",
      "gpt-5.6-luna",
      "gpt-5.6-terra",
    ]) {
      const model = getModel(id);
      expect(model.thinkingLevels).toContain("xhigh");
      expect(model.thinkingLevels).toContain("max");
      expect(clampThinking(model, "max")).toBe("max");
    }
  });
});
