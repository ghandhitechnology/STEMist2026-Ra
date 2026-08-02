/**
 * lib/server/browserbase.ts — Browserbase Agents runner for the
 * `browser_use` tool.
 *
 * Credentials come from the process environment (machine root env vars),
 * not from project .env files:
 *   BROWSERBASE_API_KEY      required
 *   BROWSERBASE_PROJECT_ID   optional (reserved for session-scoped APIs)
 */

const BB_API = "https://api.browserbase.com/v1";
const POLL_MS = 2000;
const MAX_WAIT_MS = 3 * 60 * 1000;

export type BrowserUseResult = {
  task: string;
  status: string;
  runId: string;
  sessionId?: string;
  result?: unknown;
  cause?: { code?: string; message?: string };
  liveViewUrl?: string;
};

function apiKey(): string {
  const key = process.env.BROWSERBASE_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "BROWSERBASE_API_KEY is not set. Add it to your machine environment and restart Rauchat."
    );
  }
  return key;
}

export function browserUseConfigured(): boolean {
  return Boolean(process.env.BROWSERBASE_API_KEY?.trim());
}

type AgentRun = {
  runId: string;
  agentId?: string;
  task: string;
  status: string;
  sessionId?: string;
  result?: unknown;
  cause?: { code?: string; message?: string };
};

async function bbFetch(
  path: string,
  init: RequestInit & { method?: string } = {}
): Promise<Response> {
  return fetch(`${BB_API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-BB-API-Key": apiKey(),
      ...(init.headers ?? {}),
    },
  });
}

/**
 * Runs a Browserbase Agent against a natural-language task (optionally
 * starting at a URL), polls until a terminal state, and returns the result.
 */
export async function browserUse(
  task: string,
  options: { startUrl?: string } = {}
): Promise<BrowserUseResult> {
  const cleanTask = task.trim();
  if (!cleanTask) throw new Error("browser_use requires a non-empty task.");

  const startUrl = options.startUrl?.trim();
  const fullTask =
    startUrl && !cleanTask.includes(startUrl)
      ? `${cleanTask}\n\nStart at: ${startUrl}`
      : cleanTask;

  const createRes = await bbFetch("/agents/runs", {
    method: "POST",
    body: JSON.stringify({
      task: fullTask,
      browserSettings: { proxies: true },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!createRes.ok) {
    const detail = await createRes.text().catch(() => "");
    throw new Error(
      `Browserbase run failed to start (${createRes.status})${
        detail ? `: ${detail.slice(0, 240)}` : ""
      }`
    );
  }

  const created = (await createRes.json()) as AgentRun;
  const runId = created.runId;
  if (!runId) throw new Error("Browserbase did not return a runId.");

  const terminal = new Set([
    "COMPLETED",
    "FAILED",
    "STOPPED",
    "TIMED_OUT",
  ]);
  const deadline = Date.now() + MAX_WAIT_MS;
  let run = created;

  while (!terminal.has(run.status)) {
    if (Date.now() > deadline) {
      throw new Error(
        `Browserbase run timed out after ${Math.round(MAX_WAIT_MS / 1000)}s (runId ${runId}).`
      );
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
    const pollRes = await bbFetch(`/agents/runs/${encodeURIComponent(runId)}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!pollRes.ok) {
      throw new Error(
        `Browserbase poll failed (${pollRes.status}) for run ${runId}.`
      );
    }
    run = (await pollRes.json()) as AgentRun;
  }

  if (run.status !== "COMPLETED") {
    const cause =
      run.cause?.message || run.cause?.code || run.status.toLowerCase();
    throw new Error(`Browserbase run ${run.status.toLowerCase()}: ${cause}`);
  }

  return {
    task: fullTask,
    status: run.status,
    runId,
    sessionId: run.sessionId,
    result: run.result,
    cause: run.cause,
    liveViewUrl: run.sessionId
      ? `https://www.browserbase.com/sessions/${run.sessionId}`
      : undefined,
  };
}
