import {
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WORKSPACE_BASE_ROOT } from "../paths";
import type { WorkflowRun } from "@/lib/workflow-types";
function segment(value: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value))
    throw new Error("Invalid workflow identifier.");
  return value;
}
export const workflowDirectory = (userId: string) =>
  path.join(WORKSPACE_BASE_ROOT, "workflows", segment(userId));
export async function saveWorkflow(run: WorkflowRun) {
  const dir = workflowDirectory(run.userId);
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, `${segment(run.id)}.json`);
  const tmp = `${target}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(run), { mode: 0o600 });
  await rename(tmp, target);
}
export async function readWorkflow(
  userId: string,
  id: string,
): Promise<WorkflowRun | null> {
  try {
    return JSON.parse(
      await readFile(
        path.join(workflowDirectory(userId), `${segment(id)}.json`),
        "utf8",
      ),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
export async function readWorkflows(userId: string): Promise<WorkflowRun[]> {
  let names: string[];
  try {
    names = await readdir(workflowDirectory(userId));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  return (
    await Promise.all(
      names
        .filter((n) => n.endsWith(".json"))
        .map((n) => readWorkflow(userId, n.slice(0, -5))),
    )
  )
    .filter((r): r is WorkflowRun => !!r)
    .sort((a, b) => b.createdAt - a.createdAt);
}
export async function removeWorkflowState(userId: string) {
  await rm(workflowDirectory(userId), { recursive: true, force: true });
}
