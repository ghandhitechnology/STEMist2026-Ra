import path from "node:path";
import {
  InMemoryCredentialStore,
  type AssistantMessage,
  type ImageContent,
  type Model,
  type Usage,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
  type SessionEntry,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@/lib/models";
import {
  WORKSPACE_BASE_ROOT,
  sanitizeConversationId,
  sanitizeUserId,
  userWorkspaceRoot,
} from "./paths";

const UI_TURN_ENTRY = "rauchat.ui-turn";
const MAX_OUTPUT_TOKENS = 16_384;
const DEFAULT_PARENT_TOKEN_LIMIT = 100_000;
const DEFAULT_PARENT_TIMEOUT_MS = 15 * 60 * 1000;

const READ_ONLY_BLOCKED_TOOLS = new Set([
  "bash",
  "write",
  "edit",
  "file_write",
  "skill_make",
  "skill_manage",
  "diagram",
  "svg_render",
  "pdf_create",
  "memory_add",
  "browser_use",
  "workflow_run",
]);

export type AgentTokenUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
  cost: number;
};

export type AgentRuntimeEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | {
      type: "tool_start";
      id: string;
      name: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_update";
      id: string;
      name: string;
      args: Record<string, unknown>;
      result: unknown;
    }
  | {
      type: "tool_end";
      id: string;
      name: string;
      result: unknown;
      isError: boolean;
    }
  | { type: "compaction_start" }
  | { type: "compaction_end" };

export type AgentHistoryMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
};

export type AgentRunResult = {
  text: string;
  thinking: string;
  userEntryId?: string;
  assistantEntryId?: string;
  usage: AgentTokenUsage;
  toolEvidence: string[];
  aborted: boolean;
  sessionFile?: string;
};

export type RunAgentTurnOptions = {
  userId: string;
  conversationId: string;
  history: AgentHistoryMessage[];
  prompt: string;
  images?: ImageContent[];
  systemPrompt: string;
  modelId: string;
  thinking: ThinkingLevel;
  customTools: ToolDefinition[];
  allowedToolNames?: readonly string[];
  forceToolCall?: boolean;
  readOnly?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: AgentRuntimeEvent) => void;
};

export type RunChildAgentStepOptions = {
  userId: string;
  conversationId: string;
  workflowId: string;
  stepId: string;
  attempt?: number;
  rolePrompt: string;
  task: string;
  dependencyResults?: Readonly<Record<string, unknown>>;
  modelId: string;
  thinking: ThinkingLevel;
  customTools: ToolDefinition[];
  allowedToolNames?: readonly string[];
  readOnly?: boolean;
  allowBashInReadOnly?: boolean;
  maxOutputTokens?: number;
  onUsage?: (tokens: number, cumulative: AgentTokenUsage) => void;
  shouldContinue?: (cumulative: AgentTokenUsage) => boolean;
  signal?: AbortSignal;
  onEvent?: (event: AgentRuntimeEvent) => void;
};

type UiTurnEntryData = {
  version: 1;
  userUiId: string;
  userEntryId: string;
  assistantEntryId?: string;
  userContent: string;
  assistantContent: string;
  aborted: boolean;
};

type UiTurnRecord = UiTurnEntryData & { mappingEntryId: string };

type CompletedUiTurn = {
  user: AgentHistoryMessage;
  assistant: AgentHistoryMessage;
};

export type AgentSessionRunOptions = {
  sessionManager: SessionManager;
  cwd: string;
  systemPrompt: string;
  modelId: string;
  thinking: ThinkingLevel;
  prompt: string;
  images?: ImageContent[];
  customTools: ToolDefinition[];
  allowedToolNames?: readonly string[];
  readOnly?: boolean;
  allowBashInReadOnly?: boolean;
  maxOutputTokens?: number;
  maxTotalTokens?: number;
  onUsage?: (tokens: number, cumulative: AgentTokenUsage) => void;
  shouldContinue?: (cumulative: AgentTokenUsage) => boolean;
  forceToolCall?: boolean;
  child: boolean;
  signal?: AbortSignal;
  onEvent?: (event: AgentRuntimeEvent) => void;
};

let modelRuntimePromise: Promise<ModelRuntime> | undefined;
const runtimeState = globalThis as typeof globalThis & {
  __rauchatAgentSessionLocks?: Map<string, Promise<void>>;
};
const conversationLocks =
  (runtimeState.__rauchatAgentSessionLocks ??= new Map<string, Promise<void>>());

function emptyUsage(): AgentTokenUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    total: 0,
    cost: 0,
  };
}

function addUsage(target: AgentTokenUsage, usage: Usage): void {
  target.input += usage.input;
  target.output += usage.output;
  target.cacheRead += usage.cacheRead;
  target.cacheWrite += usage.cacheWrite;
  target.reasoning += usage.reasoning ?? 0;
  target.total += usage.totalTokens;
  target.cost += usage.cost.total;
}

async function getModelRuntime(): Promise<ModelRuntime> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured on the server.");
  }
  if (!modelRuntimePromise) {
    modelRuntimePromise = (async () => {
      const runtime = await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(),
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
      });
      await runtime.setRuntimeApiKey("openrouter", apiKey);
      return runtime;
    })().catch((error) => {
      modelRuntimePromise = undefined;
      throw error;
    });
  }
  return modelRuntimePromise;
}

function resolveModel(
  runtime: ModelRuntime,
  modelId: string,
  maxOutputTokens = MAX_OUTPUT_TOKENS
): Model<any> {
  const selected = runtime.getModel("openrouter", modelId);
  if (!selected) {
    throw new Error(`OpenRouter model is unavailable: ${modelId}`);
  }
  return {
    ...selected,
    maxTokens: Math.min(selected.maxTokens, maxOutputTokens),
    headers: {
      ...selected.headers,
      "HTTP-Referer":
        process.env.RAUCHAT_PUBLIC_URL || "http://localhost:3000",
      "X-Title": "Rauchat",
    },
  };
}

function createResourceLoader(systemPrompt: string): ResourceLoader {
  const extensions = {
    extensions: [],
    errors: [],
    runtime: createExtensionRuntime(),
  };
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

export function selectAgentToolNames(
  tools: readonly ToolDefinition[],
  allowedToolNames: readonly string[] | undefined,
  options: {
    readOnly?: boolean;
    child?: boolean;
    allowBashInReadOnly?: boolean;
  } = {}
): string[] {
  const available = new Set(tools.map((tool) => tool.name));
  const requested = allowedToolNames
    ? [...new Set(allowedToolNames)]
    : [...available];
  return requested.filter(
    (name) =>
      available.has(name) &&
      !(
        options.readOnly &&
        READ_ONLY_BLOCKED_TOOLS.has(name) &&
        !(name === "bash" && options.allowBashInReadOnly === true)
      ) &&
      !(options.child && name === "workflow_run")
  );
}

function sessionDir(userId: string, conversationId: string): string {
  return path.join(
    WORKSPACE_BASE_ROOT,
    "agent-sessions",
    sanitizeUserId(userId),
    sanitizeConversationId(conversationId)
  );
}

function uiTurnRecords(sessionManager: SessionManager): UiTurnRecord[] {
  const records: UiTurnRecord[] = [];
  for (const entry of sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== UI_TURN_ENTRY) continue;
    const data = entry.data as Partial<UiTurnEntryData> | undefined;
    if (
      data?.version !== 1 ||
      typeof data.userUiId !== "string" ||
      typeof data.userEntryId !== "string" ||
      typeof data.userContent !== "string" ||
      typeof data.assistantContent !== "string"
    ) {
      continue;
    }
    records.push({
      version: 1,
      userUiId: data.userUiId,
      userEntryId: data.userEntryId,
      userContent: data.userContent,
      assistantContent: data.assistantContent,
      assistantEntryId:
        typeof data.assistantEntryId === "string"
          ? data.assistantEntryId
          : undefined,
      aborted: data.aborted === true,
      mappingEntryId: entry.id,
    });
  }
  return records;
}

function completedTurns(
  historyBeforePrompt: readonly AgentHistoryMessage[]
): CompletedUiTurn[] {
  const turns: CompletedUiTurn[] = [];
  for (let index = 0; index < historyBeforePrompt.length; index++) {
    const user = historyBeforePrompt[index];
    const assistant = historyBeforePrompt[index + 1];
    if (user.role !== "user" || assistant?.role !== "assistant") continue;
    turns.push({ user, assistant });
    index++;
  }
  return turns;
}

function isMatchingTurn(record: UiTurnRecord, turn: CompletedUiTurn): boolean {
  return (
    record.userUiId === turn.user.id &&
    record.userContent === turn.user.content &&
    record.assistantContent === turn.assistant.content
  );
}

function zeroPiUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function seedTurn(
  sessionManager: SessionManager,
  turn: CompletedUiTurn,
  model: Model<any>
): void {
  const userEntryId = sessionManager.appendMessage({
    role: "user",
    content: turn.user.content,
    timestamp: turn.user.createdAt ?? Date.now(),
  });
  const assistantEntryId = sessionManager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: turn.assistant.content }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: zeroPiUsage(),
    stopReason: "stop",
    timestamp: turn.assistant.createdAt ?? Date.now(),
  });
  sessionManager.appendCustomEntry(UI_TURN_ENTRY, {
    version: 1,
    userUiId: turn.user.id,
    userEntryId,
    assistantEntryId,
    userContent: turn.user.content,
    assistantContent: turn.assistant.content,
    aborted: false,
  } satisfies UiTurnEntryData);
}

/**
 * Reconcile the append-only Pi tree with the UI branch sent by the client.
 * Existing branches stay in JSONL; this only moves the active leaf and seeds
 * legacy UI turns that predate Pi session storage.
 */
export function synchronizeUiHistory(
  sessionManager: SessionManager,
  historyBeforePrompt: readonly AgentHistoryMessage[],
  model: Model<any>
): void {
  const turns = completedTurns(historyBeforePrompt);
  const records = uiTurnRecords(sessionManager);
  let matching = 0;
  while (
    matching < turns.length &&
    matching < records.length &&
    isMatchingTurn(records[matching], turns[matching])
  ) {
    matching++;
  }

  const expectedLeaf = matching
    ? records[matching - 1].mappingEntryId
    : null;
  if (sessionManager.getLeafId() !== expectedLeaf) {
    if (expectedLeaf) sessionManager.branch(expectedLeaf);
    else sessionManager.resetLeaf();
  }

  for (const turn of turns.slice(matching)) {
    seedTurn(sessionManager, turn, model);
  }
}

function textFromToolResult(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : ""
    )
    .filter(Boolean)
    .join("\n");
}

function assistantText(message: AssistantMessage): string {
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

export async function runAgentSession(
  options: AgentSessionRunOptions & {
    modelRuntime?: ModelRuntime;
    model?: Model<any>;
  }
): Promise<AgentRunResult> {
  if (options.signal?.aborted) {
    throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
  }

  const runtime = options.modelRuntime ?? (await getModelRuntime());
  const model =
    options.model ??
    resolveModel(runtime, options.modelId, options.maxOutputTokens);
  const restored = options.sessionManager.buildSessionContext();
  if (
    restored.messages.length &&
    (restored.model?.provider !== model.provider ||
      restored.model.modelId !== model.id)
  ) {
    options.sessionManager.appendModelChange(model.provider, model.id);
  }
  if (
    restored.messages.length &&
    restored.thinkingLevel !== options.thinking
  ) {
    options.sessionManager.appendThinkingLevelChange(options.thinking);
  }
  const activeToolNames = selectAgentToolNames(
    options.customTools,
    options.allowedToolNames,
    {
      readOnly: options.readOnly,
      child: options.child,
      allowBashInReadOnly: options.allowBashInReadOnly,
    }
  );
  const resourceLoader = createResourceLoader(options.systemPrompt);
  const settingsManager = SettingsManager.inMemory({
    compaction: {
      enabled: true,
      reserveTokens: 16_384,
      keepRecentTokens: 20_000,
    },
    retry: { enabled: true, maxRetries: 2 },
    defaultTools: [],
  });
  const { session } = await createAgentSession({
    cwd: options.cwd,
    agentDir: path.join(WORKSPACE_BASE_ROOT, "agent-runtime"),
    modelRuntime: runtime,
    model,
    thinkingLevel: options.thinking,
    noTools: "builtin",
    tools: activeToolNames,
    customTools: options.customTools,
    resourceLoader,
    sessionManager: options.sessionManager,
    settingsManager,
  });

  if (options.forceToolCall && activeToolNames.length) {
    let firstRequest = true;
    session.agent.onPayload = (payload) => {
      if (!firstRequest || !payload || typeof payload !== "object") {
        return payload;
      }
      firstRequest = false;
      return {
        ...(payload as Record<string, unknown>),
        tool_choice:
          model.api === "anthropic-messages" ? { type: "any" } : "required",
      };
    };
  }

  let text = "";
  let thinking = "";
  let userEntryId: string | undefined;
  let assistantEntryId: string | undefined;
  let finalAssistant: AssistantMessage | undefined;
  const usage = emptyUsage();
  const toolEvidence: string[] = [];

  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_update") {
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta") {
        text += update.delta;
        options.onEvent?.({ type: "text", delta: update.delta });
      } else if (update.type === "thinking_delta") {
        thinking += update.delta;
        options.onEvent?.({ type: "thinking", delta: update.delta });
      }
      return;
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      finalAssistant = event.message;
      addUsage(usage, event.message.usage);
      options.onUsage?.(event.message.usage.totalTokens, { ...usage });
      return;
    }
    if (event.type === "entry_appended" && event.entry.type === "message") {
      if (event.entry.message.role === "user") userEntryId = event.entry.id;
      if (event.entry.message.role === "assistant") {
        assistantEntryId = event.entry.id;
      }
      return;
    }
    if (event.type === "tool_execution_start") {
      options.onEvent?.({
        type: "tool_start",
        id: event.toolCallId,
        name: event.toolName,
        args:
          event.args && typeof event.args === "object"
            ? (event.args as Record<string, unknown>)
            : {},
      });
      return;
    }
    if (event.type === "tool_execution_update") {
      options.onEvent?.({
        type: "tool_update",
        id: event.toolCallId,
        name: event.toolName,
        args:
          event.args && typeof event.args === "object"
            ? (event.args as Record<string, unknown>)
            : {},
        result: event.partialResult,
      });
      return;
    }
    if (event.type === "tool_execution_end") {
      const modelText = textFromToolResult(event.result);
      if (modelText) {
        toolEvidence.push(`[${event.toolName}]\n${modelText.slice(0, 6000)}`);
      }
      options.onEvent?.({
        type: "tool_end",
        id: event.toolCallId,
        name: event.toolName,
        result: event.result,
        isError: event.isError,
      });
      return;
    }
    if (event.type === "compaction_start") {
      options.onEvent?.({ type: "compaction_start" });
    } else if (event.type === "compaction_end") {
      options.onEvent?.({ type: "compaction_end" });
    }
  });

  const abort = () => void session.abort();
  session.agent.shouldStopAfterTurn = () => {
    if (options.maxTotalTokens && usage.total >= options.maxTotalTokens) {
      return true;
    }
    return options.shouldContinue
      ? !options.shouldContinue({ ...usage })
      : false;
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    await session.prompt(options.prompt, {
      images: options.images,
      expandPromptTemplates: false,
      source: "rpc",
    });
    await session.waitForIdle();
  } finally {
    options.signal?.removeEventListener("abort", abort);
    unsubscribe();
    session.dispose();
  }

  if (!text && finalAssistant) text = assistantText(finalAssistant);
  const aborted =
    options.signal?.aborted === true || finalAssistant?.stopReason === "aborted";
  if (finalAssistant?.stopReason === "error") {
    throw new Error(finalAssistant.errorMessage || "Generation failed.");
  }
  if (
    options.maxTotalTokens &&
    usage.total >= options.maxTotalTokens &&
    finalAssistant?.stopReason === "toolUse"
  ) {
    throw new Error("This turn reached its token budget before completion.");
  }

  return {
    text,
    thinking,
    userEntryId,
    assistantEntryId,
    usage,
    toolEvidence,
    aborted,
    sessionFile: options.sessionManager.getSessionFile(),
  };
}

async function withConversationLock<T>(
  key: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = conversationLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => {}).then(() => current);
  conversationLocks.set(key, queued);
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (conversationLocks.get(key) === queued) conversationLocks.delete(key);
  }
}

export async function runAgentTurn(
  options: RunAgentTurnOptions
): Promise<AgentRunResult> {
  const safeUserId = sanitizeUserId(options.userId);
  const safeConversationId = sanitizeConversationId(options.conversationId);
  const lockKey = `${safeUserId}/${safeConversationId}`;
  return withConversationLock(lockKey, async () => {
    const cwd = userWorkspaceRoot(safeUserId);
    const manager = SessionManager.continueRecent(
      cwd,
      sessionDir(safeUserId, safeConversationId)
    );
    const runtime = await getModelRuntime();
    const model = resolveModel(runtime, options.modelId);
    synchronizeUiHistory(manager, options.history.slice(0, -1), model);

    const configuredLimit = Number(process.env.RAUCHAT_TURN_MAX_TOKENS);
    const maxTotalTokens =
      Number.isInteger(configuredLimit) && configuredLimit > 0
        ? Math.min(configuredLimit, 1_000_000)
        : DEFAULT_PARENT_TOKEN_LIMIT;
    const configuredTimeout = Number(process.env.RAUCHAT_TURN_TIMEOUT_MS);
    const timeoutMs =
      Number.isInteger(configuredTimeout) && configuredTimeout > 0
        ? Math.min(configuredTimeout, 60 * 60 * 1000)
        : DEFAULT_PARENT_TIMEOUT_MS;
    const timeout = new AbortController();
    const timeoutId = setTimeout(
      () => timeout.abort(new Error("This turn reached its time limit.")),
      timeoutMs
    );
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout.signal])
      : timeout.signal;
    let result: AgentRunResult;
    try {
      result = await runAgentSession({
        ...options,
        sessionManager: manager,
        cwd,
        maxTotalTokens,
        child: false,
        signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (result.userEntryId) {
      manager.appendCustomEntry(UI_TURN_ENTRY, {
        version: 1,
        userUiId: options.history.at(-1)?.id ?? result.userEntryId,
        userEntryId: result.userEntryId,
        assistantEntryId: result.assistantEntryId,
        userContent: options.history.at(-1)?.content ?? options.prompt,
        assistantContent: result.text,
        aborted: result.aborted,
      } satisfies UiTurnEntryData);
    }
    if (timeout.signal.aborted && !options.signal?.aborted) {
      throw timeout.signal.reason;
    }
    return result;
  });
}

export async function runChildAgentStep(
  options: RunChildAgentStepOptions
): Promise<AgentRunResult> {
  const safeUserId = sanitizeUserId(options.userId);
  sanitizeConversationId(options.conversationId);
  const safeWorkflowId = sanitizeConversationId(options.workflowId);
  const safeStepId = sanitizeConversationId(options.stepId);
  const dependencyText = options.dependencyResults
    ? JSON.stringify(options.dependencyResults).slice(0, 80_000)
    : "{}";
  const restriction = options.readOnly
    ? options.allowBashInReadOnly
      ? "You may inspect files and run shell commands only for read-only verification. Do not create, edit, move, or delete files."
      : "You may only inspect information. Do not create, edit, move, or delete files or change external state."
    : "Only change files needed for this step and follow its declared output paths.";
  const systemPrompt = `${options.rolePrompt.trim()}\n\nYou are workflow step ${options.stepId} in workflow ${options.workflowId}. ${restriction} You cannot delegate work or create another workflow. Return a concise result for the parent agent.`;
  const prompt = `Task:\n${options.task.trim()}\n\nDependency results:\n${dependencyText}`;

  return runAgentSession({
    sessionManager: SessionManager.create(
      userWorkspaceRoot(safeUserId),
      path.join(
        WORKSPACE_BASE_ROOT,
        "workflow-sessions",
        safeUserId,
        safeWorkflowId,
        safeStepId,
        `attempt-${Math.max(1, options.attempt ?? 1)}`
      )
    ),
    cwd: userWorkspaceRoot(safeUserId),
    systemPrompt,
    modelId: options.modelId,
    thinking: options.thinking,
    prompt,
    customTools: options.customTools,
    allowedToolNames: options.allowedToolNames,
    readOnly: options.readOnly,
    allowBashInReadOnly: options.allowBashInReadOnly,
    maxOutputTokens: options.maxOutputTokens,
    onUsage: options.onUsage,
    shouldContinue: options.shouldContinue,
    child: true,
    signal: options.signal,
    onEvent: options.onEvent,
  });
}

/** Backward-compatible name for workflow bridges that create and run one child. */
export const createChildAgentSession = runChildAgentStep;

export type { ImageContent, ToolDefinition };
