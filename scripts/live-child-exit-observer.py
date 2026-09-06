#!/usr/bin/env python3
"""Kernel-level process-exit observer for the live-child crash acceptance.

Harness-only instrumentation (no drogon/product APIs). The parent acceptance
process spawns this as a directly owned child, hands it one JSON config line
on stdin {"pid": N, "deadlineMs": M}, and reads newline-delimited JSON on
stdout. The registration happens only after the target has proven itself live
on the private nonce-authenticated control channel, and the resulting kernel
handle pins the *process* (not the pid number), so a NOTE_EXIT / pidfd event
cannot be spoofed by pid reuse that occurs after registration.

Platforms:
  - macOS/BSD: kqueue EVFILT_PROC with NOTE_EXIT (via stdlib `select`).
  - Linux: os.pidfd_open + poll on the pidfd (stdlib `os`/`select`).

Protocol (stdout, one JSON object per line):
  {"type": "ready", "mode": ..., "pid": N}   registration succeeded
  {"type": "exit", "pid": N}                 kernel reports the process exited
  {"type": "timeout", "pid": N}              deadline elapsed before any exit
  {"type": "stopped"}                        SIGTERM bounded shutdown
  {"type": "unsupported", "reason": ...}     no kernel mechanism on this host
  {"type": "register-error", "reason": ...}  registration failed (e.g. ESRCH:
                                             target already gone — ambiguous,
                                             the parent must classify
                                             unverifiable, never exited)

Exit codes: 0 ready->exit/stopped, 2 unsupported/register-error, 3 timeout.
Only the Python standard library is used; `--probe` prints capability and
exits without touching stdin.
"""

import json
import os
import select
import signal
import sys


def _emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def _probe():
    if hasattr(select, "kqueue") and hasattr(select, "KQ_FILTER_PROC"):
        _emit({"type": "capable", "mode": "kqueue-proc"})
        return 0
    if hasattr(os, "pidfd_open"):
        _emit({"type": "capable", "mode": "pidfd"})
        return 0
    _emit({
        "type": "unsupported",
        "reason": "no kqueue EVFILT_PROC and no os.pidfd_open on this host",
    })
    return 2


def _watch_kqueue(pid, deadline_ms):
    kq = select.kqueue()
    # EV_ADD|EV_ENABLE registers synchronously inside this control call, so
    # there is no window in which the target could exit unobserved between
    # "register" and "wait".
    kq.control(
        [
            select.kevent(
                pid,
                select.KQ_FILTER_PROC,
                select.KQ_EV_ADD | select.KQ_EV_ENABLE,
                select.KQ_NOTE_EXIT,
            )
        ],
        0,
    )
    _emit({"type": "ready", "mode": "kqueue-proc", "pid": pid})
    events = kq.control(None, 4, max(deadline_ms, 1) / 1000.0)
    if events:
        _emit({"type": "exit", "pid": pid})
        return 0
    _emit({"type": "timeout", "pid": pid})
    return 3


def _watch_pidfd(pid, deadline_ms):
    pidfd = os.pidfd_open(pid, 0)  # pins the task; immune to later pid reuse
    poller = select.poll()
    poller.register(pidfd, select.POLLIN)
    _emit({"type": "ready", "mode": "pidfd", "pid": pid})
    if poller.poll(max(deadline_ms, 1)):
        _emit({"type": "exit", "pid": pid})
        return 0
    _emit({"type": "timeout", "pid": pid})
    return 3


def main():
    if "--probe" in sys.argv:
        return _probe()

    stopped = {"flag": False}

    def _sigterm(_signo, _frame):
        # Bounded shutdown path: report and exit promptly; the parent also
        # holds our own ChildProcess handle and bounds the wait.
        if not stopped["flag"]:
            stopped["flag"] = True
            _emit({"type": "stopped"})
            sys.exit(0)

    signal.signal(signal.SIGTERM, _sigterm)
    signal.signal(signal.SIGINT, _sigterm)

    line = sys.stdin.readline()
    try:
        config = json.loads(line)
        pid = int(config["pid"])
        deadline_ms = int(config.get("deadlineMs", 60000))
    except (ValueError, KeyError, json.JSONDecodeError) as error:
        _emit({"type": "error", "reason": f"bad config line: {error}"})
        return 2
    if pid <= 0:
        _emit({"type": "error", "reason": f"refusing non-positive pid {pid}"})
        return 2

    try:
        if hasattr(select, "kqueue") and hasattr(select, "KQ_FILTER_PROC"):
            return _watch_kqueue(pid, deadline_ms)
        if hasattr(os, "pidfd_open"):
            return _watch_pidfd(pid, deadline_ms)
    except ProcessLookupError as error:
        # Target vanished between the caller's liveness proof and our
        # registration. The exit was NOT kernel-observed: the parent must
        # classify this as unverifiable, never as exited.
        _emit({"type": "register-error", "reason": str(error)})
        return 2
    except OSError as error:
        _emit({"type": "register-error", "reason": str(error)})
        return 2
    _emit({
        "type": "unsupported",
        "reason": "no kqueue EVFILT_PROC and no os.pidfd_open on this host",
    })
    return 2


if __name__ == "__main__":
    sys.exit(main())
