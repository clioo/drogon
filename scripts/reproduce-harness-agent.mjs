// The fixture agent behind every harness shim of `make repro`.
//
// It stands in for a coding agent so the demo can run the REAL product end to
// end — daemon, work graph, durable orchestrator, adversarial rounds, evidence
// and usage ledgers — with no model inference and no provider spend. What it
// does is deterministic and declared in the receipt; nothing here pretends to
// be a model:
//
//   main   → writes the Dog Tinder deck WITHOUT the undo feature (stage 1)
//   test   → runs `node --test` and reports the verdict the test run actually
//            gives (3 failures at stage 1 ⇒ `findings`), never a guess
//   review → applies the undo implementation (stage 2), RE-RUNS the tests, and
//            reports `pass` only when the re-run is green
//
// Token counts are fixed per role and labelled `fixture-harness` wherever they
// surface, because a fixture has no provider to report real ones.

import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const FIXTURE_VERSION = "drogon-repro-fixture 1.0";

/** Deterministic per-role token counts the fixture "reports", in the shape a
 *  real harness would: input/output plus cache reads on the long main turn. */
const ROLE_USAGE = {
  main: { input: 18_400, output: 3_250, cacheRead: 6_000 },
  test: { input: 9_100, output: 1_180 },
  review: { input: 12_700, output: 2_040 },
};

function parseShimArgs(argv) {
  let harness = "unknown";
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--harness") {
      harness = argv[index + 1] ?? "unknown";
      index += 1;
      continue;
    }
    if (argv[index] === "--") {
      rest.push(...argv.slice(index + 1));
      break;
    }
    rest.push(argv[index]);
  }
  return { harness, rest };
}

function loadContext() {
  // A Drogon session's environment is curated: the daemon's own variables do
  // not reach it, but `DROGON_DATA_DIR` does, so a context dropped next to
  // the data directory reaches every session of the run — the Bot's chat
  // turn included, which starts before any file could land in its project.
  const candidates = [
    path.join(process.cwd(), ".drogon", "repro-context.json"),
    process.env.DROGON_REPRO_CONTEXT ?? "",
    process.env.DROGON_DATA_DIR ? path.join(process.env.DROGON_DATA_DIR, "repro-context.json") : "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return JSON.parse(readFileSync(candidate, "utf8"));
    } catch {
      continue;
    }
  }
  return null;
}

function log(context, entry) {
  if (!context?.invocationLog) return;
  try {
    appendFileSync(context.invocationLog, `${JSON.stringify(entry)}\n`);
  } catch {
    // The log is evidence, not control flow: a demo must not die for it.
  }
}

/** The prompt the harness was launched with: the last non-flag argument the
 *  adapters pass, or stdin for an adapter that pipes it. */
function resolvePrompt(rest) {
  const candidates = rest.filter((value, index) =>
    !["--extension", "--settings"].includes(rest[index - 1]) && typeof value === "string" && value.length > 40);
  if (candidates.length > 0) return candidates[candidates.length - 1];
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function runTests(cwd) {
  const result = spawnSync(process.execPath, ["--test", "--test-reporter", "tap"], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const count = (label) => {
    const match = output.match(new RegExp(`^# ${label} (\\d+)$`, "m"));
    return match ? Number(match[1]) : null;
  };
  const failing = [...output.matchAll(/^not ok \d+ - (.+)$/gm)].map((match) => match[1].trim());
  return { pass: count("pass"), fail: count("fail"), failing, code: result.status };
}

function cli(context, args) {
  if (!context?.cli || !context?.dataDir) return null;
  const result = spawnSync(context.cli, ["--data-dir", context.dataDir, "--json", ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function cliJson(context, args) {
  const result = cli(context, args);
  if (!result || result.code !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout);
    return parsed.ok === true ? parsed.result : null;
  } catch {
    return null;
  }
}

function reportUsage(context, { role, harness, model, runId, agentId }) {
  const usage = ROLE_USAGE[role];
  if (!usage || !context?.workspaceId) return null;
  const args = [
    "graph",
    "usage-add",
    "--workspace",
    context.workspaceId,
    "--input",
    String(usage.input),
    "--output",
    String(usage.output),
    "--harness",
    harness,
    "--model",
    model,
    "--role",
    role,
  ];
  if (usage.cacheRead) args.push("--cache-read", String(usage.cacheRead));
  if (runId) args.push("--run", runId);
  if (agentId) args.push("--agent", agentId);
  return cli(context, args);
}

function recordEvidence(context, { status, summary, detail, role, runId, agentId }) {
  if (!context?.workspaceId) return null;
  const args = [
    "graph",
    "evidence-add",
    "--workspace",
    context.workspaceId,
    "--status",
    status,
    "--summary",
    summary,
    "--role",
    role,
  ];
  if (detail) args.push("--detail", detail);
  if (runId) args.push("--run", runId);
  if (agentId) args.push("--agent", agentId);
  return cli(context, args);
}

/** The workspace this invocation is running in, resolved from the daemon's own
 *  registry by matching this process's cwd. The CLI lane writes a context file
 *  next to the workspace and already knows it; the in-app lane does not, so the
 *  fixture asks instead of assuming (and never reports usage to the wrong
 *  workspace). */
function resolveWorkspaceId(context) {
  const listed = cliJson(context, ["workspace", "list"]);
  const here = realpathSync(process.cwd());
  for (const workspace of listed?.workspaces ?? []) {
    if (typeof workspace?.path !== "string") continue;
    let candidate = workspace.path;
    try {
      candidate = realpathSync(workspace.path);
    } catch {
      // A workspace whose folder moved cannot be this one.
      continue;
    }
    if (candidate === here) return workspace.id ?? null;
  }
  return null;
}

function applyStage(context, stage) {
  const source = path.join(context.stagesDir, stage);
  cpSync(source, process.cwd(), { recursive: true });
  return source;
}

function writeEvaluation(target, verdict, evidence) {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify({ verdict, evidence }, null, 2)}\n`);
}

function describeTests({ pass, fail, failing }) {
  const counts = `${pass ?? "?"} passed, ${fail ?? "?"} failed`;
  if (!failing.length) return `node --test: ${counts}`;
  return `node --test: ${counts} — ${failing.join("; ")}`;
}

const { harness, rest } = parseShimArgs(process.argv.slice(2));
const context = loadContext();

if (rest.includes("--version") || rest.includes("-v") || rest[0] === "--version") {
  process.stdout.write(`${harness} ${FIXTURE_VERSION}\n`);
  process.exit(0);
}

// Enumeration surfaces the harness catalog probes. The fixture model is the
// only id it will ever claim.
if (rest[0] === "models" || rest.includes("--list-models")) {
  process.stdout.write(`${context?.model ?? "fixture/dog-tinder"}\n`);
  process.exit(0);
}

// Load the actual managed extension and drive its public event contract.
// This fixture reports synthetic counters, never contacts a model provider.
if (harness === "pi" && rest.includes("--extension")) {
  const extensionPath = rest[rest.indexOf("--extension") + 1];
  const handlers = new Map();
  const install = new Function("require", readFileSync(extensionPath, "utf8").replace("export default function", "return function"))(createRequire(import.meta.url));
  install({ on: (name, handler) => handlers.set(name, handler) });
  const message = { role: "assistant", provider: "fixture", model: "dog-tinder", timestamp: Date.now(), stopReason: "stop",
    content: [{ type: "text", text: "Fixture response" }], usage: { input: 37, output: 11, cacheRead: 2, cacheWrite: 1 } };
  await handlers.get("message_end")?.({ message: { ...message, role: "user" } });
  await handlers.get("message_end")?.({ message: { ...message, timestamp: message.timestamp + 1, usage: {} } });
  await handlers.get("message_end")?.({ message: { ...message, timestamp: message.timestamp + 2, stopReason: "error", usage: { input: 0, output: 0 } } });
  await handlers.get("message_end")?.({ message });
  // A redelivery must not count that same response twice.
  await handlers.get("message_end")?.({ message });
}

const prompt = resolvePrompt(rest);
const modelIndex = rest.indexOf("--model");
const model = modelIndex === -1 ? (context?.model ?? "fixture") : (rest[modelIndex + 1] ?? "fixture");
const sentinel = prompt.match(/DROGON_NODE_[A-Z0-9_]+_DONE/g)?.at(-1) ?? null;
const evaluation = prompt.match(/Write (\.drogon\/evaluations\/[^\s]+\.json) as JSON/)?.[1] ?? null;
const runId =
  prompt.match(/Drogon run ([0-9a-f]{8,})/)?.[1] ??
  prompt.match(/for workflow ([0-9a-f]{8,})/)?.[1] ??
  null;
// The dispatcher's turn: a monitor firing names its delegation event; the
// in-app demo's Bot gets a chat turn whose prompt spells the exact
// `orchestrator-start` to run (no placeholders). Either way this session's
// one job is to admit the graph, not to build anything.
const releaseEvent = prompt.match(/Monitor delegation (\S+)/)?.[1] ?? null;
const directDispatch = [
  ...prompt.matchAll(/drogon-cli graph orchestrator-start --workspace (\S+) --file (\S+)/g),
].find(([, workspaceId, file]) => !/[<>]/.test(workspaceId) && !/[<>]/.test(file)) ?? null;
const dispatchId = process.env.DROGON_DISPATCH_ID ?? null;
const isDispatcher = Boolean(releaseEvent || (directDispatch && !prompt.includes("main agent of the dispatched Dog Tinder graph")));
const agentId = evaluation ? path.basename(evaluation, ".json") : isDispatcher ? "bot-dispatcher" : "orchestrator-main";
const role = dispatchId
  ? "worker"
  : evaluation
    ? evaluation.endsWith("-test.json")
      ? "test"
      : "review"
    : isDispatcher
      ? "release"
      : "main";

log(context, {
  at: new Date().toISOString(),
  harness,
  role,
  model,
  cwd: process.cwd(),
  argv: rest,
  promptBytes: prompt.length,
});

if (!context) {
  process.stderr.write("repro fixture: no run context; refusing to act\n");
  process.exit(21);
}

// The context may name no workspace (the in-app lane carries only the CLI and
// the stages): resolve this one from the daemon rather than guessing, so
// evidence and usage land where the work actually happened.
if (!context.workspaceId) {
  const resolved = resolveWorkspaceId(context);
  if (resolved) context.workspaceId = resolved;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long a worker keeps its session alive after doing its slice: long
 *  enough that a viewer (and the acceptance) can see several of them live at
 *  once, short enough not to bore anyone. */
const WORKER_DWELL_MS = context.workerDwellMs ?? 8000;

/** The worker's own turn, inside the session `worker-start` opened for it.
 *  The task spec carries a tag the main agent chose (`[deck]`, `[page]`,
 *  `[test]`); the worker does that slice, then reports through the dispatch
 *  credential the daemon put in its environment — one final report, with the
 *  outcome the work actually had. */
function worker() {
  const spec = prompt.match(/Exact instructions \(verbatim\):\s*\n([^\n]+)/)?.[1] ?? prompt;
  const tag = spec.match(/^\s*\[([a-z:-]+)\]/)?.[1] ?? "deck";
  const cwd = process.cwd();
  let summary;
  let outcome = "succeeded";
  let modified = [];
  if (tag === "deck") {
    // The deck and its storage, at stage 1: the spec's undo is not there yet.
    for (const file of ["src/deck.js", "src/storage.js"]) {
      const from = path.join(context.stagesDir, "agent-stage-1", file);
      mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
      cpSync(from, path.join(cwd, file));
      modified.push(file);
    }
    summary = "Implemented src/deck.js and src/storage.js: swipe, match, empty-deck refusal, atomic save/load.";
  } else if (tag === "page") {
    cpSync(path.join(context.stagesDir, "agent-stage-1", "index.html"), path.join(cwd, "index.html"));
    modified.push("index.html");
    summary = "Implemented index.html: the deck page with pass and like controls.";
  } else {
    // A tester: run the contract and report what it says, never a guess.
    const tests = runTests(cwd);
    const green = tests.fail === 0 && (tests.pass ?? 0) > 0;
    outcome = green ? "succeeded" : "failed";
    summary = green
      ? `Adversarial test of ${tag.split(":")[1] ?? "the deck"}: ${describeTests(tests)} — nothing left to break.`
      : `Adversarial test of ${tag.split(":")[1] ?? "the deck"}: ${describeTests(tests)}. Findings: undo of the last swipe is missing.`;
  }
  process.stdout.write(`${summary}\n`);
  // Stay visibly alive for a while: the parallelism is the point of the demo.
  const until = Date.now() + WORKER_DWELL_MS;
  while (Date.now() < until) {
    spawnSync(process.execPath, ["-e", "setTimeout(()=>{}, 500)"], { timeout: 2000 });
  }
  reportUsage(context, { role: "worker", harness, model, runId: process.env.DROGON_RUN_ID ?? null, agentId: dispatchId });
  const result = spawnSync(
    process.env.DROGON_CLI_COMMAND ?? context.cli,
    [
      "--data-dir",
      process.env.DROGON_DATA_DIR ?? context.dataDir,
      "--json",
      "orchestration",
      "send",
      "--kind",
      "worker_done",
      "--subject",
      `[${tag}] ${outcome}`,
      "--outcome",
      outcome,
      "--body",
      summary,
      "--result",
      JSON.stringify({ modifiedFiles: modified, artifacts: [], summary }),
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
  if (result.status !== 0) {
    process.stderr.write(`worker_done refused: ${result.stderr || result.stdout}\n`);
    process.exit(23);
  }
}

/** The main agent's fan-out, done from the released session the way the
 *  product's own brief describes: a run, depth-one implementation workers in
 *  parallel, then a depth-one adversarial tester for each as it finishes. The
 *  bounded whole-workflow test/review pass stays the daemon's, started last. */
function orchestrate(scoped) {
  const status = cliJson(scoped, ["status"]);
  if (!status?.hostId) throw new Error("status did not name a host");
  const created = cliJson(scoped, [
    "orchestration",
    "run-create",
    "--objective",
    "Dog Tinder: implement the deck and its page, then test them adversarially",
    "--host",
    status.hostId,
  ]);
  const run = created?.run;
  if (!run?.runId) throw new Error("orchestration run-create did not return a run");
  const scope = [
    "--run",
    run.runId,
    "--coordinator-id",
    run.coordinatorId,
    "--consumer-generation",
    String(run.consumerGeneration),
  ];
  const task = (spec, title) => {
    const made = cliJson(scoped, ["orchestration", "task-create", ...scope, "--spec", spec, "--task-title", title]);
    if (!made?.task?.taskId) throw new Error(`task-create failed for ${title}`);
    return made.task.taskId;
  };
  const start = (taskId) => {
    const started = cliJson(scoped, [
      "orchestration",
      "worker-start",
      ...scope,
      "--task",
      taskId,
      "--workspace",
      scoped.workspaceId,
      "--timeout-ms",
      "30000",
    ]);
    if (!started?.dispatchId) throw new Error(`worker-start failed for ${taskId}`);
    return started.dispatchId;
  };
  const settled = (dispatchIds, budgetMs) => {
    const deadline = Date.now() + budgetMs;
    const outcomes = {};
    while (Date.now() < deadline) {
      for (const id of dispatchIds) {
        if (outcomes[id]) continue;
        const shown = cliJson(scoped, ["orchestration", "worker-show", ...scope, "--dispatch", id]);
        if (shown?.outcome) outcomes[id] = shown.outcome;
      }
      if (dispatchIds.every((id) => outcomes[id])) return outcomes;
      spawnSync(process.execPath, ["-e", "setTimeout(()=>{}, 1000)"], { timeout: 3000 });
    }
    throw new Error(`workers did not report in ${budgetMs} ms: ${JSON.stringify(outcomes)}`);
  };

  // Implementation workers, in parallel: two sessions, two slices.
  const workers = [
    start(task("[deck] Implement src/deck.js and src/storage.js per specs/dog-tinder.md. You cannot dispatch another worker.", "Deck and storage")),
    start(task("[page] Implement index.html per specs/dog-tinder.md. You cannot dispatch another worker.", "Deck page")),
  ];
  recordEvidence(scoped, {
    status: "progress",
    summary: `Main agent dispatched ${workers.length} implementation workers in parallel.`,
    detail: `Run ${run.runId}: dispatches ${workers.join(", ")}.`,
    role: "main",
    runId: run.runId,
    agentId: "orchestrator-main",
  });
  const implemented = settled(workers, 120_000);

  // A depth-one adversarial tester per worker, also in parallel.
  const testers = [
    start(task("[test:deck] Test the deck adversarially: run node --test and report findings. Do not modify product code. You cannot dispatch another worker.", "Adversarial test: deck")),
    start(task("[test:page] Test the page adversarially: run node --test and report findings. Do not modify product code. You cannot dispatch another worker.", "Adversarial test: page")),
  ];
  const tested = settled(testers, 120_000);
  recordEvidence(scoped, {
    status: Object.values(tested).every((outcome) => outcome === "succeeded") ? "completed" : "finding",
    summary: `Depth-one testers reported: ${Object.values(tested).join(", ")}. Findings go to the daemon's bounded review pass.`,
    detail: `Workers: ${JSON.stringify(implemented)}. Testers: ${JSON.stringify(tested)}.`,
    role: "main",
    runId: run.runId,
    agentId: "orchestrator-main",
  });
  return { runId: run.runId, workers, testers, implemented, tested };
}

/** The dispatcher's session — the Bot's chat turn in the in-app demo, or the
 *  monitor-released session of `make repro`: admit the durable workflow the
 *  prompt names, or open the worktree the delegation prompt names and start
 *  it there. The rounds themselves are the daemon's job. */
function release() {
  // Standing instructions win over the delegation template, the same way they
  // would for a real agent: when the prompt names the exact command to run
  // (the in-app demo does, so a small local model can follow it), run THAT
  // in this workspace instead of opening a worktree of our own.
  // A CONCRETE command only: instructions that spell the shape with
  // placeholders (`--workspace <id>`) are guidance, not something to run, and
  // running them verbatim is exactly how this fixture used to fail.
  const direct = directDispatch;
  if (direct) {
    const [, workspaceId, file] = direct;
    const scoped = { ...context, workspaceId };
    const started = cliJson(scoped, [
      "graph",
      "orchestrator-start",
      "--workspace",
      workspaceId,
      "--file",
      file,
    ]);
    if (!started?.run?.id) {
      throw new Error(`graph orchestrator-start did not return a workflow for ${workspaceId}`);
    }
    recordEvidence(scoped, {
      status: "progress",
      summary: releaseEvent
        ? `Monitor firing ${releaseEvent} released the work: durable workflow started here.`
        : "The Bot admitted the work: durable workflow started here.",
      detail: releaseEvent
        ? `Watched ${context.specPath ?? "the spec"} changed. Followed the responsibility's own instructions and started workflow ${started.run.id} in this workspace.`
        : `Followed the prompt's own instructions and started workflow ${started.run.id} in this workspace; the graph's main agent takes it from here.`,
      role: "release",
      runId: started.run.id,
      agentId,
    });
    process.stdout.write(
      releaseEvent
        ? `Released by ${releaseEvent}: workflow ${started.run.id} in ${workspaceId}\n`
        : `Admitted by the Bot: workflow ${started.run.id} in ${workspaceId}\n`,
    );
    return started.run.id;
  }

  const worktree = prompt.match(/worktree create --project (\S+) --name (\S+)/);
  if (!worktree) throw new Error("the delegation prompt named no worktree to create");
  const [, projectId, worktreeName] = worktree;

  let created = cliJson(context, [
    "worktree",
    "create",
    "--project",
    projectId,
    "--name",
    worktreeName,
    "--no-parent",
  ]);
  if (!created) {
    // A redelivered event reuses the worktree this name already made.
    const listed = cliJson(context, ["worktree", "list", "--project", projectId]);
    created = (listed?.worktrees ?? []).find((entry) => entry.name === worktreeName) ?? null;
  }
  if (!created?.workspaceId || !created?.path) {
    throw new Error(`could not open the released worktree '${worktreeName}'`);
  }

  // Role nodes launched inside this worktree must report to ITS workspace.
  const scoped = { ...context, workspaceId: created.workspaceId };
  mkdirSync(path.join(created.path, ".drogon"), { recursive: true });
  writeFileSync(
    path.join(created.path, ".drogon/repro-context.json"),
    `${JSON.stringify(scoped, null, 2)}\n`,
  );

  const intent = path.join(created.path, ".drogon/repro-intent.json");
  writeFileSync(intent, `${JSON.stringify({ nodes: [], policy: context.policy }, null, 2)}\n`);
  const wrote = cliJson(scoped, [
    "graph",
    "write-intent",
    "--workspace",
    created.workspaceId,
    "--file",
    intent,
  ]);
  if (!wrote) throw new Error("graph write-intent refused the released policy");

  let task = context.mainNode?.prompt ?? "";
  try {
    task = `${readFileSync(path.join(created.path, context.specPath ?? "specs/dog-tinder.md"), "utf8")}\n\n${task}`;
  } catch {
    // The spec is the better brief, but its absence is not fatal: the node
    // still carries the task text this run was configured with.
  }
  const mainFile = path.join(created.path, ".drogon/repro-main-node.json");
  writeFileSync(
    mainFile,
    `${JSON.stringify({ ...context.mainNode, prompt: task }, null, 2)}\n`,
  );
  const started = cliJson(scoped, [
    "graph",
    "orchestrator-start",
    "--workspace",
    created.workspaceId,
    "--file",
    mainFile,
  ]);
  if (!started?.run?.id) throw new Error("graph orchestrator-start did not return a workflow");

  recordEvidence(scoped, {
    status: "progress",
    summary: `Monitor firing ${releaseEvent} released the work: durable workflow started on this worktree.`,
    detail: `Watched ${context.specPath ?? "the spec"} changed. Opened worktree ${worktreeName} (${created.workspaceId}) and started workflow ${started.run.id} with adversarial testing.`,
    role: "release",
    runId: started.run.id,
    agentId: "monitor-release",
  });
  process.stdout.write(
    `Released by ${releaseEvent}: worktree ${worktreeName} (${created.workspaceId}), workflow ${started.run.id}\n`,
  );
  return started.run.id;
}

try {
  if (role === "worker") {
    worker();
    process.exit(0);
  }

  if (role === "release") {
    release();
    if (sentinel) process.stdout.write(`${sentinel}\n`);
    process.exit(0);
  }

  if (role === "main") {
    if (prompt.includes("main agent of the dispatched Dog Tinder graph")) {
      const fanout = orchestrate(context);
      log(context, { at: new Date().toISOString(), event: "graph-main-fanout", role, runId, botDispatcher: false, workers: fanout.workers, testers: fanout.testers });
      process.stdout.write(`Graph main agent: ${fanout.workers.length} workers and ${fanout.testers.length} testers settled.\n`);
    }
    // If the graph main's workers already built the deck, this node is
    // the director's final check, not a second implementation.
    const alreadyBuilt = existsSync(path.join(process.cwd(), "src", "deck.js"));
    if (!alreadyBuilt) applyStage(context, "agent-stage-1");
    const tests = runTests(process.cwd());
    process.stdout.write(`Dog Tinder deck ${alreadyBuilt ? "already built by the workers" : "written (stage 1)"}. ${describeTests(tests)}\n`);
    recordEvidence(context, {
      status: "completed",
      summary: alreadyBuilt
        ? "Main agent verified the workers' deck and handed it to the bounded test/review pass."
        : "Dog Tinder deck and storage implemented; page renders the profile queue.",
      detail: `${alreadyBuilt ? "src/deck.js, src/storage.js and index.html came from the parallel workers." : "Implemented src/deck.js, src/storage.js and index.html."} ${describeTests(tests)}`,
      role: "main",
      runId,
      agentId,
    });
    reportUsage(context, { role: "main", harness, model, runId, agentId });
    if (sentinel) process.stdout.write(`${sentinel}\n`);
    process.exit(0);
  }

  if (role === "test") {
    const tests = runTests(process.cwd());
    const green = tests.fail === 0 && (tests.pass ?? 0) > 0;
    const evidence = green
      ? `Ran the deck contract adversarially: ${describeTests(tests)}. Swipe, match, empty-deck, undo and reload paths all hold.`
      : `Ran the deck contract adversarially: ${describeTests(tests)}. Undo of the last swipe is missing, so a mis-swipe is unrecoverable and the reloaded deck cannot take one back.`;
    writeEvaluation(path.join(process.cwd(), evaluation), green ? "pass" : "findings", evidence);
    recordEvidence(context, {
      status: green ? "completed" : "finding",
      summary: green ? "Adversarial test found nothing left to break." : "Adversarial test: undo of the last swipe is missing.",
      detail: evidence,
      role: "test",
      runId,
      agentId,
    });
    reportUsage(context, { role: "test", harness, model, runId, agentId });
    process.stdout.write(`${evidence}\n`);
    if (sentinel) process.stdout.write(`${sentinel}\n`);
    process.exit(0);
  }

  const before = runTests(process.cwd());
  let evidence;
  let verdict;
  let changedCode = false;
  if (before.fail === 0 && (before.pass ?? 0) > 0) {
    verdict = "pass";
    evidence = `Reviewed the deck and re-ran the contract without changing product code: ${describeTests(before)}.`;
  } else {
    changedCode = true;
    applyStage(context, "agent-stage-2");
    const after = runTests(process.cwd());
    const fixed = after.fail === 0 && (after.pass ?? 0) > 0;
    verdict = fixed ? "pass" : "findings";
    evidence = fixed
      ? `Implemented one-level undo in src/deck.js (restores the cursor, the like/pass and the match it created; refuses a second undo) and wired the Undo control in index.html. Verified by re-running the contract: ${describeTests(after)} (was ${describeTests(before)}).`
      : `Applied the undo implementation but the re-run still fails: ${describeTests(after)}.`;
  }
  writeEvaluation(path.join(process.cwd(), evaluation), verdict, evidence);
  recordEvidence(context, {
    status: verdict === "pass" ? "completed" : "finding",
    summary:
      verdict !== "pass"
        ? "Code review: findings remain after the correction attempt."
        : changedCode
          ? "Code review: undo implemented and verified by re-running the contract."
          : "Code review: nothing left to fix; re-ran the contract to confirm.",
    detail: evidence,
    role: "review",
    runId,
    agentId,
  });
  reportUsage(context, { role: "review", harness, model, runId, agentId });
  process.stdout.write(`${evidence}\n`);
  if (sentinel) process.stdout.write(`${sentinel}\n`);
  process.exit(0);
} catch (error) {
  process.stderr.write(`repro fixture ${role} failed: ${error.message}\n`);
  process.exit(22);
}
