import { randomUUID } from "node:crypto";
import {
  reserveWorkflowBudget,
  removeWorkflowUsage,
  settleWorkflowBudget,
  withWorkflowAdmission,
  workflowUserLimits,
  withWorkflowWorker,
  WorkflowAdmissionError,
} from "./admission";
import type {
  WorkflowPlan,
  WorkflowRun,
  WorkflowStepState,
  WorkflowStepResult,
} from "@/lib/workflow-types";
import { WorkflowSandbox, sandboxAvailable } from "../sandbox/e2b";
import {
  readWorkflow,
  readWorkflows,
  removeWorkflowState,
  saveWorkflow,
} from "./store";
import {
  isMutatingRole,
  ROLE_TOOLS,
  validateWorkflowPlan,
  workflowLimits,
} from "./validation";

export type WorkflowStepContext = {
  run: WorkflowRun;
  step: WorkflowStepState;
  dependencyResults: Record<string, WorkflowStepResult>;
  sandbox: WorkflowSandbox;
  signal: AbortSignal;
  allowedTools: string[];
  reportTokens: (tokens: number) => void;
  onOutput: (text: string) => void;
};
export type WorkflowRunnerConfig = {
  executeStep: (context: WorkflowStepContext) => Promise<WorkflowStepResult>;
  curate?: (context: WorkflowStepContext) => Promise<WorkflowStepResult>;
  synthesize?: (
    run: WorkflowRun,
    signal: AbortSignal,
    reportTokens: (tokens: number) => void,
  ) => Promise<{ text: string; tokens: number }>;
};
type Job = {
  run: WorkflowRun;
  controller: AbortController;
  sandbox: WorkflowSandbox;
  done: Promise<void>;
  saving: Promise<void>;
};
const state = globalThis as typeof globalThis & {
  __rauchatWorkflows?: {
    config?: WorkflowRunnerConfig;
    jobs: Map<string, Job>;
  };
};
const runtime: { config?: WorkflowRunnerConfig; jobs: Map<string, Job> } =
  (state.__rauchatWorkflows ??= { jobs: new Map<string, Job>() });
export function configureWorkflowRunner(config: WorkflowRunnerConfig) {
  runtime.config = config;
}
const key = (userId: string, id: string) => `${userId}:${id}`;
function event(
  run: WorkflowRun,
  type: string,
  message?: string,
  stepId?: string,
) {
  run.updatedAt = Date.now();
  run.events.push({
    sequence: (run.events.at(-1)?.sequence ?? 0) + 1,
    at: run.updatedAt,
    type,
    message,
    stepId,
  });
}
function persist(job: Job) {
  // Snapshot before queuing so concurrent worker updates never rewrite an older state last.
  const snapshot = structuredClone(job.run);
  job.saving = job.saving.then(() => saveWorkflow(snapshot));
  return job.saving;
}
export async function getWorkflow(
  userId: string,
  id: string,
): Promise<WorkflowRun | null> {
  const active = runtime.jobs.get(key(userId, id));
  if (active) return structuredClone(active.run);
  return withWorkflowAdmission(userId, () => getWorkflowLocked(userId, id));
}
async function getWorkflowLocked(
  userId: string,
  id: string,
): Promise<WorkflowRun | null> {
  const active = runtime.jobs.get(key(userId, id));
  if (active) return structuredClone(active.run);
  const run = await readWorkflow(userId, id);
  if (!run) return null;
  if (
    run.status !== "cancelled" &&
    run.status !== "completed" &&
    (run.status === "running" ||
      run.status === "pending" ||
      run.steps.some((s) => s.status === "running") ||
      run.curation?.status === "running")
  ) {
    if (run.activeStartedAt) {
      run.elapsedMs += Math.max(0, Date.now() - run.activeStartedAt);
      delete run.activeStartedAt;
    }
    run.status = "interrupted";
    for (const step of [...run.steps, ...(run.curation ? [run.curation] : [])])
      if (step.status === "running") {
        step.status = "interrupted";
        step.error = "Server stopped before completion was recorded.";
      }
    event(
      run,
      "interrupted",
      "Execution stopped. Completed checkpoints are preserved; interrupted writes require reconciliation.",
    );
    await saveWorkflow(run);
  }
  return run;
}
export async function listWorkflows(userId: string, conversationId?: string) {
  const runs = await readWorkflows(userId);
  const result = await Promise.all(
    runs
      .filter((r) => !conversationId || r.conversationId === conversationId)
      .map((r) => getWorkflow(userId, r.id)),
  );
  return result.filter((r): r is WorkflowRun => !!r);
}
export async function startWorkflow(
  userId: string,
  input: WorkflowPlan | unknown,
  options: {
    conversationId: string;
    model: string;
    thinking?: string;
    skillIds?: string[];
  },
) {
  return withWorkflowAdmission(userId, () =>
    startWorkflowLocked(userId, input, options),
  );
}
function assertUserSlot(userId: string) {
  const active = [...runtime.jobs.values()].filter(
    (job) => job.run.userId === userId,
  ).length;
  if (active >= workflowUserLimits().active)
    throw new WorkflowAdmissionError(
      "Another workflow is already active. Pause or finish it before starting another.",
    );
}
async function startWorkflowLocked(
  userId: string,
  input: WorkflowPlan | unknown,
  options: {
    conversationId: string;
    model: string;
    thinking?: string;
    skillIds?: string[];
  },
) {
  assertUserSlot(userId);
  if (!runtime.config)
    throw new Error("Workflow runtime has not been configured.");
  const limits = workflowLimits();
  const plan = validateWorkflowPlan(input, limits.steps);
  if (
    plan.steps.some((s) => isMutatingRole(s.role) || s.outputs.length) &&
    !sandboxAvailable()
  )
    throw new Error("Configure E2B_API_KEY to run execution workflows.");
  const skillSnapshots = [];
  if (options.skillIds?.length) {
    const { resolveSkills, snapshotSkillPackage } = await import("../skills");
    for (const skill of await resolveSkills(userId, options.skillIds)) {
      const snapshot = await snapshotSkillPackage(
        userId,
        skill.id,
        skill.revision,
      );
      if (!snapshot)
        throw new Error(
          `Selected skill revision is unavailable: ${skill.name}`,
        );
      skillSnapshots.push(snapshot);
    }
  }
  const run: WorkflowRun = {
    id: randomUUID(),
    userId,
    ...options,
    skillIds: options.skillIds ?? [],
    skillSnapshots,
    goal: plan.goal,
    steps: plan.steps.map((step) => ({
      ...step,
      status: "pending",
      attempts: 0,
    })),
    status: "pending",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    elapsedMs: 0,
    tokens: 0,
    events: [],
    baseline: {},
    publishedOutputs: [],
    conflicts: [],
    limits,
  };
  await reserveWorkflowBudget(userId, run.id, limits.tokens, 0, true);
  event(run, "created", plan.goal);
  await saveWorkflow(run);
  launch(run);
  return structuredClone(run);
}
function launch(run: WorkflowRun) {
  const job: Job = {
    run,
    controller: new AbortController(),
    saving: Promise.resolve(),
    done: Promise.resolve(),
    sandbox: undefined!,
  };
  job.sandbox = new WorkflowSandbox(run.userId, run.id, {
    sandboxId: run.sandboxId,
    baseline: run.baseline,
    skillIds: run.skillIds,
    skillSnapshots: run.skillSnapshots,
    onReady: async (id, baseline) => {
      run.sandboxId = id;
      run.baseline = baseline;
      await persist(job);
    },
  });
  runtime.jobs.set(key(run.userId, run.id), job);
  job.done = execute(job)
    .catch(async (error) => {
      if (run.status !== "cancelled") {
        run.status = "failed";
        run.error = error instanceof Error ? error.message : String(error);
        event(run, "failed", run.error);
      }
      await persist(job);
    })
    .finally(async () => {
      await withWorkflowAdmission(run.userId, async () => {
        try {
          await settleWorkflowBudget(run.userId, run.id, run.tokens);
        } finally {
          runtime.jobs.delete(key(run.userId, run.id));
        }
      });
    });
}
async function execute(job: Job) {
  const { run, controller, sandbox } = job;
  const config = runtime.config!;
  const began = Date.now();
  run.status = "running";
  run.pauseRequested = false;
  run.activeStartedAt = began;
  event(run, "running");
  await persist(job);
  const timeout = setTimeout(
    () => controller.abort(new Error("Workflow time budget exhausted.")),
    Math.max(1, run.limits.durationMs - run.elapsedMs),
  );
  const consume = (tokens: number) => {
    if (!Number.isFinite(tokens) || tokens < 0)
      throw new Error("Invalid workflow token usage.");
    run.tokens += Math.ceil(tokens);
    void persist(job).catch((error) => controller.abort(error));
    if (run.tokens >= run.limits.tokens)
      controller.abort(new Error("Workflow token budget exhausted."));
  };
  const runStep = async (
    step: WorkflowStepState,
    executor: WorkflowRunnerConfig["executeStep"],
  ) => {
    controller.signal.throwIfAborted();
    step.status = "running";
    step.attempts++;
    step.startedAt = Date.now();
    delete step.error;
    event(run, "step_started", step.task, step.id);
    await persist(job);
    let reported = 0;
    try {
      const dependencies = Object.fromEntries(
        step.dependencies.map((id) => [
          id,
          run.steps.find((s) => s.id === id)!.result!,
        ]),
      );
      const result = await withWorkflowWorker(
        run.userId,
        controller.signal,
        () =>
          executor({
            run: structuredClone(run),
            step: structuredClone(step),
            dependencyResults: dependencies,
            sandbox,
            signal: controller.signal,
            allowedTools: ROLE_TOOLS[step.role],
            reportTokens: (tokens) => {
              reported += tokens;
              consume(tokens);
            },
            onOutput: (text) => {
              event(run, "step_output", text.slice(-4000), step.id);
              void persist(job).catch((error) => controller.abort(error));
            },
          }),
      );
      if (result.tokens > reported) consume(result.tokens - reported);
      controller.signal.throwIfAborted();
      step.result = result;
      step.completedAt = Date.now();
      if (step.role === "verifier" && result.verified !== true) {
        const ancestors = new Set<string>();
        const collect = (id: string) => {
          if (ancestors.has(id)) return;
          ancestors.add(id);
          run.steps.find((s) => s.id === id)?.dependencies.forEach(collect);
        };
        step.dependencies.forEach(collect);
        const repairs = run.steps.filter(
          (s) => ancestors.has(s.id) && s.role === "executor",
        );
        if (!repairs.length || step.attempts > run.limits.repairCycles)
          throw new Error(`Verification failed: ${result.text}`);
        // Invalidate all dependents of repaired executors, including intermediate research and other verifiers.
        const invalidated = new Set(repairs.map((s) => s.id));
        let changed = true;
        while (changed) {
          changed = false;
          for (const item of run.steps)
            if (
              !invalidated.has(item.id) &&
              item.dependencies.some((d) => invalidated.has(d))
            ) {
              invalidated.add(item.id);
              changed = true;
            }
        }
        for (const item of run.steps)
          if (invalidated.has(item.id)) {
            item.status = "pending";
            item.repairFeedback = result.text;
            delete item.result;
          }
        event(run, "repair_requested", result.text, step.id);
      } else {
        step.status = "completed";
        event(run, "step_completed", result.text.slice(0, 2000), step.id);
      }
    } catch (error) {
      step.status = controller.signal.aborted ? "interrupted" : "failed";
      step.error = error instanceof Error ? error.message : String(error);
      event(run, "step_failed", step.error, step.id);
      throw error;
    } finally {
      await persist(job);
    }
  };
  const pauseAtBoundary = () => {
    if (!run.pauseRequested) return false;
    run.status = "paused";
    event(run, "paused", "Paused at a completed step boundary.");
    return true;
  };
  try {
    while (run.steps.some((s) => s.status !== "completed")) {
      controller.signal.throwIfAborted();
      if (run.pauseRequested) break;
      const ready = run.steps.filter(
        (s) =>
          s.status === "pending" &&
          s.dependencies.every(
            (id) => run.steps.find((d) => d.id === id)?.status === "completed",
          ),
      );
      if (!ready.length)
        throw new Error(
          "No runnable steps remain. Reconcile interrupted or failed steps before resuming.",
        );
      // Verifiers also run alone so repair invalidation cannot race sibling results.
      const exclusive = ready.find(
        (s) => isMutatingRole(s.role) || s.role === "verifier",
      );
      const batch = exclusive
        ? [exclusive]
        : ready.slice(0, run.limits.concurrency);
      const results = await Promise.allSettled(
        batch.map((step) => runStep(step, config.executeStep)),
      );
      const failure = results.find(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      if (failure) throw failure.reason;
    }
    if (pauseAtBoundary()) return;
    const outputs = run.steps.flatMap((s) => s.outputs);
    if (outputs.length) {
      const sync = await sandbox.publish(outputs);
      run.publishedOutputs = sync.published;
      run.conflicts = sync.conflicts;
      if (sync.conflicts.length)
        throw new Error(
          `Output conflicts staged for resolution: ${sync.conflicts.join(", ")}`,
        );
    }
    controller.signal.throwIfAborted();
    if (pauseAtBoundary()) return;
    if (!run.curated && config.curate) {
      const step: WorkflowStepState = run.curation ?? {
        id: "_curate",
        role: "skill_curator",
        task: "Save proven reusable methods from this verified workflow. Update matching skills before creating duplicates; skip one-off facts.",
        dependencies: run.steps.map((s) => s.id),
        outputs: [],
        acceptanceCriteria: ["Only verified reusable methods are saved."],
        status: "pending",
        attempts: 0,
      };
      run.curation = step;
      await runStep(step, config.curate);
      run.curated = true;
      await persist(job);
    }
    controller.signal.throwIfAborted();
    if (pauseAtBoundary()) return;
    if (!run.summary && config.synthesize) {
      let reported = 0;
      const result = await withWorkflowWorker(
        run.userId,
        controller.signal,
        () =>
          config.synthesize!(
            structuredClone(run),
            controller.signal,
            (tokens) => {
              reported += tokens;
              consume(tokens);
            },
          ),
      );
      if (result.tokens > reported) consume(result.tokens - reported);
      run.summary = result.text;
    }
    controller.signal.throwIfAborted();
    if (pauseAtBoundary()) return;
    run.status = "completed";
    event(run, "completed", run.summary ?? "All workflow steps completed.");
  } finally {
    clearTimeout(timeout);
    run.elapsedMs += Date.now() - began;
    delete run.activeStartedAt;
    if (controller.signal.aborted) await sandbox.kill().catch(() => undefined);
    else await sandbox.pause().catch(() => undefined);
    await persist(job);
  }
}
export async function controlWorkflow(
  userId: string,
  id: string,
  action: "pause" | "resume" | "cancel",
  reconciliation: {
    stepId: string;
    action: "retry" | "complete";
    result?: WorkflowStepResult;
  }[] = [],
) {
  return withWorkflowAdmission(userId, () =>
    controlWorkflowLocked(userId, id, action, reconciliation),
  );
}
async function controlWorkflowLocked(
  userId: string,
  id: string,
  action: "pause" | "resume" | "cancel",
  reconciliation: {
    stepId: string;
    action: "retry" | "complete";
    result?: WorkflowStepResult;
  }[],
) {
  const active = runtime.jobs.get(key(userId, id));
  const run = active?.run ?? (await getWorkflowLocked(userId, id));
  if (!run) return null;
  if (["completed", "cancelled"].includes(run.status))
    throw new Error(`Workflow is already ${run.status}.`);
  if (action === "pause") {
    if (!active) throw new Error("Workflow is not running.");
    run.pauseRequested = true;
    event(run, "pause_requested", "Current steps finish before pausing.");
    await persist(active);
  } else if (action === "cancel") {
    run.status = "cancelled";
    event(run, "cancelled");
    if (active) {
      active.controller.abort(new Error("Workflow cancelled."));
      await persist(active);
    } else {
      await new WorkflowSandbox(userId, id, { sandboxId: run.sandboxId })
        .kill()
        .catch(() => undefined);
      await settleWorkflowBudget(userId, id, run.tokens);
      await saveWorkflow(run);
    }
  } else {
    if (active)
      throw new Error("Workflow is still finishing its current steps.");
    assertUserSlot(userId);
    for (const step of [...run.steps, ...(run.curation ? [run.curation] : [])])
      if (step.status === "interrupted" || step.status === "failed") {
        const decision = reconciliation.find((r) => r.stepId === step.id);
        if (isMutatingRole(step.role) && !decision)
          throw new Error(
            `Reconcile interrupted writes for ${step.id} before resuming.`,
          );
        if (decision?.action === "complete") {
          if (!isMutatingRole(step.role))
            throw new Error(
              "Only interrupted mutations may be reconciled as completed; verification must run independently.",
            );
          if (!decision.result)
            throw new Error(
              "A completed reconciliation needs the observed result.",
            );
          step.result = decision.result;
          step.status = "completed";
          if (step.id === "_curate") run.curated = true;
        } else step.status = "pending";
      }
    if (
      run.tokens >= run.limits.tokens ||
      run.elapsedMs >= run.limits.durationMs
    )
      throw new Error("Workflow budget exhausted; create a new run.");
    await reserveWorkflowBudget(
      userId,
      run.id,
      run.limits.tokens,
      run.tokens,
      false,
    );
    run.error = undefined;
    event(run, "resumed");
    await saveWorkflow(run);
    launch(run);
  }
  return structuredClone(run);
}
export async function waitForWorkflow(
  userId: string,
  id: string,
  signal?: AbortSignal,
) {
  const job = runtime.jobs.get(key(userId, id));
  if (job) {
    if (!signal) await job.done;
    else
      await new Promise<void>((resolve, reject) => {
        const abort = () =>
          reject(signal.reason ?? new Error("Caller disconnected."));
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        void job.done
          .then(resolve, reject)
          .finally(() => signal.removeEventListener("abort", abort));
      });
  }
  return getWorkflow(userId, id);
}
export async function deleteUserWorkflows(userId: string) {
  for (const run of await readWorkflows(userId)) {
    const job = runtime.jobs.get(key(userId, run.id));
    if (job) {
      job.run.status = "cancelled";
      job.controller.abort(new Error("Account deleted."));
      await job.done;
    }
    await new WorkflowSandbox(userId, run.id, { sandboxId: run.sandboxId })
      .kill()
      .catch(() => undefined);
  }
  await removeWorkflowState(userId);
  await removeWorkflowUsage(userId);
}
