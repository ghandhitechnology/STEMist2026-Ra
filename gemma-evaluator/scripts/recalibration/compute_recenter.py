#!/usr/bin/env python3
"""Compute TRAIT_RECENTER_JSON from corpus projections.

threshold = median raw over the NATURAL set (neutral chat reads ~0)
scale     = median |raw_extreme - threshold| / atanh(0.85)
            (elicited pole extremes land around ±0.85)
"""
import json
import math
from statistics import median

rows = [json.loads(l) for l in open("projections.jsonl")]
AXES = ["factual", "serious", "casual", "creative", "honest", "confident", "empathetic", "calm"]
NEG = {"factual": "hallucinatory", "serious": "funny", "casual": "formal",
       "creative": "empirical", "honest": "sycophantic", "confident": "unsure",
       "empathetic": "unempathetic", "calm": "anxious"}
ATANH_085 = math.atanh(0.85)

natural = [r for r in rows if r["group"] == "natural"]
overrides = {}
report = []
for axis in AXES:
    thr = median(r["raw"][axis] for r in natural)
    pos = [r["raw"][axis] for r in rows if r["group"] == f"{axis}:{axis}"]
    neg = [r["raw"][axis] for r in rows if r["group"] == f"{axis}:{NEG[axis]}"]
    sep_ok = median(pos) > median(neg)
    devs = [abs(v - thr) for v in pos + neg]
    scale = max(median(devs) / ATANH_085, 0.5)
    overrides[axis] = {"threshold": round(thr, 3), "scale": round(scale, 3)}
    report.append(
        f"{axis:<11} thr {thr:>8.2f}  scale {scale:>6.2f}  "
        f"pos-med {median(pos):>8.2f}  neg-med {median(neg):>8.2f}  "
        f"{'OK' if sep_ok else '!! POLES REVERSED'}"
    )

print("\n".join(report))
print("\nnatural n =", len(natural), "| total n =", len(rows))
env_value = json.dumps(overrides, separators=(",", ":"))
with open("trait_recenter.json", "w") as f:
    f.write(env_value + "\n")
print("\nTRAIT_RECENTER_JSON written to trait_recenter.json")
