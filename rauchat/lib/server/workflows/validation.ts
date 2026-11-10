import { z } from "zod";
import {
  WORKFLOW_ROLES,
  type WorkflowPlan,
  type WorkflowRole,
} from "@/lib/workflow-types";
const safePath = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (p) =>
      !p.startsWith("/") &&
      !p.includes("\\") &&
      p.split("/").every((v) => v !== ".." && v !== "." && v !== ""),
    "Use a workspace-relative file path.",
  );
export const workflowPlanSchema = z.object({
  goal: z.string().trim().min(1).max(20000),
  steps: z
    .array(
      z.object({
        id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
        role: z.enum(WORKFLOW_ROLES),
        task: z.string().trim().min(1).max(20000),
        dependencies: z.array(z.string()).max(100).default([]),
        outputs: z.array(safePath).max(100).default([]),
        acceptanceCriteria: z
          .array(z.string().trim().min(1).max(2000))
          .min(1)
          .max(20),
      }),
    )
    .min(1)
    .max(100),
});
export function workflowLimits() {
  const n = (key: string, fallback: number, max: number) => {
    const value = Number(process.env[key]);
    return Number.isInteger(value) && value > 0
      ? Math.min(value, max)
      : fallback;
  };
  return {
    concurrency: n("WORKFLOW_CONCURRENCY", 3, 10),
    steps: n("WORKFLOW_MAX_STEPS", 12, 100),
    repairCycles: n("WORKFLOW_REPAIR_CYCLES", 2, 5),
    durationMs: n("WORKFLOW_TIMEOUT_MS", 900000, 3600000),
    tokens: n("WORKFLOW_MAX_TOKENS", 100000, 1000000),
  };
}
export const isMutatingRole = (role: WorkflowRole) =>
  role === "executor" || role === "skill_curator";
export function validateWorkflowPlan(
  input: unknown,
  maxSteps = workflowLimits().steps,
): WorkflowPlan {
  const plan = workflowPlanSchema.parse(input);
  if (plan.steps.length > maxSteps)
    throw new Error(`Workflow exceeds ${maxSteps} steps.`);
  const ids = new Set(plan.steps.map((s) => s.id));
  if (ids.size !== plan.steps.length)
    throw new Error("Step IDs must be unique.");
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id))
      throw new Error("Workflow dependencies contain a cycle.");
    if (visited.has(id)) return;
    const step = plan.steps.find((s) => s.id === id);
    if (!step) throw new Error(`Unknown dependency: ${id}`);
    visiting.add(id);
    step.dependencies.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  plan.steps.forEach((s) => visit(s.id));
  const dependsOn = (id: string, target: string): boolean =>
    plan.steps
      .find((s) => s.id === id)!
      .dependencies.some((d) => d === target || dependsOn(d, target));
  for (const step of plan.steps) {
    if (step.outputs.length && step.role !== "executor")
      throw new Error("Only executor steps may declare file outputs.");
    if (step.role === "skill_curator")
      throw new Error("Skill curation runs automatically after verification.");
    if (
      step.role !== "verifier" &&
      !plan.steps.some((s) => s.role === "verifier" && dependsOn(s.id, step.id))
    )
      throw new Error(
        `Step ${step.id} needs a downstream independent verifier.`,
      );
  }
  return plan;
}
export const ROLE_TOOLS: Record<WorkflowRole, string[]> = {
  explorer: ["read", "ls", "find", "grep", "skills_list", "skill_view"],
  researcher: [
    "web_search",
    "research",
    "web_fetch",
    "read",
    "ls",
    "find",
    "grep",
    "skills_list",
    "skill_view",
  ],
  planner: ["read", "ls", "find", "grep", "skills_list", "skill_view"],
  executor: [
    "bash",
    "read",
    "write",
    "edit",
    "ls",
    "find",
    "grep",
    "web_fetch",
    "web_search",
    "skills_list",
    "skill_view",
  ],
  verifier: [
    "bash",
    "read",
    "ls",
    "find",
    "grep",
    "web_fetch",
    "web_search",
    "skills_list",
    "skill_view",
  ],
  skill_curator: [
    "skills_list",
    "skill_view",
    "skill_manage",
    "read",
    "ls",
    "find",
    "grep",
  ],
};
