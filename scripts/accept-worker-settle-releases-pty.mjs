// MIT Copyright (c) 2026 Lovecast Inc.
//
// A settled attempt must never leave a live PTY behind unnoticed. The exact
// hazard, end to end on the real daemon with fixture harnesses (never paid
// inference):
//
//   1. a worker reports `worker_done` (outcome succeeded) while its session
//      process KEEPS RUNNING — the dangerous state is settled-but-live,
//      and `worker-show` must say so honestly (`processVerdict: live`);
//   2. `worker-stop` on that settled attempt must REFUSE with
//      `attempt_settled` — never answer ok while signalling nothing;
//   3. the refusal alone leaves the PTY live, so the coordinator's only
//      cleanup is `worker-release`, which must signal the process and
//      report `disposition: released` / `processVerdict: exited`;
//   4. the terminal list must then show the session exited — no live PTY
//      remains for a revoked, reported dispatch.
//
// If any link breaks — stop returns ok on a settled attempt, release stops
// signalling, the report loses its outcome, or the live session is
// misreported — this journey fails. Run:
// node scripts/accept-worker-settle-releases-pty.mjs

import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { scrubInheritedDispatchBindings } from "./acceptance-process.mjs";

// This journey owns a disposable daemon: drop the parent dispatch context so
// its CLI never presents a foreign credential to its own daemon.
scrubInheritedDispatchBindings();

const root = fileURLToPath(new URL("..", import.meta.url));
const target = path.join(root, "target", "debug");
const cli = path.join(target, "drogon-cli");
const drogond = path.join(target, "drogond");
const startedAt = new Date().toISOString();
const report = {
  kind: "worker-settle-releases-pty",
  status: "FAILED",
  startedAt,
  checks: [],
  cleanup: [],
};

function fixturePi() {
  return `#!/bin/sh
model=""
next=""
for arg in "$@"; do
  case "$next" in
    model) model="$arg"; next=""; continue ;;
  esac
  case "$arg" in
    --model) next=model ;;
  esac
done
if [ "$model" = "linger-after-report" ]; then
  "$DROGON_CLI_COMMAND" --data-dir "$DROGON_DATA_DIR" --json orchestration send \\
    --kind worker_done --subject "fixture report" --outcome succeeded \\
    --result '{"summary":"fixture worker report"}' --body "fixture worker completion" > "report-$DROGON_DISPATCH_ID.json"
  sleep 300
fi
sleep 300
`;
}

function spawnChild(file, args, env) {
  const child = spawn(file, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (bytes) => {
    stdout += bytes.toString();
  });
  child.stderr.on("data", (bytes) => {
    stderr += bytes.toString();
  });
  return { child, stdout: () => stdout, stderr: () => stderr };
}

function waitExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      reject(new Error("process did not exit in time"));
    }, timeoutMs);
    const onExit = (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    };
    child.once("exit", onExit);
  });
}

async function main() {
  const sandbox = await mkdtemp(path.join(tmpdir(), "drogon-settle-pty-"));
  const dataDir = path.join(sandbox, "data");
  const home = path.join(sandbox, "home");
  const workspace = path.join(sandbox, "workspace");
  const fixtureBin = path.join(sandbox, "bin");
  await Promise.all([
    mkdir(dataDir, { recursive: true }),
    mkdir(home, { recursive: true }),
    mkdir(workspace, { recursive: true }),
    mkdir(fixtureBin, { recursive: true }),
  ]);
  await writeFile(path.join(fixtureBin, "pi"), fixturePi(), "utf8");
  await chmod(path.join(fixtureBin, "pi"), 0o755);
  report.sandbox = sandbox;

  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i.test(key)) delete env[key];
  }
  env.HOME = home;
  env.PATH = `${fixtureBin}:/usr/bin:/bin`;
  env.DROGON_DATA_DIR = dataDir;
  scrubInheritedDispatchBindings(env);

  const daemonSpawn = spawnChild(drogond, ["--data-dir", dataDir], env);
  const daemon = daemonSpawn.child;
  daemon.on("error", () => {});
  report.cleanup.push(`drogond pid=${daemon.pid ?? "unknown"}`);

  async function cliJson(args) {
    const spawned = spawnChild(cli, ["--data-dir", dataDir, "--json", ...args], env);
    await waitExit(spawned.child, 30_000);
    const envelope = JSON.parse(spawned.stdout());
    assert.equal(envelope.ok, true, `drogon-cli ${args.join(" ")}: ${spawned.stdout()}`);
    return envelope.result;
  }

  async function cliRaw(args) {
    const spawned = spawnChild(cli, ["--data-dir", dataDir, "--json", ...args], env);
    await waitExit(spawned.child, 30_000);
    return JSON.parse(spawned.stdout());
  }

  try {
    const readyDeadline = Date.now() + 30_000;
    let hostId = null;
    while (hostId === null) {
      try {
        hostId = (await cliJson(["status"])).hostId;
      } catch (error) {
        if (Date.now() >= readyDeadline) throw error;
        await delay(200);
      }
    }

    const added = await cliJson(["workspace", "add", workspace, "--name", "settle-pty"]);
    const workspaceId = added.id;
    await cliJson([
      "rpc",
      "graph.write_intent",
      "--params",
      JSON.stringify({
        workspaceId,
        intent: {
          nodes: [],
          policy: {
            delegate: true,
            approvedRuntimes: [{ harness: "pi", model: "linger-after-report", provider: "p" }],
          },
        },
      }),
    ]);
    const createdRun = await cliJson([
      "orchestration",
      "run-create",
      "--objective",
      "settle then release the pty",
      "--host",
      hostId,
    ]);
    const run = createdRun.run;
    const scope = [
      "--run",
      run.runId,
      "--coordinator-id",
      run.coordinatorId,
      "--consumer-generation",
      String(run.consumerGeneration),
    ];
    const created = await cliJson([
      "orchestration",
      "task-create",
      ...scope,
      "--spec",
      "Report success, then keep running.",
      "--task-title",
      "linger",
    ]);
    const taskId = created.task.taskId;
    const started = await cliJson([
      "orchestration",
      "worker-start",
      ...scope,
      "--task",
      taskId,
      "--workspace",
      workspaceId,
      "--timeout-ms",
      "15000",
      "--harness",
      "pi",
      "--model",
      "linger-after-report",
    ]);
    const dispatchId = started.dispatchId;
    assert.ok(dispatchId, JSON.stringify(started));

    // 1+2. The report settles the attempt while the process stays live.
    const settledDeadline = Date.now() + 30_000;
    let shown = null;
    for (;;) {
      shown = await cliJson(["orchestration", "worker-show", ...scope, "--dispatch", dispatchId]);
      if (shown.outcome === "succeeded") break;
      if (Date.now() >= settledDeadline) {
        throw new Error(`worker never reported: ${JSON.stringify(shown)}`);
      }
      await delay(200);
    }
    assert.equal(
      shown.processVerdict,
      "live",
      `a reported-but-lingering worker must read live, not exited: ${JSON.stringify(shown)}`,
    );
    report.sessionId = shown.sessionIdentity?.sessionId;
    assert.ok(report.sessionId, JSON.stringify(shown));
    report.checks.push("reported-attempt-reads-succeeded-but-live");

    // 3. worker-stop must refuse the settled attempt, never answer ok.
    const stop = await cliRaw(["orchestration", "worker-stop", ...scope, "--dispatch", dispatchId]);
    assert.equal(stop.ok, false, `stop on a settled attempt must refuse: ${JSON.stringify(stop)}`);
    assert.equal(stop.error?.code, "attempt_settled", JSON.stringify(stop));
    report.checks.push("stop-on-settled-attempt-refuses-attempt-settled");

    // 4. The refusal signals nothing: the session is still live. A stop
    //    that answered ok here would be the lie this journey exists to
    //    catch — the PTY would leak with no owner.
    const listed = await cliJson(["terminal", "list", "--workspace", workspaceId]);
    const live = (listed.sessions ?? []).find((item) => item.id === report.sessionId);
    assert.ok(live, `the reported session must still be listed: ${JSON.stringify(listed)}`);
    assert.equal(live.verdict, "live", JSON.stringify(live));
    report.checks.push("refused-stop-leaves-the-pty-live");

    // 5+6. worker-release is the cleanup: it signals the process and the
    //    session reads exited afterwards.
    const released = await cliJson([
      "orchestration",
      "worker-release",
      ...scope,
      "--dispatch",
      dispatchId,
    ]);
    assert.equal(released.disposition, "released", JSON.stringify(released));
    assert.equal(released.processVerdict, "exited", JSON.stringify(released));
    report.checks.push("release-signals-the-lingering-process");

    const finallyListed = await cliJson(["terminal", "list", "--workspace", workspaceId]);
    const done = (finallyListed.sessions ?? []).find((item) => item.id === report.sessionId);
    assert.ok(done, JSON.stringify(finallyListed));
    assert.equal(done.verdict, "exited", JSON.stringify(done));
    report.checks.push("no-live-pty-remains-for-the-reported-dispatch");

    report.status = "PASS";
  } finally {
    daemon.kill("SIGTERM");
    try {
      await waitExit(daemon, 10_000);
      report.cleanup.push("drogond exited after SIGTERM");
    } catch {
      daemon.kill("SIGKILL");
      report.cleanup.push("drogond required SIGKILL");
    }
  }

  if (report.status !== "PASS") process.exitCode = 1;
  console.log(JSON.stringify(report, null, 2));
}

await main();
