// One command that reproduces a whole Drogon run: a bot, the task it
// dispatches, the durable adversarial rounds over the Work Graph, and a receipt
// with the evidence, the verdicts and the cost.
//
//   make repro                     pick the harnesses, run, print the receipt
//   make repro FLAGS="--harness opencode --harness pi --iterations 2"
//   make repro-list                every run this checkout has produced
//
// Each invocation is its OWN run: a fresh run id, a fresh disposable world, a
// fresh project, worktree, bot and workflow, and a new receipt directory. It
// never touches the developer's Drogon, its data directory or its sessions.
//
// Demonstration only: every harness the picker offers runs as a local fixture
// (`reproduce-harness-agent.mjs`), so the product executes for real end to end
// while no model inference happens and no provider is billed. The receipt says
// so on every number it prints.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import {
  runAcceptanceProcess as exec,
  startAcceptanceProcess as start,
  captureDescendants,
  settleOwnedProcesses,
} from "./acceptance-process.mjs";
import { packagedFixtureDaemon } from "./packaged-fixture-daemon.mjs";
import { HARNESS_CATALOG, harnessById, writeHarnessFixtures } from "./reproduce-harness-fixture.mjs";
import { stageVerifiedRuntime } from "./mentu-runtime-provision.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const scenarioRoot = path.join(root, "scripts/scenarios");
const cliPath = path.join(root, "target/debug/drogon-cli");
const daemonPath = path.join(root, "target/debug/drogond");
const reproduceRoot = path.join(root, ".preflight/reproduce");
const indexPath = path.join(reproduceRoot, "index.json");
const defaultRates = path.join(root, "scripts/reproduce-model-rates.v1.json");

/** The only lane that runs a real model by default: the free local Pi model the
 *  product already uses as its zero-cost default. Any other harness needs an
 *  explicit --model in live mode; nothing here guesses a paid runtime. */
const LIVE_DEFAULT_MODELS = { pi: "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4" };

/** The spec the bot's monitor watches, relative to its workspace. */
const SPEC_PATH = "specs/dog-tinder.md";

/** Standing instructions on the reactive responsibility the monitor
 *  releases. The delegation prompt already tells the session to open the
 *  worktree; these say what to do with it, with the exact commands so a small
 *  local model can follow them literally. */
const RELEASE_INSTRUCTIONS = [
  "The Dog Tinder spec changed. Do not implement the deck yourself: set up the durable workflow and let the Work Graph do it.",
  "1. Open the worktree exactly as step 1 below says, and keep `.result.workspaceId` and `.result.path`.",
  "2. Copy `.drogon/repro-context.json` from the bot's workspace into the new worktree, replacing `workspaceId` with the worktree's own.",
  "3. Write the policy: `drogon-cli graph write-intent --workspace <id> --file <path>/.drogon/repro-intent.json` with `{\"nodes\":[],\"policy\":<the policy from the context>}`.",
  "4. Start the rounds: `drogon-cli graph orchestrator-start --workspace <id> --file <path>/.drogon/repro-main-node.json`, with the context's main node and the text of `specs/dog-tinder.md` as its prompt.",
  "5. Record a checkpoint with `drogon-cli graph evidence-add` and finish. The daemon runs the adversarial rounds on its own.",
].join("\n");

const RUN_POLL_MS = 1200;
/** How long the rounds may take. A fixture answers in seconds; a real model
 *  writing this deck takes a lot longer, and the free local lane longest of
 *  all — so the bound follows the lane instead of failing honest work. */
const FIXTURE_RUN_TIMEOUT_MS = 15 * 60_000;
const LIVE_RUN_TIMEOUT_MS = 45 * 60_000;

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const options = {
    harnesses: [],
    iterations: 2,
    scenario: "dog-tinder",
    release: "monitor",
    model: null,
    live: false,
    out: null,
    rates: defaultRates,
    keep: false,
    list: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`${arg} needs a value`);
      }
      index += 1;
      return next;
    };
    switch (arg) {
      case "--harness":
        options.harnesses.push(...value().split(",").map((id) => id.trim()).filter(Boolean));
        break;
      case "--iterations":
        options.iterations = Number(value());
        break;
      case "--scenario":
        options.scenario = value();
        break;
      case "--model":
        options.model = value();
        break;
      case "--release": {
        const mode = value();
        if (mode !== "monitor" && mode !== "script") {
          throw new Error("--release takes 'monitor' (the bot's file watch) or 'script'");
        }
        options.release = mode;
        break;
      }
      case "--live":
        options.live = true;
        break;
      case "--out":
        options.out = value();
        break;
      case "--rates":
        options.rates = value();
        break;
      case "--keep":
        options.keep = true;
        break;
      case "--list":
        options.list = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }
  if (!Number.isInteger(options.iterations) || options.iterations < 1 || options.iterations > 10) {
    throw new Error("--iterations takes a whole number of rounds from 1 to 10");
  }
  for (const id of options.harnesses) {
    const harness = harnessById(id);
    if (!harness) throw new Error(`Unknown harness '${id}'. Known: ${HARNESS_CATALOG.map((h) => h.id).join(", ")}`);
    if (!harness.graphCapable) throw new Error(`'${id}' cannot run a Work Graph node: ${harness.adapter}`);
  }
  return options;
}

const USAGE = `Drogon reproducible adversarial run

  node scripts/reproduce-adversarial-run.mjs [options]

  --harness <id[,id]>  harness(es) to run with; repeatable. The first one runs
                       the main agent, the rest become the approved runtimes
                       for the adversarial roles, in that order. Omit it and
                       the command asks.
  --iterations <1-10>  how many adversarial rounds are allowed (default 2)
  --live               run the REAL harness installed on this host instead of
                       the local fixture. With --harness pi this is the free
                       local lane: dgx-spark/qwen3.8-flash-next-nvidia-nvfp4.
  --model <id>         exact model id (required in live mode for any harness
                       without a declared free lane)
  --release <mode>     'monitor' (default): a bot file-digest monitor over the
                       spec releases the work when this run changes it.
                       'script': skip the watch and start the workflow
                       directly (faster, for tests)
  --scenario <name>    scenario under scripts/scenarios (default dog-tinder)
  --out <dir>          receipt directory (default .preflight/reproduce/<run>)
  --rates <path>       rate card for the cost column
  --keep               keep the disposable world for inspection
  --list               list the runs this checkout has produced
  --json               print the receipt as JSON instead of the report
`;

// ---------------------------------------------------------------- presentation

const tty = process.stdout.isTTY === true;
const paint = (code, text) => (tty ? `[${code}m${text}[0m` : text);
const bold = (text) => paint("1", text);
const dim = (text) => paint("2", text);
const teal = (text) => paint("36", text);
const green = (text) => paint("32", text);
const amber = (text) => paint("33", text);
const red = (text) => paint("31", text);

function banner(runId, options) {
  const line = "─".repeat(64);
  process.stdout.write(`\n${teal(line)}\n`);
  process.stdout.write(`${bold("Drogon · reproducible adversarial run")}\n`);
  process.stdout.write(
    `${dim(`run ${runId} · scenario ${options.scenario} · up to ${options.iterations} round(s)`)}\n`,
  );
  process.stdout.write(
    `${dim(
      options.live
        ? "live lane: the harness installed on this host (the free local model by default)"
        : "demonstration: every harness runs as a local fixture — no inference, $0.00 spent",
    )}\n`,
  );
  process.stdout.write(`${teal(line)}\n`);
}

const phases = [];
function phase(id, title) {
  const started = Date.now();
  const clear = () => {
    if (tty) process.stdout.write("\r\u001b[2K");
  };
  if (tty) process.stdout.write(`${bold(id.padEnd(4))}${title} ${dim("…")}\r`);
  return {
    ok(detail = "") {
      const ms = Date.now() - started;
      phases.push({ id, title, status: "ok", ms, detail });
      clear();
      process.stdout.write(
        `${bold(id.padEnd(4))}${title.padEnd(34, " ")} ${green("ok")} ${dim(detail)}\n`,
      );
    },
    fail(message) {
      const ms = Date.now() - started;
      phases.push({ id, title, status: "failed", ms, detail: message });
      clear();
      process.stdout.write(
        `${bold(id.padEnd(4))}${title.padEnd(34, " ")} ${red("failed")} ${dim(message)}\n`,
      );
    },
  };
}

// ---------------------------------------------------------------- harness choice

async function hostStatus(exe) {
  try {
    const { stdout } = await exec("/usr/bin/which", [exe], { timeout: 5000 });
    return stdout.trim() ? "installed" : "not installed";
  } catch {
    return "not installed";
  }
}

async function chooseHarnesses(preselected) {
  if (preselected.length > 0) return preselected;

  const rows = [];
  for (const harness of HARNESS_CATALOG) {
    rows.push({ ...harness, host: harness.exe ? await hostStatus(harness.exe) : "—" });
  }

  process.stdout.write(`\n${bold("Which harnesses should the demonstration run with?")}\n\n`);
  rows.forEach((harness, index) => {
    const number = harness.graphCapable ? `${index + 1}` : " ";
    const label = harness.graphCapable ? harness.id : dim(harness.id);
    process.stdout.write(
      `  ${bold(number.padStart(2))}  ${label.padEnd(harness.graphCapable ? 14 : 22)}${harness.host.padEnd(14)}${dim(harness.adapter)}\n`,
    );
  });
  process.stdout.write(
    `\n${dim("The first runs the main agent; the rest become approved runtimes,")}\n${dim("in that order, for the adversarial roles. e.g. 3,4 — or Enter for 3,4.")}\n\n`,
  );

  if (!process.stdin.isTTY) {
    const fallback = ["opencode", "pi"];
    process.stdout.write(`${dim(`no TTY: using ${fallback.join(", ")}`)}\n`);
    return fallback;
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const answer = (await readline.question(`${bold(">")} `)).trim();
      if (!answer) return ["opencode", "pi"];
      const picked = [];
      let invalid = null;
      for (const token of answer.split(/[,\s]+/).filter(Boolean)) {
        const byNumber = Number(token);
        const harness = Number.isInteger(byNumber)
          ? (HARNESS_CATALOG[byNumber - 1] ?? null)
          : harnessById(token.toLowerCase());
        if (!harness || !harness.graphCapable) {
          invalid = token;
          break;
        }
        if (!picked.includes(harness.id)) picked.push(harness.id);
      }
      if (invalid) {
        process.stdout.write(`${amber(`'${invalid}' cannot run a Work Graph node. Try again.`)}\n`);
        continue;
      }
      if (picked.length > 0) return picked;
    }
    throw new Error("no harness selection after three attempts");
  } finally {
    readline.close();
  }
}

// ---------------------------------------------------------------- cost

/** Prices one usage ledger against a rate card. Missing tokens are never zero
 *  and an unpriced model is never guessed: both surface as their own bucket. */
export function priceUsage(entries, card) {
  const rates = card?.rates ?? {};
  const lookup = (entry) => {
    const model = (entry.model ?? "").trim();
    const harness = (entry.harness ?? "").trim();
    for (const key of [`${harness}/${model}`, model]) {
      if (key && rates[key]) return { key, rate: rates[key] };
    }
    return null;
  };
  const cost = (rate, entry) =>
    ((entry.inputTokens ?? 0) / 1e6) * (rate.input ?? 0) +
    ((entry.outputTokens ?? 0) / 1e6) * (rate.output ?? 0) +
    ((entry.cacheReadTokens ?? 0) / 1e6) * (rate.cacheRead ?? 0) +
    ((entry.cacheWriteTokens ?? 0) / 1e6) * (rate.cacheWrite ?? 0);

  const byRole = {};
  const kinds = new Set();
  const unpriced = [];
  let priced = 0;
  let totalUsd = 0;
  let inputTokens = null;
  let outputTokens = null;

  for (const entry of entries) {
    if (typeof entry.inputTokens === "number") inputTokens = (inputTokens ?? 0) + entry.inputTokens;
    if (typeof entry.outputTokens === "number") outputTokens = (outputTokens ?? 0) + entry.outputTokens;
    const found = lookup(entry);
    if (!found) {
      unpriced.push({ harness: entry.harness ?? null, model: entry.model ?? null });
      continue;
    }
    priced += 1;
    kinds.add(found.rate.kind ?? "unknown");
    const value = cost(found.rate, entry);
    totalUsd += value;
    const role = entry.role ?? "unattributed";
    byRole[role] = Number(((byRole[role] ?? 0) + value).toFixed(6));
  }

  let bucket;
  if (entries.length === 0) bucket = "not_reported";
  else if (priced === 0) bucket = "unpriced";
  else if (unpriced.length > 0) bucket = "partial";
  else if ([...kinds].every((kind) => kind === "local_free")) bucket = "local_free";
  else bucket = "exact";

  return {
    bucket,
    totalUsd: priced === 0 ? null : Number(totalUsd.toFixed(6)),
    source: "api_equivalent",
    rateKinds: [...kinds],
    measurements: entries.length,
    pricedMeasurements: priced,
    unpriced,
    inputTokens,
    outputTokens,
    byRole,
  };
}

// Shared ownership cleanup is independent of workflow runtime provisioning.
export { captureDescendants, settleOwnedProcesses } from "./acceptance-process.mjs";

// ---------------------------------------------------------------- runs index

async function readIndex() {
  try {
    return JSON.parse(await readFile(indexPath, "utf8"));
  } catch {
    return { version: 1, runs: [] };
  }
}

async function appendIndex(entry) {
  const index = await readIndex();
  index.runs.push(entry);
  await mkdir(reproduceRoot, { recursive: true });
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  return index.runs.length;
}

async function listRuns() {
  const index = await readIndex();
  if (index.runs.length === 0) {
    process.stdout.write(`${dim("no runs yet. Try: make repro")}\n`);
    return;
  }
  process.stdout.write(`\n${bold(`${index.runs.length} run(s)`)}\n\n`);
  for (const [position, run] of index.runs.entries()) {
    const status = run.status === "PASSED" ? green(run.status) : run.status === "EXHAUSTED" ? amber(run.status) : red(run.status);
    const cost = run.costUsd === null || run.costUsd === undefined ? "—" : `$${run.costUsd.toFixed(4)}`;
    process.stdout.write(
      `  ${String(position + 1).padStart(2)}  ${run.runId.padEnd(22)}${status.padEnd(18)}${String(run.harnesses.join("+")).padEnd(20)}${dim(`${run.rounds} round(s) · ${cost} · ${run.receipt}`)}\n`,
    );
  }
  process.stdout.write("\n");
}

// ---------------------------------------------------------------- the run

async function cliJson(dataDir, args, options = {}) {
  const { stdout } = await exec(cliPath, ["--data-dir", dataDir, "--json", ...args], {
    timeout: 60_000,
    ...options,
  });
  const value = JSON.parse(stdout);
  assert.equal(value.ok, true, stdout);
  return value.result;
}

async function until(check, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  for (;;) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() > deadline) {
      throw new Error(`${label} (${Math.round(timeoutMs / 1000)}s)${lastError ? `: ${lastError.message}` : ""}`);
    }
    await delay(RUN_POLL_MS);
  }
}

async function ensureCore() {
  for (const binary of [daemonPath, cliPath]) {
    try {
      await readFile(binary);
    } catch {
      const step = phase("P0", "build the core (once)");
      try {
        await exec("cargo", ["build", "--workspace", "--locked"], { cwd: root, timeout: 20 * 60_000 });
        step.ok();
      } catch (error) {
        step.fail(error.message);
        throw error;
      }
      return;
    }
  }
}

/** The pinned recipe runtime the durable orchestrator requires. Mentu is
 *  optional in the product since #533, so this resolves it without ever
 *  writing into the developer's installed Drogon: whatever verified copy the
 *  host already has is copied into this run's own data directory. */
export async function resolveRuntime(dataDir) {
  return stageVerifiedRuntime(dataDir, root);
}

async function seedRepository(repo, scenario) {
  await mkdir(repo, { recursive: true });
  await cp(path.join(scenario, "seed"), repo, { recursive: true });
  const git = (args) => exec("/usr/bin/git", args, { cwd: repo, timeout: 30_000 });
  await git(["init", "--quiet", "--initial-branch=main"]);
  await git(["config", "user.email", "repro@drogon.local"]);
  await git(["config", "user.name", "Drogon repro"]);
  await git(["add", "."]);
  await git(["commit", "--quiet", "-m", "Dog Tinder: profiles and the deck contract"]);
  return repo;
}

async function readJsonIfPresent(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function summarizeSteps(run) {
  return (run?.steps ?? []).map((step) => ({
    iteration: step.iteration,
    phase: step.phase,
    nodeId: step.nodeId,
    status: step.status,
    verdict: step.verdict ?? null,
    isFallback: step.isFallback === true,
    runtime: step.runtime ? `${step.runtime.harness}/${step.runtime.model}` : null,
    attempts: (step.attempts ?? []).map((attempt) => ({
      harness: attempt.harness,
      model: attempt.model,
      outcome: attempt.outcome,
      reason: attempt.reason ?? null,
    })),
  }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (options.list) {
    await listRuns();
    return 0;
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");
  const runId = `${stamp}-${randomBytes(2).toString("hex")}`;
  const outDir = options.out ? path.resolve(options.out) : path.join(reproduceRoot, runId);
  const scenario = path.join(scenarioRoot, options.scenario);

  banner(runId, options);
  const harnesses = await chooseHarnesses(options.harnesses);
  const modelFor = (harness) => {
    if (options.model) return options.model;
    if (!options.live) return harness.model;
    const lane = LIVE_DEFAULT_MODELS[harness.id];
    if (!lane) {
      throw new Error(
        `--live needs --model for '${harness.id}': only pi has a declared free lane (${LIVE_DEFAULT_MODELS.pi}).`,
      );
    }
    return lane;
  };
  const withModel = (harness) => ({ ...harness, model: modelFor(harness) });
  const mainHarness = withModel(harnessById(harnesses[0]));
  const roleHarnesses = (harnesses.length > 1 ? harnesses.slice(1) : harnesses)
    .map(harnessById)
    .map(withModel);
  const fallbackCandidate = HARNESS_CATALOG.find(
    (entry) => entry.graphCapable && !harnesses.includes(entry.id),
  );
  // In live mode a fallback would be a second real runtime to reason about;
  // keep the ladder honest by only declaring one we have a model for.
  const fallback =
    fallbackCandidate && (!options.live || LIVE_DEFAULT_MODELS[fallbackCandidate.id])
      ? withModel(fallbackCandidate)
      : null;
  process.stdout.write(
    `\n${dim(`main agent: ${mainHarness.id} · adversarial roles: ${roleHarnesses.map((h) => h.id).join(" → ")}${fallback ? ` · unapproved fallback: ${fallback.id}` : ""}`)}\n\n`,
  );

  const receipt = {
    kind: "drogon-reproducible-adversarial-run",
    status: "FAILED",
    runId,
    startedAt: new Date().toISOString(),
    demonstrationOnly: true,
    lane: options.live ? "live" : "fixture",
    agentKind: options.live
      ? "real harness installed on this host"
      : "fixture-harness (deterministic, no model inference, no provider spend)",
    identity: {},
    selection: {
      harnesses,
      mainAgent: null,
      approvedRuntimes: [],
      fallbackRuntime: null,
      iterationsAllowed: options.iterations,
      scenario: options.scenario,
    },
    chain: {},
    rounds: [],
    evidence: [],
    usage: [],
    cost: null,
    verification: null,
    artifacts: {},
    processes: [],
    phases,
  };

  await ensureCore();

  const world = await mkdtemp(path.join(tmpdir(), "dtr-"));
  const dataDir = path.join(world, "data");
  const repo = path.join(world, "repo");
  const bin = path.join(world, "bin");
  const invocationLog = path.join(world, "harness-invocations.jsonl");
  let daemon = null;
  let daemonHandle = null;
  const owned = new Map();
  let workspaceId = null;
  let orchestratorRun = null;
  let failure = null;

  try {
    // P0 — identity. A receipt is only comparable if it says what ran.
    const step0 = phase("P0", "build identity");
    const gitRev = (await exec("/usr/bin/git", ["rev-parse", "--short", "HEAD"], { cwd: root })).stdout.trim();
    const cliVersion = (await exec(cliPath, ["--version"])).stdout.trim();
    receipt.identity = { gitRev, cliVersion, node: process.version, platform: `${process.platform}-${process.arch}` };
    step0.ok(`rev ${gitRev} · ${cliVersion}`);

    // P1 — a disposable world, and the runtime the orchestrator requires.
    const step1 = phase("P1", "disposable world + runtime");
    await mkdir(dataDir, { recursive: true });
    await writeFile(invocationLog, "");
    const runtime = await resolveRuntime(dataDir);
    receipt.identity.runtime = { revision: runtime.revision, sha256: runtime.sha256, source: runtime.source };
    if (!options.live) {
      await writeHarnessFixtures(bin, [...new Set([...harnesses, ...(fallback ? [fallback.id] : [])])]);
    } else {
      await mkdir(bin, { recursive: true });
    }
    await seedRepository(repo, scenario);
    step1.ok(world);

    // P2 — the daemon this run owns.
    const step2 = phase("P2", "its own daemon");
    const env = {
      ...process.env,
      PATH: options.live
        ? [path.dirname(process.execPath), process.env.PATH ?? "/usr/bin:/bin"].join(path.delimiter)
        : [bin, path.dirname(process.execPath), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(path.delimiter),
      DROGON_MENTU_RUNTIME: runtime.path,
      DROGON_BACKGROUND_WINDOW: "1",
      DROGON_REPRO_CONTEXT: path.join(world, "repro-context.json"),
    };
    daemon = start(daemonPath, ["--data-dir", dataDir], { cwd: world, env, stdio: ["ignore", "ignore", "pipe"] });
    let daemonStderr = "";
    const daemonLog = path.join(world, "daemon.stderr.log");
    daemon.stderr?.on("data", (chunk) => {
      daemonStderr += chunk.toString();
      appendFileSync(daemonLog, chunk);
    });
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        await cliJson(dataDir, ["status"]);
        break;
      } catch (error) {
        if (Date.now() > deadline) throw new Error(`daemon did not answer: ${error.message} ${daemonStderr}`);
        await delay(200);
      }
    }
    daemonHandle = packagedFixtureDaemon(daemonPath, cliPath, dataDir);
    await daemonHandle.capture();
    const discovered = await cliJson(dataDir, ["harness", "list"]);
    const discoveredIds = (discovered.harnesses ?? [])
      .filter((entry) => entry.availability === "available")
      .map((entry) => entry.harnessId);
    for (const harness of [mainHarness, ...roleHarnesses]) {
      assert.ok(
        discoveredIds.includes(harness.id),
        `the daemon did not discover '${harness.id}' on this run's PATH (found: ${discoveredIds.join(", ")})`,
      );
    }
    step2.ok(`pid ${daemon.pid} · harnesses ${discoveredIds.join(", ")}`);

    // P3 — the project and the workspace the bot lives in. The bot has to
    // sit on the workspace that IS the project root: a monitor-released run
    // resolves the Project from its workspace path so it can open a worktree,
    // and a child worktree has no project of its own (the daemon refuses it
    // with exactly that reason).
    const step3 = phase("P3", "project and workspace");
    const project = await cliJson(dataDir, ["project", "add", repo, "--name", `dog-tinder-${runId}`], { cwd: world });
    const projectId = project.id ?? project.projectId;
    const registered = await cliJson(dataDir, ["workspace", "add", repo, "--name", `dog-tinder-${runId}`], { cwd: world });
    workspaceId = registered.id ?? registered.workspaceId;
    const workspacePath = registered.path ?? repo;
    receipt.chain.projectId = projectId;
    receipt.chain.workspaceId = workspaceId;
    receipt.chain.workspacePath = workspacePath;
    step3.ok(`workspace ${workspaceId}`);

    // Everything the monitor-released session needs to continue THIS run:
    // where the CLI is, the policy this run configured, and the task node.
    const brief = await readFile(path.join(scenario, "brief.md"), "utf8");
    const policy = {
      approvedRuntimes: roleHarnesses.map((harness) => ({ harness: harness.id, model: harness.model })),
      ...(fallback ? { fallbackRuntime: { harness: fallback.id, model: fallback.model } } : {}),
      adversarial: { enabled: true, maxIterations: options.iterations },
      delegate: false,
    };
    const mainNode = {
      id: "orchestrator-main",
      title: "Dog Tinder with undo of the last swipe",
      harness: mainHarness.id,
      model: mainHarness.model,
      dependsOn: [],
      enabled: true,
      prompt: brief,
    };
    const context = {
      cli: cliPath,
      dataDir,
      workspaceId,
      runId,
      model: mainHarness.model,
      stagesDir: scenario,
      invocationLog,
      policy,
      mainNode,
      specPath: SPEC_PATH,
    };
    const writeContext = async (root, value) => {
      await mkdir(path.join(root, ".drogon"), { recursive: true });
      await writeFile(
        path.join(root, ".drogon/repro-context.json"),
        `${JSON.stringify(value, null, 2)}\n`,
      );
    };
    await writeContext(workspacePath, context);
    await writeFile(path.join(world, "repro-context.json"), `${JSON.stringify(context, null, 2)}\n`);

    // P4 — the bot that owns the watch.
    const step4 = phase("P4", "bot");
    const status = await cliJson(dataDir, ["status"]);
    const botId = `dog-tinder-bot-${runId}`;
    const bot = await cliJson(dataDir, [
      "rpc",
      "bot.create",
      "--params",
      JSON.stringify({
        workspaceId,
        hostId: status.hostId,
        botId,
        locale: "es-MX",
        body: {
          characterPreset: "arya",
          displayIdentity: {
            displayName: `White walker ${runId.slice(-6)}`,
            // The handle is an identity the daemon refuses to reuse: the run's
            // own random suffix keeps a second run from colliding with the first.
            handle: `white-walker-${runId.slice(-6)}`,
            title: "Watches the deck's spec",
          },
          harnessPolicy: { defaultHarness: mainHarness.id, explicitModel: mainHarness.model },
          instructions: brief,
          memories: ["This run is a reproducible demonstration; none of it is production."],
        },
      }),
    ]);
    receipt.chain.botId = bot.id ?? botId;
    step4.ok(`${bot.id ?? botId} · harness ${mainHarness.id}`);

    // P5 — the Subagent policy on this workspace. The released worktree gets
    // its own copy, written by the session the monitor releases.
    const step5 = phase("P5", "Work Graph policy");
    const intentFile = path.join(world, "intent.json");
    await writeFile(intentFile, `${JSON.stringify({ nodes: [], policy }, null, 2)}\n`);
    await cliJson(dataDir, ["graph", "write-intent", "--workspace", workspaceId, "--file", intentFile]);
    const storedGraph = await cliJson(dataDir, ["graph", "read", "--workspace", workspaceId]);
    const storedPolicy = storedGraph.graph?.intent?.policy ?? storedGraph.intent?.policy;
    assert.equal(storedPolicy.adversarial.enabled, true, "the stored policy did not enable adversarial testing");
    assert.equal(storedPolicy.adversarial.maxIterations, options.iterations, "the stored iteration bound differs");
    assert.equal(
      storedPolicy.approvedRuntimes.map((runtime) => runtime.harness).join(","),
      roleHarnesses.map((harness) => harness.id).join(","),
      "the stored approved runtimes differ from the selection",
    );
    receipt.selection.mainAgent = { harness: mainHarness.id, model: mainHarness.model };
    receipt.selection.approvedRuntimes = policy.approvedRuntimes;
    receipt.selection.fallbackRuntime = policy.fallbackRuntime ?? null;
    step5.ok(
      `approved ${policy.approvedRuntimes.map((r) => r.harness).join(", ")}${fallback ? ` · fallback ${fallback.id}` : ""}`,
    );

    let activeWorkspaceId = workspaceId;
    let activeWorkspacePath = workspacePath;
    let releasedBy = "script";

    if (options.release === "monitor") {
      // A monitor that refuses, or a release that never lands, is real
      // evidence — not a reason to lose the run. It is recorded and the
      // workflow starts directly below, with the receipt saying so.
      try {
        // P6 — the watch. Armed while the spec does NOT exist yet, so the
        // firing this run waits for is caused by the spec it writes next and
        // not by a file that was already sitting there.
        const step6 = phase("P6", "watch on the spec");
        const monitorScope = { hostId: status.hostId, workspaceId, botId: bot.id ?? botId };
        const monitor = await cliJson(dataDir, [
          "rpc",
          "bot.monitor_create",
          "--params",
          JSON.stringify({
            ...monitorScope,
            kind: "local_file_digest.v1",
            resource: SPEC_PATH,
            cron: "* * * * *",
            responsibilityName: "Rondas adversariales de Dog Tinder",
            instructions: RELEASE_INSTRUCTIONS,
          }),
        ]);
        await cliJson(dataDir, [
          "rpc",
          "bot.monitor_approve",
          "--params",
          JSON.stringify({ ...monitorScope, monitorId: monitor.monitorId }),
        ]);
        receipt.chain.monitor = {
          monitorId: monitor.monitorId,
          ruleKind: monitor.ruleKind,
          resource: SPEC_PATH,
          cron: "* * * * *",
          responsibilityId: monitor.responsibilityId ?? null,
        };
        step6.ok(`${monitor.ruleKind} · ${SPEC_PATH} · every minute`);

        const readMonitor = async () => {
          const listed = await cliJson(dataDir, [
            "rpc",
            "bot.monitor_list",
            "--params",
            JSON.stringify(monitorScope),
          ]);
          return (listed.monitors ?? []).find((entry) => entry.monitorId === monitor.monitorId) ?? null;
        };

        // P7 — the monitor's first check, before the spec exists: an honest
        // "not found", no event, nothing dispatched.
        const step7 = phase("P7", "first check (spec absent)");
        const first = await until(
          async () => {
            const view = await readMonitor();
            return view?.lastCheckOutcome ? view : null;
          },
          "the watch never ran its first check",
          180_000,
        );
        receipt.chain.monitor.firstCheck = {
          outcome: first.lastCheckOutcome,
          error: first.lastError ?? null,
        };
        step7.ok(`${first.lastCheckOutcome}${first.lastError ? ` · ${first.lastError}` : ""}`);

        // P8 — the change the monitor is watching for.
        const step8 = phase("P8", "the script writes the spec");
        const specText = await readFile(path.join(scenario, "spec.md"), "utf8");
        const specFile = path.join(workspacePath, SPEC_PATH);
        await mkdir(path.dirname(specFile), { recursive: true });
        await writeFile(specFile, specText);
        receipt.chain.specChange = {
          path: SPEC_PATH,
          bytes: Buffer.byteLength(specText),
          lines: specText.split("\n").length,
        };
        step8.ok(`${SPEC_PATH} · ${Buffer.byteLength(specText)} bytes`);

        // P9 — the monitor sees it and releases real work. Each check the
        // daemon records is printed as it happens: the demo shows the watch
        // working, not a spinner.
        const step9 = phase("P9", "the watch wakes the bot");
        const checks = [];
        const seenChecks = new Set();
        const fired = await until(
          async () => {
            const view = await readMonitor();
            if (!view) return null;
            const key = `${view.lastCheckAtMs}:${view.lastCheckOutcome}:${view.lastEventId ?? ""}:${view.firing?.lastOutcome ?? ""}`;
            if (!seenChecks.has(key)) {
              seenChecks.add(key);
              checks.push({
                outcome: view.lastCheckOutcome ?? null,
                eventId: view.lastEventId ?? null,
                error: view.lastError ?? null,
                firing: view.firing?.lastOutcome ?? null,
                health: view.health ?? null,
              });
              process.stdout.write(
                `      ${dim(`check ${view.lastCheckOutcome ?? "—"}${view.lastEventId ? ` · event ${view.lastEventId}` : ""}${view.firing?.lastOutcome ? ` · firing ${view.firing.lastOutcome}` : ""}${view.lastError ? ` · ${view.lastError}` : ""}`)}\n`,
              );
            }
            const firing = view.firing ?? null;
            return firing && firing.lastEventId ? { view, firing } : null;
          },
          "the watch never fired on the spec change",
          300_000,
        ).catch((error) => {
          receipt.chain.monitor.checks = checks;
          throw error;
        });
        receipt.chain.monitor.checks = checks;
        receipt.chain.monitor.firing = {
          eventId: fired.firing.lastEventId,
          outcome: fired.firing.lastOutcome,
          runId: fired.firing.lastRunId || null,
          detail: fired.firing.lastDetail || null,
          resource: fired.firing.lastResource || SPEC_PATH,
          countToday: fired.firing.countToday ?? null,
        };
        if (fired.firing.lastOutcome !== "dispatched" && fired.firing.lastOutcome !== "joined") {
          step9.fail(`evento ${fired.firing.lastEventId} · ${fired.firing.lastOutcome} · ${fired.firing.lastDetail ?? ""}`);
          throw new Error(
            `the watch fired but no work was released (${fired.firing.lastOutcome}): ${fired.firing.lastDetail ?? "no detail"}`,
          );
        }
        step9.ok(`event ${fired.firing.lastEventId} · ${fired.firing.lastOutcome}`);

        // P10 — the released session opens its own worktree and starts the
        // workflow there. We observe that, we do not do it.
        const step10 = phase("P10", "released workflow");
        try {
          const released = await until(
            async () => {
              const listed = await cliJson(dataDir, ["worktree", "list", "--project", projectId]);
              const candidates = (listed.worktrees ?? []).filter(
                (entry) => entry.workspaceId && entry.workspaceId !== workspaceId,
              );
              for (const candidate of candidates) {
                const state = await cliJson(dataDir, [
                  "graph",
                  "orchestrator-status",
                  "--workspace",
                  candidate.workspaceId,
                ]).catch(() => null);
                if (state?.run?.id) return { candidate, run: state.run };
              }
              return null;
            },
            "the released session never started a workflow",
            240_000,
          );
          activeWorkspaceId = released.candidate.workspaceId;
          activeWorkspacePath = released.candidate.path;
          orchestratorRun = released.run;
          releasedBy = "monitor";
          receipt.chain.releasedWorktree = {
            name: released.candidate.name ?? null,
            workspaceId: activeWorkspaceId,
            path: activeWorkspacePath,
          };
          step10.ok(`${released.candidate.name ?? activeWorkspaceId} · workflow ${orchestratorRun.id}`);
        } catch (error) {
          step10.fail(`${error.message} — continuing with the workflow from the script`);
          receipt.chain.releaseFallbackReason = error.message;
        }
    } catch (error) {
        receipt.chain.releaseFallbackReason = error.message;
        process.stdout.write(`      ${amber(`the watch did not release the work: ${error.message}`)}\n`);
      }
    }

    if (!orchestratorRun) {
      // Either --release script, or the monitor chain did not settle in time.
      // Either way the receipt says which of the two started this workflow.
      const stepStart = phase("PS", "workflow (started directly)");
      const specText = await readFile(path.join(scenario, "spec.md"), "utf8");
      const specFile = path.join(activeWorkspacePath, SPEC_PATH);
      await mkdir(path.dirname(specFile), { recursive: true });
      await writeFile(specFile, specText);
      const mainFile = path.join(world, "main-node.json");
      await writeFile(
        mainFile,
        `${JSON.stringify({ ...mainNode, prompt: `${specText}\n\n${brief}` }, null, 2)}\n`,
      );
      const started = await cliJson(dataDir, [
        "graph",
        "orchestrator-start",
        "--workspace",
        activeWorkspaceId,
        "--file",
        mainFile,
      ]);
      orchestratorRun = started.run;
      stepStart.ok(`workflow ${orchestratorRun.id}`);
    }
    receipt.chain.orchestratorRunId = orchestratorRun.id;
    receipt.chain.releasedBy = releasedBy;
    receipt.chain.activeWorkspaceId = activeWorkspaceId;

    // P7 — the rounds, as the daemon observes them.
    const stepRounds = phase("PR", "adversarial rounds");
    const seen = new Set();
    const runTimeoutMs = options.live ? LIVE_RUN_TIMEOUT_MS : FIXTURE_RUN_TIMEOUT_MS;
    const runDeadline = Date.now() + runTimeoutMs;
    for (;;) {
      const status = await cliJson(dataDir, ["graph", "orchestrator-status", "--workspace", activeWorkspaceId]);
      orchestratorRun = status.run ?? orchestratorRun;
      for (const step of orchestratorRun.steps ?? []) {
        const key = `${step.nodeId}:${step.status}:${step.verdict ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (step.status === "running" || step.status === "dispatching") {
          const runtime = step.runtime ? `${step.runtime.harness}/${step.runtime.model}` : "…";
          process.stdout.write(`      ${dim(`round ${step.iteration} · ${step.phase.padEnd(6)} → ${runtime}`)}\n`);
        }
        if (step.verdict) {
          const mark = step.verdict === "pass" ? green("pass") : amber("findings");
          process.stdout.write(`      ${dim(`round ${step.iteration} · ${step.phase.padEnd(6)} ⇒ `)}${mark}\n`);
        }
      }
      if (["passed", "exhausted", "failed", "stopped", "unverifiable"].includes(orchestratorRun.status)) break;
      if (Date.now() > runDeadline)
        throw new Error(`the workflow did not settle in ${runTimeoutMs / 60000} minutes`);
      await delay(RUN_POLL_MS);
    }
    receipt.rounds = summarizeSteps(orchestratorRun);
    receipt.workflowStatus = orchestratorRun.status;
    receipt.workflowError = orchestratorRun.error ?? null;
    if (orchestratorRun.status === "passed") stepRounds.ok(`${orchestratorRun.iteration} round(s) · passed`);
    else if (orchestratorRun.status === "exhausted") stepRounds.ok(`${orchestratorRun.iteration} round(s) · cap reached, still failing`);
    else stepRounds.fail(`${orchestratorRun.status}${orchestratorRun.error ? `: ${orchestratorRun.error}` : ""}`);

    // P8 — evidence, independent verification, cost.
    const stepEvidence = phase("PE", "evidence, verification and cost");
    const observability = await cliJson(dataDir, ["graph", "observability", "--workspace", activeWorkspaceId]);
    const snapshot = observability.observability ?? observability;
    receipt.evidence = snapshot.evidence ?? [];
    receipt.usage = snapshot.usage ?? [];
    const card = JSON.parse(await readFile(options.rates, "utf8"));
    receipt.cost = {
      ...priceUsage(receipt.usage, card),
      rateCard: { version: card.version, path: path.relative(root, options.rates), note: card.note },
    };
    const verification = await exec(process.execPath, ["--test", "--test-reporter", "tap"], {
      cwd: activeWorkspacePath,
      timeout: 120_000,
    }).catch((error) => ({ stdout: error.stdout ?? "", stderr: error.stderr ?? "", failed: true }));
    const tap = `${verification.stdout ?? ""}${verification.stderr ?? ""}`;
    const number = (label) => Number(tap.match(new RegExp(`^# ${label} (\\d+)$`, "m"))?.[1] ?? NaN);
    receipt.verification = {
      command: "node --test",
      cwd: path.relative(world, activeWorkspacePath),
      pass: Number.isNaN(number("pass")) ? null : number("pass"),
      fail: Number.isNaN(number("fail")) ? null : number("fail"),
      independentOfTheAgents: true,
    };
    stepEvidence.ok(
      `${receipt.evidence.length} checkpoints · node --test ${receipt.verification.pass ?? "?"}/${(receipt.verification.pass ?? 0) + (receipt.verification.fail ?? 0)}`,
    );

    // P9 — the receipt and the work product.
    const stepReceipt = phase("PC", "receipt");
    await mkdir(outDir, { recursive: true });
    for (const name of ["graph.json", "evidence.json", "usage.json"]) {
      await copyFile(path.join(activeWorkspacePath, ".drogon", name), path.join(outDir, name)).catch(() => {});
    }
    const evaluations = path.join(activeWorkspacePath, ".drogon/evaluations");
    const evaluationFiles = await readdir(evaluations).catch(() => []);
    if (evaluationFiles.length > 0) {
      await cp(evaluations, path.join(outDir, "evaluations"), { recursive: true });
    }
    // New files are untracked, and an untracked file is invisible to `git
    // diff`. Intent-to-add records them in this disposable worktree's index
    // only, so the receipt can show what the agents actually wrote.
    await exec("/usr/bin/git", ["add", "-AN", "."], { cwd: activeWorkspacePath, timeout: 30_000 }).catch(() => {});
    const diff = await exec("/usr/bin/git", ["diff", "--stat", "HEAD"], { cwd: activeWorkspacePath, timeout: 30_000 }).catch(
      () => ({ stdout: "" }),
    );
    const fullDiff = await exec("/usr/bin/git", ["diff", "HEAD"], { cwd: activeWorkspacePath, timeout: 30_000 }).catch(() => ({
      stdout: "",
    }));
    await writeFile(path.join(outDir, "dog-tinder.diff"), fullDiff.stdout);
    await copyFile(invocationLog, path.join(outDir, "harness-invocations.jsonl")).catch(() => {});
    await copyFile(path.join(world, "daemon.stderr.log"), path.join(outDir, "daemon.stderr.log")).catch(() => {});
    receipt.artifacts = {
      graph: "graph.json",
      evidence: "evidence.json",
      usage: "usage.json",
      evaluations: evaluationFiles.length > 0 ? "evaluations/" : null,
      workProductDiff: "dog-tinder.diff",
      harnessInvocations: "harness-invocations.jsonl",
      daemonLog: "daemon.stderr.log",
      diffStat: diff.stdout.trim(),
    };
    receipt.status =
      orchestratorRun.status === "passed" && receipt.verification.fail === 0
        ? "PASSED"
        : orchestratorRun.status === "exhausted"
          ? "EXHAUSTED"
          : "FAILED";
    stepReceipt.ok(path.relative(root, outDir));
  } catch (error) {
    failure = error;
    receipt.failure = error.message;
    process.stdout.write(`\n${red("the run failed")}: ${error.message}\n`);
  } finally {
    // Teardown owns every process this run started, on success and failure.
    const stepT = phase("PT", "teardown");
    try {
      await captureDescendants([daemon?.pid], owned);
      let graceful = null;
      if (daemonHandle) {
        graceful = await daemonHandle
          .stop()
          .then(() => "accepted")
          .catch((error) => `unverifiable: ${error.message}`);
      }
      receipt.processes = await settleOwnedProcesses(owned);
      const live = receipt.processes.filter((entry) => entry.verdict === "live");
      const unverifiable = receipt.processes.filter((entry) => entry.verdict === "unverifiable");
      receipt.teardown = { gracefulShutdown: graceful, owned: owned.size, live: live.length, unverifiable: unverifiable.length };
      if (live.length === 0 && unverifiable.length === 0) {
        if (!options.keep) await rm(world, { recursive: true, force: true });
        stepT.ok(`${owned.size} process(es) exited${options.keep ? ` · world kept at ${world}` : ""}`);
      } else {
        stepT.fail(`${live.length} live, ${unverifiable.length} unverifiable — keeping ${world}`);
        receipt.status = "FAILED";
      }
    } catch (error) {
      stepT.fail(error.message);
      receipt.teardown = { error: error.message };
      receipt.status = "FAILED";
    }
    receipt.finishedAt = new Date().toISOString();
    receipt.phases = phases;
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(path.join(outDir, "receipt.md"), renderReceipt(receipt, outDir));
  const position = await appendIndex({
    runId,
    startedAt: receipt.startedAt,
    status: receipt.status,
    harnesses,
    rounds: receipt.rounds.filter((round) => round.phase !== "main").length,
    costUsd: receipt.cost?.totalUsd ?? null,
    receipt: path.relative(root, path.join(outDir, "receipt.md")),
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } else {
    process.stdout.write(renderReport(receipt, outDir, position));
  }
  return receipt.status === "PASSED" || receipt.status === "EXHAUSTED" ? 0 : 1;
}

// ---------------------------------------------------------------- reporting

function money(cost) {
  if (!cost || cost.totalUsd === null) return "unavailable";
  return `$${cost.totalUsd.toFixed(4)} USD`;
}

function costNote(cost) {
  if (!cost) return "";
  const kinds = cost.rateKinds.join(", ");
  switch (cost.bucket) {
    case "exact":
      return `${cost.pricedMeasurements} measurement(s) priced · ${kinds}`;
    case "partial":
      return `${cost.pricedMeasurements} of ${cost.measurements} measurement(s) priced · ${cost.unpriced.length} with no rate`;
    case "local_free":
      return "declared-free local model";
    case "unpriced":
      return `${cost.measurements} measurement(s) with no rate in the card`;
    default:
      return "no agent reported tokens; absence is not zero";
  }
}

function renderReport(receipt, outDir, position) {
  const lines = [""];
  const status =
    receipt.status === "PASSED" ? green("PASSED") : receipt.status === "EXHAUSTED" ? amber("EXHAUSTED") : red("FAILED");
  if (receipt.rounds.length > 0) {
    lines.push(bold("Rounds"));
    for (const round of receipt.rounds) {
      const verdict =
        round.verdict === "pass" ? green("pass") : round.verdict === "findings" ? amber("findings") : dim(round.status);
      lines.push(
        `  ${String(round.iteration).padStart(2)}  ${round.phase.padEnd(7)}${verdict.padEnd(18)}${dim(
          `${round.runtime ?? "—"}${round.isFallback ? " (fallback)" : ""}`,
        )}`,
      );
    }
    lines.push("");
  }
  if (receipt.evidence.length > 0) {
    lines.push(bold("Evidence"));
    for (const entry of receipt.evidence) {
      lines.push(`  ${dim(`${entry.role ?? "—"}`.padEnd(8))}${entry.summary}`);
    }
    lines.push("");
  }
  if (receipt.chain?.monitor?.firing) {
    lines.push(
      `${bold("Firing")}         ${dim(
        `monitor ${receipt.chain.monitor.ruleKind} on ${receipt.chain.monitor.resource} · event ${receipt.chain.monitor.firing.eventId} · ${receipt.chain.monitor.firing.outcome}`,
      )}`,
    );
  }
  const releaseNote =
    receipt.chain?.releasedBy === "monitor"
      ? green("the bot's own watch")
      : receipt.chain?.releaseFallbackReason
        ? amber(`the script (the watch did not make it in time: ${receipt.chain.releaseFallbackReason})`)
        : dim("the script (--release script)");
  lines.push(`${bold("Released by")}    ${releaseNote}`);
  lines.push(`${bold("Verdict")}        ${status}  ${dim(`workflow ${receipt.workflowStatus ?? "—"}`)}`);
  if (receipt.verification) {
    lines.push(
      `${bold("Verification")}   ${dim("independent of the agents:")} node --test → ${receipt.verification.pass ?? "?"} passed, ${receipt.verification.fail ?? "?"} failed`,
    );
  }
  lines.push(
    `${bold("Tokens")}         ${receipt.cost?.inputTokens ?? "—"} in · ${receipt.cost?.outputTokens ?? "—"} out ${dim(
      receipt.lane === "live"
        ? "(reported by the agents; what they do not report stays absent)"
        : "(reported by the fixture, not by a provider)",
    )}`,
  );
  lines.push(`${bold("Cost")}           ${money(receipt.cost)}  ${dim(costNote(receipt.cost))}`);
  lines.push(`${bold("Receipt")}        ${path.relative(root, path.join(outDir, "receipt.md"))}  ${dim(`run #${position}`)}`);
  lines.push(`${bold("Product")}        ${receipt.artifacts.diffStat ? receipt.artifacts.diffStat.split("\n").pop().trim() : "—"}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderReceipt(receipt, outDir) {
  const rows = receipt.rounds
    .map(
      (round) =>
        `| ${round.iteration} | ${round.phase} | ${round.verdict ?? round.status} | \`${round.runtime ?? "—"}\`${round.isFallback ? " (fallback)" : ""} |`,
    )
    .join("\n");
  const evidence = receipt.evidence
    .map((entry) => `- **${entry.status}** · ${entry.role ?? "—"} — ${entry.summary}\n  ${entry.detail ?? ""}`)
    .join("\n");
  const usage = receipt.usage
    .map(
      (entry) =>
        `| ${entry.role ?? "—"} | \`${entry.harness ?? "—"}/${entry.model ?? "—"}\` | ${entry.inputTokens ?? "—"} | ${entry.outputTokens ?? "—"} | ${entry.cacheReadTokens ?? "—"} |`,
    )
    .join("\n");

  return `# Drogon — reproducible adversarial run ${receipt.runId}

**${receipt.status}** · workflow \`${receipt.workflowStatus ?? "—"}\` · ${receipt.startedAt} → ${receipt.finishedAt}

Demonstration: the harnesses ran as local fixtures
(\`${receipt.agentKind}\`). The product really executed — daemon, work
graph, durable orchestrator, ledgers — with no model inference.

## What was chosen

| | |
|---|---|
| main agent | \`${receipt.selection.mainAgent?.harness}/${receipt.selection.mainAgent?.model}\` |
| approved runtimes | ${receipt.selection.approvedRuntimes.map((r) => `\`${r.harness}/${r.model}\``).join(", ") || "—"} |
| fallback (not approved) | ${receipt.selection.fallbackRuntime ? `\`${receipt.selection.fallbackRuntime.harness}/${receipt.selection.fallbackRuntime.model}\`` : "—"} |
| round cap | ${receipt.selection.iterationsAllowed} |
| build | \`${receipt.identity.gitRev}\` · ${receipt.identity.cliVersion} · ${receipt.identity.platform} |
| recipe runtime | \`${receipt.identity.runtime?.revision}\` sha256 \`${receipt.identity.runtime?.sha256?.slice(0, 12)}…\` |

## Chain

bot \`${receipt.chain.botId}\` → responsibility \`${receipt.chain.responsibilityId}\` → workflow \`${receipt.chain.orchestratorRunId}\` → workspace \`${receipt.chain.workspaceId}\`

## Rounds

| round | role | verdict | runtime |
|---|---|---|---|
${rows || "| — | — | — | — |"}

## Evidence

${evidence || "_no checkpoints_"}

## Independent verification

\`node --test\` in the workspace, run by the script and not by the agents:
**${receipt.verification?.pass ?? "?"} passed, ${receipt.verification?.fail ?? "?"} failed**.

## Tokens and cost

| role | runtime | input | output | cache read |
|---|---|---|---|---|
${usage || "| — | — | — | — | — |"}

- **Cost: ${money(receipt.cost)}** (${receipt.cost?.bucket}) — ${costNote(receipt.cost)}
- Rate card \`${receipt.cost?.rateCard?.path}\` v${receipt.cost?.rateCard?.version}. ${receipt.cost?.rateCard?.note ?? ""}
- By role: ${Object.entries(receipt.cost?.byRole ?? {}).map(([role, value]) => `${role} $${value.toFixed(4)}`).join(" · ") || "—"}

## Processes

${receipt.processes.map((entry) => `- \`${entry.pid}\` **${entry.verdict}**${entry.note ? ` — ${entry.note}` : ""}`).join("\n") || "_none_"}

## Artifacts

${Object.entries(receipt.artifacts)
  .filter(([, value]) => value)
  .map(([key, value]) => `- ${key}: \`${value}\``)
  .join("\n")}

_Directory: \`${path.relative(root, outDir)}\`_
`;
}

// Importable for its own tests: only an actual invocation runs a demo.
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = await main();
