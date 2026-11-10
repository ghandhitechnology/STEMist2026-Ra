import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
let root: string;
const sandbox = {
  publish: vi.fn(async () => ({ published: [], conflicts: [] })),
  pause: vi.fn(async () => {}),
  kill: vi.fn(async () => {}),
};
vi.mock("../sandbox/e2b", () => ({
  sandboxAvailable: () => true,
  WorkflowSandbox: class {
    publish = sandbox.publish;
    pause = sandbox.pause;
    kill = sandbox.kill;
  },
}));
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "workflow-tests-"));
  vi.stubEnv("RAUCHAT_WORKSPACE", root);
  vi.resetModules();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
const step = (
  id: string,
  role = "researcher",
  dependencies: string[] = [],
) => ({
  id,
  role,
  task: id,
  dependencies,
  outputs: [],
  acceptanceCriteria: ["Supported by evidence"],
});
describe("workflow validation", () => {
  it("rejects cycles, unknown dependencies, unsafe outputs, and unverified execution", async () => {
    const { validateWorkflowPlan } = await import("./validation");
    expect(() =>
      validateWorkflowPlan({
        goal: "test",
        steps: [step("a", "researcher", ["b"]), step("b", "researcher", ["a"])],
      }),
    ).toThrow(/cycle/);
    expect(() =>
      validateWorkflowPlan({
        goal: "test",
        steps: [step("a", "researcher", ["absent"])],
      }),
    ).toThrow(/Unknown/);
    expect(() =>
      validateWorkflowPlan({ goal: "test", steps: [step("a", "executor")] }),
    ).toThrow(/verifier/);
    expect(() =>
      validateWorkflowPlan({
        goal: "test",
        steps: [
          { ...step("a", "executor"), outputs: ["../escape"] },
          step("v", "verifier", ["a"]),
        ],
      }),
    ).toThrow();
  });
  it("does not expose delegation or mutators to research roles", async () => {
    const { ROLE_TOOLS } = await import("./validation");
    for (const role of ["explorer", "researcher", "planner"] as const)
      expect(ROLE_TOOLS[role]).not.toEqual(expect.arrayContaining(["bash"]));
    for (const names of Object.values(ROLE_TOOLS))
      expect(names).not.toContain("workflow_run");
    expect(ROLE_TOOLS.verifier).toContain("bash");
    expect(ROLE_TOOLS.verifier).not.toContain("write");
  });
});
describe("workflow scheduler", () => {
  it("runs three readers together, waits for dependencies, and serializes executor/verifier", async () => {
    const runner = await import("./runner");
    let readers = 0;
    let maximum = 0;
    const done = new Set<string>();
    runner.configureWorkflowRunner({
      executeStep: async ({ step: s }) => {
        s.dependencies.forEach((id) => expect(done.has(id)).toBe(true));
        if (s.role === "executor" || s.role === "verifier")
          expect(readers).toBe(0);
        else {
          readers++;
          maximum = Math.max(maximum, readers);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (s.role !== "executor" && s.role !== "verifier") readers--;
        done.add(s.id);
        return { text: "done", tokens: 10, verified: true };
      },
    });
    const run = await runner.startWorkflow(
      "user_a",
      {
        goal: "test",
        steps: [
          step("a"),
          step("b"),
          step("c"),
          step("d", "executor", ["a", "b", "c"]),
          step("v", "verifier", ["d"]),
        ],
      },
      { conversationId: "chat", model: "test" },
    );
    const result = await runner.waitForWorkflow("user_a", run.id);
    expect(maximum).toBe(3);
    expect(result?.status).toBe("completed");
    expect(result?.tokens).toBe(50);
    expect(await runner.getWorkflow("user_b", run.id)).toBeNull();
  });
  it("repairs failed verification at most twice and never publishes failures", async () => {
    const runner = await import("./runner");
    const calls: string[] = [];
    runner.configureWorkflowRunner({
      executeStep: async ({ step: s }) => {
        calls.push(s.id);
        return { text: "check failed", tokens: 1, verified: false };
      },
    });
    const run = await runner.startWorkflow(
      "user_a",
      {
        goal: "test",
        steps: [step("e", "executor"), step("v", "verifier", ["e"])],
      },
      { conversationId: "chat", model: "test" },
    );
    const result = await runner.waitForWorkflow("user_a", run.id);
    expect(result?.status).toBe("failed");
    expect(calls).toEqual(["e", "v", "e", "v", "e", "v"]);
  });
  it("keeps a run alive when its caller disconnects and persists the final summary", async () => {
    const runner = await import("./runner");
    runner.configureWorkflowRunner({
      executeStep: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { text: "evidence", tokens: 5, verified: true };
      },
      synthesize: async () => ({ text: "Final answer", tokens: 3 }),
    });
    const run = await runner.startWorkflow(
      "user_a",
      { goal: "test", steps: [step("r"), step("v", "verifier", ["r"])] },
      { conversationId: "chat", model: "test" },
    );
    const caller = new AbortController();
    caller.abort();
    await expect(
      runner.waitForWorkflow("user_a", run.id, caller.signal),
    ).rejects.toBeDefined();
    const result = await runner.waitForWorkflow("user_a", run.id);
    expect(result?.status).toBe("completed");
    expect(result?.summary).toBe("Final answer");
    expect(result?.tokens).toBe(13);
  });
  it("requires reconciliation before restarting an interrupted writer", async () => {
    const runner = await import("./runner");
    const { saveWorkflow } = await import("./store");
    runner.configureWorkflowRunner({
      executeStep: async () => ({ text: "done", tokens: 1, verified: true }),
    });
    const run = await runner.startWorkflow(
      "user_a",
      {
        goal: "test",
        steps: [step("e", "executor"), step("v", "verifier", ["e"])],
      },
      { conversationId: "chat", model: "test" },
    );
    const finished = (await runner.waitForWorkflow("user_a", run.id))!;
    finished.status = "running";
    finished.steps[0].status = "running";
    finished.steps[1].status = "pending";
    await saveWorkflow(finished);
    expect((await runner.getWorkflow("user_a", run.id))?.status).toBe(
      "interrupted",
    );
    await expect(
      runner.controlWorkflow("user_a", run.id, "resume"),
    ).rejects.toThrow(/Reconcile/);
    await runner.controlWorkflow("user_a", run.id, "resume", [
      { stepId: "e", action: "retry" },
    ]);
    expect((await runner.waitForWorkflow("user_a", run.id))?.status).toBe(
      "completed",
    );
  });
  it("stops after aggregate token exhaustion", async () => {
    vi.stubEnv("WORKFLOW_MAX_TOKENS", "10");
    const runner = await import("./runner");
    runner.configureWorkflowRunner({
      executeStep: async () => ({ text: "done", tokens: 10 }),
    });
    const run = await runner.startWorkflow(
      "user_a",
      {
        goal: "test",
        steps: [
          step("a"),
          step("b", "researcher", ["a"]),
          step("v", "verifier", ["b"]),
        ],
      },
      { conversationId: "chat", model: "test" },
    );
    const result = await runner.waitForWorkflow("user_a", run.id);
    expect(result?.status).toBe("failed");
    expect(result?.steps[1].attempts).toBe(0);
  });
  it("cancels active work and never starts its dependents", async () => {
    const runner = await import("./runner");
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    runner.configureWorkflowRunner({
      executeStep: async ({ signal }) => {
        entered();
        await new Promise<void>((resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
        return { text: "unreachable", tokens: 1 };
      },
    });
    const run = await runner.startWorkflow(
      "user_a",
      { goal: "test", steps: [step("a"), step("v", "verifier", ["a"])] },
      { conversationId: "chat", model: "test" },
    );
    await started;
    await runner.controlWorkflow("user_a", run.id, "cancel");
    const result = await runner.waitForWorkflow("user_a", run.id);
    expect(result?.status).toBe("cancelled");
    expect(result?.steps[1].attempts).toBe(0);
  });
  it("pauses at a completed checkpoint and resumes remaining steps", async () => {
    const runner = await import("./runner");
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    runner.configureWorkflowRunner({
      executeStep: async ({ step: s }) => {
        if (s.id === "a") {
          entered();
          await gate;
        }
        return { text: "done", tokens: 1, verified: true };
      },
    });
    const run = await runner.startWorkflow(
      "user_a",
      { goal: "test", steps: [step("a"), step("v", "verifier", ["a"])] },
      { conversationId: "chat", model: "test" },
    );
    await started;
    await runner.controlWorkflow("user_a", run.id, "pause");
    release();
    const paused = await runner.waitForWorkflow("user_a", run.id);
    expect(paused?.status).toBe("paused");
    expect(paused?.steps[0].status).toBe("completed");
    expect(paused?.steps[1].attempts).toBe(0);
    await runner.controlWorkflow("user_a", run.id, "resume");
    const completed = await runner.waitForWorkflow("user_a", run.id);
    expect(completed?.status).toBe("completed");
    expect(completed?.steps[0].attempts).toBe(1);
  });

  it("persists curator mutations and requires reconciliation after failure", async () => {
    const runner = await import("./runner");
    runner.configureWorkflowRunner({
      executeStep: async () => ({ text: "checked", tokens: 1, verified: true }),
      curate: async () => {
        throw new Error("Skill save result was interrupted");
      },
    });
    const run = await runner.startWorkflow(
      "user_a",
      { goal: "test", steps: [step("r"), step("v", "verifier", ["r"])] },
      { conversationId: "chat", model: "test" },
    );
    const failed = await runner.waitForWorkflow("user_a", run.id);
    expect(failed?.curation?.status).toBe("failed");
    await expect(
      runner.controlWorkflow("user_a", run.id, "resume"),
    ).rejects.toThrow(/_curate/);
    await runner.controlWorkflow("user_a", run.id, "resume", [
      {
        stepId: "_curate",
        action: "complete",
        result: { text: "Skill revision confirmed", tokens: 0 },
      },
    ]);
    const completed = await runner.waitForWorkflow("user_a", run.id);
    expect(completed?.status).toBe("completed");
    expect(completed?.curated).toBe(true);
  });

  it("admits only one of two simultaneous starts for the same user", async () => {
    const runner = await import("./runner");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    runner.configureWorkflowRunner({
      executeStep: async () => {
        await gate;
        return { text: "done", tokens: 1, verified: true };
      },
    });
    const start = () =>
      runner.startWorkflow(
        "user_a",
        { goal: "test", steps: [step("a"), step("v", "verifier", ["a"])] },
        { conversationId: "chat", model: "test" },
      );
    const results = await Promise.allSettled([start(), start()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    release();
    const admitted = results.find(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof start>>> =>
        r.status === "fulfilled",
    )!;
    await runner.waitForWorkflow("user_a", admitted.value.id);
  });
  it("does not resurrect a cancelled run after a process stops during cancellation", async () => {
    const runner = await import("./runner");
    const { saveWorkflow } = await import("./store");
    runner.configureWorkflowRunner({
      executeStep: async () => ({ text: "done", tokens: 1, verified: true }),
    });
    const run = await runner.startWorkflow(
      "user_a",
      { goal: "test", steps: [step("a"), step("v", "verifier", ["a"])] },
      { conversationId: "chat", model: "test" },
    );
    const result = (await runner.waitForWorkflow("user_a", run.id))!;
    result.status = "cancelled";
    result.steps[0].status = "running";
    await saveWorkflow(result);
    expect((await runner.getWorkflow("user_a", run.id))?.status).toBe(
      "cancelled",
    );
    await expect(
      runner.controlWorkflow("user_a", run.id, "resume"),
    ).rejects.toThrow(/already cancelled/);
  });
  it("honors a pause during curation and does not repeat the saved skill on resume", async () => {
    const runner = await import("./runner");
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const curator = vi.fn(async () => {
      entered();
      await gate;
      return { text: "saved skill", tokens: 1 };
    });
    runner.configureWorkflowRunner({
      executeStep: async () => ({ text: "done", tokens: 1, verified: true }),
      curate: curator,
    });
    const run = await runner.startWorkflow(
      "user_a",
      { goal: "test", steps: [step("a"), step("v", "verifier", ["a"])] },
      { conversationId: "chat", model: "test" },
    );
    await started;
    const requested = await runner.controlWorkflow("user_a", run.id, "pause");
    expect(requested?.pauseRequested).toBe(true);
    expect(requested?.status).toBe("running");
    release();
    expect((await runner.waitForWorkflow("user_a", run.id))?.status).toBe(
      "paused",
    );
    await runner.controlWorkflow("user_a", run.id, "resume");
    expect((await runner.waitForWorkflow("user_a", run.id))?.status).toBe(
      "completed",
    );
    expect(curator).toHaveBeenCalledTimes(1);
  });
});
