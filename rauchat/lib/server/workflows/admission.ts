import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WORKSPACE_BASE_ROOT } from "../paths";

type Allocation = { spent: number; reserved: number; baseline: number };
type AdmissionUsage = {
  day: string;
  starts: number[];
  runs: Record<string, Allocation>;
};
const shared = globalThis as typeof globalThis & {
  __rauchatWorkflowAdmissionLocks?: Map<string, Promise<void>>;
};
const locks = (shared.__rauchatWorkflowAdmissionLocks ??= new Map<
  string,
  Promise<void>
>());

export class WorkflowAdmissionError extends Error {}

export function workflowUserLimits() {
  const value = (name: string, fallback: number, maximum: number) => {
    const configured = Number(process.env[name]);
    return Number.isSafeInteger(configured) && configured > 0
      ? Math.min(configured, maximum)
      : fallback;
  };
  return {
    active: value("WORKFLOW_USER_ACTIVE_LIMIT", 1, 3),
    dailyTokens: value("WORKFLOW_USER_DAILY_TOKENS", 1_000_000, 100_000_000),
    dailyStarts: value("WORKFLOW_USER_DAILY_RUNS", 20, 1000),
    minuteStarts: value("WORKFLOW_USER_BURST_RUNS", 2, 100),
  };
}

/** Admission and lifecycle controls share one user lock, including concurrent resumes. */
export async function withWorkflowAdmission<T>(
  userId: string,
  work: () => Promise<T>,
) {
  const previous = locks.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.then(() => held);
  locks.set(userId, chain);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (locks.get(userId) === chain) locks.delete(userId);
  }
}

function usagePath(userId: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(userId))
    throw new Error("Invalid user ID.");
  return path.join(WORKSPACE_BASE_ROOT, "workflow-usage", `${userId}.json`);
}

async function loadUsage(userId: string, now: number): Promise<AdmissionUsage> {
  const day = new Date(now).toISOString().slice(0, 10);
  try {
    const usage = JSON.parse(
      await readFile(usagePath(userId), "utf8"),
    ) as AdmissionUsage;
    if (usage.day === day) return usage;
    // Keep outstanding reservations across midnight; unfinished runs still spend tokens.
    return {
      day,
      starts: [],
      runs: Object.fromEntries(
        Object.entries(usage.runs)
          .filter(([, allocation]) => allocation.reserved > 0)
          .map(([id, allocation]) => [id, { ...allocation, spent: 0 }]),
      ),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { day, starts: [], runs: {} };
}

async function saveUsage(userId: string, usage: AdmissionUsage) {
  const target = usagePath(userId);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(usage), { mode: 0o600 });
  await rename(temporary, target);
}

/** Reserve the remaining run budget before spending. A crash leaves the reservation intact. */
export async function reserveWorkflowBudget(
  userId: string,
  runId: string,
  maximumTokens: number,
  spentTokens: number,
  isNew: boolean,
  now = Date.now(),
) {
  const limits = workflowUserLimits();
  const usage = await loadUsage(userId, now);
  if (isNew) {
    if (usage.starts.length >= limits.dailyStarts) {
      throw new WorkflowAdmissionError(
        `Daily workflow limit reached (${limits.dailyStarts} runs).`,
      );
    }
    if (
      usage.starts.filter((started) => now - started < 60_000).length >=
      limits.minuteStarts
    ) {
      throw new WorkflowAdmissionError(
        "Workflow start limit reached. Try again in a minute.",
      );
    }
  }
  const previous = usage.runs[runId];
  const spent =
    (previous?.spent ?? 0) +
    Math.max(0, spentTokens - (previous?.baseline ?? spentTokens));
  const reserved = Math.max(0, maximumTokens - spentTokens);
  const otherTokens = Object.entries(usage.runs)
    .filter(([id]) => id !== runId)
    .reduce((total, [, entry]) => total + entry.spent + entry.reserved, 0);
  if (otherTokens + spent + reserved > limits.dailyTokens) {
    throw new WorkflowAdmissionError(
      "Daily workflow token budget cannot cover this run. It resets at midnight UTC.",
    );
  }
  usage.runs[runId] = { spent, reserved, baseline: spentTokens };
  if (isNew) usage.starts.push(now);
  await saveUsage(userId, usage);
}

/** Called under the same admission lock after the runner has stopped spending. */
export async function settleWorkflowBudget(
  userId: string,
  runId: string,
  totalTokens: number,
) {
  const usage = await loadUsage(userId, Date.now());
  const allocation = usage.runs[runId];
  if (!allocation) return;
  allocation.spent += Math.max(0, totalTokens - allocation.baseline);
  allocation.baseline = totalTokens;
  allocation.reserved = 0;
  await saveUsage(userId, usage);
}

type WorkerWaiter = {
  grant: () => void;
  reject: (reason: unknown) => void;
  signal: AbortSignal;
  abort: () => void;
};
type WorkerQueue = { active: number; waiting: WorkerWaiter[] };
const workerState = globalThis as typeof globalThis & {
  __rauchatWorkflowWorkers?: Map<string, WorkerQueue>;
};
const workers = (workerState.__rauchatWorkflowWorkers ??= new Map<
  string,
  WorkerQueue
>());

/** All runs for one user share worker slots, even when concurrent runs are enabled. */
export async function withWorkflowWorker<T>(
  userId: string,
  signal: AbortSignal,
  work: () => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  const queue = workers.get(userId) ?? { active: 0, waiting: [] };
  workers.set(userId, queue);
  const pump = () => {
    const configured = Number(process.env.WORKFLOW_USER_WORKERS);
    const limit =
      Number.isInteger(configured) && configured > 0
        ? Math.min(configured, 10)
        : 3;
    while (queue.active < limit && queue.waiting.length) {
      const waiter = queue.waiting.shift()!;
      waiter.signal.removeEventListener("abort", waiter.abort);
      if (waiter.signal.aborted) {
        waiter.reject(waiter.signal.reason);
        continue;
      }
      queue.active++;
      waiter.grant();
    }
  };
  await new Promise<void>((resolve, reject) => {
    const waiter: WorkerWaiter = {
      grant: resolve,
      reject,
      signal,
      abort: () => {
        const index = queue.waiting.indexOf(waiter);
        if (index >= 0) queue.waiting.splice(index, 1);
        reject(signal.reason);
      },
    };
    signal.addEventListener("abort", waiter.abort, { once: true });
    queue.waiting.push(waiter);
    pump();
  });
  try {
    signal.throwIfAborted();
    return await work();
  } finally {
    queue.active--;
    pump();
    if (!queue.active && !queue.waiting.length) workers.delete(userId);
  }
}

export async function removeWorkflowUsage(userId: string) {
  await rm(usagePath(userId), { force: true });
}
