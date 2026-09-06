// Unit tests for the live-child crash fixture: control channel, kernel exit
// observer, and the combined classifier. These run with node --test and need
// NO drogon daemon: they prove the harness itself has teeth (respawn
// detection, no false exit from silence or from control loss, bounded
// self-deadline, SIGHUP handling, nonce rejection, close proof, unique ping
// tokens) so the daemon-backed acceptance run can rely on its observations.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { createConnection } from "node:net";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runAcceptanceProcess } from "./acceptance-process.mjs";
import {
  buildFixtureProgram,
  classifyChildState,
  evaluateCleanupProof,
  probeExitObserver,
  startControlServer,
  startExitObserver,
} from "./live-child-crash-fixture.mjs";

const observerScript = fileURLToPath(
  new URL("./live-child-exit-observer.py", import.meta.url),
);

async function withControlServer(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "dg-fixture-test-"));
  const controlPath = path.join(dir, "control.sock");
  const nonce = randomBytes(32).toString("hex");
  const control = await startControlServer({ controlPath, nonce });
  try {
    return await fn({ control, controlPath, nonce, dir });
  } finally {
    await control.close(2000);
    await rm(dir, { recursive: true, force: true });
  }
}

/** Raw protocol client for negative/positive teeth checks. */
function connectRaw(controlPath) {
  const socket = createConnection(controlPath);
  const messages = [];
  const waiters = [];
  let buffer = "";
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
      messages.push(msg);
      // A protocol-conformant test double answers pings like the real fixture.
      if (msg.type === "ping")
        socket.write(JSON.stringify({ type: "pong", t: msg.t }) + "\n");
      for (let i = waiters.length - 1; i >= 0; i -= 1) {
        if (waiters[i].predicate(msg)) {
          waiters[i].resolve(msg);
          waiters.splice(i, 1);
        }
      }
    }
  });
  return {
    socket,
    messages,
    send: (obj) => socket.write(JSON.stringify(obj) + "\n"),
    next: (predicate, timeoutMs = 3000) =>
      new Promise((resolve, reject) => {
        const existing = messages.find(predicate);
        if (existing) return resolve(existing);
        const timer = setTimeout(() => {
          const index = waiters.findIndex((w) => w.resolve === resolve);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error("Timed out waiting for a protocol message"));
        }, timeoutMs);
        waiters.push({
          predicate,
          resolve: (msg) => {
            clearTimeout(timer);
            resolve(msg);
          },
        });
      }),
    end: () => socket.end(),
    destroy: () => socket.destroy(),
  };
}

async function spawnFixture(controlPath, nonce, deadlineMs = 30_000) {
  const child = spawn(
    process.execPath,
    ["-e", buildFixtureProgram({ controlPath, nonce, deadlineMs })],
    { stdio: "ignore", shell: false },
  );
  child.spawnError = null;
  child.on("error", (error) => {
    child.spawnError = error;
  });
  return child;
}

function waitChildExit(child, timeoutMs = 8000) {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve, reject) => {
    const onExit = (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    };
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      reject(new Error("Fixture child did not exit within bound"));
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

test("real fixture child completes handshake, round-trips ping, and orderly shutdown proves control close", async () => {
  await withControlServer(async ({ control, controlPath, nonce }) => {
    const child = await spawnFixture(controlPath, nonce);
    try {
      const hello = await control.waitForHello(5000);
      assert.ok(hello.instanceId);
      assert.equal(typeof hello.pid, "number");
      assert.equal(control.rejectedHandshakes, 0);
      assert.equal(await control.ping(hello.instanceId, 2000), true);
      control.requestShutdown(hello.instanceId, 0);
      // This is CONTROL CLOSE evidence, not process-exit evidence; the kernel
      // observer carries exit authority in the acceptance run.
      const closed = await control.waitClosed(hello.instanceId, 5000);
      assert.equal(closed.closed, true);
      assert.equal(closed.known, true);
      assert.deepEqual(closed.bye, { code: 0, reason: "shutdown" });
      const exit = await waitChildExit(child, 5000);
      assert.equal(exit.code, 0);
      assert.equal(exit.signal, null);
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await waitChildExit(child, 3000).catch(() => {});
    }
  });
});

test("wrong nonce is rejected and never registers a child", async () => {
  await withControlServer(async ({ control, controlPath }) => {
    const client = connectRaw(controlPath);
    try {
      client.send({
        type: "hello",
        nonce: "wrong-nonce",
        instanceId: "fake",
        pid: 1,
      });
      const reply = await client.next((m) => m.type === "rejected", 3000);
      assert.ok(reply);
      await delay(150);
      assert.equal(control.children.size, 0);
      assert.equal(control.rejectedHandshakes, 1);
    } finally {
      client.destroy();
    }
  });
});

test("respawn detector has teeth: two handshakes register two children", async () => {
  await withControlServer(async ({ control, controlPath, nonce }) => {
    const first = connectRaw(controlPath);
    const second = connectRaw(controlPath);
    try {
      first.send({ type: "hello", nonce, instanceId: "child-a", pid: 101 });
      second.send({ type: "hello", nonce, instanceId: "child-b", pid: 102 });
      await delay(200);
      assert.equal(
        control.children.size,
        2,
        "A respawned second child is countable",
      );
      const listed = control.listChildren().map((record) => record.instanceId);
      assert.deepEqual(listed.sort(), ["child-a", "child-b"]);
      // The acceptance assertion `children.size === 1` would fail on this
      // observed state — the detector cannot be satisfied by a false single.
      first.end();
      second.end();
      await delay(150);
    } finally {
      first.destroy();
      second.destroy();
    }
  });
});

test("an open silent connection never produces a control close; only a real close does", async () => {
  await withControlServer(async ({ control, controlPath, nonce }) => {
    const client = connectRaw(controlPath);
    try {
      client.send({ type: "hello", nonce, instanceId: "silent", pid: 103 });
      await delay(150);
      const silent = await control.waitClosed("silent", 500);
      assert.equal(silent.closed, false);
      assert.equal(
        await control.ping("silent", 1000),
        true,
        "Silent child is still live",
      );
      client.destroy();
      const closed = await control.waitClosed("silent", 3000);
      assert.equal(closed.closed, true, "Observed close after real disconnect");
      assert.equal(
        closed.bye,
        null,
        "A disconnect has no orderly bye — and none is invented",
      );
    } finally {
      client.destroy();
    }
  });
});

test("waitClosed on a missing record is never mislabeled as closed or exited", async () => {
  await withControlServer(async ({ control }) => {
    const result = await control.waitClosed("never-heard-of", 300);
    assert.equal(result.closed, false);
    assert.equal(result.known, false);
    assert.equal(result.bye, null);
  });
});

test("self-shutdown deadline bounds a child nobody cleaned up", async () => {
  await withControlServer(async ({ control, controlPath, nonce }) => {
    const child = await spawnFixture(controlPath, nonce, 1500);
    try {
      const hello = await control.waitForHello(5000);
      // Nobody sends shutdown: the child's own deadline must end it, provably.
      const closed = await control.waitClosed(hello.instanceId, 8000);
      assert.equal(closed.closed, true);
      assert.equal(closed.bye.code, 92);
      assert.equal(closed.bye.reason, "deadline");
      const exit = await waitChildExit(child, 5000);
      assert.equal(exit.code, 92);
      assert.equal(exit.signal, null, "Deadline exit is voluntary, not a kill");
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await waitChildExit(child, 3000).catch(() => {});
    }
  });
});

test("SIGHUP is recorded without killing the fixture child", async () => {
  await withControlServer(async ({ control, controlPath, nonce }) => {
    const child = await spawnFixture(controlPath, nonce);
    try {
      const hello = await control.waitForHello(5000);
      child.kill("SIGHUP");
      const until = Date.now() + 3000;
      while (Date.now() < until) {
        const record = control.children.get(hello.instanceId);
        if (record.events.some((event) => event.name === "sighup")) break;
        await delay(50);
      }
      assert.ok(
        control.children
          .get(hello.instanceId)
          .events.some((event) => event.name === "sighup"),
        "SIGHUP was not reported by the fixture child",
      );
      assert.equal(
        await control.ping(hello.instanceId, 2000),
        true,
        "Fixture child must survive SIGHUP",
      );
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await waitChildExit(child, 3000).catch(() => {});
    }
  });
});

test("simultaneous pings carry unique tokens and all resolve", async () => {
  await withControlServer(async ({ control, controlPath, nonce }) => {
    const client = connectRaw(controlPath);
    try {
      client.send({ type: "hello", nonce, instanceId: "pinger", pid: 104 });
      await delay(150);
      const answers = await Promise.all([
        control.ping("pinger", 2000),
        control.ping("pinger", 2000),
        control.ping("pinger", 2000),
        control.ping("pinger", 2000),
        control.ping("pinger", 2000),
      ]);
      assert.deepEqual(answers, [true, true, true, true, true]);
    } finally {
      client.destroy();
    }
  });
});

test("close proof reports an unauthenticated open connection instead of claiming success", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "dg-fixture-test-"));
  const controlPath = path.join(dir, "control.sock");
  const nonce = randomBytes(32).toString("hex");
  const control = await startControlServer({ controlPath, nonce });
  const dangling = connectRaw(controlPath);
  try {
    await delay(150); // let the connection land, never authenticated
    const proof = await control.close(800);
    assert.equal(
      proof.closed,
      false,
      "An open socket must not be reported closed",
    );
    assert.equal(proof.openSockets, 1);
    assert.equal(proof.childHandshakes, 0);
    assert.equal(proof.rejectedHandshakes, 0);
  } finally {
    dangling.destroy();
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing Python reports unsupported without crashing the caller", async () => {
  const emptyPath = await mkdtemp(path.join(tmpdir(), "dg-no-python-"));
  try {
    const moduleUrl = new URL("./live-child-crash-fixture.mjs", import.meta.url)
      .href;
    const { stdout } = await runAcceptanceProcess(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { probeExitObserver } from ${JSON.stringify(moduleUrl)};
       console.log(JSON.stringify(await probeExitObserver(${JSON.stringify(observerScript)}, 1000)));`,
      ],
      { env: { ...process.env, PATH: emptyPath }, timeout: 5000 },
    );
    const result = JSON.parse(stdout);
    assert.equal(result.supported, false);
    assert.match(result.reason, /spawn.*ENOENT/);
  } finally {
    await rm(emptyPath, { recursive: true, force: true });
  }
});

test("kernel exit observer probe is supported on this Unix host", async () => {
  const probe = await probeExitObserver(observerScript);
  assert.equal(
    probe.supported,
    true,
    `observer unsupported: ${probe.reason ?? "unknown"}`,
  );
  assert.ok(["kqueue-proc", "pidfd"].includes(probe.mode));
});

test("kernel exit observer reports a real process exit and stops cleanly", async () => {
  const target = spawn(
    process.execPath,
    ["-e", "setTimeout(()=>process.exit(0),300)"],
    {
      stdio: "ignore",
      shell: false,
    },
  );
  try {
    await delay(100); // target alive at registration
    const observer = await startExitObserver(target.pid, {
      scriptPath: observerScript,
      deadlineMs: 10_000,
    });
    assert.equal(await observer.waitExit(5000), "exit");
    const stopped = await observer.stop(3000);
    assert.equal(stopped.stopped, true);
    assert.equal(stopped.forced, false);
  } finally {
    if (target.exitCode === null && target.signalCode === null)
      target.kill("SIGKILL");
    await waitChildExit(target, 3000).catch(() => {});
  }
});

test("kernel exit observer timeout never fabricates exit", async () => {
  const target = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    stdio: "ignore",
    shell: false,
  });
  try {
    const observer = await startExitObserver(target.pid, {
      scriptPath: observerScript,
      deadlineMs: 600,
    });
    assert.equal(await observer.waitExit(4000), "timeout");
    assert.equal(
      await controlSafeAlive(target),
      true,
      "Target must be untouched",
    );
    const stopped = await observer.stop(3000);
    assert.equal(stopped.stopped, true);
  } finally {
    if (target.exitCode === null && target.signalCode === null)
      target.kill("SIGKILL");
    await waitChildExit(target, 3000).catch(() => {});
  }
});

async function controlSafeAlive(child) {
  return child.exitCode === null && child.signalCode === null;
}

test("kernel exit observer refuses an already-gone pid as register-error, not exit", async () => {
  const target = spawn(process.execPath, ["-e", "process.exit(0)"], {
    stdio: "ignore",
    shell: false,
  });
  await waitChildExit(target, 5000);
  await assert.rejects(
    startExitObserver(target.pid, {
      scriptPath: observerScript,
      deadlineMs: 1000,
    }),
    /unavailable: register-error/,
  );
});

test("classifier: kernel-observed exit beats control loss", async () => {
  await withControlServer(async ({ control, controlPath, nonce }) => {
    const child = await spawnFixture(controlPath, nonce);
    try {
      const hello = await control.waitForHello(5000);
      assert.equal(await control.ping(hello.instanceId, 2000), true);
      const observer = await startExitObserver(hello.pid, {
        scriptPath: observerScript,
        deadlineMs: 15_000,
      });
      try {
        // The test owns this child directly: SIGKILL via its exact handle.
        child.kill("SIGKILL");
        const verdict = await classifyChildState({
          control,
          observer,
          instanceId: hello.instanceId,
          windowMs: 5000,
        });
        assert.equal(verdict.state, "exited");
        assert.equal(verdict.reason, "kernel-observed-exit");
        assert.ok(verdict.kernelExitAt);
      } finally {
        const stopped = await observer.stop(3000);
        assert.equal(stopped.stopped, true);
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await waitChildExit(child, 3000).catch(() => {});
    }
  });
});

test("classifier: control drop while alive with only a silent observer is unverifiable, never exited, and the pid is never signaled", async () => {
  await withControlServer(async ({ control, controlPath, nonce }) => {
    const child = await spawnFixture(controlPath, nonce, 15_000);
    try {
      const hello = await control.waitForHello(5000);
      assert.equal(await control.ping(hello.instanceId, 2000), true);
      const observer = await startExitObserver(hello.pid, {
        scriptPath: observerScript,
        deadlineMs: 20_000,
      });
      try {
        control.dropControl(hello.instanceId);
        const closed = await control.waitClosed(hello.instanceId, 3000);
        assert.equal(closed.closed, true, "Control channel closed");
        // A merely silent (unsettled) observer is not affirmative liveness:
        // it can stall, so control loss without a pong or kernel event must
        // classify unverifiable — only live/unverifiable/exited exist.
        const verdict = await classifyChildState({
          control,
          observer,
          instanceId: hello.instanceId,
          windowMs: 3000,
        });
        assert.equal(verdict.state, "unverifiable");
        assert.equal(
          verdict.reason,
          "control-lost-without-pong-or-kernel-exit",
        );
        // The process behind the authenticated handshake is still running:
        // no stale-PID signal was ever sent (the harness has no such path).
        assert.equal(child.exitCode, null);
        assert.equal(child.signalCode, null);
      } finally {
        const stopped = await observer.stop(3000);
        assert.equal(stopped.stopped, true);
      }
    } finally {
      // The test owns this child directly: teardown via its exact handle.
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await waitChildExit(child, 3000).catch(() => {});
    }
  });
});

test("classifier: no observer and control loss is unverifiable, never exited", async () => {
  await withControlServer(async ({ control }) => {
    const verdict = await classifyChildState({
      control,
      observer: null,
      instanceId: "ghost",
      windowMs: 800,
    });
    assert.equal(verdict.state, "unverifiable");
    assert.equal(verdict.reason, "control-lost-without-pong-or-kernel-exit");
  });
});

test("observer startup settles when the observer exits before ready, reaping the owned child", async () => {
  const began = Date.now();
  await assert.rejects(
    startExitObserver(process.pid, {
      scriptPath: observerScript,
      deadlineMs: 100,
      // Test seam: a script that prints nothing and exits immediately.
      args: ["/dev/null"],
    }),
    /exited before ready \(code 0, signal null\)/,
  );
  assert.ok(Date.now() - began < 5000, "startup rejection must be bounded");
});

test("observer startup timeout reaps a stalling observer", async () => {
  const began = Date.now();
  await assert.rejects(
    startExitObserver(process.pid, {
      scriptPath: observerScript,
      deadlineMs: 100,
      args: ["-c", "import time; time.sleep(30)"],
      readyTimeoutMs: 400,
    }),
    /did not become ready/,
  );
  const elapsed = Date.now() - began;
  assert.ok(elapsed >= 400, "startup must wait out its ready timeout");
  assert.ok(elapsed < 8000, "stall rejection plus reap must be bounded");
});

test("unavailable observer executable rejects without a lost handle", async () => {
  const began = Date.now();
  await assert.rejects(
    startExitObserver(process.pid, {
      scriptPath: observerScript,
      deadlineMs: 100,
      executable: "dg-missing-observer-python-xyz",
      readyTimeoutMs: 1000,
    }),
    /spawn failed/,
  );
  assert.ok(
    Date.now() - began < 8000,
    "spawn-failure rejection must be bounded",
  );
});

test("cleanup verdict: forced observer or daemon cleanup fails the run", () => {
  const healthy = [
    { service: "exited", reason: "intentional-sigkill-fixture" },
    { fixtureChildControl: "closed (shutdown)" },
    { fixtureChildKernel: "exited (kernel-observed)" },
    { observerStop: "exit", observerStopped: true, observerForced: false },
    { service: "exited (SIGTERM)" },
    {
      controlCloseProof: {
        closed: true,
        openSockets: 0,
        childHandshakes: 1,
        rejectedHandshakes: 0,
      },
    },
  ];
  assert.equal(
    evaluateCleanupProof(healthy).proven,
    true,
    "Healthy cleanup must prove",
  );
  assert.equal(
    evaluateCleanupProof([
      ...healthy,
      { observerStop: "sigkill", observerStopped: true, observerForced: true },
    ]).proven,
    false,
    "Forced observer stop must fail the run, not merely retain the fixture",
  );
  assert.equal(
    evaluateCleanupProof([...healthy, { service: "forced-exit-after-timeout" }])
      .proven,
    false,
    "Forced daemon cleanup must fail the run",
  );
  assert.equal(
    evaluateCleanupProof([
      ...healthy,
      { fixtureChildKernel: "unverifiable (kernel: pending)" },
    ]).proven,
    false,
    "Unverifiable child exit must fail the run",
  );
  assert.equal(
    evaluateCleanupProof([
      ...healthy,
      {
        controlCloseProof: {
          closed: false,
          openSockets: 1,
          childHandshakes: 0,
          rejectedHandshakes: 0,
        },
      },
    ]).proven,
    false,
    "Untracked open sockets must fail the run",
  );
  assert.equal(
    evaluateCleanupProof([...healthy, { observerStopped: false }]).proven,
    false,
    "An observer that could not be stopped must fail the run",
  );
});
