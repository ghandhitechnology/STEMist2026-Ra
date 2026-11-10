"use client";

import { useEffect, useState } from "react";
import type { Message } from "@/lib/types";
import type { WorkflowRun } from "@/lib/workflow-types";
import { WorkflowCard } from "./WorkflowCard";

/** Runs persist even when a browser disconnects before saving the assistant turn. */
export function RecoveredWorkflows({ conversationId, messages, streamingMessage, isStreaming }: {
  conversationId?: string;
  messages: Message[];
  streamingMessage?: Message | null;
  isStreaming: boolean;
}) {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  useEffect(() => {
    setRuns([]);
    if (!conversationId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch(`/api/workflows?conversationId=${encodeURIComponent(conversationId!)}`, { signal: controller.signal });
        if (response.ok) {
          const data = await response.json() as { runs: WorkflowRun[] };
          if (!controller.signal.aborted) setRuns(data.runs);
        }
      } catch { /* A later refresh can recover a lost connection. */ }
      if (!controller.signal.aborted && isStreaming) timer = setTimeout(refresh, 5000);
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [conversationId, isStreaming]);

  const visibleIds = new Set([...messages, ...(streamingMessage ? [streamingMessage] : [])]
    .flatMap(message => message.toolEvents ?? [])
    .filter(event => event.tool === "workflow_run")
    .map(event => (event.result as { id?: string } | undefined)?.id));
  return runs.filter(run => run.conversationId === conversationId && !visibleIds.has(run.id))
    .map(run => <WorkflowCard key={run.id} initial={run} />);
}
