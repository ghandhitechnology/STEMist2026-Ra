#!/usr/bin/env python3
"""Project every corpus pair through the evaluator; save raw scores."""
import json
import os
import sys
import urllib.request

if len(sys.argv) < 2:
    sys.exit("usage: project_corpus.py https://<POD_ID>-8000.proxy.runpod.net")
URL = sys.argv[1]

key = os.environ.get("GEMMA_API_KEY", "").strip()
if not key:
    sys.exit("set GEMMA_API_KEY")

rows = [json.loads(l) for l in open("corpus.jsonl")]
out_path = "projections.jsonl"
done_ids = set()
if os.path.exists(out_path):
    done_ids = {json.loads(l)["id"] for l in open(out_path)}

with open(out_path, "a") as out:
    for n, row in enumerate(rows):
        if row["id"] in done_ids:
            continue
        body = json.dumps({"prompt": row["prompt"], "response": row["response"]}).encode()
        req = urllib.request.Request(
            f"{URL}/project", data=body,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                     "User-Agent": "Mozilla/5.0 (rauchat-calibration)"},
        )
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=180) as r:
                    data = json.load(r)
                out.write(json.dumps({
                    "id": row["id"], "group": row["group"],
                    "raw": data["meta"]["rawScores"],
                    "scores": {x["traitId"]: x["score"] for x in data["readings"]},
                }) + "\n")
                out.flush()
                break
            except Exception as e:
                if attempt == 2:
                    print(f"FAILED {row['id']}: {e}", file=sys.stderr)
        if (n + 1) % 20 == 0:
            print(f"{n + 1}/{len(rows)}")
print("done")
