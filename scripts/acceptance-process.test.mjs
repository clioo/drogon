import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { test } from "node:test";
import {
  startAcceptanceProcess,
  waitAcceptanceExit,
  stopAcceptanceProcess,
  captureDescendants,
  settleOwnedProcesses,
} from "./acceptance-process.mjs";

async function fixture(context, script) {
  const child = startAcceptanceProcess(process.execPath, ["-e", script], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  context.after(async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    assert.equal((await waitAcceptanceExit(child, 2000)).verdict, "exited");
  });
  await once(child.stdout, "data");
  return child;
}

test("process ownership can be captured and settled without workflow runtime helpers", async (context) => {
  const child = await fixture(context, 'process.stdout.write("ready"); setInterval(() => {}, 1000)');
  const owned = await captureDescendants([child.pid], new Map());
  assert.ok(owned.get(child.pid)?.includes(process.execPath));
  const verdicts = await settleOwnedProcesses(owned);
  assert.equal(verdicts.find((entry) => entry.pid === child.pid)?.verdict, "exited");
  assert.equal((await waitAcceptanceExit(child, 2000)).verdict, "exited");
});

test("captured descendants remain owned after their parent exits", async (context) => {
  const child = await fixture(context,
    'require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 15000)"], { stdio: "ignore" }); process.stdout.write("ready"); setInterval(() => {}, 1000)');
  const owned = new Map();
  try {
    await captureDescendants([child.pid], owned);
    assert.equal(owned.size, 2);
    assert.equal((await stopAcceptanceProcess(child)).verdict, "exited");
    const verdicts = await settleOwnedProcesses(owned);
    assert.ok(verdicts.every((entry) => entry.verdict === "exited"));
  } finally {
    await captureDescendants([child.pid], owned);
    await stopAcceptanceProcess(child);
    assert.ok((await settleOwnedProcesses(owned)).every((entry) => entry.verdict === "exited"));
  }
});

test("an identity mismatch never signals the process currently using that PID", async () => {
  const verdicts = await settleOwnedProcesses(new Map([[process.pid, "not this process identity"]]));
  assert.equal(verdicts[0].verdict, "exited");
  assert.doesNotThrow(() => process.kill(process.pid, 0));
});

test("a successful signal without an exit event remains unverifiable", async () => {
  const child = Object.assign(new EventEmitter(), {
    pid: 123,
    exitCode: null,
    signalCode: null,
    kill: () => true,
  });
  assert.deepEqual(
    await stopAcceptanceProcess(child, { graceMs: 5, forceMs: 5 }),
    {
      verdict: "unverifiable",
      forced: true,
    },
  );
  assert.equal(child.listenerCount("exit"), 0);
});

test("signal errors preserve an unverifiable cleanup result", async () => {
  const child = Object.assign(new EventEmitter(), {
    pid: 123,
    exitCode: null,
    signalCode: null,
    kill: () => {
      throw new Error("signal refused");
    },
  });
  assert.deepEqual(
    await stopAcceptanceProcess(child, { graceMs: 5, forceMs: 5 }),
    {
      verdict: "unverifiable",
      forced: false,
      error: "signal refused",
    },
  );
});

test("exit observation timeout does not mean the owned process exited", async (context) => {
  const child = await fixture(
    context,
    'process.stdout.write("ready"); setInterval(() => {}, 1000)',
  );
  assert.deepEqual(await waitAcceptanceExit(child, 20), {
    verdict: "unverifiable",
  });
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);
  assert.equal(child.listenerCount("exit"), 0);
});

test("observed normal exit preserves its real code and can be read again", async (context) => {
  const child = await fixture(
    context,
    'process.stdout.write("ready"); setTimeout(() => process.exit(7), 100)',
  );
  const observed = await waitAcceptanceExit(child, 2000);
  assert.deepEqual(observed, { verdict: "exited", code: 7, signal: null });
  assert.deepEqual(await waitAcceptanceExit(child, 20), observed);
});

test("orderly cleanup signals only its owned handle and observes exit", async (context) => {
  const child = await fixture(
    context,
    'process.stdout.write("ready"); setInterval(() => {}, 1000)',
  );
  const result = await stopAcceptanceProcess(child, {
    graceMs: 2000,
    forceMs: 1000,
  });
  assert.equal(result.verdict, "exited");
  assert.equal(result.forced, false);
});

test(
  "forced cleanup is reported even when the final exit is observed",
  {
    skip:
      process.platform === "win32"
        ? "Windows does not deliver Unix SIGTERM handlers"
        : false,
  },
  async (context) => {
    const child = await fixture(
      context,
      'process.on("SIGTERM", () => {}); process.stdout.write("ready"); setInterval(() => {}, 1000)',
    );
    const result = await stopAcceptanceProcess(child, {
      graceMs: 30,
      forceMs: 2000,
    });
    assert.equal(result.verdict, "exited");
    assert.equal(result.signal, "SIGKILL");
    assert.equal(result.forced, true);
  },
);
