/**
 * lib/server/sse.ts — a small Server-Sent-Events response helper shared by
 * app/api/chat/route.ts and app/api/research/route.ts.
 *
 * Wire format per event: `event: <type>\ndata: <json>\n\n`.
 */

export type SSESend = (event: string, data: unknown) => void;

/**
 * Builds a `text/event-stream` Response backed by an async producer
 * function. The producer receives a `send(event, data)` callback and an
 * AbortSignal that fires if the client disconnects.
 *
 * If the producer throws, a single `error` event carrying `{ message }` is
 * emitted before the stream closes — callers that want finer-grained error
 * events (e.g. per-tool) should catch internally and call `send('error', …)`
 * themselves instead of letting the exception propagate.
 */
export function createSSEResponse(
  run: (send: SSESend, signal: AbortSignal) => Promise<void>
): Response {
  const encoder = new TextEncoder();
  const abortController = new AbortController();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;

      const send: SSESend = (event, data) => {
        if (!controllerRef) return;
        try {
          controllerRef.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // Controller already closed (client disconnected) — drop silently.
        }
      };

      run(send, abortController.signal)
        .catch((err: unknown) => {
          send("error", {
            message: err instanceof Error ? err.message : "Unknown error",
          });
        })
        .finally(() => {
          try {
            controllerRef?.close();
          } catch {
            // Already closed.
          }
          controllerRef = null;
        });
    },
    cancel() {
      abortController.abort();
      controllerRef = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
