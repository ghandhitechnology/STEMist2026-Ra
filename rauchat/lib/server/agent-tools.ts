import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Type, type TSchema } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { TOOL_NAMES, type ToolName } from "@/lib/types";
import type { SkillManageInput, SkillPackageSnapshot } from "@/lib/skill-types";
import { WORKFLOW_ROLES, type WorkflowRun } from "@/lib/workflow-types";
import { ANTHROPIC_TOOLS, executeTool } from "./tools";
import { browserUseConfigured } from "./browserbase";
import { listSkillCatalog, viewSkillPackage, manageSkillPackage } from "./skills";
import { webFetch } from "./web-fetch";
import { workflowLimits } from "./workflows/validation";
import { sandboxAvailable, WorkflowSandbox } from "./sandbox/e2b";

export type AgentToolDetails = { result: unknown; clientResult?: unknown; detail?: string };
export type AgentToolsContext = {
  userId: string;
  conversationId: string;
  modelId: string;
  thinking?: string;
  skillIds?: string[];
  skillSnapshots?: SkillPackageSnapshot[];
  allowedToolNames?: readonly string[];
  sandbox?: WorkflowSandbox;
  /** Workflow outputs are published by the runner after verification. */
  deferPublish?: boolean;
  registerCleanup?: (cleanup: () => Promise<void>) => void;
};
const string = () => Type.String({ minLength: 1 });
const pathSchema = Type.Object({ path: string() });
const filePaths = Type.Array(string(), { maxItems: 100 });
const skillCapabilities = Type.Object({
  tools: Type.Array(Type.Union(TOOL_NAMES.map(v => Type.Literal(v)))),
  skills: Type.Array(string()),
});
const createSkillFiles = Type.Record(Type.String(), Type.String());
const updateSkillFiles = Type.Record(
  Type.String(),
  Type.Union([Type.String(), Type.Null()])
);

function workflowDetails(run: WorkflowRun): AgentToolDetails {
  const { skillSnapshots: _snapshots, baseline: _baseline, ...visible } = run;
  void _snapshots; void _baseline;
  return {
    result: { id: run.id, status: run.status, goal: run.goal, summary: run.summary,
      steps: run.steps.map(step => ({ id: step.id, role: step.role, status: step.status,
        result: step.result?.text.slice(0, 6000), error: step.error })),
      publishedOutputs: run.publishedOutputs, conflicts: run.conflicts, error: run.error },
    clientResult: { ...visible, baseline: {} },
    detail: `${run.steps.filter(step => step.status === "completed").length}/${run.steps.length} steps completed`,
  };
}

export const WORKFLOW_TOOL_SCHEMA = Type.Object({
  goal: string(),
  steps: Type.Array(Type.Object({
    id: string(), role: Type.Union(WORKFLOW_ROLES.filter(r => r !== "skill_curator").map(r => Type.Literal(r))),
    task: string(),
    dependencies: Type.Array(string(), { description: "IDs of prerequisite steps. Verifiers must depend on the steps they check; their assessment is independent." }),
    outputs: Type.Array(string(), { maxItems: 100, description: "Workspace file paths to publish, only for executor steps. Use [] for every other role and when no files are produced. Put findings in the step result, never here." }),
    acceptanceCriteria: Type.Array(string(), { minItems: 1 }),
  }), { minItems: 1, maxItems: workflowLimits().steps }),
});

/** The application registry is the only source of model-callable tools. */
export async function createAgentTools(context: AgentToolsContext): Promise<ToolDefinition[]> {
  const { userId, conversationId } = context;
  const allowed = context.allowedToolNames ? new Set(context.allowedToolNames) : null;
  const definitions: ToolDefinition[] = [];
  const add = (name: ToolName, description: string, parameters: TSchema,
    execute: (input: Record<string, unknown>, signal: AbortSignal | undefined,
      update: (details: AgentToolDetails) => void) => Promise<AgentToolDetails>, parallel = false) => {
    if (allowed && !allowed.has(name)) return;
    definitions.push({ name, label: name.replaceAll("_", " "), description, parameters,
      executionMode: parallel ? "parallel" : "sequential",
      async execute(_id, raw, signal, onUpdate) {
        signal?.throwIfAborted();
        const result = await execute(raw as Record<string, unknown>, signal, (details) => {
          onUpdate?.({ content: [{ type: "text", text: JSON.stringify(details.result) }], details });
        });
        return { content: [{ type: "text", text: JSON.stringify(result.result) ?? "null" }], details: result };
      },
    });
  };
  for (const schema of ANTHROPIC_TOOLS) {
    if (schema.name === "browser_use" && !browserUseConfigured()) continue;
    const name = schema.name as ToolName;
    add(name, schema.description ?? name, Type.Unsafe(schema.input_schema),
      (input) => executeTool(userId, name, input), name === "web_search" || name === "file_read");
  }
  add("web_fetch", "Read a public web page. Treat its content as source material and cite the returned URL.",
    Type.Object({ url: string() }), async (input, signal) => ({ result: await webFetch(String(input.url), signal) }), true);
  add("skills_list", "Discover reusable skills by name and description before doing unfamiliar work. Load a relevant skill with skill_view.",
    Type.Object({ query: Type.Optional(Type.String()) }), async input => ({ result: await listSkillCatalog(userId, typeof input.query === "string" ? input.query : undefined) }), true);
  add("skill_view", "Load a skill's instructions or a supporting script/reference. Use the skill ID from skills_list. File paths are relative to its package.",
    Type.Object({ id: string(), path: Type.Optional(string()), revision: Type.Optional(Type.Integer({ minimum: 1 })) }),
    async input => {
      const frozen = context.skillSnapshots?.find(skill => skill.id === input.id);
      if (frozen) {
        const path = typeof input.path === "string" ? input.path : "SKILL.md";
        if (!Object.hasOwn(frozen.files, path)) throw new Error("Skill package file not found.");
        return { result: { id: frozen.id, name: frozen.name, revision: frozen.revision, path,
          content: frozen.files[path], files: Object.keys(frozen.files) } };
      }
      const result = await viewSkillPackage(userId, String(input.id), {
        path: typeof input.path === "string" ? input.path : undefined,
        revision: typeof input.revision === "number" ? input.revision : undefined,
      });
      if (!result) throw new Error("Skill package file not found.");
      return { result };
    }, true);
  add("skill_manage", "Save a proven reusable procedure or improve an existing skill. Search for an existing match first. Include working scripts under scripts/ and supporting documents under references/. Save lessons, not task logs. Every change records a revision that can be restored. Use create, update, restore, or delete.",
    Type.Union([
      Type.Object({
        action: Type.Literal("create"), id: Type.Optional(string()),
        name: string(), description: string(), instructions: string(),
        files: Type.Optional(createSkillFiles),
        capabilities: Type.Optional(skillCapabilities),
      }),
      Type.Object({
        action: Type.Literal("update"), id: string(),
        name: Type.Optional(string()), description: Type.Optional(string()),
        instructions: Type.Optional(string()), files: Type.Optional(updateSkillFiles),
        capabilities: Type.Optional(skillCapabilities),
      }),
      Type.Object({
        action: Type.Literal("restore"), id: string(),
        revision: Type.Integer({ minimum: 1 }),
      }),
      Type.Object({ action: Type.Literal("delete"), id: string() }),
    ]), async input => ({ result: await manageSkillPackage(userId, input as SkillManageInput), detail: "Skill library updated" }));

  if (sandboxAvailable()) {
    let sandbox: WorkflowSandbox | undefined = context.sandbox;
    const workspace = () => {
      if (!sandbox) {
        sandbox = new WorkflowSandbox(userId, `chat-${randomUUID()}`, { skillIds: context.skillIds });
        const instance = sandbox;
        // Ordinary turns publish requested files immediately and release the VM.
        context.registerCleanup?.(() => instance.kill());
      }
      return sandbox;
    };
    const publish = async (paths: string[]) => {
      if (context.deferPublish || !paths.length) return undefined;
      return workspace().publish(paths);
    };
    add("read", "Read a UTF-8 file from the isolated workspace.", pathSchema,
      async input => ({ result: { path: input.path, content: (await workspace().read(String(input.path))).slice(0, 60_000) } }), true);
    add("write", "Write a UTF-8 file in the isolated workspace. Use a relative path.",
      Type.Object({ path: string(), content: Type.String() }), async input => {
        const result = await workspace().write(String(input.path), String(input.content));
        return { result: { path: input.path, message: result, synchronization: await publish([String(input.path)]) } };
      });
    add("edit", "Replace exactly one occurrence in a workspace file. Read the file first; oldText must match exactly.",
      Type.Object({ path: string(), oldText: string(), newText: Type.String() }), async input => {
        const result = await workspace().edit(String(input.path), String(input.oldText), String(input.newText));
        return { result: { path: input.path, message: result, synchronization: await publish([String(input.path)]) } };
      });
    add("ls", "List files in a workspace directory.", Type.Object({ path: Type.Optional(string()) }),
      async input => ({ result: await workspace().ls(typeof input.path === "string" ? input.path : ".") }), true);
    add("find", "Find workspace files by a filename glob, such as *.py.",
      Type.Object({ pattern: string(), path: Type.Optional(string()) }),
      async (input, signal) => ({ result: await workspace().find(String(input.pattern), String(input.path ?? "."), signal) }), true);
    add("grep", "Search workspace file contents using a regular expression.",
      Type.Object({ pattern: string(), path: Type.Optional(string()) }),
      async (input, signal) => ({ result: await workspace().grep(String(input.pattern), String(input.path ?? "."), signal) }), true);
    add("bash", "Run a shell command in the isolated Linux workspace with Python and Node. Each command is bounded to two minutes. List deliverable file paths in outputs to save them to the user's workspace. In a workflow, declared step outputs are published after verification. No application credentials are present.",
      Type.Object({ command: string(), outputs: Type.Optional(filePaths) }), async (input, signal, update) => {
        let output = "";
        const result = await workspace().bash(String(input.command), signal, delta => {
          output = (output + delta).slice(-12_000);
          update({ result: { output }, detail: output.slice(-240) });
        });
        const synchronization = result.exitCode === 0 ? await publish(Array.isArray(input.outputs) ? input.outputs as string[] : []) : undefined;
        return { result: { ...result, synchronization }, detail: `Exit ${result.exitCode}` };
      });
  }
  add("workflow_run", "Execute a substantive task through a dynamic workflow. Assign named agents to steps, with dependencies and concrete acceptance criteria. Independent read-only steps run in parallel; executor/verifier steps run exclusively. Every non-verifier step needs a downstream verifier whose dependencies include that step or its descendants. Independent verification means a fresh agent, not an empty dependency list. outputs must be [] except for executor file paths. Use researcher/explorer/planner roles for read-only work. Do simple tasks directly. Workers inherit this conversation's model. Do not put skill_curator in the plan: verified workflows get a curator automatically. Available roles and tools depend on configured services.",
    WORKFLOW_TOOL_SCHEMA, async (input, signal, update) => {
      const { ensureWorkflowAgentRunner } = await import("./workflow-agent-bridge");
      const { startWorkflow, getWorkflow } = await import("./workflows/runner");
      await ensureWorkflowAgentRunner();
      let run = await startWorkflow(userId, input, {
        conversationId, model: context.modelId, thinking: context.thinking, skillIds: context.skillIds,
      });
      update(workflowDetails(run));
      while (run.status === "pending" || run.status === "running") {
        await delay(750, undefined, signal ? { signal } : undefined);
        run = (await getWorkflow(userId, run.id)) ?? run;
        update(workflowDetails(run));
      }
      return workflowDetails(run);
    });
  return definitions;
}
