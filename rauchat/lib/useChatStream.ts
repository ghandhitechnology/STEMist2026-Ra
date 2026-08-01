"use client";

/**
 * lib/useChatStream.ts
 *
 * POSTs to /api/chat and consumes the SSE stream.
 *
 * SSE contract (shared with the API route):
 *   event: text            data: "<delta>"            (JSON string, or raw text)
 *   event: thinking        data: {"delta":"…"}        (model reasoning stream, optional)
 *   event: tool_event      data: <ToolEvent JSON>
 *   event: trait_snapshot  data: <TraitSnapshot JSON>
 *   event: done            data: {}                   (optional payload)
 *   event: error           data: {"message":"…"}      (or a raw string)
 *
 * Text deltas are coalesced into one state update per animation frame, so a
 * fast token stream costs ~60 renders/second at most, not one per token.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Message, ToolEvent, ToolName, TraitSnapshot } from "./types";

export type StreamingMessage = {
  content: string;
  toolEvents: ToolEvent[];
  traitSnapshot: TraitSnapshot | null;
};

export type StreamingState = StreamingMessage & {
  isStreaming: boolean;
  error: string | null;
  /** Accumulated model reasoning ("thinking") deltas for the in-flight turn. */
  thinking: string;
};

export const EMPTY_STREAMING_MESSAGE: StreamingMessage = {
  content: "",
  toolEvents: [],
  traitSnapshot: null,
};

export const EMPTY_STREAMING_STATE: StreamingState = {
  ...EMPTY_STREAMING_MESSAGE,
  isStreaming: false,
  error: null,
  thinking: "",
};

export type SendInput = {
  /** Full history to send, including the new user message. */
  messages: Message[];
  conversationId?: string;
  tools?: readonly ToolName[];
  skillId?: string | null;
  forceTools?: boolean;
  /** Rauchat model id (lib/models.ts ModelInfo["id"]); omit for server default. */
  model?: string;
  /** Thinking level (lib/models.ts ThinkingLevel); omit for the model's default. */
  thinking?: string;
  /** Merged into the request body verbatim. */
  extra?: Record<string, unknown>;
};

export type UseChatStreamOptions = {
  /** Defaults to "/api/chat". */
  endpoint?: string;
  onToolEvent?: (event: ToolEvent) => void;
  onTraitSnapshot?: (snapshot: TraitSnapshot) => void;
  /** Fired for each model reasoning ("thinking") delta. */
  onThinking?: (delta: string) => void;
  /** Fired once the stream completes normally. */
  onDone?: (final: StreamingMessage) => void;
  /** Fired on transport or server error, and never on user-initiated stop. */
  onError?: (message: string) => void;
};

export type UseChatStream = {
  send: (input: SendInput) => Promise<StreamingMessage | null>;
  stop: () => void;
  isStreaming: boolean;
  /** Non-null while a turn is in flight, and until `reset()` is called. */
  streamingMessage: StreamingMessage | null;
  /** Accumulated model reasoning ("thinking") deltas; reset at the start of each `send()`. */
  streamingThinking: string;
  error: string | null;
  /** Convenience bundle for <ChatView streamingState={…} />. */
  state: StreamingState;
  reset: () => void;
};

/* ------------------------------------------------------------------
   SSE frame parsing
   ------------------------------------------------------------------ */

type Frame = { event: string; data: string };

function parseFrame(raw: string): Frame | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }
  if (dataLines.length === 0 && event === "message") return null;
  return { event, data: dataLines.join("\n") };
}

function parseTextDelta(data: string): string {
  if (!data) return "";
  const first = data[0];
  if (first === '"' || first === "{") {
    try {
      const parsed: unknown = JSON.parse(data);
      if (typeof parsed === "string") return parsed;
      if (parsed && typeof parsed === "object") {
        const rec = parsed as Record<string, unknown>;
        for (const key of ["text", "delta", "content", "value"]) {
          if (typeof rec[key] === "string") return rec[key] as string;
        }
      }
    } catch {
      /* not JSON — fall through to the raw payload */
    }
  }
  return data;
}

function parseJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function isToolEvent(value: unknown): value is ToolEvent {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return typeof rec.id === "string" && typeof rec.tool === "string";
}

function isTraitSnapshot(value: unknown): value is TraitSnapshot {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return Array.isArray(rec.readings);
}

function errorMessageOf(data: string): string {
  const parsed = parseJson(data);
  if (typeof parsed === "string") return parsed;
  if (parsed && typeof parsed === "object") {
    const rec = parsed as Record<string, unknown>;
    for (const key of ["message", "error", "detail"]) {
      if (typeof rec[key] === "string") return rec[key] as string;
    }
  }
  return data || "The request failed.";
}

/* ------------------------------------------------------------------
   Hook
   ------------------------------------------------------------------ */

export function useChatStream(options: UseChatStreamOptions = {}): UseChatStream {
  const { endpoint = "/api/chat" } = options;

  const [streamingMessage, setStreamingMessage] = useState<StreamingMessage | null>(
    null
  );
  const [streamingThinking, setStreamingThinking] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Handlers live in a ref so `send` keeps a stable identity across renders.
  const handlers = useRef(options);
  handlers.current = options;

  const abortRef = useRef<AbortController | null>(null);
  const bufferRef = useRef<StreamingMessage>(EMPTY_STREAMING_MESSAGE);
  const thinkingRef = useRef<string>("");
  const frameRef = useRef<number | null>(null);

  const cancelFlush = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const commit = useCallback(() => {
    setStreamingMessage({ ...bufferRef.current });
    setStreamingThinking(thinkingRef.current);
  }, []);

  /** Coalesce high-frequency updates into one commit per frame. */
  const scheduleFlush = useCallback(() => {
    if (frameRef.current !== null) return;
    if (typeof requestAnimationFrame === "undefined") {
      commit();
      return;
    }
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      commit();
    });
  }, [commit]);

  useEffect(
    () => () => {
      cancelFlush();
      abortRef.current?.abort();
    },
    [cancelFlush]
  );

  const reset = useCallback(() => {
    cancelFlush();
    bufferRef.current = EMPTY_STREAMING_MESSAGE;
    thinkingRef.current = "";
    setStreamingMessage(null);
    setStreamingThinking("");
    setError(null);
  }, [cancelFlush]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    cancelFlush();
    commit();
    setIsStreaming(false);
  }, [cancelFlush, commit]);

  const send = useCallback(
    async (input: SendInput): Promise<StreamingMessage | null> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      cancelFlush();
      bufferRef.current = { content: "", toolEvents: [], traitSnapshot: null };
      thinkingRef.current = "";
      setStreamingMessage(bufferRef.current);
      setStreamingThinking("");
      setError(null);
      setIsStreaming(true);

      const fail = (message: string) => {
        cancelFlush();
        commit();
        setError(message);
        setIsStreaming(false);
        handlers.current.onError?.(message);
      };

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            conversationId: input.conversationId,
            messages: input.messages,
            tools: input.tools ?? [],
            skillId: input.skillId ?? null,
            forceTools: input.forceTools ?? false,
            ...(input.model !== undefined ? { model: input.model } : {}),
            ...(input.thinking !== undefined ? { thinking: input.thinking } : {}),
            ...input.extra,
          }),
        });

        if (!response.ok || !response.body) {
          let detail: string | null = null;
          try {
            const body = (await response.json()) as { error?: unknown };
            if (typeof body.error === "string" && body.error) detail = body.error;
          } catch {
            // Non-JSON error body — fall back to the status line.
          }
          fail(
            detail ??
              `Request failed (${response.status}${
                response.statusText ? ` ${response.statusText}` : ""
              }).`
          );
          return null;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        // Held on an object: TypeScript resets narrowing of object properties
        // across the handleFrame() calls that mutate them.
        const status: { error: string | null; finished: boolean } = {
          error: null,
          finished: false,
        };

        const handleFrame = (raw: string) => {
          const frame = parseFrame(raw);
          if (!frame) return;

          switch (frame.event) {
            case "text": {
              const delta = parseTextDelta(frame.data);
              if (!delta) return;
              bufferRef.current = {
                ...bufferRef.current,
                content: bufferRef.current.content + delta,
              };
              scheduleFlush();
              return;
            }
            case "thinking": {
              const delta = parseTextDelta(frame.data);
              if (!delta) return;
              thinkingRef.current += delta;
              handlers.current.onThinking?.(delta);
              scheduleFlush();
              return;
            }
            case "tool_event": {
              const parsed = parseJson(frame.data);
              if (!isToolEvent(parsed)) return;
              const existing = bufferRef.current.toolEvents;
              const index = existing.findIndex((e) => e.id === parsed.id);
              const toolEvents =
                index === -1
                  ? [...existing, parsed]
                  : existing.map((e, i) => (i === index ? { ...e, ...parsed } : e));
              bufferRef.current = { ...bufferRef.current, toolEvents };
              handlers.current.onToolEvent?.(parsed);
              scheduleFlush();
              return;
            }
            case "trait_snapshot": {
              const parsed = parseJson(frame.data);
              if (!isTraitSnapshot(parsed)) return;
              bufferRef.current = { ...bufferRef.current, traitSnapshot: parsed };
              handlers.current.onTraitSnapshot?.(parsed);
              scheduleFlush();
              return;
            }
            case "error": {
              status.error = errorMessageOf(frame.data);
              status.finished = true;
              return;
            }
            case "done": {
              status.finished = true;
              return;
            }
            default:
              return;
          }
        };

        while (!status.finished) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let split = buffer.indexOf("\n\n");
          while (split !== -1) {
            const raw = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            handleFrame(raw);
            if (status.finished) break;
            split = buffer.indexOf("\n\n");
          }
        }

        if (!status.finished && buffer.trim()) handleFrame(buffer.trim());

        try {
          await reader.cancel();
        } catch {
          /* the stream is already closed */
        }

        // A newer send() has taken over: this is a stale continuation and
        // must not touch the live turn's controller, buffer, or flags.
        if (abortRef.current !== controller) return null;
        abortRef.current = null;

        cancelFlush();
        const final = { ...bufferRef.current };
        setStreamingMessage(final);
        setStreamingThinking(thinkingRef.current);
        setIsStreaming(false);

        if (status.error) {
          setError(status.error);
          handlers.current.onError?.(status.error);
          return null;
        }

        handlers.current.onDone?.(final);
        return final;
      } catch (err) {
        // Superseded by a newer send(): that turn owns the state now, so this
        // one unwinds silently. (This is the common case when the user starts
        // a turn in another conversation.)
        if (abortRef.current !== controller) return null;
        abortRef.current = null;

        if (err instanceof DOMException && err.name === "AbortError") {
          // User-initiated stop: keep whatever streamed, no error surface.
          cancelFlush();
          commit();
          setIsStreaming(false);
          return null;
        }
        fail(err instanceof Error ? err.message : "The request failed.");
        return null;
      }
    },
    [cancelFlush, commit, endpoint, scheduleFlush]
  );

  const state: StreamingState = {
    content: streamingMessage?.content ?? "",
    toolEvents: streamingMessage?.toolEvents ?? EMPTY_STREAMING_MESSAGE.toolEvents,
    traitSnapshot: streamingMessage?.traitSnapshot ?? null,
    isStreaming,
    error,
    thinking: streamingThinking,
  };

  return {
    send,
    stop,
    isStreaming,
    streamingMessage,
    streamingThinking,
    error,
    state,
    reset,
  };
}

export default useChatStream;
