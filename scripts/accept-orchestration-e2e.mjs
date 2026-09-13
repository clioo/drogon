// MIT Copyright (c) 2026 Lovecast Inc.
//
// Native orchestration dogfood: the real drogon-cli drives the real drogond
// daemon, while a fixture `pi` executable stands in for model inference. The
// journey proves the default policy launch, exact provider/model propagation,
// structured worker briefs, durable worker_done settlement, and retry
// failover without credentials or a paid provider.
//
// Run: node scripts/accept-orchestration-e2e.mjs

import assert from "node:assert/strict";
import {
  access,
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("..", import.meta.url));
const target = path.join(root, "target", "debug");
const cli = path.join(target, "drogon-cli");
const drogond = path.join(target, "drogond");
const startedAt = new Date().toISOString();
const report = {
  kind: "orchestration-e2e",
  status: "FAILED",
  startedAt,
  checks: [],
  cheapModel: {
    requested: "pi --provider openai-codex --model gpt-5.6-luna --thinking low",
    status: "not-run",
    reason:
      "AGENTS.md forbids real model inference from validation; every scenario uses a shell fixture with the same Drogon CLI boundary.",
  },
  cleanup: [],
};

const sleep = (ms) => delay(ms);

function sanitizedEnv(overrides = {}) {
  const env = { ...process.env };
  // This probe is intentionally fixture-only. Do not pass provider credentials
  // or bearer tokens into the daemon, its child, or the fixture harness.
  for (const key of Object.keys(env)) {
    if (/(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i.test(key)) {
      delete env[key];
    }
  }
  env.HOME = overrides.HOME ?? env.HOME;
  env.PATH = overrides.PATH ?? "/usr/bin:/bin";
  return { ...env, ...overrides };
}

function captureProcess(child) {
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  return {
    child,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

async function waitExit(captured, timeoutMs = 30_000) {
  if (captured.child.exitCode !== null || captured.child.signalCode !== null) {
    return { code: captured.child.exitCode, signal: captured.child.signalCode };
  }
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `process did not exit within ${timeoutMs}ms\nstderr=${captured.stderr}`,
        ),
      );
    }, timeoutMs);
    captured.child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    captured.child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function runProcess(file, args, options = {}) {
  const captured = captureProcess(
    spawn(file, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? sanitizedEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  const exit = await waitExit(captured, options.timeoutMs ?? 30_000);
  if (exit.code !== 0) {
    throw new Error(
      `${path.basename(file)} ${args.join(" ")} exited ${exit.code ?? exit.signal}\nstdout=${captured.stdout}\nstderr=${captured.stderr}`,
    );
  }
  return captured.stdout;
}

async function processSnapshot() {
  const text = await runProcess("/bin/ps", ["-axo", "pid=,ppid=,command="], {
    env: sanitizedEnv({ PATH: "/usr/bin:/bin" }),
  });
  return text.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) return [];
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    if (!Number.isInteger(pid) || pid === process.pid) return [];
    return [{ pid, ppid, command: match[3] }];
  });
}

async function ownedProcessTree(rootPid) {
  const snapshot = await processSnapshot();
  const direct = snapshot.find((entry) => entry.pid === rootPid);
  const owned = new Map([
    [
      rootPid,
      direct ?? {
        pid: rootPid,
        ppid: 0,
        command: "drogond (direct child)",
      },
    ],
  ]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of snapshot) {
      if (!owned.has(entry.pid) && owned.has(entry.ppid)) {
        owned.set(entry.pid, entry);
        changed = true;
      }
    }
  }
  return [...owned.values()];
}

async function ensureBinaries() {
  try {
    await runProcess(cli, ["--version"]);
    await runProcess(drogond, ["--help"]);
  } catch {
    await runProcess(
      "cargo",
      ["build", "--locked", "-p", "drogon-cli", "-p", "drogond"],
      {
        timeoutMs: 300_000,
        env: sanitizedEnv({ PATH: process.env.PATH ?? "/usr/bin:/bin" }),
      },
    );
  }
}

function fixtureScript() {
  return `#!/bin/sh
set -eu
model=""
provider=""
next=""
for arg in "$@"; do
  case "$next" in
    model) model="$arg"; next=""; continue ;;
    provider) provider="$arg"; next=""; continue ;;
  esac
  case "$arg" in
    --model) next=model ;;
    --provider) next=provider ;;
  esac
done
# Keep the whole argv, including the structured first-turn brief, as fixture
# evidence. The real worker cwd is the registered disposable workspace.
dispatch="\${DROGON_DISPATCH_ID:-missing}"
printf 'provider=%s model=%s dispatch=%s\\n' "$provider" "$model" "$dispatch" > "fixture-$dispatch.txt"
printf '%s\\n' "$@" >> "fixture-$dispatch.txt"
printf 'DROGON-FIXTURE-READY dispatch=%s\\n' "$dispatch"
# Direct headless harness probes have no dispatch credential and must not
# attempt a worker report; they only expose the first-turn argv to the probe.
if [ -z "\${DROGON_DISPATCH_ID:-}" ]; then
  touch "direct-$model.done"
  exit 0
fi
if [ "$model" = "fixture-unreported" ]; then
  touch "unreported-$dispatch"
  exit 0
fi
if [ "$model" = "fixture-ask" ]; then
  set +e
  "$DROGON_CLI_COMMAND" --data-dir "$DROGON_DATA_DIR" --json orchestration ask \\
    --question "Need coordinator approval" --timeout-ms 100 > "ask-$dispatch.json" 2>&1
  set -e
  message_id=$(sed -n 's/.*"messageId"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' "ask-$dispatch.json" | head -1)
  if [ -z "$message_id" ]; then exit 2; fi
  printf '%s\\n' "$message_id" > "ask-$dispatch.id"
  touch "ask-ready-$dispatch"
  while [ ! -f "coordinator-replied-$dispatch" ]; do sleep 0.05; done
  "$DROGON_CLI_COMMAND" --data-dir "$DROGON_DATA_DIR" --json orchestration ask \\
    --resume "$message_id" --timeout-ms 5000 > "ask-resumed-$dispatch.json"
  outcome=succeeded
else
  case "$model" in
    fixture-fail) outcome=failed ;;
    fixture-success) outcome=succeeded ;;
    *) outcome=failed ;;
  esac
fi
result='{"modifiedFiles":["fixture-'"$dispatch"'.txt"],"artifacts":["fixture-'"$dispatch"'.txt"],"summary":"fixture worker report"}'
"$DROGON_CLI_COMMAND" --data-dir "$DROGON_DATA_DIR" --json orchestration send \\
  --kind worker_done --subject "fixture $model" --outcome "$outcome" \\
  --body "fixture worker completion" --result "$result" > "report-$dispatch.json"
printf '%s\\n' "$?" > "report-$dispatch.exit"
touch "done-$dispatch"
exit 0
`;
}

async function writeFixture(binDir) {
  await mkdir(binDir, { recursive: true });
  const script = fixtureScript();
  for (const harness of ["pi", "claude", "opencode"]) {
    const file = path.join(binDir, harness);
    await writeFile(file, script, "utf8");
    await chmod(file, 0o755);
  }
}

async function waitForFile(file, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(file);
      return;
    } catch {
      await sleep(50);
    }
  }
  throw new Error(`fixture did not create ${file} before timeout`);
}

async function probeCheapModelAvailability() {
  try {
    await runProcess("pi", ["--version"], {
      env: sanitizedEnv({ PATH: process.env.PATH ?? "/usr/bin:/bin" }),
      timeoutMs: 5_000,
    });
    report.cheapModel.availability = "binary-present";
  } catch (error) {
    report.cheapModel.availability = "unavailable";
    report.cheapModel.probeError =
      error instanceof Error ? error.message : String(error);
  }
}

async function main() {
  await probeCheapModelAvailability();
  await ensureBinaries();
  // macOS often gives os.tmpdir() a long per-user path; the daemon's Unix
  // socket has a strict SUN_LEN limit, so keep this disposable root short.
  const scratchRoot = process.env.DROGON_E2E_TMPDIR ?? "/tmp";
  const sandbox = await mkdtemp(
    path.join(scratchRoot, "drogon-orchestration-e2e-"),
  );
  const dataDir = path.join(sandbox, "data");
  const home = path.join(sandbox, "home");
  const workspace = path.join(sandbox, "workspace");
  const fixtureBin = path.join(sandbox, "bin");
  await Promise.all([
    mkdir(dataDir, { recursive: true }),
    mkdir(home, { recursive: true }),
    mkdir(workspace, { recursive: true }),
  ]);
  await writeFixture(fixtureBin);

  const env = sanitizedEnv({
    HOME: home,
    PATH: `${fixtureBin}:/usr/bin:/bin`,
    DROGON_DATA_DIR: dataDir,
  });
  const daemonCapture = captureProcess(
    spawn(drogond, ["--data-dir", dataDir], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  report.dataDir = dataDir;
  report.workspace = workspace;

  async function cliJson(args, { allowFailure = false } = {}) {
    const captured = captureProcess(
      spawn(cli, ["--data-dir", dataDir, "--json", ...args], {
        cwd: root,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    const exit = await waitExit(captured, 30_000);
    let envelope;
    try {
      envelope = JSON.parse(captured.stdout);
    } catch (error) {
      throw new Error(
        `invalid drogon-cli JSON for ${args.join(" ")}: ${error.message}\nstdout=${captured.stdout}\nstderr=${captured.stderr}`,
      );
    }
    if (!allowFailure && (exit.code !== 0 || envelope.ok !== true)) {
      throw new Error(
        `drogon-cli ${args.join(" ")} failed\n${JSON.stringify(envelope, null, 2)}\nstderr=${captured.stderr}`,
      );
    }
    return { ...envelope, exitCode: exit.code, stderr: captured.stderr };
  }

  try {
    const readyDeadline = Date.now() + 30_000;
    while (true) {
      try {
        const status = await cliJson(["status"]);
        report.hostId = status.result.hostId;
        break;
      } catch (error) {
        if (Date.now() >= readyDeadline) throw error;
        await sleep(200);
      }
    }

    const added = await cliJson([
      "workspace",
      "add",
      workspace,
      "--name",
      "orchestration-e2e",
    ]);
    const workspaceId = added.result.id;
    report.workspaceId = workspaceId;
    const writePolicy = async (policy) => {
      await cliJson([
        "rpc",
        "graph.write_intent",
        "--params",
        JSON.stringify({ workspaceId, intent: { nodes: [], policy } }),
      ]);
    };
    await writePolicy({
      delegate: true,
      approvedRuntimes: [
        { harness: "pi", model: "fixture-fail", provider: "fixture-provider" },
      ],
      fallbackRuntime: {
        harness: "pi",
        model: "fixture-success",
        provider: "fixture-fallback",
      },
      adversarial: { enabled: false, maxIterations: 1 },
    });
    report.checks.push("registered workspace and wrote policy");

    const createdRun = await cliJson([
      "orchestration",
      "run-create",
      "--objective",
      "fixture policy dispatch",
      "--host",
      report.hostId,
    ]);
    const run = createdRun.result.run;
    const scope = [
      "--run",
      run.runId,
      "--coordinator-id",
      run.coordinatorId,
      "--consumer-generation",
      String(run.consumerGeneration),
    ];
    async function createTask(instructions, title = "Policy worker fixture") {
      const created = await cliJson([
        "orchestration",
        "task-create",
        ...scope,
        "--spec",
        instructions,
        "--task-title",
        title,
      ]);
      return created.result.task.taskId;
    }

    async function startWorker(taskId, retryOf) {
      const args = [
        "orchestration",
        "worker-start",
        ...scope,
        "--task",
        taskId,
        "--workspace",
        workspaceId,
        "--timeout-ms",
        "15000",
      ];
      if (retryOf) args.push("--retry-of", retryOf);
      // No --harness/--model/--provider: this is the product's default policy path.
      return (await cliJson(args)).result;
    }

    async function waitForSettled(dispatchId, requireExited = false) {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const shown = await cliJson([
          "orchestration",
          "worker-show",
          ...scope,
          "--dispatch",
          dispatchId,
        ]);
        const result = shown.result;
        if (
          (result.outcome ||
            ["failed", "completed"].includes(result.assignmentState)) &&
          (!requireExited || result.processVerdict === "exited")
        )
          return result;
        await sleep(100);
      }
      throw new Error(`worker ${dispatchId} did not settle before timeout`);
    }

    async function waitForExitedWithoutReport(dispatchId) {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const shown = await cliJson([
          "orchestration",
          "worker-show",
          ...scope,
          "--dispatch",
          dispatchId,
        ]);
        const result = shown.result;
        if (result.outcome) {
          throw new Error(
            `worker ${dispatchId} reported unexpectedly: ${JSON.stringify(result)}`,
          );
        }
        if (result.processVerdict === "exited") return result;
        await sleep(100);
      }
      throw new Error(
        `worker ${dispatchId} did not become exited without a report`,
      );
    }

    const taskId = await createTask(
      "Create the fixture artifact and report completion.",
    );
    const first = await startWorker(taskId);
    const firstShown = await waitForSettled(first.dispatchId);
    assert.equal(firstShown.launch.harnessId, "pi");
    assert.equal(firstShown.launch.provider, "fixture-provider");
    assert.equal(firstShown.launch.model, "fixture-fail");
    assert.equal(firstShown.outcome, "failed");
    assert.equal(firstShown.reportResult.summary, "fixture worker report");
    const firstEvidence = await readFile(
      path.join(workspace, `fixture-${first.dispatchId}.txt`),
      "utf8",
    );
    assert.match(firstEvidence, /provider=fixture-provider model=fixture-fail/);
    assert.match(firstEvidence, /Drogon task:/);
    assert.match(firstEvidence, /DROGON WORKER BRIEF/);
    assert.match(firstEvidence, /worker_done/);
    report.checks.push(
      "scenario a: default worker-start selected the approved provider/model and settled worker_done",
    );

    const second = await startWorker(taskId, first.dispatchId);
    const secondShown = await waitForSettled(second.dispatchId);
    assert.equal(secondShown.launch.harnessId, "pi");
    assert.equal(secondShown.launch.provider, "fixture-fallback");
    assert.equal(secondShown.launch.model, "fixture-success");
    assert.equal(secondShown.outcome, "succeeded");
    assert.equal(
      secondShown.reportResult.modifiedFiles[0],
      `fixture-${second.dispatchId}.txt`,
    );
    const secondEvidence = await readFile(
      path.join(workspace, `fixture-${second.dispatchId}.txt`),
      "utf8",
    );
    assert.match(
      secondEvidence,
      /provider=fixture-fallback model=fixture-success/,
    );
    const task = await cliJson([
      "orchestration",
      "task-show",
      ...scope,
      "--task",
      taskId,
    ]);
    assert.equal(task.result.task.status, "completed");
    report.checks.push(
      "scenario b: retry advanced to fallback and durable task completion was recorded",
    );

    // Scenario c: three independent policy workers run concurrently. Each
    // report is attributed to its own dispatch; no PTY output is used as the
    // completion signal.
    await writePolicy({
      delegate: true,
      approvedRuntimes: [
        {
          harness: "pi",
          model: "fixture-success",
          provider: "fixture-provider",
        },
      ],
      fallbackRuntime: null,
      adversarial: { enabled: false, maxIterations: 1 },
    });
    const concurrentTasks = await Promise.all(
      ["one", "two", "three"].map((name) =>
        createTask(`Create concurrent fixture ${name}.`, `Concurrent ${name}`),
      ),
    );
    const concurrentStarts = await Promise.all(
      concurrentTasks.map((id) => startWorker(id)),
    );
    const concurrentResults = await Promise.all(
      concurrentStarts.map((start) => waitForSettled(start.dispatchId, true)),
    );
    assert.equal(
      new Set(concurrentStarts.map((start) => start.dispatchId)).size,
      3,
    );
    for (const result of concurrentResults) {
      assert.equal(result.outcome, "succeeded");
      assert.equal(result.processVerdict, "exited");
      assert.equal(result.launch.provider, "fixture-provider");
    }
    report.checks.push(
      "scenario c: three concurrent workers produced three attributed exited reports",
    );

    // Scenario d: a worker's first ask times out, the coordinator replies,
    // and the same question is resumed before the worker reports completion.
    await writePolicy({
      delegate: true,
      approvedRuntimes: [
        { harness: "pi", model: "fixture-ask", provider: "fixture-provider" },
      ],
      fallbackRuntime: null,
      adversarial: { enabled: false, maxIterations: 1 },
    });
    const askTask = await createTask(
      "Ask for approval, then finish the fixture task.",
      "Ask fixture",
    );
    const askStart = await startWorker(askTask);
    await waitForFile(path.join(workspace, `ask-ready-${askStart.dispatchId}`));
    const askEnvelope = JSON.parse(
      await readFile(
        path.join(workspace, `ask-${askStart.dispatchId}.json`),
        "utf8",
      ),
    );
    const questionId = askEnvelope.messageId ?? askEnvelope.result?.messageId;
    assert.ok(
      questionId,
      `ask did not return a message id: ${JSON.stringify(askEnvelope)}`,
    );
    assert.equal(askEnvelope.timedOut ?? askEnvelope.result?.timedOut, true);
    await cliJson([
      "orchestration",
      "reply",
      ...scope,
      "--id",
      questionId,
      "--body",
      "approved by fixture coordinator",
    ]);
    await writeFile(
      path.join(workspace, `coordinator-replied-${askStart.dispatchId}`),
      "ok\n",
    );
    const askResult = await waitForSettled(askStart.dispatchId, true);
    assert.equal(askResult.outcome, "succeeded");
    const resumed = JSON.parse(
      await readFile(
        path.join(workspace, `ask-resumed-${askStart.dispatchId}.json`),
        "utf8",
      ),
    );
    assert.equal(
      resumed.answer ?? resumed.result?.answer,
      "approved by fixture coordinator",
    );
    report.checks.push(
      "scenario d: ask timeout, coordinator reply, and same-question resume completed",
    );

    // Scenario e: a worker exits without worker_done. The coordinator sees an
    // exited process with no outcome, never a fabricated success.
    await writePolicy({
      delegate: true,
      approvedRuntimes: [
        {
          harness: "pi",
          model: "fixture-unreported",
          provider: "fixture-provider",
        },
      ],
      fallbackRuntime: null,
      adversarial: { enabled: false, maxIterations: 1 },
    });
    const unreportedTask = await createTask(
      "Exit without sending a completion report.",
      "Unreported fixture",
    );
    const unreportedStart = await startWorker(unreportedTask);
    await waitForFile(
      path.join(workspace, `unreported-${unreportedStart.dispatchId}`),
    );
    const unreported = await waitForExitedWithoutReport(
      unreportedStart.dispatchId,
    );
    assert.equal(unreported.processVerdict, "exited");
    assert.equal(unreported.outcome, undefined);
    const unreportedCheck = await cliJson([
      "orchestration",
      "check",
      ...scope,
      "--peek",
      "--kinds",
      "worker_done",
    ]);
    const checkedMessages = unreportedCheck.result.messages ?? [];
    assert.equal(
      checkedMessages.some((message) =>
        String(message.subject ?? "").includes("fixture-unreported"),
      ),
      false,
    );
    await cliJson([
      "orchestration",
      "worker-abandon",
      ...scope,
      "--dispatch",
      unreportedStart.dispatchId,
      "--reason",
      "fixture exited without worker_done",
    ]);
    report.checks.push(
      "scenario e: a worker without worker_done remained outcome-less, check found no final report, and it was observed exited",
    );

    // Scenario f: Claude and OpenCode get the same first-turn context through
    // their adapter-specific worker delivery mechanisms, still using fixture
    // CLIs and the mandatory worker_done report.
    const adapterDispatches = [];
    for (const harness of ["claude", "opencode"]) {
      await writePolicy({
        delegate: true,
        approvedRuntimes: [{ harness, model: "fixture-success" }],
        fallbackRuntime: null,
        adversarial: { enabled: false, maxIterations: 1 },
      });
      const adapterTask = await createTask(
        `Use the ${harness} adapter fixture and report completion.`,
        `${harness} adapter fixture`,
      );
      const adapterStart = await startWorker(adapterTask);
      const adapterResult = await waitForSettled(adapterStart.dispatchId, true);
      const adapterEvidence = await readFile(
        path.join(workspace, `fixture-${adapterStart.dispatchId}.txt`),
        "utf8",
      );
      assert.equal(adapterResult.outcome, "succeeded");
      assert.match(adapterEvidence, /=== DROGON WORKER BRIEF ===/);
      assert.match(adapterEvidence, /Drogon orchestration context:/);
      assert.match(adapterEvidence, /Exact instructions/);
      adapterDispatches.push(adapterStart.dispatchId);
    }
    report.checks.push(
      "scenario f: Claude and OpenCode fixture workers received turn-one Drogon context",
    );

    report.dispatches = [
      first.dispatchId,
      second.dispatchId,
      ...concurrentStarts.map((start) => start.dispatchId),
      askStart.dispatchId,
      unreportedStart.dispatchId,
      ...adapterDispatches,
    ];
    report.taskId = taskId;
    report.status = "PASS";
  } finally {
    let descendants = [];
    try {
      descendants = await ownedProcessTree(daemonCapture.child.pid);
      report.processes = { beforeShutdown: descendants };
    } catch (error) {
      report.cleanup.push(
        `could not enumerate owned processes before shutdown: ${error.message}`,
      );
    }

    let daemonExit = null;
    if (
      daemonCapture.child.exitCode === null &&
      daemonCapture.child.signalCode === null
    ) {
      daemonCapture.child.kill("SIGTERM");
      try {
        daemonExit = await waitExit(daemonCapture, 10_000);
      } catch (error) {
        report.cleanup.push(`daemon did not exit cleanly: ${error.message}`);
        if (
          daemonCapture.child.exitCode === null &&
          daemonCapture.child.signalCode === null
        ) {
          daemonCapture.child.kill("SIGKILL");
          daemonExit = await waitExit(daemonCapture, 5_000).catch(() => null);
        }
      }
    } else {
      daemonExit = {
        code: daemonCapture.child.exitCode,
        signal: daemonCapture.child.signalCode,
      };
    }
    if (daemonExit)
      report.cleanup.push(
        `drogond exited code=${daemonExit.code ?? "null"} signal=${daemonExit.signal ?? "none"}`,
      );

    // A daemon exit does not prove its worker descendants exited. Recheck the
    // exact identities captured in the process tree, then signal only those
    // same identities (never a broad executable-name kill).
    let remaining = [];
    try {
      const sameOwnedProcesses = async () => {
        const snapshot = await processSnapshot();
        return descendants.filter((owned) =>
          snapshot.some(
            (current) =>
              current.pid === owned.pid && current.command === owned.command,
          ),
        );
      };
      const deadline = Date.now() + 5_000;
      do {
        remaining = await sameOwnedProcesses();
        if (remaining.length === 0 || Date.now() >= deadline) break;
        await sleep(100);
      } while (true);
      for (const survivor of remaining) {
        const current = (await sameOwnedProcesses()).find(
          (entry) =>
            entry.pid === survivor.pid && entry.command === survivor.command,
        );
        if (current) process.kill(current.pid, "SIGTERM");
      }
      const afterTerm = Date.now() + 2_000;
      do {
        remaining = await sameOwnedProcesses();
        if (remaining.length === 0 || Date.now() >= afterTerm) break;
        await sleep(100);
      } while (true);
      for (const survivor of remaining) {
        const current = (await sameOwnedProcesses()).find(
          (entry) =>
            entry.pid === survivor.pid && entry.command === survivor.command,
        );
        if (current) process.kill(current.pid, "SIGKILL");
      }
      remaining = await sameOwnedProcesses();
      report.processes.afterShutdown = remaining;
      if (remaining.length > 0) {
        report.cleanup.push(
          `owned survivors are unverifiable: ${remaining.map(({ pid }) => pid).join(",")}`,
        );
        report.status = "FAILED";
      }
    } catch (error) {
      report.cleanup.push(
        `could not verify owned process cleanup: ${error.message}`,
      );
      report.status = "FAILED";
    }

    report.daemonStderr = daemonCapture.stderr.slice(-4000);
    if (
      report.status === "PASS" &&
      (!report.processes?.afterShutdown ||
        report.processes.afterShutdown.length === 0)
    ) {
      await rm(sandbox, { recursive: true, force: true });
    } else {
      report.debugSandbox = sandbox;
    }
  }
}

try {
  await main();
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "PASS") process.exitCode = 1;
}
