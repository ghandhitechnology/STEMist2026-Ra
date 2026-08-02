import type { ToolEvent } from "./types";

export type AssistantFlowPart =
  | { kind: "text"; content: string; key: string }
  | { kind: "sketch"; event: ToolEvent; key: string };

/** A completed inline sketch whose location was recorded by the server. */
export function hasInlineSketchAnchor(event: ToolEvent): boolean {
  return (
    event.tool === "svg_render" &&
    event.status === "done" &&
    typeof event.textOffset === "number" &&
    Number.isFinite(event.textOffset) &&
    event.textOffset >= 0
  );
}

/**
 * Split assistant prose around model-authored sketch calls. Offsets use JS
 * string indices on both server and client, so astral characters stay aligned.
 * During streaming, a sketch waits until smoothed prose reaches its anchor.
 */
export function buildAssistantFlow(
  content: string,
  events: readonly ToolEvent[],
): AssistantFlowPart[] {
  const sketches = events
    .map((event, order) => ({ event, order }))
    .filter(({ event }) => hasInlineSketchAnchor(event))
    .filter(({ event }) => event.textOffset! <= content.length)
    .sort(
      (a, b) =>
        a.event.textOffset! - b.event.textOffset! || a.order - b.order,
    );

  if (sketches.length === 0) {
    return content ? [{ kind: "text", content, key: "text:0" }] : [];
  }

  const parts: AssistantFlowPart[] = [];
  let cursor = 0;
  for (const { event } of sketches) {
    const offset = Math.min(content.length, Math.trunc(event.textOffset!));
    const before = content.slice(cursor, offset);
    if (before) {
      parts.push({ kind: "text", content: before, key: `text:${cursor}` });
    }
    parts.push({ kind: "sketch", event, key: `sketch:${event.id}` });
    cursor = offset;
  }

  const after = content.slice(cursor);
  if (after) {
    parts.push({ kind: "text", content: after, key: `text:${cursor}` });
  }
  return parts;
}
