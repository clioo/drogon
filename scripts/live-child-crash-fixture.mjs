// Live-child crash-recovery acceptance fixture (harness-only; no drogon
// imports; daemon-free unit tests in live-child-crash-fixture.test.mjs).
//
// The PTY child spawned through drogond dials a private nonce-handshaken
// control socket so the parent can observe and manage it without any drogon
// state. Evidence layering: a control close is CONTROL LOSS, never exit; the
// kernel exit observer (macOS kqueue EVFILT_PROC NOTE_EXIT / Linux pidfd,
// registered only after an authenticated pong) is the exit authority and
// pins the process against pid reuse. The child pid is never signaled.
// Anything ambiguous classifies unverifiable and the fixture is retained.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

// Exit codes the fixture child uses for its own bounded terminal states.
export const FIXTURE_EXIT = {
  controlled: 0,
  deadline: 92,
  controlLost: 93,
};

export const DEFAULT_FIXTURE_DEADLINE_MS = 120_000;

/**
 * Source of the `node -e` program run as the drogon PTY child. All values are
 * embedded via JSON.stringify so the daemon's argv-only spawn (no shell) is
 * preserved; the nonce travels inside argv, never in env (drogond strips
 * DROGON_* and ORCA_* from session children) and is never logged.
 */
export function buildFixtureProgram({
  controlPath,
  nonce,
  deadlineMs = DEFAULT_FIXTURE_DEADLINE_MS,
  // Test-only seam (unset in production/acceptance use): forces a control
  // socket error this many ms after finish() has already selected the exit
  // code, to deterministically prove the error path cannot override it.
  raceControlErrorAfterFinishMs = null,
}) {
  return `(() => {
  const net = require("node:net");
  const { randomUUID } = require("node:crypto");
  const CONTROL = ${JSON.stringify(controlPath)};
  const NONCE = ${JSON.stringify(nonce)};
  const RACE_CONTROL_ERROR_MS = ${JSON.stringify(raceControlErrorAfterFinishMs)};
  const instanceId = randomUUID();
  const timers = new Set();
  let settled = false;
  let ctl = null;
  const send = (obj) => {
    if (ctl && !ctl.destroyed) ctl.write(JSON.stringify(obj) + "\\n");
  };
  const finish = (code, reason) => {
    if (settled) return;
    settled = true;
    for (const t of timers) clearTimeout(t);
    send({ type: "bye", code, reason });
    if (RACE_CONTROL_ERROR_MS !== null) {
      // Seam: race a control-socket error into the already-selected exit
      // window below, proving ctl.on("error") cannot override it once
      // settled.
      setTimeout(() => {
        if (ctl && !ctl.destroyed) ctl.destroy(new Error("seam-forced-control-error"));
      }, RACE_CONTROL_ERROR_MS);
    }
    // Bounded flush window; the kernel observer plus the control close are
    // the exit/cleanup evidence, so this cannot hang cleanup.
    setTimeout(() => process.exit(code), 25);
  };
  const later = (fn, ms) => {
    const t = setTimeout(fn, ms);
    timers.add(t);
    return t;
  };
  // Daemon death closes the PTY master; this host may then deliver SIGHUP to
  // the foreground group. Survival is NOT assumed — record what happened and
  // stay alive so the harness can observe the platform's real behavior.
  process.on("SIGHUP", () => send({ type: "event", name: "sighup" }));
  process.on("SIGWINCH", () =>
    // Node may run this JS handler before refreshing tty winsize; one
    // immediate turn later the observed columns/rows are reliable.
    setImmediate(() =>
      send({
        type: "event",
        name: "sigwinch",
        cols: process.stdout.columns || 0,
        rows: process.stdout.rows || 0,
      }),
    ),
  );
  process.on("SIGTERM", () => finish(0, "sigterm"));
  process.on("SIGINT", () => finish(0, "sigint"));
  // PTY closure surfaces as EIO on the slave stdio; swallow it so the
  // witness child outlives the daemon on hosts where the kernel allows it.
  for (const s of [process.stdin, process.stdout, process.stderr])
    s.on("error", () => {});
  // Echo written bytes back over the control channel (not the PTY) so a
  // session.write is provable end-to-end from the parent's side.
  process.stdin.on("data", (chunk) =>
    send({ type: "ack", data: chunk.toString("base64") }),
  );
  process.stdin.resume();
  later(() => finish(${FIXTURE_EXIT.deadline}, "deadline"), ${deadlineMs});
  ctl = net.createConnection(CONTROL, () => {
    send({
      type: "hello",
      nonce: NONCE,
      instanceId,
      pid: process.pid,
      // Count only; names are not needed to prove the daemon stripped
      // control-plane context from the real grandchild environment.
      envLeaked: Object.keys(process.env).filter((k) => {
        const u = k.toUpperCase();
        return u.startsWith("ORCA_") || u.startsWith("DROGON_");
      }).length,
    });
    process.stdout.write("READY " + instanceId + "\\n");
    const alive = setInterval(() => send({ type: "alive" }), 200);
    timers.add(alive);
  });
  ctl.setNoDelay(true);
  ctl.on("error", () => {
    // A terminal exit code was already selected (e.g. shutdown/deadline);
    // that choice is the recorded evidence and must never be replaced by a
    // later, unrelated control error racing the same flush window.
    if (settled) return;
    // No control channel: this fixture can prove nothing about itself and
    // must not linger silently — die loudly with a distinct code.
    process.exit(${FIXTURE_EXIT.controlLost});
  });
  let buffer = "";
  ctl.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let cut;
    while ((cut = buffer.indexOf("\\n")) >= 0) {
      const line = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 1);
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.type === "ping") send({ type: "pong", t: msg.t });
      else if (msg.type === "shutdown") finish(msg.code ?? 0, "shutdown");
      else if (msg.type === "drop-control") ctl.destroy();
    }
  });
})();`;
}

/**
 * Parent-side control server. Observations about the fixture child (pongs,
 * acked stdin bytes, SIGHUP/SIGWINCH delivery, orderly shutdown) come from
 * this authenticated channel. A socket close here means ONLY "control lost"
 * — never process exit; exit evidence comes exclusively from the kernel
 * observer (see classifyChildState).
 */
export async function startControlServer({ controlPath, nonce }) {
  /** @type {Map<string, any>} */
  const children = new Map();
  /** @type {Set<import("node:net").Socket>} every connection, pre-auth too. */
  const allSockets = new Set();
  const helloWaiters = [];
  /** @type {Map<string, Map<string, {timer: NodeJS.Timeout, resolve: Function}>>} */
  const pongWaiters = new Map(); // instanceId -> token -> waiter
  /** @type {Map<string, Array<{timer: NodeJS.Timeout, resolve: Function}>>} */
  const closeWaiters = new Map(); // instanceId -> waiters
  let rejectedHandshakes = 0;
  let closeProof = null;

  const server = createServer((socket) => {
    allSockets.add(socket);
    socket.setNoDelay(true);
    let buffer = "";
    let record = null;
    let authenticated = false;
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let cut;
      while ((cut = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (!authenticated) {
          if (msg.type !== "hello" || msg.nonce !== nonce) {
            rejectedHandshakes += 1;
            socket.write(JSON.stringify({ type: "rejected" }) + "\n");
            socket.destroy();
            return;
          }
          authenticated = true;
          record = {
            instanceId: msg.instanceId,
            pid: msg.pid,
            envLeaked: msg.envLeaked ?? null,
            socket,
            events: [],
            acks: [],
            bye: null,
            closed: false,
            lastSeenAt: Date.now(),
          };
          children.set(msg.instanceId, record);
          for (const waiter of helloWaiters.splice(0)) {
            clearTimeout(waiter.timer);
            waiter.resolve(record);
          }
          continue;
        }
        record.lastSeenAt = Date.now();
        if (msg.type === "alive") continue;
        if (msg.type === "bye")
          record.bye = { code: msg.code, reason: msg.reason };
        else if (msg.type === "event") record.events.push(msg);
        else if (msg.type === "ack") record.acks.push(msg.data);
        else if (msg.type === "pong") {
          const waiters = pongWaiters.get(record.instanceId);
          const waiter = waiters?.get(msg.t);
          if (waiter) {
            waiters.delete(msg.t);
            clearTimeout(waiter.timer);
            waiter.resolve(true);
          }
        }
      }
    });
    const markClosed = () => {
      allSockets.delete(socket);
      if (!record || record.closed) return;
      record.closed = true;
      const waiters = closeWaiters.get(record.instanceId) ?? [];
      closeWaiters.delete(record.instanceId);
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.resolve(true);
      }
      const pendingPongs = pongWaiters.get(record.instanceId);
      if (pendingPongs) {
        for (const waiter of pendingPongs.values()) {
          clearTimeout(waiter.timer);
          waiter.resolve(false);
        }
        pongWaiters.delete(record.instanceId);
      }
    };
    socket.on("close", markClosed);
    socket.on("error", markClosed);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(controlPath, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const waitForHello = (timeoutMs) =>
    new Promise((resolve, reject) => {
      const existing = [...children.values()][0];
      if (existing) return resolve(existing);
      const waiter = {
        timer: setTimeout(() => {
          const index = helloWaiters.indexOf(waiter);
          if (index >= 0) helloWaiters.splice(index, 1);
          reject(
            new Error("Fixture child did not complete the nonce handshake"),
          );
        }, timeoutMs),
        resolve,
      };
      helloWaiters.push(waiter);
    });

  const ping = (instanceId, timeoutMs) =>
    new Promise((resolve) => {
      const record = children.get(instanceId);
      if (!record || record.closed) return resolve(false);
      // Unique token per request: same-millisecond pings must never collide.
      const token = randomUUID();
      let waiters = pongWaiters.get(instanceId);
      if (!waiters) {
        waiters = new Map();
        pongWaiters.set(instanceId, waiters);
      }
      const waiter = {
        timer: setTimeout(() => {
          waiters.delete(token);
          resolve(false);
        }, timeoutMs),
        resolve,
      };
      waiters.set(token, waiter);
      record.socket.write(JSON.stringify({ type: "ping", t: token }) + "\n");
    });

  const requestShutdown = (instanceId, code = 0) => {
    const record = children.get(instanceId);
    if (!record || record.closed) return false;
    record.socket.write(JSON.stringify({ type: "shutdown", code }) + "\n");
    return true;
  };

  const dropControl = (instanceId) => {
    const record = children.get(instanceId);
    if (!record || record.closed) return false;
    record.socket.write(JSON.stringify({ type: "drop-control" }) + "\n");
    return true;
  };

  /**
   * Resolves when the control channel closes. This is CONTROL LOSS ONLY —
   * never process-exit evidence. An unknown instanceId resolves
   * `{ known: false }` so callers cannot mislabel a missing record.
   */
  const waitClosed = (instanceId, timeoutMs) =>
    new Promise((resolve) => {
      const record = children.get(instanceId);
      if (!record) return resolve({ closed: false, bye: null, known: false });
      if (record.closed)
        return resolve({ closed: true, bye: record.bye, known: true });
      const waiter = {
        timer: setTimeout(() => {
          const waiters = closeWaiters.get(instanceId) ?? [];
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          resolve({ closed: false, bye: record.bye, known: true });
        }, timeoutMs),
        resolve: () => resolve({ closed: true, bye: record.bye, known: true }),
      };
      let waiters = closeWaiters.get(instanceId);
      if (!waiters) {
        waiters = [];
        closeWaiters.set(instanceId, waiters);
      }
      waiters.push(waiter);
    });

  /** Snapshot for reports: no nonce, no socket internals. */
  const listChildren = () =>
    [...children.values()].map((record) => ({
      instanceId: record.instanceId,
      pid: record.pid,
      envLeaked: record.envLeaked,
      closed: record.closed,
      bye: record.bye,
      events: record.events,
      ackCount: record.acks.length,
    }));

  /**
   * Bounded close with an honest proof: every socket (authenticated or not)
   * is tracked, and the returned `closed` reflects the tracked socket set
   * after the bound, never an assumed success. Idempotent: repeat calls
   * return the first proof.
   */
  const close = async (timeoutMs = 3000) => {
    if (closeProof) return closeProof;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    // Proof is captured here, before any disposal below, so freeing leftover
    // handles can never retroactively turn a FAILED proof into a PASSED one
    // or stand in for fixture-child exit evidence.
    closeProof = {
      closed: allSockets.size === 0,
      openSockets: allSockets.size,
      childHandshakes: children.size,
      rejectedHandshakes,
    };
    // Every socket still tracked missed the bound above; destroying our own
    // owned handles here only releases the calling process from an
    // indefinite hang (an open handle keeps the event loop alive forever) —
    // it is disposal of resources we own, not a claim about the remote
    // fixture child's state.
    for (const socket of [...allSockets]) socket.destroy();
    await rm(controlPath, { force: true });
    return closeProof;
  };

  return {
    children,
    listChildren,
    waitForHello,
    ping,
    requestShutdown,
    dropControl,
    waitClosed,
    close,
    get rejectedHandshakes() {
      return rejectedHandshakes;
    },
  };
}

/** Bounded wait for an owned ChildProcess exit event; no dangling listener. */
function waitChildExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null)
      return resolve({ code: child.exitCode, signal: child.signalCode });
    const onExit = (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    };
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolve(null);
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

// Capability requires a valid report and an observed clean probe exit.
export async function probeExitObserver(scriptPath, timeoutMs = 8000) {
  let child;
  try {
    child = spawn("python3", [scriptPath, "--probe"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
  } catch (error) {
    return {
      supported: false,
      reason: `python3 spawn failed: ${error.message}`,
    };
  }
  let spawnError = null;
  child.on("error", (error) => {
    spawnError = error;
  });
  let stderrTail = "";
  child.stderr.on("data", (chunk) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-400);
  });
  let stdoutBuffer = "";
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
  });
  // Reject paths must leave no owned process and no live timer behind.
  const cleanup = async (reason) => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }
    const exit = await waitChildExit(child, 2000);
    if (!exit) {
      // SIGKILL did not produce a confirmed reap within the bound: destroy
      // only the pipe handles this process owns so a stuck probe cannot
      // hang the caller. This never claims the probe process itself exited
      // — the reason below still says "unverifiable".
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
    }
    return {
      supported: false,
      reason: exit ? reason : `${reason}; probe cleanup unverifiable`,
    };
  };
  const deadline = Date.now() + timeoutMs;
  let line = null;
  let failure = null;
  while (Date.now() < deadline) {
    if (spawnError) {
      if (!child.pid)
        return {
          supported: false,
          reason: `python3 spawn failed: ${spawnError.message}`,
        };
      return cleanup(`python3 process error: ${spawnError.message}`);
    }
    const cut = stdoutBuffer.indexOf("\n");
    if (cut >= 0) {
      line = stdoutBuffer.slice(0, cut);
      break;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      failure = `probe exited before reporting (code ${child.exitCode}, signal ${child.signalCode})`;
      break;
    }
    await delay(25);
  }
  if (!line && !failure) failure = "observer probe timed out";
  if (failure) return cleanup(failure);
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    return cleanup(`probe output was not JSON: ${error.message}`);
  }
  const exit = await waitChildExit(child, timeoutMs);
  if (!exit) {
    return cleanup("probe process did not exit after reporting");
  }
  if (message.type === "unsupported") {
    // Exit code 2 is the documented unsupported/register-error contract
    // (see live-child-exit-observer.py); preserve the structured reason
    // instead of collapsing it into the generic nonzero-exit message below.
    if (exit.code !== 2)
      return cleanup(
        `probe reported unsupported but exited with code ${exit.code}`,
      );
    return { supported: false, reason: message.reason ?? "unsupported" };
  }
  if (message.type !== "capable" || exit.code !== 0) {
    return cleanup(
      `probe exited with code ${exit.code}` +
        (message.type !== "capable"
          ? ` (unexpected type ${message.type})`
          : ""),
    );
  }
  return { supported: true, mode: message.mode };
}

/**
 * Start a directly owned kernel-exit observer for `pid`. The observer is a
 * spawned ChildProcess (Python stdlib) with bounded shutdown and real
 * exit-event cleanup; every rejection path reaps the exact owned child, so
 * no handle is ever lost. `executable`/`args` are a test-only seam (defaults
 * unchanged); registration must happen only after the target proved itself
 * alive on the nonce-authenticated control channel.
 */
export async function startExitObserver(
  pid,
  {
    scriptPath,
    deadlineMs,
    executable = "python3",
    args,
    readyTimeoutMs = 8000,
  },
) {
  const child = spawn(executable, args ?? [scriptPath], {
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });
  let spawnError = null;
  let settled = false;
  /** @type {any | null} first parsed stdout line (ready/unsupported/...) */
  let firstMessage = null;
  /** @type {{type: string, at: number} | null} terminal observation */
  let result = null;
  let stdoutBuffer = "";
  let stderrTail = "";
  // Wakeable sleeps that remove themselves on their own timeout.
  const waiters = new Set();
  const waitForWake = (ms) =>
    new Promise((resolve) => {
      const entry = {
        timer: setTimeout(() => {
          waiters.delete(entry);
          resolve();
        }, ms),
        wake: () => {
          clearTimeout(entry.timer);
          waiters.delete(entry);
          resolve();
        },
      };
      waiters.add(entry);
    });
  const wake = () => {
    for (const entry of [...waiters]) entry.wake();
  };

  child.on("error", (error) => {
    spawnError = error;
    wake();
  });
  child.stdin.on("error", () => {
    // The observer may die before consuming config; its exit report is the
    // source of truth, not a pipe write failure.
  });
  child.stderr.on("data", (chunk) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-400);
  });
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
    let cut;
    while ((cut = stdoutBuffer.indexOf("\n")) >= 0) {
      const line = stdoutBuffer.slice(0, cut);
      stdoutBuffer = stdoutBuffer.slice(cut + 1);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (!firstMessage) firstMessage = message;
      if (
        !result &&
        [
          "exit",
          "timeout",
          "stopped",
          "unsupported",
          "register-error",
          "error",
        ].includes(message.type)
      )
        result = { type: message.type, at: Date.now() };
      wake();
    }
  });
  child.on("exit", () => {
    settled = true;
    if (!result)
      result = { type: "observer-ended-without-event", at: Date.now() };
    wake();
  });

  // Rejection paths must reap the exact owned observer: kill it if it is
  // somehow still alive, then bound-wait for its exit event (a failed spawn
  // has no process and resolves immediately).
  const cleanupAndThrow = async (message) => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }
    await waitChildExit(child, 2000);
    throw new Error(message);
  };

  // Hand the config over immediately: the observer reads it, registers, and
  // then prints its first report. Waiting for a report BEFORE writing config
  // would deadlock the pair.
  child.stdin.write(JSON.stringify({ pid, deadlineMs }) + "\n");

  // Startup settles on the first report, a spawn error, an early exit, or
  // the ready timeout — never repolls forever after the observer is gone.
  const startupDeadline = Date.now() + readyTimeoutMs;
  let startupError = null;
  while (!startupError && !firstMessage) {
    if (spawnError)
      startupError = `exit observer spawn failed: ${spawnError.message}`;
    else if (settled)
      startupError = `exit observer exited before ready (code ${child.exitCode}, signal ${child.signalCode})`;
    else if (Date.now() >= startupDeadline)
      startupError = "exit observer did not become ready";
    else await waitForWake(Math.min(50, startupDeadline - Date.now()));
  }
  if (startupError) await cleanupAndThrow(startupError);

  if (firstMessage.type !== "ready") {
    await cleanupAndThrow(
      `exit observer unavailable: ${firstMessage.type}${
        firstMessage.reason ? ` (${firstMessage.reason})` : ""
      }`,
    );
  }

  const waitExit = async (timeoutMs) => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (result) return result.type;
      await waitForWake(Math.min(50, Math.max(1, until - Date.now())));
    }
    return result?.type ?? "pending";
  };

  const stop = async (timeoutMs = 3000) => {
    if (!settled) {
      try {
        child.kill("SIGTERM");
      } catch {
        // already gone
      }
    }
    const exit = await waitChildExit(child, timeoutMs);
    if (exit)
      return {
        stopped: true,
        forced: false,
        via: result?.type ?? "exit-event",
        observerExit: exit,
      };
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
    const forcedExit = await waitChildExit(child, 1500);
    if (!forcedExit) {
      // Even SIGKILL did not produce a confirmed reap within the bound:
      // destroy only the pipe handles this process owns so a stuck observer
      // cannot hang the caller. This never claims the observer process
      // itself exited — `stopped` below stays false ("unverifiable").
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.stdin?.destroy();
      child.unref();
    }
    return {
      stopped: Boolean(forcedExit),
      forced: true,
      via: forcedExit ? "sigkill" : "unverifiable",
      observerExit: forcedExit,
    };
  };

  return {
    child,
    pid,
    mode: firstMessage.mode,
    get settled() {
      return settled;
    },
    get result() {
      return result;
    },
    waitExit,
    stop,
  };
}

/**
 * Pure cleanup verdict shared by the runner and its tests: any forced kill,
 * unverifiable proof, or untracked open socket fails the run — a forced
 * observer or daemon cleanup must never end PASSED with merely a retained
 * fixture.
 */
export function evaluateCleanupProof(cleanup) {
  let proven = true;
  for (const item of cleanup) {
    if (item.fixtureChild === "unverifiable") proven = false;
    if (
      typeof item.fixtureChildKernel === "string" &&
      item.fixtureChildKernel.startsWith("unverifiable")
    )
      proven = false;
    if (item.fixtureChildControl === "unverifiable") proven = false;
    if (item.service === "forced-exit-after-timeout") proven = false;
    if (item.observerForced === true || item.observerStopped === false)
      proven = false;
    if (
      item.controlCloseProof &&
      (!item.controlCloseProof.closed || item.controlCloseProof.openSockets > 0)
    )
      proven = false;
  }
  return { proven };
}

/**
 * Classify the fixture child's post-crash state by combining the two
 * independent channels inside a bounded window. Vocabulary is exactly
 * live / unverifiable / exited:
 *   - a kernel exit event proves exited;
 *   - a fresh pong proves live;
 *   - anything else — including control loss with a merely silent observer,
 *     which can stall and is not affirmative liveness — is unverifiable.
 * Never fabricates "exited".
 */
export async function classifyChildState({
  control,
  observer,
  instanceId,
  windowMs = 6000,
}) {
  const startedAt = Date.now();
  const until = startedAt + windowMs;
  let kernelExitAt = null;
  let lastPongAt = null;
  let controlLostAt = control.children.get(instanceId) ? null : startedAt;

  if (observer?.result?.type === "exit") kernelExitAt = observer.result.at;

  while (Date.now() < until && !kernelExitAt) {
    const record = control.children.get(instanceId);
    if (!record || record.closed) {
      if (!controlLostAt) controlLostAt = Date.now();
    } else if (await control.ping(instanceId, 300)) {
      lastPongAt = Date.now();
    }
    if (observer?.result?.type === "exit") kernelExitAt = observer.result.at;
    await delay(100);
  }
  if (observer?.result?.type === "exit") kernelExitAt = observer.result.at;

  const summary = { kernelExitAt, lastPongAt, controlLostAt, windowMs };
  if (kernelExitAt && lastPongAt && lastPongAt > kernelExitAt) {
    return {
      state: "unverifiable",
      reason: "kernel-exit-contradicts-later-pong",
      ...summary,
    };
  }
  if (kernelExitAt)
    return { state: "exited", reason: "kernel-observed-exit", ...summary };
  if (lastPongAt)
    return { state: "live", reason: "pong-and-no-kernel-exit", ...summary };
  if (controlLostAt)
    return {
      state: "unverifiable",
      reason: "control-lost-without-pong-or-kernel-exit",
      ...summary,
    };
  return {
    state: "unverifiable",
    reason: "no-pong-no-exit-within-window",
    ...summary,
  };
}
