# Rauchat

Rauchat is a Claude-powered chat app with a live **Model Telemetry** side
panel: after every assistant turn, a remote Gemma 4 12B evaluator projects
the reply onto eight trait axes (factual↔hallucinatory, serious↔funny,
casual↔formal, creative↔empirical, honest↔sycophantic, confident↔unsure,
empathetic↔unempathetic, calm↔anxious) and the panel plots the result. The
evaluator is an optional overlay — with no `GEMMA_ENDPOINT_URL` configured,
the panel just renders dormant and the rest of the app works normally.

Besides chat, Rauchat gives Claude five tools it can call mid-conversation:
web search, PDF generation, sandboxed file read/write, and "make a skill"
(persist a reusable system-prompt snippet). A Workspace browser and a
Skills library expose the same sandbox and skill set through the UI.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ app/page.tsx  (client)                                               │
│  - owns lib/store.ts (conversations, localStorage)                   │
│  - owns lib/useChatStream.ts (SSE client for /api/chat)               │
│  - owns lib/useTelemetry.ts (polls /api/traits/status)                │
│                                                                       │
│  ┌───────────┐   ┌───────────────────────────┐   ┌────────────────┐ │
│  │  Sidebar  │   │         ChatView           │   │ TelemetryPanel │ │
│  │ 264px/56  │   │  MessageList + Composer    │   │   320px/44px   │ │
│  └───────────┘   └───────────────────────────┘   └────────────────┘ │
│        │                                                              │
│        ▼ opens                                                       │
│  SkillsModal · WorkspaceModal · SettingsModal                        │
└──────────────────────────────┬────────────────────────────────────────┘
                                │ fetch / SSE
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ app/api/**  (Next.js route handlers, Node runtime)                   │
│                                                                       │
│  POST /api/chat        SSE: text · tool_event · trait_snapshot ·     │
│                         done · error — the agentic tool loop         │
│  POST /api/research     SSE multi-turn search → synthesize → report  │
│  GET  /api/traits/status   Gemma health probe → {status,model,...}   │
│  POST /api/traits          standalone {text} → TraitSnapshot         │
│  GET/POST/DELETE /api/skills   skill CRUD                            │
│  GET/POST /api/files           workspace list / read / write         │
│  POST /api/files/upload        multipart composer attachments        │
│  GET  /api/pdf/[...path]       download a generated PDF              │
│                                                                       │
│  lib/server/tools.ts     web_search · pdf_create · file_read/write · │
│                          skill_make — executed inside the tool loop   │
│  lib/server/traits.ts    Gemma 4 12B HTTP client (health + project)  │
│  lib/server/workspace.ts sandboxed filesystem root                   │
│  lib/server/skills.ts    skill JSON CRUD (workspace/skills/*.json)   │
└───────────────┬──────────────────────────────┬────────────────────────┘
                │                                │
                ▼                                ▼
        OpenRouter API                    Gemma 4 12B evaluator
 (all six chat models + Luna titling)   (remote GPU service in
                                          ../gemma-evaluator)
```

## Models & thinking levels

All generation goes through OpenRouter with one key. The catalog
(`lib/models.ts`): Claude Sonnet 5 / Opus 5 and Grok 4.5 (thinking
off/low/medium/high), plus GPT-5.6 Sol / Luna / Terra (minimal→high, Terra
adds xhigh). The selector next to the chat title switches model and
thinking per conversation; levels map to OpenRouter's unified
`reasoning: { effort }` parameter (`lib/server/openrouter.ts`).
`GET /api/models` reports live catalog availability.

Chat titles are generated automatically by GPT-5.6 Luna (`/api/title`):
typed in after the first exchange, erased-and-retyped when you leave a
conversation that has grown since it was last named. Skills can be flagged
**auto-load** (Skills modal) to be active in every conversation.

## Environment variables

See `.env.example` for the full annotated list. Model and telemetry services
degrade gracefully when unset; WorkOS configuration is required whenever the
local full-access development mode is not enabled.

| Variable | Required for | Default |
|---|---|---|
| `OPENROUTER_API_KEY` | `/api/chat`, `/api/research`, `/api/title` | — (required to chat) |
| `RAUCHAT_PUBLIC_URL` | canonical auth origin + OpenRouter attribution | `http://localhost:3000` |
| `WORKOS_API_KEY` | WorkOS server API calls | — |
| `WORKOS_CLIENT_ID` | WorkOS application authentication | — |
| `WORKOS_COOKIE_PASSWORD` | encrypted WorkOS session cookie (32+ chars) | — |
| `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | exact registered OAuth callback | `http://localhost:3000/callback` |
| `RAUCHAT_TRUST_PROXY` | opt-in forwarded host/protocol trust | `false` |
| `GEMMA_ENDPOINT_URL` | Model Telemetry panel | unset → panel stays "disconnected" |
| `GEMMA_API_KEY` | bearer auth to the Gemma endpoint | unset → no `Authorization` header |
| `GEMMA_PROJECT_TIMEOUT_MS` | completed-response projection timeout | `60000` |
| `TAVILY_API_KEY` | higher-quality `web_search` | unset → falls back to scraping DuckDuckGo HTML |
| `BROWSERBASE_API_KEY` | `browser_use` cloud browser tool | unset → tool unavailable |
| `BROWSERBASE_PROJECT_ID` | Browserbase project (optional) | — |
| `RAUCHAT_WORKSPACE` | sandbox root for files/PDFs/skills | `./workspace` |

## Gemma 4 12B remote endpoint contract

`GEMMA_ENDPOINT_URL` must serve two HTTP endpoints (documented in full,
including exact JSON shapes, in `lib/server/traits.ts`). Every request
includes `Authorization: Bearer <GEMMA_API_KEY>` when that variable is set.

**`GET {GEMMA_ENDPOINT_URL}/health`**
```json
{
  "status": "ok",
  "model": "gemma-4-12b",
  "layerInfo": {
    "layerRange": "36",
    "projectionRank": 8,
    "vectorBuild": "full-original-layer-36"
  }
}
```
`layerInfo` is optional; when present it's surfaced in the panel's
"Substrate" section.

**`POST {GEMMA_ENDPOINT_URL}/project`** — body:

```json
{
  "prompt": "latest user request and relevant tool/reference evidence",
  "response": "completed assistant response"
}
```

Response:

```json
{
  "readings": [
    { "traitId": "factual", "score": 0.62, "confidence": 0.9 },
    ...one entry per trait axis, any order, extras/unknowns are dropped
  ]
}
```
`score` is signed in `-1..1` (positive leans toward the axis's first-named
pole); `confidence` is `0..1`.

The evaluator implementation, safe vector bundle, container, and artifact
conversion script live in `../gemma-evaluator`. See
`../GEMMA_RUNPOD_DEPLOYMENT.md` for the persistent-GPU deployment procedure.

## Running it

```bash
cd rauchat
npm install
cp .env.example .env.local   # fill in OPENROUTER_API_KEY at minimum
npm run dev                  # http://localhost:3000
```

Production build:
```bash
npm test && npm run build && npm start
```

## WorkOS deployment checklist

Rauchat uses one canonical browser origin. The sign-in pages and every
`/api/auth/*` endpoint must be served from that same scheme, hostname, and
port. Before deploying:

1. Set `RAUCHAT_PUBLIC_URL=https://your-app.example` without a path and set
   `NEXT_PUBLIC_WORKOS_REDIRECT_URI=https://your-app.example/callback`.
2. Register that exact callback in the matching WorkOS environment and enable
   Google and GitHub for the same application/client ID.
3. Use API keys and client IDs from the same WorkOS staging or production
   environment. Keep `WORKOS_COOKIE_PASSWORD` stable across every replica.
4. Run Node.js 22.11 or newer, matching the installed AuthKit SDK requirement.
5. Leave `RAUCHAT_TRUST_PROXY=false` unless the hosting proxy is documented to
   overwrite, rather than append to, inbound `X-Forwarded-Host` and
   `X-Forwarded-Proto` headers.
6. Redirect alternate domains before serving the sign-in page. Never redirect
   or replay credential POST requests between origins.
7. Confirm the `wos-session`, OAuth state, and PKCE cookies are `HttpOnly`,
   `SameSite=Lax`, path `/`, and `Secure` on HTTPS.
8. Smoke-test password sign-in, signup + email verification, reset, Google,
   GitHub, sign-out, and a deliberately mismatched Origin before launch.

For local development, keep both public URLs on the same localhost port. A
direct same-origin POST reaches WorkOS; a different hostname, scheme, or port
is rejected with `AUTH_ORIGIN_MISMATCH` before credentials leave Rauchat.

## Known limitations

- Composer attachments upload to the per-user workspace (`uploads/`) and are
  enriched into the chat turn (text inlined, images as vision parts, other
  binaries path-referenced). PDF/binary text extraction is not implemented.
- `onRetry` and `onRegenerate` resend the conversation history without
  remembering the original turn's tool/skill selection or attachments.
- `TelemetryPanel`'s `onSelectTurn` (click a point in the trait history to
  jump the transcript to that turn) has no scroll-to-message wiring yet —
  `MessageList` doesn't expose a scroll-to-index handle.
