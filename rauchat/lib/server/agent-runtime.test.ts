import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  InMemoryCredentialStore,
  Type,
  type Model,
} from "@earendil-works/pi-ai";
import {
  ModelRuntime,
  SessionManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  selectAgentToolNames,
  synchronizeUiHistory,
  runAgentSession,
  type AgentHistoryMessage,
} from "./agent-runtime";
import { createAgentEventRelay } from "./agent-events";
import type { ToolEvent } from "@/lib/types";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

const model: Model<any> = {
  id: "test/model",
  name: "Test",
  api: "openai-completions",
  provider: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000_000,
  maxTokens: 16_384,
};

function history(): AgentHistoryMessage[] {
  return [
    { id: "u1", role: "user", content: "first", createdAt: 1 },
    { id: "a1", role: "assistant", content: "one", createdAt: 2 },
    { id: "u2", role: "user", content: "second", createdAt: 3 },
    { id: "a2", role: "assistant", content: "two", createdAt: 4 },
  ];
}

function fakeTool(name: string): ToolDefinition {
  return {
    name,
    label: name,
    description: name,
    parameters: Type.Object({}),
    async execute() {
      return { content: [{ type: "text", text: "ok" }], details: {} };
    },
  };
}

describe("Pi session history", () => {
  it("persists migrated UI turns and restores their mapping", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "rauchat-pi-"));
    tempDirs.push(root);
    const cwd = path.join(root, "workspace");
    const sessions = path.join(root, "sessions");
    await mkdir(cwd);

    const initial = SessionManager.create(cwd, sessions, { id: "session-1" });
    synchronizeUiHistory(initial, history(), model);
    const file = initial.getSessionFile();
    expect(file).toBeTruthy();
    expect(initial.buildSessionContext().messages.map((item) => item.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);

    const restored = SessionManager.open(file!);
    synchronizeUiHistory(restored, history(), model);
    expect(restored.getBranch().filter((entry) => entry.type === "custom")).toHaveLength(2);
    expect(await readFile(file!, "utf8")).toContain('"customType":"rauchat.ui-turn"');
  });

  it("moves the leaf back when regeneration removes the last assistant", () => {
    const manager = SessionManager.inMemory("/tmp/rauchat-test");
    synchronizeUiHistory(manager, history(), model);
    const oldLeaf = manager.getLeafId();

    synchronizeUiHistory(manager, history().slice(0, 2), model);

    expect(manager.getLeafId()).not.toBe(oldLeaf);
    expect(manager.buildSessionContext().messages.map((item) => item.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(manager.getEntries()).toHaveLength(6);
  });
});

describe("child tool policy", () => {
  const tools = ["read", "bash", "write", "workflow_run", "web_search"].map(
    fakeTool
  );

  it("removes mutation and recursive workflow tools from read-only children", () => {
    expect(
      selectAgentToolNames(tools, undefined, { readOnly: true, child: true })
    ).toEqual(["read", "web_search"]);
  });

  it("allows verifier bash only when the caller explicitly requests it", () => {
    expect(
      selectAgentToolNames(tools, ["bash", "read"], {
        readOnly: true,
        child: true,
        allowBashInReadOnly: true,
      })
    ).toEqual(["bash", "read"]);
  });
});

describe("Pi event integration", () => {
  it("executes tools, feeds their results into the next model turn, and preserves UI details", async () => {
    const faux = fauxProvider();
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    runtime.registerNativeProvider(faux.provider);

    let sawToolResults = false;
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxText("Before "),
          fauxToolCall(
            "diagram",
            { id: "demo", title: "Demo" },
            { id: "diagram-call" }
          ),
          fauxToolCall(
            "svg_render",
            { title: "Sketch" },
            { id: "svg-call" }
          ),
        ],
        { stopReason: "toolUse" }
      ),
      (context) => {
        const results = context.messages.filter(
          (message) => message.role === "toolResult"
        );
        sawToolResults =
          results.length === 2 &&
          results.some((result) =>
            result.content.some(
              (part) => part.type === "text" && part.text.includes("saved")
            )
          );
        expect(context.tools?.map((tool) => tool.name)).not.toContain(
          "workflow_run"
        );
        return fauxAssistantMessage("After");
      },
    ]);

    const diagram = fakeTool("diagram");
    diagram.execute = async () => ({
      content: [{ type: "text", text: JSON.stringify({ saved: true }) }],
      details: {
        result: { saved: true },
        clientResult: { id: "demo", content: "full artifact" },
        detail: "created",
      },
    });
    const svg = fakeTool("svg_render");
    svg.execute = async () => ({
      content: [{ type: "text", text: JSON.stringify({ rendered: true }) }],
      details: {
        result: { rendered: true },
        clientResult: { title: "Sketch", svg: "<svg />" },
        detail: "rendered inline",
      },
    });
    const workflow = fakeTool("workflow_run");
    const sent: Array<{ event: string; data: unknown }> = [];
    const relay = createAgentEventRelay((event, data) => sent.push({ event, data }));

    const result = await runAgentSession({
      sessionManager: SessionManager.inMemory("/tmp/rauchat-pi-integration"),
      cwd: "/tmp/rauchat-pi-integration",
      systemPrompt: "Test the tool loop.",
      modelId: faux.getModel().id,
      modelRuntime: runtime,
      model: faux.getModel(),
      thinking: "off",
      prompt: "Make an artifact and sketch.",
      customTools: [diagram, svg, workflow],
      child: true,
      onEvent: relay,
    });

    expect(sawToolResults).toBe(true);
    expect(result.text).toBe("Before After");
    expect(result.usage.total).toBeGreaterThan(0);
    const events = sent
      .filter((item) => item.event === "tool_event")
      .map((item) => item.data as ToolEvent);
    expect(events.find((event) => event.tool === "diagram" && event.status === "done")?.result).toEqual({
      id: "demo",
      content: "full artifact",
    });
    expect(events.find((event) => event.tool === "svg_render" && event.status === "done")).toMatchObject({
      textOffset: 7,
      result: { title: "Sketch", svg: "<svg />" },
    });
  });
});
