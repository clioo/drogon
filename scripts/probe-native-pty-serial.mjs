// Native PTY serial-green probe (track2 lifecycle/packaged wave).
//
// Characterizes the native PTY test suites by repeating them SERIALLY
// (`--test-threads=1`, never weakened, never skipped) and recording a
// per-suite × per-iteration verdict matrix as durable evidence. A suite that
// passes on repetition N but failed on an earlier one is reported as FLAKY —
// the probe always fails when any cell fails, so this harness can only
// strengthen the suite's guarantees, never mask a defect behind a retry.
//
// Scope note: these suites are exactly the ones whose assertions ride on real
// PTY timing (fork/exec under a pty, EOF/reap races, kernel exit observation):
// serial green is the project's stated requirement for them, and the loop
// gives the flake-hunt a bounded, reproducible evidence artifact instead of a
// "works on my machine" claim.
//
// Usage:
//   node scripts/probe-native-pty-serial.mjs [--iterations N] [--output <dir>]
// Env:
//   DROGON_PTY_SERIAL_ITERATIONS  default iteration count (CLI flag wins)
//   CARGO                         cargo binary (default "cargo")

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAcceptanceProcess } from "./acceptance-process.mjs";

/** The PTY-timing-sensitive native suites, with their crate. Every entry is
 * run serially; the list is explicit so a renamed test binary fails loudly
 * here instead of silently shrinking the evidence. */
export const NATIVE_PTY_SUITES = [
  { crate: "drogon-core", suite: "native_worker_lifecycle" },
  { crate: "drogon-core", suite: "exit-observation" },
  { crate: "drogon-core", suite: "engine" },
  { crate: "drogon-core", suite: "session_restart_record" },
  { crate: "drogon-core", suite: "session-persistence" },
  { crate: "drogon-core", suite: "agent_state_hook_events" },
  { crate: "drogon-core", suite: "harness_agent_hooks_opencode_pi" },
  { crate: "drogon-core", suite: "session_parent_nesting" },
  { crate: "drogon-core", suite: "session_env_shim" },
  { crate: "drogon-core", suite: "headless_runs" },
  { crate: "drogon-core", suite: "quick_session_delete_lifecycle" },
  { crate: "drogon-core", suite: "native_attempt_cancel_reopen" },
  { crate: "drogon-core", suite: "native_bot_run_shell_fixture" },
  { crate: "drogon-core", suite: "native_worker_retention" },
  { crate: "drogon-core", suite: "native-release" },
  { crate: "drogon-cli", suite: "terminal_wait" },
];

export function parseArgs(argv) {
  const args = { iterations: undefined, output: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--iterations") {
      args.iterations = Number(argv[i + 1]);
      i += 1;
    } else if (argv[i] === "--output") {
      args.output = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`unknown argument ${argv[i]}`);
    }
  }
  return args;
}

/** One serial cargo invocation for a single suite. Exposed as a seam so the
 * unit tests can inject deterministic suite outcomes without running cargo. */
export async function runSuiteOnce(
  { cargoBin = "cargo", crate, suite },
  env = process.env,
) {
  const startedAt = Date.now();
  // --test-threads=1 is the whole point: the PTY suites must be proven green
  // serially, and CARGO_NET_OFFLINE matches the documented gate invocation.
  // The generous timeout/maxBuffer absorb a cold cargo build of the suite
  // under test; a real hang still fails closed through the bounded timeout.
  let stdout = "";
  let exitCode = 0;
  let failure = null;
  try {
    const result = await runAcceptanceProcess(
      cargoBin,
      ["test", "-p", crate, "--test", suite, "--", "--test-threads=1"],
      {
        env: { ...env, CARGO_NET_OFFLINE: "true" },
        timeout: 180_000,
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    stdout = result.stdout;
  } catch (error) {
    exitCode = typeof error.code === "number" ? error.code : 1;
    failure = error;
    stdout = [error.stdout, error.stderr, error.message]
      .filter(Boolean)
      .join("\n");
  }
  const summaryMatch = stdout.match(/test result: .*/);
  return {
    crate,
    suite,
    exitCode,
    summary: summaryMatch ? summaryMatch[0].trim() : stdout.slice(-2000),
    durationMs: Date.now() - startedAt,
    failure: failure ? String(failure.message ?? failure) : null,
  };
}

/** The probe body: `iterations` serial passes over every suite, each pass in
 * the same order (fresh process per invocation, so stateful leaks between
 * suites cannot hide behind shared-process reuse). */
export async function runNativePtySerial({
  iterations,
  suites = NATIVE_PTY_SUITES,
  output,
  cargoBin,
  env = process.env,
  runOnce = runSuiteOnce,
}) {
  const resolvedIterations =
    iterations ??
    Number(env.DROGON_PTY_SERIAL_ITERATIONS ?? "1");
  assert.ok(
    Number.isSafeInteger(resolvedIterations) && resolvedIterations >= 1,
    "iterations must be a positive integer",
  );
  assert.ok(suites.length >= 1, "an empty suite list is no evidence at all");
  const results = [];
  for (let iteration = 1; iteration <= resolvedIterations; iteration += 1) {
    for (const entry of suites) {
      const cell = await runOnce({ cargoBin, ...entry }, env);
      // A retry harness that swallow failures would be exactly the
      // "weakened assert" this wave forbids: record, then fail hard.
      assert.equal(
        cell.exitCode,
        0,
        `native PTY suite ${entry.crate}/${entry.suite} failed on serial ` +
          `iteration ${iteration}:\n${cell.summary}`,
      );
      results.push({ iteration, ...cell });
    }
  }
  const evidence = {
    kind: "native-pty-serial",
    iterations: resolvedIterations,
    testThreads: 1,
    suites: suites.map((entry) => `${entry.crate}/${entry.suite}`),
    cells: results,
    verdict:
      results.length === resolvedIterations * suites.length ? "GREEN" : "INCOMPLETE",
  };
  if (output) {
    await mkdir(output, { recursive: true });
    await writeFile(
      path.join(output, "native-pty-serial.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    return { ...evidence, outputDir: output };
  }
  return evidence;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const root = fileURLToPath(new URL("..", import.meta.url));
  const evidence = await runNativePtySerial({
    iterations: args.iterations,
    output:
      args.output ??
      path.join(root, ".preflight", "acceptance", `native-pty-serial-${Date.now()}`),
  });
  console.log(
    JSON.stringify({
      verdict: evidence.verdict,
      iterations: evidence.iterations,
      cells: evidence.cells.length,
      suites: evidence.suites.length,
    }),
  );
}
