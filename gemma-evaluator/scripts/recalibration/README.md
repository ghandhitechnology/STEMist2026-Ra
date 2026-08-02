# Trait recentering refit

Refits `TRAIT_RECENTER_JSON` (see deployment guide §9) for a new chat model
or a materially changed system prompt. Takes ~15 minutes with the evaluator
Pod running. All files are written to the current working directory.

```bash
# 1. Generate the corpus: 142 natural + 128 pole-elicited responses.
#    Natural jobs contain only a user message. Pole jobs add exactly one
#    intentional style system message. CORPUS_MODEL defaults to Sonnet 5.
OPENROUTER_API_KEY=... CORPUS_MODEL=anthropic/claude-sonnet-5 \
  python3 gen_corpus.py                      # -> corpus.jsonl

# 2. Re-render the corpus like Rauchat's production conversation window.
python3 build_context_corpus.py . context    # -> context/corpus.jsonl

# 3. Project every context pair through the running evaluator (resumable).
cd context
GEMMA_API_KEY=... \
  python3 ../project_corpus.py https://<POD_ID>-8000.proxy.runpod.net
                                             # -> projections.jsonl

# 4. Compute per-axis threshold (natural median) and scale (pole spread).
#    Check the report: every axis must print OK, not "POLES REVERSED".
python3 ../compute_recenter.py               # -> trait_recenter.json

# 5. Deploy: set the Pod env var TRAIT_RECENTER_JSON to the contents of
#    trait_recenter.json (stop Pod -> edit env -> start), then commit the
#    file to gemma-evaluator/artifacts/ with the model and date in its name.
```

Do not deploy a reversed pole. Diagnose whether the model refused the elicited
behavior. Terra's honest-axis remediation used matched low-stakes subjective
prompts sent as a single user message with no system message; this isolated
candid criticism from permitted sycophantic praise without hidden prompt
effects. Preserve the natural threshold and replace only the affected scale
when a supplemental diagnostic separates robustly.

Safety-aligned models may also refuse the hallucinatory pole. The Sol and Opus
5 remediations used matched harmless trivia: the positive response answered
accurately, while the negative response was explicitly framed as dialogue from
a fictional unreliable lecturer. Opus 5 required the same fictional-dialogue
framing for the v2 sycophancy cases. These supplemental calls still contain
exactly one user message and no system message. Record semantic compliance and
matched-pair direction counts before replacing a scale.

Grok 4.5's main sycophancy pole was also rejected after three of eight answers
corrected the user. The same zero-system v2 low-stakes diagnostic produced
full semantic compliance and 15/16 matched-pair directions. Its natural IQR
was wider than the diagnostic's pole-derived scale, so the noise floor remained
the deployed honest scale.

Opus 5 can spend an 800-token completion entirely on adaptive reasoning and
return no visible answer. Preserve successful rows and retry only missing IDs
with a larger completion ceiling; do not regenerate the complete corpus.

Note: RunPod's proxy rejects Python's default urllib user agent with 403 —
the scripts already send a browser-style User-Agent, so keep it if you edit
them.
