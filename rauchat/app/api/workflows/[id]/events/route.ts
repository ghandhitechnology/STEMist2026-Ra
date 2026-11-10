import type { NextRequest } from "next/server";
import { getUserId, unauthorized } from "@/lib/server/auth";
import { getWorkflow } from "@/lib/server/workflows/runner";
export const runtime = "nodejs";
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await context.params;
  let initial;
  try {
    initial = await getWorkflow(userId, id);
  } catch {
    return Response.json({ error: "Invalid workflow ID." }, { status: 400 });
  }
  if (!initial)
    return Response.json({ error: "Workflow not found." }, { status: 404 });
  const parsed = Number(
    req.headers.get("last-event-id") ??
      req.nextUrl.searchParams.get("after") ??
      0,
  );
  let cursor = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  const encoder = new TextEncoder();
  let stop: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let polling = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        req.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          /* The client may have cancelled the stream. */
        }
      };
      const poll = async () => {
        if (closed || polling) return;
        polling = true;
        try {
          const run = await getWorkflow(userId, id);
          if (closed) return;
          if (!run) {
            close();
            return;
          }
          for (const event of run.events.filter((e) => e.sequence > cursor)) {
            controller.enqueue(
              encoder.encode(
                `id: ${event.sequence}\nevent: workflow\ndata: ${JSON.stringify(event)}\n\n`,
              ),
            );
            cursor = event.sequence;
          }
          controller.enqueue(
            encoder.encode(
              `event: snapshot\ndata: ${JSON.stringify({ run })}\n\n`,
            ),
          );
          if (
            [
              "completed",
              "failed",
              "cancelled",
              "paused",
              "interrupted",
            ].includes(run.status)
          )
            close();
        } catch {
          close();
        } finally {
          polling = false;
        }
      };
      const timer = setInterval(() => {
        void poll();
      }, 1000);
      stop = close;
      req.signal.addEventListener("abort", close, { once: true });
      if (req.signal.aborted) close();
      else void poll();
    },
    cancel() {
      stop?.();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
