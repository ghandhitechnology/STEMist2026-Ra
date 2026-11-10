"use client";

import { useEffect, useState } from "react";
import type { WorkflowRun } from "@/lib/workflow-types";
import { Markdown } from "./Markdown";
import styles from "./WorkflowCard.module.css";

export function WorkflowCard({ initial }: { initial: WorkflowRun }) {
  const [run, setRun] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retrySteps, setRetrySteps] = useState<string[]>([]);
  useEffect(() => {
    if (initial.updatedAt >= run.updatedAt) setRun(initial);
  }, [initial, run.updatedAt]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/workflows/${encodeURIComponent(initial.id)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Could not refresh workflow progress.");
        const { run: next } = await response.json() as { run: WorkflowRun };
        if (controller.signal.aborted) return;
        setRun(next);
        if (!["completed", "cancelled"].includes(next.status)) timer = setTimeout(refresh, 2000);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Connection lost.");
          timer = setTimeout(refresh, 5000);
        }
      }
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [initial.id]);

  async function control(action: "pause" | "resume" | "cancel") {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/workflows/${encodeURIComponent(run.id)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reconciliation: retrySteps.map(stepId => ({ stepId, action: "retry" })) }),
      });
      const data = await response.json() as { run?: WorkflowRun; error?: string };
      if (!response.ok || !data.run) throw new Error(data.error ?? "Could not update workflow.");
      setRun(data.run); setRetrySteps([]);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not update workflow."); }
    finally { setBusy(false); }
  }
  const completed = run.steps.filter(step => step.status === "completed").length;
  const terminal = ["completed", "cancelled"].includes(run.status);
  return (
    <section className={styles.card} aria-label="Workflow progress">
      <div className={styles.header}>
        <strong>{run.goal}</strong>
        <span aria-live="polite">{run.pauseRequested ? "pausing" : run.status} · {completed}/{run.steps.length}</span>
      </div>
      <progress className={styles.progress} max={run.steps.length} value={completed} aria-label="Completed steps" />
      <div className={styles.steps}>
        {run.steps.map(step => (
          <details key={step.id} className={styles.step}>
            <summary><span>{step.role.replaceAll("_", " ")}</span><span>{step.id}</span><span>{step.status}</span></summary>
            <p>{step.task}</p>
            <ul>{step.acceptanceCriteria.map((criterion, i) => <li key={i}>{criterion}</li>)}</ul>
            {step.dependencies.length > 0 && <p className={styles.meta}>After {step.dependencies.join(", ")}</p>}
            {step.result && <Markdown content={step.result.text} />}
            {step.error && <p role="status">{step.error}</p>}
            {run.events.filter(event => event.stepId === step.id && event.type === "step_output").slice(-5).map(event => (
              <pre key={event.sequence}>{event.message}</pre>
            ))}
            {step.role === "executor" && ["interrupted", "failed"].includes(step.status) && (
              <label className={styles.reconcile}>
                <input type="checkbox" checked={retrySteps.includes(step.id)} onChange={event => setRetrySteps(ids => event.target.checked ? [...ids, step.id] : ids.filter(id => id !== step.id))} />
                I checked this step's changes; retry it on resume.
              </label>
            )}
          </details>
        ))}
      </div>
      {run.curation && ["failed", "interrupted"].includes(run.curation.status) && (
        <details className={styles.step} open>
          <summary>Skill learning interrupted</summary>
          <p>{run.curation.error}</p>
          <label className={styles.reconcile}>
            <input type="checkbox" checked={retrySteps.includes("_curate")} onChange={event => setRetrySteps(ids => event.target.checked ? [...ids, "_curate"] : ids.filter(id => id !== "_curate"))} />
            I checked the skill revisions; retry learning on resume.
          </label>
        </details>
      )}
      {run.summary && <details className={styles.result} open><summary>Result</summary><Markdown content={run.summary} /></details>}
      {run.publishedOutputs.length > 0 && <p className={styles.meta}>Saved to workspace: {run.publishedOutputs.join(", ")}</p>}
      {run.conflicts.length > 0 && <p role="status">Conflicting files staged: {run.conflicts.join(", ")}</p>}
      {(error || run.error) && <p role="status">{error || run.error}</p>}
      <div className={styles.footer}>
        <span>{run.tokens.toLocaleString()} tokens · {Math.round((run.elapsedMs + (run.activeStartedAt ? Math.max(0, run.updatedAt - run.activeStartedAt) : 0)) / 1000)}s</span>
        {!terminal && <div className={styles.controls}>
          {run.status === "running" || run.status === "pending" ?
            <button disabled={busy || run.pauseRequested} onClick={() => void control("pause")}>{run.pauseRequested ? "Pausing…" : "Pause"}</button> :
            <button disabled={busy} onClick={() => void control("resume")}>Resume</button>}
          <button disabled={busy} onClick={() => void control("cancel")}>Cancel</button>
        </div>}
      </div>
    </section>
  );
}
