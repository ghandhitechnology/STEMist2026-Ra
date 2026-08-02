#!/usr/bin/env python3
"""Double-fork Next.js so it survives the parent shell exiting."""
from __future__ import annotations

import os
import sys
import time


def main() -> int:
    app = os.environ["RAUCHAT_APP"]
    port = os.environ.get("PORT", "3000")
    log_file = os.environ["RAUCHAT_LOG_FILE"]
    pid_file = os.environ["RAUCHAT_PID_FILE"]

    # First fork
    if os.fork() > 0:
        # Parent waits briefly for pid file, then exits
        for _ in range(50):
            if os.path.exists(pid_file):
                break
            time.sleep(0.1)
        return 0

    os.setsid()

    # Second fork
    if os.fork() > 0:
        os._exit(0)

    os.chdir(app)
    os.environ["PORT"] = port

    with open(log_file, "a", encoding="utf-8") as log:
        os.dup2(log.fileno(), 1)
        os.dup2(log.fileno(), 2)

    # Close leftover stdin
    try:
        null = open("/dev/null", "r", encoding="utf-8")
        os.dup2(null.fileno(), 0)
    except OSError:
        pass

    # Use npm's next binary via npx/npm; record the shell-wrapper pid after exec
    # We write pid of this daemon process; npm will replace us via exec below? 
    # Better: spawn npm and write its pid.
    import subprocess

    proc = subprocess.Popen(
        ["npm", "run", "dev", "--", "-p", port, "-H", "0.0.0.0"],
        cwd=app,
        stdin=subprocess.DEVNULL,
        stdout=open(log_file, "a", encoding="utf-8"),
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    with open(pid_file, "w", encoding="utf-8") as f:
        f.write(str(proc.pid))
    # Keep the daemon alive as a babysitter so we can exit with the child
    raise SystemExit(proc.wait())


if __name__ == "__main__":
    raise SystemExit(main())
