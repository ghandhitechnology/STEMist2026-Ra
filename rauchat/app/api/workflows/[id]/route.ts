import type { NextRequest } from "next/server";
import { z } from "zod";
import { WorkflowAdmissionError } from "@/lib/server/workflows/admission";
import { getUserId, unauthorized } from "@/lib/server/auth";
import { crossSiteRejection } from "@/lib/server/http";
import { controlWorkflow, getWorkflow } from "@/lib/server/workflows/runner";
import { ensureWorkflowAgentRunner } from "@/lib/server/workflow-agent-bridge";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_req: NextRequest, context: Context) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  try {
    const run = await getWorkflow(userId, (await context.params).id);
    return run
      ? Response.json({ run })
      : Response.json({ error: "Workflow not found." }, { status: 404 });
  } catch {
    return Response.json({ error: "Invalid workflow ID." }, { status: 400 });
  }
}
const controlSchema = z.object({
  action: z.enum(["pause", "resume", "cancel"]),
  reconciliation: z
    .array(
      z.object({
        stepId: z.string(),
        action: z.enum(["retry", "complete"]),
        result: z
          .object({
            text: z.string(),
            tokens: z.number().nonnegative(),
            outputs: z.array(z.string()).optional(),
            verified: z.boolean().optional(),
          })
          .optional(),
      }),
    )
    .max(100)
    .optional(),
});
export async function POST(req: NextRequest, context: Context) {
  const rejection = crossSiteRejection(req);
  if (rejection) return rejection;
  const userId = await getUserId();
  if (!userId) return unauthorized();
  let input;
  try {
    input = controlSchema.parse(await req.json());
  } catch {
    return Response.json(
      { error: "Invalid workflow control." },
      { status: 400 },
    );
  }
  try {
    ensureWorkflowAgentRunner();
    const run = await controlWorkflow(
      userId,
      (await context.params).id,
      input.action,
      input.reconciliation,
    );
    return run
      ? Response.json({ run })
      : Response.json({ error: "Workflow not found." }, { status: 404 });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Workflow control failed." },
      { status: e instanceof WorkflowAdmissionError ? 429 : 409 },
    );
  }
}
