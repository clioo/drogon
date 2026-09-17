// Shared kill/restart/readiness helper for the destructive daemon-restart
// probes (`probe-rendered-session-restart.mjs`, `probe-rendered-exited-stubs.mjs`).
//
// PERF-01e: both probes used to collapse every restart failure into the bare
// string "restarted daemon never came up", which cannot distinguish a
// replacement that exited immediately (lock/endpoint/migration refusal — its
// reason went to an ignored stderr pipe) from one that is still starting
// (its socket binds before Engine::open answers) from a kill that never
// landed. Whoever hits the next failure must learn WHICH it was from the
// error itself: the last CLI observation, the replacement's liveness and
// exit, its stderr tail, and the elapsed time.
//
// The readiness check is also cheaper rather than longer: each `status`
// attempt is bounded to a few seconds (a healthy status answers in ~10 ms
// even at load 12+, measured on the maintainer's host), so a bound-but-
// silent daemon costs one short attempt instead of the 10 s exec default
// eating most of the 15 s deadline in a single hanging poll.

import { setTimeout as delay } from "node:timers/promises";

import {
  runAcceptanceProcess,
  startAcceptanceProcess,
  waitAcceptanceExit,
} from "./acceptance-process.mjs";

export const RESTART_READY_TIMEOUT_MS = 15000;
export const RESTART_STATUS_ATTEMPT_TIMEOUT_MS = 2000;
export const RESTART_STATUS_POLL_INTERVAL_MS = 100;
const STDERR_TAIL_CHARS = 8192;
const OBSERVATION_TAIL_CHARS = 1024;

function tail(text, limit) {
  const value = String(text ?? "");
  return value.length > limit ? `…${value.slice(-limit)}` : value;
}

/// Spawn the replacement daemon with its stderr captured (capped) instead
/// of ignored: every startup refusal goes to the stderr the spawner gave it
/// (`drogond::serve` only moves diagnostics to the log file once it is
/// actually serving). Returns the child plus a `stderrTail` reader.
export function spawnRestartDaemon(daemonBin, dataDir, { env } = {}) {
  let captured = "";
  const child = startAcceptanceProcess(daemonBin, ["--data-dir", dataDir], {
    stdio: ["ignore", "ignore", "pipe"],
    env: env ?? { ...process.env },
  });
  child.stderr?.on("data", (bytes) => {
    captured = (captured + bytes.toString()).slice(-STDERR_TAIL_CHARS);
  });
  return {
    child,
    stderrTail: () => captured,
  };
}

/// One-line liveness of a spawned replacement: exited (with code/signal),
/// alive (with pid), or gone without the exit event firing.
export function describeChild(child) {
  if (child.exitCode !== null || child.signalCode !== null)
    return `exited (code=${child.exitCode} signal=${child.signalCode} pid=${child.pid ?? "unknown"})`;
  if (child.pid == null) return "never spawned (no pid)";
  try {
    process.kill(child.pid, 0);
    return `alive (pid ${child.pid})`;
  } catch {
    return `gone without an exit event (pid ${child.pid})`;
  }
}

/// SIGKILL an owned daemon and prove it died. Throws a diagnostic — rather
/// than letting the restart proceed against a still-live incumbent — when
/// the signal was not delivered or the exit is not observed.
export async function killOwnedDaemon(daemon, { exitTimeoutMs = 10000 } = {}) {
  let delivered = false;
  let killError = null;
  try {
    delivered = daemon.kill("SIGKILL");
  } catch (error) {
    killError = error?.message ?? String(error);
  }
  const observed = await waitAcceptanceExit(daemon, exitTimeoutMs);
  if (!delivered || observed.verdict !== "exited") {
    throw new Error(
      `owned daemon did not die for the restart (SIGKILL delivered=${delivered}` +
        (killError ? ` killError=${JSON.stringify(killError)}` : "") +
        ` exit=${observed.verdict} code=${observed.code ?? "n/a"} signal=${observed.signal ?? "n/a"} pid=${daemon.pid ?? "unknown"})`,
    );
  }
  return observed;
}

function describeObservation(last) {
  switch (last.kind) {
    case "none":
      return "no status attempt completed yet";
    case "answering-not-ok":
      return `daemon answered status but ok!=true: stdout=${JSON.stringify(tail(last.stdout, OBSERVATION_TAIL_CHARS))}`;
    case "unparseable":
      return `CLI exited 0 but printed non-JSON (exit code is not readiness): stdout=${JSON.stringify(tail(last.stdout, OBSERVATION_TAIL_CHARS))} stderr=${JSON.stringify(tail(last.stderr, OBSERVATION_TAIL_CHARS))}`;
    case "cli-failed":
      return `CLI failed (exit=${last.code ?? "n/a"} killed=${last.killed ?? false} signal=${last.signal ?? "n/a"}): ${tail(last.message, OBSERVATION_TAIL_CHARS)} stdout=${JSON.stringify(tail(last.stdout, OBSERVATION_TAIL_CHARS))} stderr=${JSON.stringify(tail(last.stderr, OBSERVATION_TAIL_CHARS))}`;
    default:
      return `unknown observation: ${JSON.stringify(last)}`;
  }
}

/// Poll `drogon-cli status` until it answers `ok:true`. Fails FAST with the
/// replacement's own stderr when the child has already exited (it can never
/// become ready); on the deadline, reports attempts, elapsed time, the last
/// CLI observation and the replacement's liveness — never a bare string.
export async function waitForRestartedDaemon(
  cliBin,
  dataDir,
  restarted,
  {
    timeoutMs = RESTART_READY_TIMEOUT_MS,
    attemptTimeoutMs = RESTART_STATUS_ATTEMPT_TIMEOUT_MS,
    pollIntervalMs = RESTART_STATUS_POLL_INTERVAL_MS,
  } = {},
) {
  const { child, stderrTail } = restarted;
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let attempts = 0;
  let last = { kind: "none" };
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `restarted daemon exited before serving (after ${Date.now() - startedAt}ms, ${attempts} status attempts, ${describeChild(child)});` +
          ` last status observation: ${describeObservation(last)};` +
          ` daemon stderr: ${JSON.stringify(tail(stderrTail(), OBSERVATION_TAIL_CHARS)) || '"<empty>"'}`,
      );
    }
    attempts += 1;
    try {
      const response = await runAcceptanceProcess(
        cliBin,
        ["--data-dir", dataDir, "--json", "status"],
        { timeout: attemptTimeoutMs },
      );
      let parsed = null;
      try {
        parsed = JSON.parse(response.stdout);
      } catch {
        last = {
          kind: "unparseable",
          stdout: response.stdout,
          stderr: response.stderr,
        };
      }
      if (parsed !== null) {
        if (parsed.ok === true)
          return { attempts, elapsedMs: Date.now() - startedAt };
        last = { kind: "answering-not-ok", stdout: response.stdout };
      }
    } catch (error) {
      last = {
        kind: "cli-failed",
        message: error?.message ?? String(error),
        code: error?.code,
        killed: error?.killed,
        signal: error?.signal,
        stdout: error?.stdout,
        stderr: error?.stderr,
      };
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `restarted daemon never came up (after ${Date.now() - startedAt}ms, ${attempts} status attempts, replacement ${describeChild(child)});` +
          ` last status observation: ${describeObservation(last)};` +
          ` daemon stderr: ${JSON.stringify(tail(stderrTail(), OBSERVATION_TAIL_CHARS)) || '"<empty>"'}`,
      );
    }
    await delay(pollIntervalMs);
  }
}
