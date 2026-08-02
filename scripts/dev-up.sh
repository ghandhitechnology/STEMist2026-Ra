#!/usr/bin/env bash
# Bring up Rauchat on :3000 and ensure the Gemma GPU pod is live.
# Survives terminal close via nohup + pid/log under $TMPDIR/rauchat.
#
# Usage:
#   ./scripts/dev-up.sh           # start if needed
#   ./scripts/dev-up.sh --restart # force restart Next.js
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/rauchat"
LOG_DIR="${TMPDIR:-/tmp}/rauchat"
PID_FILE="$LOG_DIR/next.pid"
LOG_FILE="$LOG_DIR/next-dev.log"
PORT="${PORT:-3000}"
RESTART=0
[[ "${1:-}" == "--restart" ]] && RESTART=1

mkdir -p "$LOG_DIR"

need() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env: $name" >&2
    exit 1
  fi
}

need RUNPOD_API_KEY
need GEMMA_API_KEY
need OPENROUTER_API_KEY
need WORKOS_API_KEY
need WORKOS_CLIENT_ID
need WORKOS_COOKIE_PASSWORD

export RAUCHAT_PUBLIC_URL="${RAUCHAT_PUBLIC_URL:-http://localhost:${PORT}}"
export NEXT_PUBLIC_WORKOS_REDIRECT_URI="${NEXT_PUBLIC_WORKOS_REDIRECT_URI:-http://localhost:${PORT}/callback}"
export RAUCHAT_LOCAL_FULL_ACCESS="${RAUCHAT_LOCAL_FULL_ACCESS:-false}"
export GEMMA_PROJECT_TIMEOUT_MS="${GEMMA_PROJECT_TIMEOUT_MS:-60000}"

echo "== Ensuring Gemma GPU pod =="
GEMMA_ENDPOINT_URL="$(python3 "$ROOT/scripts/_ensure_gemma.py")"
export GEMMA_ENDPOINT_URL
echo "GEMMA_ENDPOINT_URL=$GEMMA_ENDPOINT_URL"

# Keep .env in sync so Next can read it without shell exports.
python3 - "$APP/.env" "$GEMMA_ENDPOINT_URL" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
url = sys.argv[2]
text = path.read_text() if path.exists() else ""
line = 'GEMMA_ENDPOINT_URL="{}"'.format(url)
if "GEMMA_ENDPOINT_URL=" in text:
    out = []
    for row in text.splitlines():
        out.append(line if row.startswith("GEMMA_ENDPOINT_URL=") else row)
    path.write_text("\n".join(out) + ("\n" if text.endswith("\n") else ""))
else:
    path.write_text(text.rstrip() + "\n" + line + "\n")
print("synced", path)
PY

echo "== Waiting for Gemma /health =="
python3 "$ROOT/scripts/_wait_gemma.py"

if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE" || true)"
  if [[ -n "${old_pid}" ]] && kill -0 "$old_pid" 2>/dev/null; then
    if [[ "$RESTART" -eq 1 ]]; then
      echo "== Restarting Next.js (pid $old_pid) =="
      kill "$old_pid" 2>/dev/null || true
      sleep 1
      kill -9 "$old_pid" 2>/dev/null || true
    else
      if curl -fsS -m 3 "http://127.0.0.1:${PORT}/sign-in" >/dev/null; then
        echo "Rauchat already healthy at http://localhost:${PORT} (pid $old_pid)"
        exit 0
      fi
      echo "Stale/hung Next.js (pid $old_pid) — restarting"
      kill "$old_pid" 2>/dev/null || true
      sleep 1
      kill -9 "$old_pid" 2>/dev/null || true
    fi
  fi
fi

if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "== Freeing :$PORT =="
  # shellcheck disable=SC2046
  kill $(lsof -tiTCP:"$PORT" -sTCP:LISTEN) 2>/dev/null || true
  sleep 1
  if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    # shellcheck disable=SC2046
    kill -9 $(lsof -tiTCP:"$PORT" -sTCP:LISTEN) 2>/dev/null || true
  fi
fi

echo "== Starting Next.js on :$PORT =="
export RAUCHAT_APP="$APP"
export RAUCHAT_LOG_FILE="$LOG_FILE"
export RAUCHAT_PID_FILE="$PID_FILE"
export PORT
python3 "$ROOT/scripts/_start_next.py"
echo "pid=$(cat "$PID_FILE") log=$LOG_FILE"

for _ in $(seq 1 60); do
  if curl -fsS -m 2 "http://127.0.0.1:${PORT}/sign-in" >/dev/null 2>&1; then
    echo "Ready: http://localhost:${PORT}"
    echo "Gemma: $GEMMA_ENDPOINT_URL (ok)"
    exit 0
  fi
  sleep 1
done

echo "Next.js did not become ready; see $LOG_FILE" >&2
exit 1
