// PERF-01e: the restart-readiness failure must say WHICH it was — a
// replacement that exited (with its own stderr), one answering-not-ok, or
// one unreachable — with attempts and elapsed time, never a bare string.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  describeChild,
  killOwnedDaemon,
  spawnRestartDaemon,
  waitForRestartedDaemon,
} from "./acceptance-daemon-restart.mjs";
import { startAcceptanceProcess, waitAcceptanceExit } from "./acceptance-process.mjs";

function script(context, name, body) {
  const dir = mkdtempSync(join(tmpdir(), "daemon-restart-"));
  context.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });
  const file = join(dir, name);
  writeFileSync(file, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(file, 0o700);
  return file;
}

async function sleeper(context) {
  const child = startAcceptanceProcess(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { stdio: "ignore" },
  );
  context.after(async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    assert.equal((await waitAcceptanceExit(child, 2000)).verdict, "exited");
  });
  return child;
}

test("ready daemon resolves with attempts and elapsed time", async (context) => {
  const cli = script(context, "cli-ok", `console.log(JSON.stringify({ ok: true }));`);
  const child = await sleeper(context);
  const result = await waitForRestartedDaemon(cli, "/nonexistent-dir", {
    child,
    stderrTail: () => "",
  });
  assert.equal(result.attempts, 1);
  assert.ok(result.elapsedMs >= 0);
});

test("answering-but-not-ok names the last response on the deadline", async (context) => {
  const cli = script(
    context,
    "cli-not-ok",
    `console.log(JSON.stringify({ ok: false, error: { message: "auth mismatch" } }));`,
  );
  const child = await sleeper(context);
  await assert.rejects(
    () =>
      waitForRestartedDaemon(cli, "/nonexistent-dir", { child, stderrTail: () => "" }, {
        timeoutMs: 400,
        attemptTimeoutMs: 1000,
        pollIntervalMs: 50,
      }),
    (error) => {
      assert.match(error.message, /restarted daemon never came up/);
      assert.match(error.message, /answering-but-not-ok|answered status but ok!=true/);
      assert.match(error.message, /auth mismatch/);
      assert.match(error.message, /status attempts/);
      assert.match(error.message, /alive \(pid \d+\)/);
      return true;
    },
  );
});

test("unreachable daemon reports the CLI failure, not readiness", async (context) => {
  const cli = script(
    context,
    "cli-down",
    `console.error("cannot connect: Connection refused"); process.exit(1);`,
  );
  const child = await sleeper(context);
  await assert.rejects(
    () =>
      waitForRestartedDaemon(cli, "/nonexistent-dir", { child, stderrTail: () => "" }, {
        timeoutMs: 300,
        attemptTimeoutMs: 1000,
        pollIntervalMs: 50,
      }),
    (error) => {
      assert.match(error.message, /restarted daemon never came up/);
      assert.match(error.message, /CLI failed/);
      assert.match(error.message, /cannot connect/);
      return true;
    },
  );
});

test("an exited replacement fails fast with its code and stderr", async (context) => {
  const cli = script(context, "cli-never", `process.exit(1);`);
  const daemon = script(
    context,
    "daemon-refuses",
    `console.error("another drogond instance already holds the exclusive lock"); process.exit(1);`,
  );
  const restarted = spawnRestartDaemon(daemon, "/nonexistent-dir");
  await assert.rejects(
    () => waitForRestartedDaemon(cli, "/nonexistent-dir", restarted, { timeoutMs: 5000 }),
    (error) => {
      assert.match(error.message, /exited before serving/);
      assert.match(error.message, /code=1/);
      assert.match(error.message, /already holds the exclusive lock/);
      return true;
    },
  );
  assert.match(describeChild(restarted.child), /exited \(code=1/);
});

test("spawned restart daemon captures stderr while alive", async (context) => {
  const daemon = script(
    context,
    "daemon-slow",
    `console.error("listening"); setInterval(() => {}, 1000);`,
  );
  const restarted = spawnRestartDaemon(daemon, "/nonexistent-dir");
  context.after(async () => {
    restarted.child.kill("SIGKILL");
    await waitAcceptanceExit(restarted.child, 2000);
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.match(describeChild(restarted.child), /alive \(pid \d+\)/);
  assert.match(restarted.stderrTail(), /listening/);
});

test("killOwnedDaemon proves the SIGKILLed process died", async (context) => {
  const child = await sleeper(context);
  const observed = await killOwnedDaemon(child, { exitTimeoutMs: 2000 });
  assert.equal(observed.verdict, "exited");
});

test("killOwnedDaemon reports a kill that never lands instead of proceeding", async () => {
  const { EventEmitter } = await import("node:events");
  const ghost = Object.assign(new EventEmitter(), {
    pid: 123456789,
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  await assert.rejects(
    () => killOwnedDaemon(ghost, { exitTimeoutMs: 30 }),
    /owned daemon did not die for the restart/,
  );
});
