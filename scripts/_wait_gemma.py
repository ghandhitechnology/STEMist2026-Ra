#!/usr/bin/env python3
"""Poll GEMMA_ENDPOINT_URL/health until status=ok (via curl; CF blocks bare urllib)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time

URL = os.environ["GEMMA_ENDPOINT_URL"].rstrip("/")
KEY = os.environ["GEMMA_API_KEY"]
TIMEOUT_S = int(os.environ.get("GEMMA_WAIT_TIMEOUT_S", "600"))


def probe() -> tuple[int, dict]:
    proc = subprocess.run(
        [
            "curl",
            "-sS",
            "-m",
            "15",
            "-o",
            "-",
            "-w",
            "\n%{http_code}",
            "-H",
            f"Authorization: Bearer {KEY}",
            "-H",
            "User-Agent: rauchat-dev-up/1.0",
            f"{URL}/health",
        ],
        capture_output=True,
        text=True,
    )
    out = proc.stdout or ""
    if "\n" not in out:
        return 0, {"status": (proc.stderr or "empty").strip() or "empty"}
    body, _, code_s = out.rpartition("\n")
    try:
        code = int(code_s.strip())
    except ValueError:
        code = 0
    try:
        data = json.loads(body) if body.strip() else {}
    except json.JSONDecodeError:
        data = {"status": body[:120]}
    return code, data


def main() -> int:
    deadline = time.time() + TIMEOUT_S
    last = ""
    while time.time() < deadline:
        code, body = probe()
        status = body.get("status", "?")
        msg = f"http={code} status={status}"
        if msg != last:
            print(msg, flush=True)
            last = msg
        if code == 200 and status == "ok":
            return 0
        time.sleep(5)

    print(f"Gemma did not become ready in {TIMEOUT_S}s", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
