// MIT Copyright (c) 2026 Lovecast Inc.
//
// Opt-in real-harness dogfood for orchestration. Unlike the CI-safe fixture
// journey, this starts real Pi sessions with the owner's explicitly approved
// cheap lane and records bounded, redacted evidence outside the repository.
//
// Run only with:
//   DROGON_E2E_REAL_HARNESS=1 node scripts/e2e-orchestration-real.mjs
//
// This file is deliberately never called by CI. It refuses to run without the
// opt-in so a normal validation command cannot spend provider quota.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("..", import.meta.url));
const target = path.join(root, "target", "debug");
const cli = path.join(target, "drogon-cli");
const drogond = path.join(target, "drogond");
const realModel = {
  harness: "pi",
  provider: "openai-codex",
  model: "gpt-5.6-luna",
  effort: "low",
  argv: "pi --provider openai-codex --model gpt-5.6-luna --thinking low",
};

const sleep = (ms) => delay(ms);
const startedAt = new Date().toISOString();
const report = {
  kind: "orchestration-real-harness-e2e",
  status: "FAILED",
  startedAt,
  optIn: true,
  model: realModel,
  scenarios: [],
  cleanup: [],
};

function envForRealRun(overrides = {}) {
  // Keep the user's provider authentication available to the explicitly
  // authorized Pi lane, while putting Drogon state in this run's disposable
  // directory. No environment value is copied into the report.
  const env = {
    ...process.env,
    PATH: [
      path.dirname(process.execPath),
      path.dirname(cli),
      "/opt/homebrew/bin",
      process.env.PATH ?? "/usr/bin:/bin",
    ].join(path.delimiter),
    DROGON_BACKGROUND_WINDOW: "1",
    ...overrides,
  };
  return env;
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
      reject(new Error(`process did not exit within ${timeoutMs}ms`));
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
      env: options.env ?? envForRealRun(),
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  const exit = await waitExit(captured, options.timeoutMs ?? 30_000);
  if (exit.code !== 0) {
    throw new Error(
      `${path.basename(file)} ${args.join(" ")} exited ${exit.code ?? exit.signal}\nstdout=${captured.stdout.slice(-2000)}\nstderr=${captured.stderr.slice(-4000)}`,
    );
  }
  return captured.stdout;
}

async function ensureBinaries() {
  try {
    await runProcess(cli, ["--version"], { timeoutMs: 5_000 });
    await runProcess(drogond, ["--help"], { timeoutMs: 5_000 });
  } catch {
    await runProcess(
      "cargo",
      ["build", "--locked", "-p", "drogon-cli", "-p", "drogond"],
      { timeoutMs: 300_000 },
    );
  }
}

async function processSnapshot(env) {
  const output = await runProcess("/bin/ps", ["-axo", "pid=,ppid=,command="], {
    env: { ...env, PATH: "/usr/bin:/bin" },
  });
  return output.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) return [];
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    if (!Number.isInteger(pid) || pid === process.pid) return [];
    return { pid, ppid, command: match[3] };
  });
}

async function ownedProcessTree(rootPid, env) {
  const snapshot = await processSnapshot(env);
  const direct = snapshot.find((entry) => entry.pid === rootPid);
  const owned = new Map([
    [
      rootPid,
      direct ?? { pid: rootPid, ppid: 0, command: "drogond (direct child)" },
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

function redact(text) {
  return String(text)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key|token|secret|password)=\S+/gi, "$1=[redacted]")
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "sk-[redacted]")
    .replace(/[A-Fa-f0-9]{64,}/g, "[redacted]");
}

function evidenceExcerpt(text) {
  const safe = redact(text);
  const lines = safe.split("\n");
  const interesting = lines.filter((line) =>
    /drogon|orchestration|worker|skills|get --topic|dispatch|report|agent tool|error|failed|confus|hello|hola/i.test(
      line,
    ),
  );
  const selected = interesting.length > 0 ? interesting : lines;
  return selected.join("\n").slice(-12_000);
}

function noteConfusion(scenario, message) {
  if (!message) return;
  scenario.confusions ??= [];
  scenario.confusions.push(message);
}

async function main() {
  let sandbox;
  let daemonCapture;
  let daemonEnv;
  let descendants = [];
  try {
    await ensureBinaries();
    const scratchRoot = process.env.DROGON_E2E_TMPDIR ?? "/tmp";
    sandbox = await mkdtemp(path.join(scratchRoot, "drogon-real-orch-"));
    const dataDir = path.join(sandbox, "data");
    const home = path.join(sandbox, "home");
    const electronProfile = path.join(sandbox, "electron");
    const workspace = path.join(sandbox, "workspace");
    await Promise.all([
      mkdir(dataDir, { recursive: true }),
      mkdir(home, { recursive: true }),
      mkdir(electronProfile, { recursive: true }),
      mkdir(workspace, { recursive: true }),
    ]);

    // HOME remains the caller's read-only auth source for the approved Pi lane;
    // Drogon's daemon state, Pi headless overlay, and any Electron profile are
    // all isolated below sandbox.
    daemonEnv = envForRealRun({
      DROGON_DATA_DIR: dataDir,
      DROGON_ELECTRON_PROFILE: electronProfile,
      DROGON_BACKGROUND_WINDOW: "1",
    });
    daemonCapture = captureProcess(
      spawn(drogond, ["--data-dir", dataDir], {
        cwd: root,
        env: daemonEnv,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    report.dataDir = dataDir;
    report.workspace = workspace;

    async function cliJson(
      args,
      { allowFailure = false, timeoutMs = 30_000 } = {},
    ) {
      const captured = captureProcess(
        spawn(cli, ["--data-dir", dataDir, "--json", ...args], {
          cwd: root,
          env: daemonEnv,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      );
      const exit = await waitExit(captured, timeoutMs);
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

    const readyDeadline = Date.now() + 30_000;
    let status;
    while (Date.now() < readyDeadline) {
      try {
        status = await cliJson(["status"]);
        break;
      } catch {
        await sleep(200);
      }
    }
    if (!status) throw new Error("drogond did not become ready");
    report.hostId = status.result.hostId;

    const added = await cliJson([
      "workspace",
      "add",
      workspace,
      "--name",
      "real-orchestration-e2e",
    ]);
    const workspaceId = added.result.id;
    report.workspaceId = workspaceId;

    async function writePolicy(policy) {
      await cliJson([
        "rpc",
        "graph.write_intent",
        "--params",
        JSON.stringify({ workspaceId, intent: { nodes: [], policy } }),
      ]);
    }

    async function createScope(objective, taskInstructions, title) {
      const createdRun = await cliJson([
        "orchestration",
        "run-create",
        "--objective",
        objective,
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
      const createdTask = await cliJson([
        "orchestration",
        "task-create",
        ...scope,
        "--spec",
        taskInstructions,
        "--task-title",
        title,
      ]);
      return { run, scope, taskId: createdTask.result.task.taskId };
    }

    async function startParent(prompt, timeoutMs = 300_000) {
      const response = await cliJson(
        [
          "rpc",
          "harness.start",
          "--params",
          JSON.stringify({
            workspaceId,
            harnessId: realModel.harness,
            provider: realModel.provider,
            model: realModel.model,
            effort: realModel.effort,
            permissionMode: "unattended",
            headless: true,
            prompt,
          }),
        ],
        { timeoutMs: 30_000 },
      );
      const session = response.result;
      assert.ok(session.id, "real parent did not return a session id");
      assert.ok(
        session.incarnation,
        "real parent did not return an incarnation",
      );
      let wait;
      try {
        wait = await cliJson(
          [
            "terminal",
            "wait",
            "--session",
            session.id,
            "--incarnation",
            session.incarnation,
            "--for",
            "exited",
            "--timeout-ms",
            String(timeoutMs),
          ],
          { timeoutMs: timeoutMs + 15_000 },
        );
      } catch (error) {
        try {
          await cliJson([
            "terminal",
            "close",
            "--session",
            session.id,
            "--incarnation",
            session.incarnation,
          ]);
        } catch (closeError) {
          report.cleanup.push(`parent close failed: ${closeError.message}`);
        }
        throw error;
      }
      const read = await cliJson([
        "terminal",
        "read",
        "--session",
        session.id,
        "--incarnation",
        session.incarnation,
        "--limit-bytes",
        "65536",
      ]);
      const output = Buffer.from(
        read.result.dataBase64 ?? read.result.data_base64 ?? "",
        "base64",
      ).toString("utf8");
      return {
        session,
        wait: wait.result,
        transcript: output,
        excerpt: evidenceExcerpt(output),
      };
    }

    async function workerShow(scope, dispatchId) {
      return (
        await cliJson([
          "orchestration",
          "worker-show",
          ...scope,
          "--dispatch",
          dispatchId,
        ])
      ).result;
    }

    async function waitWorker(scope, dispatchId, timeoutMs = 120_000) {
      const deadline = Date.now() + timeoutMs;
      let last;
      while (Date.now() < deadline) {
        last = await workerShow(scope, dispatchId);
        if (last.outcome || last.processVerdict === "exited") return last;
        await sleep(500);
      }
      throw new Error(
        `worker ${dispatchId} did not settle: ${JSON.stringify(last)}`,
      );
    }

    async function dispatchEvidence(scope, dispatchId) {
      const shown = await workerShow(scope, dispatchId);
      return {
        dispatchId,
        outcome: shown.outcome ?? null,
        processVerdict: shown.processVerdict ?? null,
        launch: shown.launch ?? null,
        reportResult: shown.reportResult ?? null,
        sessionIdentity: shown.sessionIdentity ?? null,
      };
    }

    async function workspaceEvidence() {
      const names = new Set([
        "AGENTS.md",
        "CLAUDE.md",
        "graph-intent.json",
        ".drogon/graph.json",
      ]);
      for (const entry of await readdir(workspace, { withFileTypes: true })) {
        if (entry.isFile()) names.add(entry.name);
      }
      try {
        for (const entry of await readdir(path.join(workspace, ".drogon"), {
          withFileTypes: true,
        })) {
          if (entry.isFile()) names.add(path.join(".drogon", entry.name));
        }
      } catch {
        // The model may not create a .drogon evidence directory.
      }
      const evidence = {};
      const parsed = {};
      for (const name of names) {
        try {
          const text = await readFile(path.join(workspace, name), "utf8");
          evidence[name] = evidenceExcerpt(text);
          if (name.endsWith(".json")) {
            try {
              parsed[name] = JSON.parse(text);
            } catch {
              // A model may leave a partial JSON artifact; retain its excerpt.
            }
          }
        } catch {
          // The model may race a file write or leave a path absent.
        }
      }
      return { evidence, parsed };
    }

    async function clearWorkspaceEvidence() {
      // Each scenario gets a clean disposable workspace so independent CLI
      // verification cannot accidentally accept an earlier scenario's file.
      await rm(workspace, { recursive: true, force: true });
      await mkdir(workspace, { recursive: true });
    }

    function evidenceDispatchRecords(value, inherited = {}, records = []) {
      if (Array.isArray(value)) {
        for (const item of value)
          evidenceDispatchRecords(item, inherited, records);
        return records;
      }
      if (!value || typeof value !== "object") return records;
      const scope = {
        runId: value.runId ?? value.run_id ?? inherited.runId,
        taskId: value.taskId ?? value.task_id ?? inherited.taskId,
        coordinatorId:
          value.coordinatorId ??
          value.coordinator_id ??
          inherited.coordinatorId,
        consumerGeneration:
          value.consumerGeneration ??
          value.generation ??
          inherited.consumerGeneration,
      };
      if (typeof value.dispatchId === "string") {
        records.push({ ...scope, dispatchId: value.dispatchId });
      }
      for (const child of Object.values(value)) {
        evidenceDispatchRecords(child, scope, records);
      }
      return records;
    }

    async function verifyEvidenceDispatches(parsed) {
      const records = evidenceDispatchRecords(parsed);
      const unique = new Map(
        records
          .filter((record) => record.runId && record.dispatchId)
          .map((record) => [record.dispatchId, record]),
      );
      const verified = [];
      for (const record of unique.values()) {
        const scope = ["--run", record.runId];
        if (record.coordinatorId) {
          scope.push("--coordinator-id", record.coordinatorId);
        }
        if (record.consumerGeneration != null) {
          scope.push(
            "--consumer-generation",
            String(record.consumerGeneration),
          );
        }
        try {
          const shown = await workerShow(scope, record.dispatchId);
          verified.push({
            dispatchId: record.dispatchId,
            runId: record.runId,
            taskId: record.taskId ?? null,
            outcome: shown.outcome ?? null,
            processVerdict: shown.processVerdict ?? null,
            launch: shown.launch ?? null,
            reportResult: shown.reportResult ?? null,
            sessionIdentity: shown.sessionIdentity ?? null,
          });
        } catch {
          // The artifact is not accepted as proof if the current daemon cannot
          // independently show the dispatch it names.
        }
      }
      return verified;
    }

    async function finishScenario(scenario, parentResult) {
      const { evidence: files, parsed } = await workspaceEvidence();
      const verified = await verifyEvidenceDispatches(parsed);
      const existing = scenario.workers ?? [];
      const workers = [...existing];
      const known = new Set(existing.map((worker) => worker.dispatchId));
      for (const worker of verified) {
        if (!known.has(worker.dispatchId)) workers.push(worker);
      }
      scenario.workers = workers;
      const durableChildDispatches = workers.filter(
        (worker) => worker.dispatchId,
      ).length;
      const transcriptEvidence = parentResult?.excerpt ?? "";
      const graphEvidence = ["graph-intent.json", ".drogon/graph.json"]
        .map((name) => files[name] ?? "")
        .join("\n");
      const usedGraphCli =
        /run-node-failover|graph-intent|graph write-intent/i.test(
          `${transcriptEvidence}\n${graphEvidence}`,
        );
      const fileEvidence = Object.entries(files)
        .filter(([name]) => !["AGENTS.md", "CLAUDE.md"].includes(name))
        .map(([, text]) => text)
        .join("\n");
      const usedDrogonCli =
        durableChildDispatches > 0 ||
        Boolean(
          `${transcriptEvidence}\n${fileEvidence}`.match(
            /drogon-cli|DROGON_CLI_COMMAND/i,
          ),
        );
      const parent = {
        toldOnTurnOne: scenario.parentPrompt,
        sessionId: parentResult?.session?.id ?? null,
        processVerdict: parentResult?.wait?.session?.verdict ?? null,
        durableChildDispatches,
        independentlyVerifiedDispatches: verified.length,
        usedDrogonCliUnprompted: usedDrogonCli,
        delegationSurface:
          verified.length > 0
            ? "drogon-cli orchestration/worker-start"
            : usedGraphCli
              ? "drogon-cli graph/run-node-failover"
              : "none-observed",
        transcriptEvidence,
        workspaceEvidence: files,
      };
      scenario.parent = parent;
      const expected = scenario.expectedWorkers;
      const workerReports = workers.filter(
        (worker) => worker.outcome === "succeeded",
      );
      const successShape =
        scenario.id === "e"
          ? workers.length >= 1 &&
            workers.some(
              (worker) =>
                worker.processVerdict === "exited" && worker.outcome == null,
            )
          : scenario.id === "c"
            ? verified.length >= expected &&
              workerReports.length >= expected &&
              workers
                .filter((worker) => worker.outcome)
                .every(
                  (worker) =>
                    worker.outcome === "succeeded" &&
                    worker.processVerdict === "exited",
                )
            : verified.length >= expected && workerReports.length >= expected;
      if (successShape) scenario.status = "PASS";
      if (!usedDrogonCli) {
        noteConfusion(
          scenario,
          "The parent completed without a durable child dispatch, CLI evidence, or a visible drogon-cli command in its bounded evidence.",
        );
      }
      if (usedGraphCli && verified.length === 0) {
        noteConfusion(
          scenario,
          "The cheap model reached for graph-oriented delegation evidence, but the current daemon could not independently verify a native orchestration dispatch.",
        );
      }
      return scenario;
    }

    async function runParentScenario({
      id,
      objective,
      taskInstructions,
      parentPrompt,
      title,
      policy,
      expectedWorkers,
      timeoutMs = 300_000,
      afterParent,
    }) {
      const scenario = {
        id,
        status: "FAILED",
        parentPrompt,
        expectedWorkers,
        confusions: [],
      };
      report.scenarios.push(scenario);
      try {
        await clearWorkspaceEvidence();
        await writePolicy(policy);
        const context = await createScope(objective, taskInstructions, title);
        scenario.runId = context.run.runId;
        scenario.taskId = context.taskId;
        scenario.coordinatorId = context.run.coordinatorId;
        scenario.childInstructions = taskInstructions;
        const parentPromptWithIds = parentPrompt
          .replaceAll("{{RUN_ID}}", context.run.runId)
          .replaceAll("{{COORDINATOR_ID}}", context.run.coordinatorId)
          .replaceAll(
            "{{CONSUMER_GENERATION}}",
            String(context.run.consumerGeneration),
          )
          .replaceAll("{{TASK_ID}}", context.taskId)
          .replaceAll("{{WORKSPACE_ID}}", workspaceId);
        scenario.parentPrompt = parentPromptWithIds;
        const parent = await startParent(parentPromptWithIds, timeoutMs);
        const settled = await afterParent({ context, parent, scenario });
        scenario.workers = settled.workers;
        scenario.status = settled.ok ? "PASS" : "FAILED";
        if (settled.confusions) scenario.confusions.push(...settled.confusions);
        await finishScenario(scenario, parent);
      } catch (error) {
        scenario.error = error instanceof Error ? error.message : String(error);
        noteConfusion(scenario, `Harness journey failed: ${scenario.error}`);
      }
      return scenario;
    }

    const piPolicy = {
      delegate: true,
      approvedRuntimes: [
        {
          harness: "pi",
          provider: realModel.provider,
          model: realModel.model,
        },
      ],
      fallbackRuntime: null,
      adversarial: { enabled: false, maxIterations: 1 },
    };

    const workerStartInstructions = (extra) =>
      `You are a real Drogon worker. Read the complete structured worker brief delivered on your first turn. ${extra} Use the managed CLI from DROGON_CLI_COMMAND for orchestration; do not use an internal Agent tool or merely print a completion message. Send exactly one worker_done report containing outcome, result, modified files (if any), and artifacts (if any).`;

    const parentDelegationPrelude = `You are the coordinator for a real Drogon orchestration dogfood scenario. The injected Drogon context on your first turn is authoritative. Do not use an internal Agent tool, do not start a raw hidden session, and do not read a child's PTY buffer. Use the built-in Drogon delegation contract; the Work Graph policy supplies the child runtime. The exact run is {{RUN_ID}}, coordinator is {{COORDINATOR_ID}}, generation is {{CONSUMER_GENERATION}}, task is {{TASK_ID}}, and registered workspace is {{WORKSPACE_ID}}. First discover/read the orchestration guide as the injected context requests. After starting the child, observe durable worker state and mailbox evidence and write a small JSON evidence file in the workspace. Explain any confusion instead of inventing success. `;

    await runParentScenario({
      id: "a",
      objective:
        "Real cheap-model delegation says hello and reports through Drogon CLI",
      title: "real model hello",
      taskInstructions: workerStartInstructions(
        'Say exactly "hola desde Drogon" in your result and then complete through the CLI.',
      ),
      parentPrompt: `${parentDelegationPrelude} Delegate the child to say hello, wait for its worker_done, and summarize whether the report arrived through the coordinator mailbox.`,
      policy: piPolicy,
      expectedWorkers: 1,
      afterParent: async ({ context }) => {
        const task = await cliJson([
          "orchestration",
          "task-show",
          ...context.scope,
          "--task",
          context.taskId,
        ]);
        const dispatchId = task.result.task.latestDispatchId;
        if (!dispatchId) {
          return {
            ok: false,
            workers: [],
            confusions: ["The parent did not create a worker dispatch."],
          };
        }
        const worker = await waitWorker(context.scope, dispatchId);
        const evidence = await dispatchEvidence(context.scope, dispatchId);
        return {
          ok: worker.outcome === "succeeded",
          workers: [evidence],
          confusions:
            worker.outcome === "succeeded"
              ? worker.reportResult
                ? []
                : [
                    "The child reported worker_done without a structured result field.",
                  ]
              : ["The child did not produce a durable worker_done report."],
        };
      },
    });

    await runParentScenario({
      id: "b",
      objective:
        "Real cheap-model policy dispatch uses the approved provider and model",
      title: "real model policy",
      taskInstructions: workerStartInstructions(
        "Report that you were selected by policy, including the effective provider and model visible in your brief/environment.",
      ),
      parentPrompt: `${parentDelegationPrelude} This scenario specifically tests policy selection. Start one child without runtime flags, then inspect its durable launch provider/model and worker_done report. Do not guess a provider from a bare model id.`,
      policy: piPolicy,
      expectedWorkers: 1,
      afterParent: async ({ context }) => {
        const task = await cliJson([
          "orchestration",
          "task-show",
          ...context.scope,
          "--task",
          context.taskId,
        ]);
        const dispatchId = task.result.task.latestDispatchId;
        if (!dispatchId) {
          return {
            ok: false,
            workers: [],
            confusions: ["The parent did not create the policy dispatch."],
          };
        }
        const worker = await waitWorker(context.scope, dispatchId);
        const evidence = await dispatchEvidence(context.scope, dispatchId);
        const launchMatches =
          worker.launch?.provider === realModel.provider &&
          worker.launch?.model === realModel.model;
        return {
          ok: launchMatches && worker.outcome === "succeeded",
          workers: [evidence],
          confusions: launchMatches
            ? []
            : [
                `Policy launch was ${worker.launch?.provider ?? "missing"}/${worker.launch?.model ?? "missing"}, not ${realModel.provider}/${realModel.model}.`,
              ],
        };
      },
    });

    await runParentScenario({
      id: "c",
      objective: "Three real cheap-model workers report concurrently",
      title: "real model concurrent workers",
      taskInstructions: workerStartInstructions(
        "Say which concurrent worker you are (one, two, or three) in the final report and do not wait on a PTY.",
      ),
      parentPrompt: `${parentDelegationPrelude} Create three independent child tasks named one, two, and three (you may create them with the CLI), start all three without runtime flags, and wait for three attributed worker_done reports through the CLI. Do not scrape terminal output.`,
      policy: piPolicy,
      expectedWorkers: 3,
      afterParent: async ({ context, scenario }) => {
        const deadline = Date.now() + 20_000;
        let taskIds = [];
        while (Date.now() < deadline) {
          const listed = await cliJson([
            "orchestration",
            "task-list",
            ...context.scope,
            "--limit",
            "20",
          ]).catch(() => null);
          const tasks = listed?.result?.tasks ?? [];
          taskIds = tasks
            .filter((task) =>
              /concurrent (one|two|three)/i.test(
                String(task.title ?? task.taskTitle ?? task.displayName ?? ""),
              ),
            )
            .map((task) => task.taskId ?? task.id)
            .filter(Boolean);
          if (taskIds.length >= 3) break;
          await sleep(500);
        }
        taskIds = [...new Set(taskIds)].slice(0, 3);
        const dispatches = [];
        for (const taskId of taskIds) {
          const shownTask = await cliJson([
            "orchestration",
            "task-show",
            ...context.scope,
            "--task",
            taskId,
          ]).catch(() => null);
          const dispatchId = shownTask?.result?.task?.latestDispatchId;
          if (dispatchId) dispatches.push(dispatchId);
        }
        if (dispatches.length < 3) {
          return {
            ok: false,
            workers: dispatches.map((id) => ({ dispatchId: id })),
            confusions: [
              `The parent created ${taskIds.length} matching tasks and ${dispatches.length} dispatches; expected 3 of each.`,
            ],
          };
        }
        const evidence = [];
        for (const dispatchId of dispatches) {
          await waitWorker(context.scope, dispatchId, 180_000);
          evidence.push(await dispatchEvidence(context.scope, dispatchId));
        }
        const ok =
          evidence.length === 3 &&
          evidence.every(
            (worker) =>
              worker.outcome === "succeeded" &&
              worker.processVerdict === "exited" &&
              worker.reportResult,
          );
        return {
          ok,
          workers: evidence,
          confusions: ok
            ? []
            : [
                "At least one concurrent child lacked an exited worker_done state.",
              ],
        };
      },
    });

    await runParentScenario({
      id: "d",
      objective: "Real worker asks the coordinator and resumes after reply",
      title: "real model ask reply",
      taskInstructions: workerStartInstructions(
        'Ask the coordinator exactly "Need approval to continue" with orchestration ask, wait for the reply, then include the answer in your worker_done result.',
      ),
      parentPrompt: `${parentDelegationPrelude} Start the child. Consume its question using the orchestration mailbox, reply "approved by the real coordinator", and then wait for the same child to resume and report. Never answer by writing to a PTY.`,
      policy: {
        ...piPolicy,
        approvedRuntimes: [
          {
            harness: "pi",
            provider: realModel.provider,
            model: realModel.model,
          },
        ],
      },
      expectedWorkers: 1,
      afterParent: async ({ context, scenario }) => {
        // If the parent misunderstood the mailbox contract, the outer
        // coordinator supplies a bounded rescue only so the evidence says
        // exactly where the cheap model needed help.
        let rescued = false;
        let questionId = null;
        const rescueDeadline = Date.now() + 45_000;
        while (Date.now() < rescueDeadline && !questionId) {
          const peek = await cliJson([
            "orchestration",
            "check",
            ...context.scope,
            "--peek",
            "--kinds",
            "question",
          ]).catch(() => null);
          const message = peek?.result?.messages?.find(
            (entry) => entry.kind === "question" || entry.type === "question",
          );
          questionId = message?.messageId ?? null;
          if (!questionId) await sleep(500);
        }
        if (questionId) {
          await cliJson([
            "orchestration",
            "reply",
            ...context.scope,
            "--question",
            questionId,
            "--body",
            "approved by the real coordinator",
          ]);
          rescued = true;
          noteConfusion(
            scenario,
            "The outer coordinator had to discover/reply to the question; the parent did not complete the reply path on its own.",
          );
        }
        const task = await cliJson([
          "orchestration",
          "task-show",
          ...context.scope,
          "--task",
          context.taskId,
        ]);
        const dispatchId = task.result.task.latestDispatchId;
        if (!dispatchId) {
          return {
            ok: false,
            workers: [],
            confusions: ["The parent did not create the ask worker."],
          };
        }
        const worker = await waitWorker(context.scope, dispatchId, 180_000);
        const evidence = await dispatchEvidence(context.scope, dispatchId);
        return {
          ok: worker.outcome === "succeeded",
          workers: [evidence],
          confusions: rescued
            ? ["Coordinator rescue was required."]
            : worker.reportResult
              ? []
              : [
                  "The child reported worker_done without a structured result field.",
                ],
        };
      },
    });

    await runParentScenario({
      id: "e",
      objective:
        "A real worker that never reports remains outcome-less after exit",
      title: "real model missing report",
      taskInstructions: workerStartInstructions(
        'This is an intentional failure path: before any completion report, use a shell tool to run `kill -TERM "$PPID"` and therefore terminate the Pi worker. Do not send worker_done.',
      ),
      parentPrompt: `${parentDelegationPrelude} Start the child and observe the durable worker state. It is intentionally supposed to die without worker_done; report unverifiable/outcome-less state, not success. Do not fabricate a report.`,
      policy: piPolicy,
      expectedWorkers: 1,
      afterParent: async ({ context, scenario }) => {
        const task = await cliJson([
          "orchestration",
          "task-show",
          ...context.scope,
          "--task",
          context.taskId,
        ]);
        const dispatchId = task.result.task.latestDispatchId;
        if (!dispatchId) {
          return {
            ok: false,
            workers: [],
            confusions: ["The parent did not create the failure-path worker."],
          };
        }
        const worker = await waitWorker(context.scope, dispatchId, 120_000);
        const evidence = await dispatchEvidence(context.scope, dispatchId);
        const honest =
          worker.processVerdict === "exited" &&
          worker.outcome == null &&
          worker.reportResult == null;
        return {
          ok: honest,
          workers: [evidence],
          confusions: honest
            ? []
            : [
                "The parent or child produced a completion outcome where the missing-report path required an exited outcome-less worker.",
              ],
        };
      },
    });

    // Real Claude/OpenCode inference is intentionally not run: the repository
    // contract authorizes only the Pi/Luna lane for model inference. The
    // fixture journey still covers both adapters; this opt-in report keeps the
    // distinction explicit rather than spending an unauthorized provider.
    report.scenarios.push({
      id: "f",
      status: "UNVERIFIABLE",
      parent: {
        toldOnTurnOne:
          "Repeat scenario a with Claude Code and OpenCode as the parent harness; children remain on the approved Pi/Luna policy.",
        usedDrogonCliUnprompted: null,
        transcriptEvidence:
          "Not run: real inference is authorized only for Pi/Luna in this repository task.",
      },
      workers: [],
      confusions: [
        "Real Claude/OpenCode parent inference was not run because AGENTS.md authorizes only pi/openai-codex/gpt-5.6-luna for real model sessions; CI-safe fixture coverage remains in accept-orchestration-e2e.mjs.",
      ],
    });

    report.status = report.scenarios
      .filter((scenario) => scenario.id !== "f")
      .every((scenario) => scenario.status === "PASS")
      ? "PASS_WITH_UNVERIFIABLE_F"
      : "FAILED";
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (daemonCapture && daemonEnv) {
      try {
        descendants = await ownedProcessTree(
          daemonCapture.child.pid,
          daemonEnv,
        );
        report.processes = { beforeShutdown: descendants };
      } catch (error) {
        report.cleanup.push(`process enumeration failed: ${error.message}`);
      }
      if (
        daemonCapture.child.exitCode === null &&
        daemonCapture.child.signalCode === null
      ) {
        daemonCapture.child.kill("SIGTERM");
        try {
          await waitExit(daemonCapture, 10_000);
        } catch (error) {
          report.cleanup.push(`drogond did not exit cleanly: ${error.message}`);
          if (
            daemonCapture.child.exitCode === null &&
            daemonCapture.child.signalCode === null
          ) {
            daemonCapture.child.kill("SIGKILL");
            await waitExit(daemonCapture, 5_000).catch(() => {});
          }
        }
      }
      const sameOwnedProcesses = async () => {
        const snapshot = await processSnapshot(daemonEnv);
        return descendants.filter((owned) =>
          snapshot.some(
            (current) =>
              current.pid === owned.pid && current.command === owned.command,
          ),
        );
      };
      let remaining = [];
      try {
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
        const termDeadline = Date.now() + 2_000;
        do {
          remaining = await sameOwnedProcesses();
          if (remaining.length === 0 || Date.now() >= termDeadline) break;
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
        report.cleanup.push(`cleanup verification failed: ${error.message}`);
        report.status = "FAILED";
      }
      report.daemonStderr = daemonCapture.stderr.slice(-4000);
    }
    if (sandbox) {
      if (
        report.processes?.afterShutdown &&
        report.processes.afterShutdown.length > 0
      ) {
        report.debugSandbox = sandbox;
      } else if (report.status === "PASS_WITH_UNVERIFIABLE_F") {
        await rm(sandbox, { recursive: true, force: true });
      } else {
        // Preserve failed-run evidence for inspection, but only after every
        // owned process has been positively observed exited.
        report.debugSandbox = sandbox;
      }
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.status.startsWith("PASS")) process.exitCode = 1;
  }
}

if (process.env.DROGON_E2E_REAL_HARNESS !== "1") {
  console.error(
    "Refusing real model inference. Set DROGON_E2E_REAL_HARNESS=1 explicitly.",
  );
  process.exitCode = 2;
} else {
  await main();
}
