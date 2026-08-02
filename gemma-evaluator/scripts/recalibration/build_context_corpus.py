#!/usr/bin/env python3
"""Derive a multi-turn corpus from a single-turn one — no new generation.

Reads corpus.jsonl in SRC dir, writes corpus.jsonl in DST dir. Each sample
keeps its own response but its prompt is re-rendered the way rauchat's
buildTraitEvaluationPrompt does it in production: roughly a third stay
bare first-turn questions, the rest gain 1-3 prior user/assistant turns
drawn (deterministically) from the natural set as "Conversation so far".

usage: build_context_corpus.py <src_dir> <dst_dir> [seed]
"""
import json
import os
import random
import sys

MAX_TRAIT_CONTEXT_CHARS = 20_000  # keep in lockstep with chat/route.ts

src, dst = sys.argv[1], sys.argv[2]
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 20260802
rng = random.Random(seed)

rows = [json.loads(l) for l in open(os.path.join(src, "corpus.jsonl"))]
natural = [r for r in rows if r["group"] == "natural"]


def render(history: list[dict], latest_prompt: str) -> str:
    if not history:
        return latest_prompt[-MAX_TRAIT_CONTEXT_CHARS:]
    transcript = "\n\n".join(
        f"User: {h['prompt'].strip()}\n\nAssistant: {h['response'].strip()}"
        for h in history
    )
    combined = "\n\n".join(
        [f"Conversation so far:\n{transcript}", f"Latest user request:\n{latest_prompt}"]
    )
    return combined[-MAX_TRAIT_CONTEXT_CHARS:]


out_rows = []
for row in rows:
    n_history = rng.choice([0, 1, 1, 2, 2, 3])
    pool = [r for r in natural if r["id"] != row["id"]]
    history = rng.sample(pool, n_history) if n_history else []
    out_rows.append({
        "id": row["id"],
        "group": row["group"],
        "prompt": render(history, row["prompt"]),
        "response": row["response"],
    })

os.makedirs(dst, exist_ok=True)
with open(os.path.join(dst, "corpus.jsonl"), "w") as f:
    for r in out_rows:
        f.write(json.dumps(r) + "\n")
with_ctx = sum(1 for r in out_rows if r["prompt"].startswith("Conversation so far:"))
print(f"{dst}: {len(out_rows)} rows, {with_ctx} with history, seed {seed}")
