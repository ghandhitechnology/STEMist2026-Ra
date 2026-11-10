import type { ToolEvent, ToolName } from "@/lib/types";
import type { SSESend } from "./sse";
import { toolEventTitle } from "./tools";
import type { AgentToolDetails } from "./agent-tools";
import type { AgentRuntimeEvent } from "./agent-runtime";

function titleForTool(
  name: ToolName,
  input: Record<string, unknown>
): string {
  const legacy = toolEventTitle(name, input);
  if (legacy) return legacy;
  for (const key of ["path", "query", "url", "task", "command", "name", "id"]) {
    if (typeof input[key] === "string" && input[key]) {
      return String(input[key]).replace(/\s+/g, " ").slice(0, 96);
    }
  }
  return name.replaceAll("_", " ");
}

function unpackToolDetails(result: unknown): AgentToolDetails {
  if (!result || typeof result !== "object") return { result };
  const details = (result as { details?: unknown }).details;
  if (details && typeof details === "object" && "result" in details) {
    return details as AgentToolDetails;
  }
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return { result };
  const text = content
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
  try {
    return { result: JSON.parse(text) };
  } catch {
    return { result: text || result };
  }
}

/** Translate Pi runtime events into the stable RauChat browser protocol. */
export function createAgentEventRelay(
  send: SSESend
): (event: AgentRuntimeEvent) => void {
  const runningTools = new Map<
    string,
    { name: ToolName; title: string; textOffset?: number }
  >();
  let streamedText = "";

  return (event) => {
    if (event.type === "text") {
      streamedText += event.delta;
      send("text", { delta: event.delta });
      return;
    }
    if (event.type === "thinking") {
      send("thinking", { delta: event.delta });
      return;
    }
    if (event.type === "tool_start") {
      const name = event.name as ToolName;
      const state = {
        name,
        title: titleForTool(name, event.args),
        textOffset: name === "svg_render" ? streamedText.length : undefined,
      };
      runningTools.set(event.id, state);
      send("tool_event", {
        id: event.id,
        tool: name,
        status: "running",
        title: state.title,
        textOffset: state.textOffset,
      } satisfies ToolEvent);
      return;
    }
    if (event.type !== "tool_update" && event.type !== "tool_end") return;
    const state = runningTools.get(event.id) ?? {
      name: event.name as ToolName,
      title: titleForTool(event.name as ToolName, {}),
    };
    const details = unpackToolDetails(event.result);
    if (event.type === "tool_end" && event.isError && !details.detail) {
      details.detail =
        typeof details.result === "string"
          ? details.result
          : "Tool execution failed.";
    }
    send("tool_event", {
      id: event.id,
      tool: state.name,
      status:
        event.type === "tool_update"
          ? "running"
          : event.isError
            ? "error"
            : "done",
      title: state.title,
      textOffset: state.textOffset,
      detail: details.detail,
      result: details.clientResult ?? details.result,
    } satisfies ToolEvent);
    if (event.type === "tool_end") runningTools.delete(event.id);
  };
}
