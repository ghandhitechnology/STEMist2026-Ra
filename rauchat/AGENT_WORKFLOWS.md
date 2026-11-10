# Agent runtime and dynamic workflows

RauChat embeds `@earendil-works/pi-coding-agent` for model streaming, tool execution,
session history, and context compaction. Models still use the existing OpenRouter
catalog. Node 22.19 or later is required. Parent turns default to 100000 tokens
and fifteen minutes, configurable through `RAUCHAT_TURN_MAX_TOKENS` and
`RAUCHAT_TURN_TIMEOUT_MS`.

## Tools and execution

Auto tools is enabled for new users. Manual tool selection remains in the composer.
The registry retains web search, browser use, PDFs, artifacts, inline SVG, memory,
and workspace file tools. It adds public-page fetching, skill discovery and
management, dynamic workflows, and E2B-backed `bash`, `read`, `write`, `edit`, `ls`,
`find`, and `grep` tools.

Set `E2B_API_KEY` on the server to enable isolated execution. Each workflow gets
its own Linux workspace, seeded from that user's files and selected skill snapshots.
Application credentials are never forwarded. Individual commands have a two-minute
timeout. Declared workflow outputs publish after verification; files changed in the
host workspace meanwhile are staged as conflicts. Ordinary shell calls declare
deliverables through their `outputs` argument. Their temporary sandbox is removed
when the chat turn ends.

Without E2B, normal chat, web research, skills, artifacts, and existing workspace
file tools remain available. Execution workflows fail with a configuration error.

## Workflow execution

The lead calls `workflow_run` with a goal and a task-specific step graph. Each step
has an ID, role, task, dependencies, output paths, and acceptance criteria. Roles
are explorer, researcher, planner, executor, and verifier. Every non-verifier step
must lead to an independent verifier. Workers inherit the conversation's model
and thinking level, and cannot spawn workflows. Verifiers depend on the steps they
check. Output paths are executor file paths; other roles use an empty array.

The server validates the graph and schedules ready steps. Read-only steps can run
in parallel. Executors and verifiers run exclusively within their workflow.
Failed verification returns evidence to affected executors for bounded repair.
A curator examines verified results for useful skill improvements, then a lead
session produces the final summary.

| Setting | Default |
| --- | --- |
| `WORKFLOW_CONCURRENCY` | 3 workers per run |
| `WORKFLOW_MAX_STEPS` | 12 steps |
| `WORKFLOW_REPAIR_CYCLES` | 2 repair cycles |
| `WORKFLOW_TIMEOUT_MS` | 900000, fifteen minutes |
| `WORKFLOW_MAX_TOKENS` | 100000 aggregate tokens per run |
| `WORKFLOW_USER_ACTIVE_LIMIT` | 1 active run per user |
| `WORKFLOW_USER_WORKERS` | 3 workers across a user's runs |
| `WORKFLOW_USER_DAILY_TOKENS` | 1000000 tokens reserved/spent per day |
| `WORKFLOW_USER_DAILY_RUNS` | 20 starts per day |
| `WORKFLOW_USER_BURST_RUNS` | 2 starts per minute |

Progress cards show steps, results, token usage, and pause/resume/cancel controls.
Pause finishes the current step before stopping. Cancel interrupts active model
calls and sandbox commands. Disconnecting the browser leaves the workflow running. Reopening the conversation
recovers its runs even if the assistant message was never saved.

Jobs run in the existing persistent Node process. Persisted checkpoints survive
restarts; interrupted runs require resume. Interrupted writes and skill changes
need reconciliation before retrying. Completed work is retained. Use the expanded
failed step to confirm inspection before retrying. API clients may instead supply
an observed completed result. Exhausted budgets require a new run.

## Storage and APIs

Everything is scoped to the authenticated user under `RAUCHAT_WORKSPACE`:

- `agent-sessions/<user>/<conversation>/`: pi session trees and UI message mappings.
- `workflow-sessions/<user>/<workflow>/`: child transcripts by step and attempt.
- `workflows/<user>/`: run state, event history, and staged output conflicts.
- `users/<user>/skills/<id>/`: current skill package and immutable revisions.

Existing conversation JSON remains the UI projection. Pi stores the full tool
history separately. Editing or regenerating a message branches the pi session.

`GET /api/workflows?conversationId=...` lists runs. `GET /api/workflows/:id` returns
a snapshot; `GET /api/workflows/:id/events` streams events and accepts
`Last-Event-ID`. `POST /api/workflows/:id` accepts `pause`, `resume`, or `cancel`,
plus explicit step reconciliation for resume. All endpoints enforce user ownership;
controls also check the request origin.

## Skills and migration

Old skill JSON migrates on access while preserving IDs, selections, creation dates,
and capabilities. A package contains `SKILL.md` and optional `scripts/` and
`references/` files. The agent first discovers descriptions through `skills_list`,
then loads relevant instructions or files through `skill_view`.

`skill_manage` creates, updates, restores, and deletes skills. Updates create complete
revisions; restoring a revision creates a new revision. The Skills dialog exposes
package files, history, and restore. Workflow-selected packages are frozen at launch,
so a concurrent skill edit does not change an in-flight step's instructions.

## Verification

Run `npm test` and `npm run build`. Tests cover pi session branching/tool exchange,
workflow dependencies and limits, verification repairs, pause/cancel/restart,
skill migration/revisions, workspace isolation, and conflicting file publication.
For a live check, run a small research workflow, then an E2B workflow that writes
and verifies a file. Reload during execution and inspect its completed progress card.
