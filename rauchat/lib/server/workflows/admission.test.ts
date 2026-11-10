import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "workflow-admission-"));
  vi.stubEnv("RAUCHAT_WORKSPACE", root);
  vi.resetModules();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
it("reserves aggregate tokens across runs and releases unused allocation", async () => {
  vi.stubEnv("WORKFLOW_USER_DAILY_TOKENS", "150");
  const { reserveWorkflowBudget, settleWorkflowBudget } = await import(
    "./admission"
  );
  await reserveWorkflowBudget("user", "first", 100, 0, true);
  await expect(
    reserveWorkflowBudget("user", "second", 100, 0, true),
  ).rejects.toThrow(/token budget/);
  await settleWorkflowBudget("user", "first", 30);
  await reserveWorkflowBudget("user", "second", 100, 0, true);
});
it("includes already-spent tokens when resuming after a crash", async () => {
  vi.stubEnv("WORKFLOW_USER_DAILY_TOKENS", "150");
  const { reserveWorkflowBudget } = await import("./admission");
  await reserveWorkflowBudget("user", "first", 100, 0, true);
  await reserveWorkflowBudget("user", "first", 100, 60, false);
  await expect(
    reserveWorkflowBudget("user", "second", 60, 0, true),
  ).rejects.toThrow(/token budget/);
});
it("bounds burst starts durably", async () => {
  const { reserveWorkflowBudget } = await import("./admission");
  await reserveWorkflowBudget("user", "a", 10, 0, true);
  await reserveWorkflowBudget("user", "b", 10, 0, true);
  await expect(reserveWorkflowBudget("user", "c", 10, 0, true)).rejects.toThrow(
    /start limit/,
  );
});
it("shares worker slots across runs and removes cancelled waiters", async () => {
  vi.stubEnv("WORKFLOW_USER_WORKERS", "2");
  const { withWorkflowWorker } = await import("./admission");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let active = 0;
  let maximum = 0;
  const work = async () => {
    active++;
    maximum = Math.max(maximum, active);
    await gate;
    active--;
  };
  const signal = new AbortController();
  const first = withWorkflowWorker("user", signal.signal, work);
  const second = withWorkflowWorker("user", signal.signal, work);
  const cancelled = new AbortController();
  const third = withWorkflowWorker("user", cancelled.signal, work);
  cancelled.abort(new Error("cancelled while queued"));
  await expect(third).rejects.toThrow(/queued/);
  release();
  await Promise.all([first, second]);
  expect(maximum).toBe(2);
});
