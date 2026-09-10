// Unit tests for the native PTY serial-green probe. The cargo invocation is
// injected (runOnce seam / fake cargo binary), so these run in seconds and
// never touch a real PTY suite; the live matrix itself is produced by running
// the probe for real (evidence lands under .preflight/acceptance/native-pty-serial-*).

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  NATIVE_PTY_SUITES,
  parseArgs,
  runNativePtySerial,
  runSuiteOnce,
} from "./probe-native-pty-serial.mjs";

test("the suite list pins the PTY-timing-sensitive native suites", () => {
  const names = NATIVE_PTY_SUITES.map((entry) => entry.suite);
  for (const required of [
    "native_worker_lifecycle",
    "exit-observation",
    "engine",
    "quick_session_delete_lifecycle",
    "terminal_wait",
  ]) {
    assert.ok(names.includes(required), `${required} must stay covered`);
  }
  for (const entry of NATIVE_PTY_SUITES) {
    assert.ok(entry.crate === "drogon-core" || entry.crate === "drogon-cli");
    assert.match(entry.suite, /^[\w-]+$/, "suite names must be bare binaries");
  }
});

test("every suite runs serially and a green matrix yields GREEN evidence", async () => {
  const calls = [];
  const output = await mkdtemp(path.join(tmpdir(), "pty-serial-"));
  try {
    const evidence = await runNativePtySerial({
      iterations: 2,
      output,
      runOnce: async (entry) => {
        calls.push(entry);
        return {
          ...entry,
          exitCode: 0,
          summary: `test result: ok. 3 passed; 0 failed for ${entry.suite}`,
          durationMs: 1,
          failure: null,
        };
      },
    });
    assert.equal(evidence.verdict, "GREEN");
    assert.equal(evidence.iterations, 2);
    assert.equal(evidence.testThreads, 1);
    assert.equal(calls.length, 2 * NATIVE_PTY_SUITES.length);
    const written = JSON.parse(
      await readFile(path.join(output, "native-pty-serial.json"), "utf8"),
    );
    assert.equal(written.kind, "native-pty-serial");
    assert.equal(written.cells.length, 2 * NATIVE_PTY_SUITES.length);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("a suite failing on any single iteration fails the probe (no retry laundering)", async () => {
  let first = true;
  await assert.rejects(
    runNativePtySerial({
      iterations: 2,
      suites: [{ crate: "drogon-core", suite: "engine" }],
      runOnce: async (entry) => {
        if (first) {
          first = false;
          return {
            ...entry,
            exitCode: 101,
            summary: "test result: FAILED. 2 passed; 1 failed",
            failure: "panicked",
          };
        }
        return {
          ...entry,
          exitCode: 0,
          summary: "test result: ok. 3 passed",
          failure: null,
        };
      },
    }),
    /failed on serial iteration 1/,
  );
});

test("an empty suite list is refused outright (no evidence is no pass)", async () => {
  await assert.rejects(
    runNativePtySerial({
      iterations: 1,
      suites: [],
      runOnce: async () => {
        throw new Error("no suites must be run");
      },
    }),
    /empty suite list/,
  );
});

test("parseArgs accepts iterations/output and rejects unknown flags", () => {
  assert.deepEqual(parseArgs(["--iterations", "3", "--output", "/tmp/x"]), {
    iterations: 3,
    output: "/tmp/x",
  });
  assert.throws(() => parseArgs(["--bogus"]), /unknown argument/);
});

test("runSuiteOnce invokes cargo with --test-threads=1 and offline env", async () => {
  // runSuiteOnce is a thin wrapper over runAcceptanceProcess; a fake cargo on
  // an explicit path records the exact argv it was handed, and the assertion
  // reads it back out of the recorded summary.
  const dir = await mkdtemp(path.join(tmpdir(), "pty-fakecargo-"));
  const fakeCargo = path.join(dir, "cargo");
  await writeFile(
    fakeCargo,
    `#!/bin/sh
echo "test result: ok. ARGV=$* OFFLINE=$CARGO_NET_OFFLINE"
`,
    { mode: 0o755 },
  );
  try {
    const cell = await runSuiteOnce(
      { cargoBin: fakeCargo, crate: "drogon-core", suite: "engine" },
      process.env,
    );
    assert.equal(cell.exitCode, 0);
    assert.match(cell.summary, /test result: ok/);
    assert.match(cell.summary, /--test-threads=1/);
    assert.match(cell.summary, /--test engine/);
    assert.match(cell.summary, /-p drogon-core/);
    assert.match(cell.summary, /OFFLINE=true/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runSuiteOnce converts a failing cargo run into a recorded red cell", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pty-failcargo-"));
  const failing = path.join(dir, "cargo");
  await writeFile(
    failing,
    `#!/bin/sh
echo 'test result: FAILED. 0 passed; 1 failed' >&2
exit 101
`,
    { mode: 0o755 },
  );
  try {
    const cell = await runSuiteOnce(
      { cargoBin: failing, crate: "drogon-core", suite: "engine" },
      process.env,
    );
    assert.equal(cell.exitCode, 101);
    assert.match(cell.summary, /FAILED/);
    assert.ok(cell.failure);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
