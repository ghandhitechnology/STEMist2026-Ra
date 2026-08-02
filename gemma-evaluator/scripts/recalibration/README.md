# Trait recentering refit

Refits `TRAIT_RECENTER_JSON` (see deployment guide §9) for a new chat model
or a materially changed system prompt. Takes ~15 minutes with the evaluator
Pod running. All files are written to the current working directory.

```bash
# 1. Generate the corpus: 72 natural + 64 pole-elicited responses.
#    CORPUS_MODEL defaults to anthropic/claude-sonnet-5.
OPENROUTER_API_KEY=... CORPUS_MODEL=anthropic/claude-sonnet-5 \
  python3 gen_corpus.py                      # -> corpus.jsonl

# 2. Project every pair through the running evaluator (resumable).
GEMMA_API_KEY=... \
  python3 project_corpus.py https://<POD_ID>-8000.proxy.runpod.net
                                             # -> projections.jsonl

# 3. Compute per-axis threshold (natural median) and scale (pole spread).
#    Check the report: every axis must print OK, not "POLES REVERSED".
python3 compute_recenter.py                  # -> trait_recenter.json

# 4. Deploy: set the Pod env var TRAIT_RECENTER_JSON to the contents of
#    trait_recenter.json (stop Pod -> edit env -> start), then commit the
#    file to gemma-evaluator/artifacts/ with the model and date in its name.
```

Note: RunPod's proxy rejects Python's default urllib user agent with 403 —
the scripts already send a browser-style User-Agent, so keep it if you edit
them.
