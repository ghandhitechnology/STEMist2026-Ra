import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { NextRequest } from "next/server";
const session = vi.hoisted(() => ({ userId: "user_a" as string | null }));
vi.mock("@/lib/server/auth", () => ({
  getUserId: async () => session.userId,
  unauthorized: () =>
    Response.json({ error: "Not signed in." }, { status: 401 }),
}));
// Origin validation has dedicated tests; these exercise ownership and runner lifecycle.
vi.mock("@/lib/server/http", () => ({ crossSiteRejection: () => null }));
vi.mock("@/lib/server/workflow-agent-bridge", () => ({
  ensureWorkflowAgentRunner: () => {},
}));
vi.mock("../sandbox/e2b", () => ({
  sandboxAvailable: () => true,
  WorkflowSandbox: class {
    async pause() {}
    async kill() {}
  },
}));
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "workflow-api-"));
  vi.stubEnv("RAUCHAT_WORKSPACE", root);
  vi.resetModules();
  session.userId = "user_a";
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
const plan = {
  goal: "Check a question",
  steps: [
    {
      id: "research",
      role: "researcher",
      task: "Research",
      dependencies: [],
      outputs: [],
      acceptanceCriteria: ["Supported facts"],
    },
    {
      id: "verify",
      role: "verifier",
      task: "Verify",
      dependencies: ["research"],
      outputs: [],
      acceptanceCriteria: ["Evidence checks"],
    },
  ],
};
const request = (id: string, body?: unknown) =>
  new NextRequest(
    `http://localhost/api/workflows/${id}`,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
const context = (id: string) => ({ params: Promise.resolve({ id }) });

it("keeps inspection, control, and event replay scoped to the signed-in owner", async () => {
  const runner = await import("./runner");
  runner.configureWorkflowRunner({
    executeStep: async () => ({ text: "Checked", tokens: 1, verified: true }),
  });
  const run = await runner.startWorkflow("user_a", plan, {
    conversationId: "chat",
    model: "test",
  });
  await runner.waitForWorkflow("user_a", run.id);
  const route = await import("@/app/api/workflows/[id]/route");
  const events = await import("@/app/api/workflows/[id]/events/route");
  expect((await route.GET(request(run.id), context(run.id))).status).toBe(200);
  session.userId = "user_b";
  expect((await route.GET(request(run.id), context(run.id))).status).toBe(404);
  expect(
    (await route.POST(request(run.id, { action: "cancel" }), context(run.id)))
      .status,
  ).toBe(404);
  expect((await events.GET(request(run.id), context(run.id))).status).toBe(404);
  session.userId = null;
  expect((await route.GET(request(run.id), context(run.id))).status).toBe(401);
  expect(
    (await route.POST(request(run.id, { action: "resume" }), context(run.id)))
      .status,
  ).toBe(401);
});

it("replays events after the supplied cursor and returns a final snapshot", async () => {
  const runner = await import("./runner");
  runner.configureWorkflowRunner({
    executeStep: async () => ({ text: "Checked", tokens: 1, verified: true }),
    synthesize: async () => ({ text: "Final result", tokens: 1 }),
  });
  const run = await runner.startWorkflow("user_a", plan, {
    conversationId: "chat",
    model: "test",
  });
  await runner.waitForWorkflow("user_a", run.id);
  const events = await import("@/app/api/workflows/[id]/events/route");
  const response = await events.GET(
    new NextRequest(`http://localhost/api/workflows/${run.id}/events`, {
      headers: { "Last-Event-ID": "2" },
    }),
    context(run.id),
  );
  const body = await response.text();
  expect(body).not.toContain("id: 1\n");
  expect(body).not.toContain("id: 2\n");
  expect(body).toContain("event: snapshot");
  expect(body).toContain("Final result");
});

it("returns 429 when a resume would bypass the user's active run limit", async () => {
  const runner = await import("./runner");
  const { saveWorkflow } = await import("./store");
  runner.configureWorkflowRunner({
    executeStep: async () => ({ text: "Checked", tokens: 1, verified: true }),
  });
  const first = await runner.startWorkflow("user_a", plan, {
    conversationId: "chat",
    model: "test",
  });
  const paused = (await runner.waitForWorkflow("user_a", first.id))!;
  paused.status = "paused";
  await saveWorkflow(paused);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  runner.configureWorkflowRunner({
    executeStep: async () => {
      await gate;
      return { text: "Checked", tokens: 1, verified: true };
    },
  });
  const second = await runner.startWorkflow("user_a", plan, {
    conversationId: "chat",
    model: "test",
  });
  const route = await import("@/app/api/workflows/[id]/route");
  expect(
    (
      await route.POST(
        request(first.id, { action: "resume" }),
        context(first.id),
      )
    ).status,
  ).toBe(429);
  expect(
    (
      await route.POST(
        request(first.id, { action: "unknown" }),
        context(first.id),
      )
    ).status,
  ).toBe(400);
  release();
  await runner.waitForWorkflow("user_a", second.id);
});
