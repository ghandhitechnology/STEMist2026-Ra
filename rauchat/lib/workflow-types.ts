import type { SkillPackageSnapshot } from "./skill-types";
export const WORKFLOW_ROLES = [
  "explorer",
  "researcher",
  "planner",
  "executor",
  "verifier",
  "skill_curator",
] as const;
export type WorkflowRole = (typeof WORKFLOW_ROLES)[number];
export type WorkflowStep = {
  id: string;
  role: WorkflowRole;
  task: string;
  dependencies: string[];
  outputs: string[];
  acceptanceCriteria: string[];
};
export type WorkflowPlan = { goal: string; steps: WorkflowStep[] };
export type WorkflowStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
export type WorkflowStepResult = {
  text: string;
  tokens: number;
  outputs?: string[];
  verified?: boolean;
};
export type WorkflowStepState = WorkflowStep & {
  status: WorkflowStatus;
  attempts: number;
  result?: WorkflowStepResult;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  repairFeedback?: string;
};
export type WorkflowEvent = {
  sequence: number;
  at: number;
  type: string;
  stepId?: string;
  message?: string;
};
export type WorkflowRun = {
  id: string;
  userId: string;
  conversationId: string;
  model: string;
  thinking?: string;
  skillIds: string[];
  skillSnapshots?: SkillPackageSnapshot[];
  goal: string;
  status: WorkflowStatus;
  pauseRequested?: boolean;
  steps: WorkflowStepState[];
  createdAt: number;
  updatedAt: number;
  elapsedMs: number;
  activeStartedAt?: number;
  tokens: number;
  events: WorkflowEvent[];
  error?: string;
  sandboxId?: string;
  baseline: Record<string, string>;
  publishedOutputs: string[];
  conflicts: string[];
  curated?: boolean;
  curation?: WorkflowStepState;
  summary?: string;
  limits: {
    concurrency: number;
    steps: number;
    repairCycles: number;
    durationMs: number;
    tokens: number;
  };
};
