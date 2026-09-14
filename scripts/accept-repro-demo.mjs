// Acceptance for Settings → "Demo reproducible": runs the WHOLE demo from the
// app's own button and proves what a viewer would see — the bot under Chats
// with the prompt in its own session, the Work Graph that session admits, the
// main session fanning out to parallel workers, the adversarial rounds, and
// the evidence and cost at the end.
//
// The app is launched in a BACKGROUND window against a disposable data
// directory, with its own daemon whose PATH carries this repository's harness
// fixtures — so every role in the run executes for real with no model
// inference and no provider spend, exactly like `make repro`. The developer's
// Drogon, data directory and sessions are never touched.
//
// Modes: --help | --check (read-only) | (default) execute.
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { runAcceptanceProcess, startAcceptanceProcess, stopAcceptanceProcess } from "./acceptance-process.mjs";
import { startForegroundObservation, verifyForegroundObservation } from "./acceptance-foreground.mjs";
import { emulatePageFocus } from "./acceptance-page-focus.mjs";
import { packagedFixtureDaemon } from "./packaged-fixture-daemon.mjs";
import { resolveRuntime, captureDescendants, settleOwnedProcesses } from "./reproduce-adversarial-run.mjs";
import { writeHarnessFixtures } from "./reproduce-harness-fixture.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = path.join(root, "apps", "desktop");
const evidenceDir = path.join(root, ".preflight", "acceptance");
/** The fixture lane: OpenCode's shell adapter, with an id the rate card
 *  prices, so the run exercises the cost column too. */
const FIXTURE_HARNESS = "opencode";
const FIXTURE_MODEL = "fixture/dog-tinder";
/** The bot's session has to boot a harness and admit the graph, then its
 *  own turn, so the whole demo is minutes, not seconds. */
const RUN_BUDGET_MS = 12 * 60_000;
const LIVE_RUN_BUDGET_MS = 45 * 60_000;

function isMainModule() {
  return (
    Boolean(process.argv[1]) &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  );
}

export async function runCheck() {
  const problems = [];
  for (const [label, file] of [
    ["built main entry", path.join(appDir, "out", "main", "index.js")],
    ["built preload entry", path.join(appDir, "out", "preload", "index.js")],
    ["built renderer entry", path.join(appDir, "out", "renderer", "index.html")],
    ["daemon binary", path.join(root, "target", "debug", "drogond")],
    ["cli binary", path.join(root, "target", "debug", "drogon-cli")],
  ]) {
    try {
      await stat(file);
    } catch {
      problems.push(`${label} is missing: ${file}`);
    }
  }
  return { mode: "check", ok: problems.length === 0, problems };
}

async function stopOwned(child, label, report) {
  if (!child) return;
  const result = await stopAcceptanceProcess(child);
  report.cleanup.push(`${label}: ${result.verdict}${result.forced ? " (forced)" : ""}`);
  if (result.verdict !== "exited") report.status = "FAILED";
}

/** The display names the product's harness picker shows, by harness id. */
const HARNESS_DISPLAY_NAMES = {
  claude: "Claude Code",
  codex: "Codex CLI",
  opencode: "OpenCode",
  pi: "Pi",
};

/**
 * `live` runs the demo on the REAL harnesses installed on this host — real
 * inference, real spend — instead of the local fixture: the main agent on
 * `main`, its subagents on `subagents`. Everything the fixture lane proves
 * about the chain still has to hold (the bot, its session, the admission, the
 * parallel sessions, the daemon's telemetry); what a real agent decides —
 * whether the first round already passes — is reported, not assumed.
 */
export async function execute({ runs = 2, live = null, fixtureHarness = FIXTURE_HARNESS } = {}) {
  assert.ok(["opencode", "pi"].includes(fixtureHarness), "Unsupported fixture harness");
  const report = {
    runner: "scripts/accept-repro-demo.mjs",
    status: "FAILED",
    startedAt: new Date().toISOString(),
    lane: `${fixtureHarness}/${FIXTURE_MODEL} (local fixture, no inference)`,
    checks: [],
    runs: [],
    phases: {},
    cleanup: [],
    screenshots: [],
  };
  const appRequire = createRequire(path.join(appDir, "package.json"));
  const playwright = appRequire("playwright");
  const electronBinary = appRequire("electron");
  await mkdir(evidenceDir, { recursive: true });
  const fixture = await mkdtemp(path.join(evidenceDir, "repro-demo-run-"));
  // The daemon's unix socket lives under the data directory and that path has a
  // hard length limit, so the disposable world goes to the system temp dir.
  const world = await mkdtemp(path.join(tmpdir(), "rpa-"));
  const dataDir = path.join(world, "data");
  const profileDir = path.join(world, "electron");
  const binDir = path.join(world, "bin");
  await mkdir(dataDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });
  report.world = world;

  let desktop = null;
  let daemon = null;
  let daemonHandle = null;
  let browser = null;
  let foreground = null;
  const owned = new Map();
  try {
    if (process.env.DROGON_VERIFY_OS_FOCUS === "1")
      foreground = await startForegroundObservation(fixture);
    const cliPath = path.join(root, "target/debug/drogon-cli");
    const daemonPath = path.join(root, "target/debug/drogond");
    const runtime = await resolveRuntime(dataDir);
    if (live) {
      report.lane = `LIVE · main ${live.main.harness}/${live.main.model || "harness default"} · subagents ${live.subagents.harness}/${live.subagents.model || "harness default"} (real inference)`;
    } else {
      await writeHarnessFixtures(binDir, [fixtureHarness]);
    }
    // What the fixture agent needs to reach the CLI and its stages. The in-app
    // demo writes no context file of its own, so the daemon carries the path
    // and the fixture resolves its workspace from the registry.
    const contextPath = path.join(world, "repro-context.json");
    await writeFile(
      contextPath,
      `${JSON.stringify(
        {
          cli: cliPath,
          dataDir,
          stagesDir: path.join(root, "scripts/scenarios/dog-tinder"),
          model: FIXTURE_MODEL,
          invocationLog: path.join(world, "harness-invocations.jsonl"),
          specPath: "specs/dog-tinder.md",
          workerDwellMs: 15000,
        },
        null,
        2,
      )}\n`,
    );
    // The same context next to the data directory: a session sees
    // `DROGON_DATA_DIR`, never the daemon's own environment, and the Bot's
    // chat turn starts seconds after the project exists — before this script
    // could drop a file into it.
    if (!live) await copyFile(contextPath, path.join(dataDir, "repro-context.json"));
    await writeFile(path.join(world, "harness-invocations.jsonl"), "");
    // The daemon resolves harnesses from ITS path, so the fixture shim has to
    // lead the daemon's own PATH — never the developer's environment.
    // On the live lane the daemon sees the developer's own PATH — the real
    // harnesses live there — and no fixture context at all.
    const env = live
      ? { ...process.env, DROGON_MENTU_RUNTIME: runtime.path }
      : {
          ...process.env,
          PATH: [binDir, path.dirname(process.execPath), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(
            path.delimiter,
          ),
          DROGON_MENTU_RUNTIME: runtime.path,
          DROGON_REPRO_CONTEXT: contextPath,
        };

    daemon = startAcceptanceProcess(daemonPath, ["--data-dir", dataDir], {
      cwd: world,
      stdio: ["ignore", "ignore", "ignore"],
      env,
    });
    await captureDescendants([daemon.pid], owned);
    const deadline = Date.now() + 30_000;
    for (;;) {
      const answered = await runAcceptanceProcess(
        cliPath,
        ["--data-dir", dataDir, "--json", "status"],
        { timeout: 10_000 },
      )
        .then(() => true)
        .catch(() => false);
      if (answered) break;
      if (Date.now() > deadline) throw new Error("the acceptance daemon never answered");
      await delay(200);
    }
    daemonHandle = packagedFixtureDaemon(daemonPath, cliPath, dataDir);
    await daemonHandle.capture();
    report.checks.push(
      live
        ? "daemon owned by this run, with the real harnesses on its PATH"
        : "daemon owned by this run, with the harness fixture on its PATH",
    );

    desktop = startAcceptanceProcess(electronBinary, [appDir, "--remote-debugging-port=0"], {
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...env,
        DROGON_DATA_DIR: dataDir,
        DROGON_ELECTRON_PROFILE: profileDir,
        DROGON_BACKGROUND_WINDOW: "1",
      },
    });
    await captureDescendants([desktop.pid], owned);
    const endpoint = await new Promise((resolve, reject) => {
      let tail = "";
      const timer = setTimeout(
        () => reject(new Error(`Electron did not publish a debugging endpoint: ${tail}`)),
        30_000,
      );
      desktop.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      desktop.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(`Electron exited before connection: ${tail}`));
      });
      desktop.stderr.on("data", (bytes) => {
        tail = (tail + bytes.toString()).slice(-8192);
        const match = tail.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
    });
    browser = await playwright.chromium.connectOverCDP(endpoint);
    let page = null;
    for (let attempt = 0; attempt < 200 && !page; attempt += 1) {
      page = browser.contexts()[0]?.pages()[0] ?? null;
      if (!page) await delay(50);
    }
    assert.ok(page, "Electron must create a rendered page");
    page.setDefaultTimeout(30_000);
    await emulatePageFocus(page);
    await page.getByRole("button", { name: "Reveal active workspace", exact: true }).waitFor();

    for (let attempt = 1; attempt <= runs; attempt += 1) {
      // Everything below is one whole demo, driven through the real UI.
      // Open the demo and choose the fixture lane, through the real controls.
      await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
      await page.getByRole("button", { name: "Reproducible demo", exact: true }).click();
      await page.getByTestId("repro-demo-run").waitFor();
      // The harness and the model come from the product's own pickers — the
      // same controls the Subagent policy uses — never from a demo-only list.
      // A model id is typed into the picker's search: a listed id is its
      // catalog row, anything else rides as "typed by you".
      const pick = async (prefix, wanted) => {
        await page.getByTestId(`${prefix}-harness`).click();
        await page
          .getByRole("option", { name: HARNESS_DISPLAY_NAMES[wanted.harness], exact: true })
          .click();
        if (!wanted.model) return;
        const modelField = page.getByTestId(`${prefix}-model-value`).locator("..");
        await modelField.getByRole("button", { name: "Browse models" }).click();
        await page.getByLabel("Search models").fill(wanted.model);
        await page
          .getByRole("option", { name: new RegExp(wanted.model.replace(/[/.]/g, "\\$&")) })
          .first()
          .click();
        assert.equal(
          (await page.getByTestId(`${prefix}-model-value`).innerText()).trim(),
          wanted.model,
          `the picked ${prefix} model must be the one the run gets`,
        );
      };
      const main = live ? live.main : { harness: fixtureHarness, model: FIXTURE_MODEL };
      const subagents = live ? live.subagents : main;
      await pick("repro-demo", main);
      await pick("repro-demo-subagents", subagents);
      await page.getByRole("button", { name: "2", exact: true }).click();
      await (async () => {
        const stop = Date.now() + 30_000;
        while (!(await page.getByTestId("repro-demo-run").isEnabled())) {
          if (Date.now() > stop) {
            const why = await page.getByTestId("repro-demo-blocked").innerText().catch(() => "");
            throw new Error(`Run demo never became enabled: ${why}`);
          }
          await delay(250);
        }
      })();
      await page.getByTestId("repro-demo-run").click();
      report.checks.push(
        live
          ? `the demo starts from its own button: main ${main.harness}/${main.model}, subagents ${subagents.harness}/${subagents.model}`
          : "the demo starts from its own button on the fixture lane",
      );

      // The panel's own phase rows are NOT a reliable oracle here: Settings
      // closes as soon as the bot has its prompt. The demo must reveal the
      // ordinary app shell and then preserve whichever session the viewer
      // chooses — it never routes through the standalone Bots page.
      await page.getByTestId("repro-demo-run").waitFor({ state: "detached", timeout: 120_000 });
      assert.equal(
        await page.getByRole("heading", { name: "Bots", exact: true }).filter({ visible: true }).count(),
        0,
        "the demo must close Settings into the app shell, not open the Bots page",
      );

      // Every earlier run's Bot is still listed under Chats — which is the
      // point: they coexist. Wait for the one this run just made, i.e. a name
      // no earlier run in this report claimed.
      const seenTags = new Set(report.runs.map((entry) => entry.tag));
      const { tag, botName } = await (async () => {
        const stop = Date.now() + 90_000;
        for (;;) {
          const text = await page.getByTestId("sidebar-chats-section").innerText();
          const found = [...text.matchAll(/White walker ([0-9a-f]{6})/g)]
            .map((match) => ({ botName: match[0], tag: match[1] }))
            .find((entry) => !seenTags.has(entry.tag));
          if (found) return found;
          if (Date.now() > stop)
            throw new Error(
              `Chats never showed run ${attempt}'s own bot: ${text.slice(0, 220).replace(/\s+/g, " ")}`,
            );
          await delay(1000);
        }
      })();
      // The bot that delegates carries the run's tag; the project it works in
      // is named after the app it builds, with the same tag.
      const runName = `dog-tinder-${tag}`;
      assert.ok(!seenTags.has(tag), `run ${attempt} reused the tag of an earlier run: ${tag}`);
      report.runName = runName;
      const botRow = page.locator(`[data-bot-session-row="white-walker-${tag}"]`);
      await botRow.click();
      await page.getByTestId("bot-session-header").waitFor({ timeout: 30_000 });
      assert.equal(
        await page.getByTestId("repro-demo-run").filter({ visible: true }).count(),
        0,
        "one click on the Bot must open its session without returning to Settings",
      );
      report.checks.push(
        `run ${attempt} closed Settings, showed '${botName}' under Chats, and opened its session in one click`,
      );
      const botsShot = path.join(fixture, `bot-session-open-${attempt}.png`);
      await page.screenshot({ path: botsShot, animations: "disabled" });
      report.screenshots.push(botsShot);

      // The workspace this run created, resolved through the daemon: the demo
      // registers an ordinary project named after the run (under Projects,
      // never a Quick Session under Chats), and the workspace is the one
      // registered at that project's path.
      const cli = async (...args) => {
        const { stdout } = await runAcceptanceProcess(
          cliPath,
          ["--data-dir", dataDir, "--json", ...args],
          { timeout: 30_000 },
        );
        const answer = JSON.parse(stdout);
        assert.equal(answer.ok, true, stdout);
        return answer.result;
      };
      const projects = await cli("project", "list");
      const project = (projects.projects ?? []).find((entry) => entry.name === runName);
      assert.ok(project, `the daemon must know the project '${runName}'`);
      assert.ok(
        !project.quickSession,
        `'${runName}' must be an ordinary project, not a Quick Session: ${JSON.stringify(project)}`,
      );
      const workspaces = await cli("workspace", "list");
      const demoWorkspaceId = (workspaces.workspaces ?? []).find(
        (entry) => entry.path === project.path,
      )?.id;
      assert.ok(demoWorkspaceId, `the daemon must know a workspace at ${project.path}`);

      // A PTY session gets a curated environment, so the shim cannot read the
      // context from the daemon's env the way a recipe step does: drop it in
      // the workspace the released session will run in. This is fixture
      // plumbing for THIS acceptance — the product ships nothing of the sort,
      // and a real agent just follows the instructions in its prompt.
      if (!live) await mkdir(path.join(project.path, ".drogon"), { recursive: true });
      if (!live) await writeFile(
        path.join(project.path, ".drogon/repro-context.json"),
        `${JSON.stringify(
          {
            cli: cliPath,
            dataDir,
            workspaceId: demoWorkspaceId,
            stagesDir: path.join(root, "scripts/scenarios/dog-tinder"),
            model: FIXTURE_MODEL,
            invocationLog: path.join(world, "harness-invocations.jsonl"),
            specPath: "specs/dog-tinder.md",
          },
          null,
          2,
        )}\n`,
      );

      // Second stop of the tour: the run's own sessions. The Bot dispatcher
      // admits the durable workflow and exits; its native graph main then fans
      // out to parallel workers. Until orchestration settles, this loop
      // samples the daemon's session list and remembers the most sessions it
      // saw alive at once: the parallelism is measured, never inferred from
      // a screenshot. The daemon's own orchestrator status is the verdict —
      // never the rendered text.
      const orchestratorStatus = async () => {
        const { stdout } = await runAcceptanceProcess(
          cliPath,
          [
            "--data-dir",
            dataDir,
            "--json",
            "graph",
            "orchestrator-status",
            "--workspace",
            demoWorkspaceId,
          ],
          { timeout: 30_000 },
        );
        const answer = JSON.parse(stdout);
        return answer.ok ? (answer.result.run ?? null) : null;
      };
      const sessionsAlive = async () => {
        const listed = await cli(
          "rpc",
          "session.list",
          "--params",
          JSON.stringify({ workspaceId: demoWorkspaceId }),
        );
        return (listed.sessions ?? []).filter((session) => session.verdict === "live");
      };
      let mostAlive = 0;
      let sessionsShot = null;
      let dispatcherSessionId = null;
      const rounds = await (async () => {
        const stop = Date.now() + (live ? LIVE_RUN_BUDGET_MS : RUN_BUDGET_MS);
        for (;;) {
          const alive = await sessionsAlive().catch(() => []);
          if (alive.length > mostAlive) mostAlive = alive.length;
          if (alive.length) await captureDescendants([daemon.pid], owned);
          // The bot's turn and the graph main can both be alive before any
          // worker exists (a real main agent takes a while to fan out): the
          // sessions stop is checked once the fan-out has actually happened.
          const fannedOut = await (async () => {
            if (alive.length < 2) return false;
            const graph = await orchestratorStatus().catch(() => null);
            const mainRunId = graph?.steps?.find((step) => step.phase === "main" && step.status === "running")?.runId ?? "";
            const mainSessionId = /^session:([^:]+):/.exec(mainRunId)?.[1] ?? null;
            const bots = await cli("rpc", "bot.snapshot", "--params", JSON.stringify({
              hostId: (await cli("status")).hostId, workspaceId: "", locale: "en-US",
            })).catch(() => null);
            const botSessionId = bots?.bots?.find((bot) => bot.id === `white-walker-${tag}`)?.currentSession?.sessionId ?? null;
            return alive.filter((session) => session.id !== mainSessionId && session.id !== botSessionId).length >= 2;
          })();
          if (fannedOut && !sessionsShot) {
            // The demo itself must still be showing the Bot session chosen
            // above; only this acceptance now asks to inspect the run's
            // sessions. That explicit request is the same action as the
            // panel's "Show the sessions" button.
            await page.getByTestId("bot-session-header").waitFor({ timeout: 30_000 });
            await page.evaluate(
              (workspaceId) => window.dispatchEvent(new CustomEvent("drogon:repro-demo-tour", {
                detail: { kind: "open-sessions", workspaceId },
              })),
              demoWorkspaceId,
            );
            await page.getByTestId("bot-session-header").waitFor({ state: "detached", timeout: 30_000 });
            assert.equal(
              await page.getByTestId("orchestrator-canvas").filter({ visible: true }).count(),
              0,
              "showing sessions must not open the Work Graph canvas",
            );
            assert.equal(
              await page.getByTestId("repro-demo-run").filter({ visible: true }).count(),
              0,
              "showing sessions must not return to Settings",
            );
            assert.ok(
              (await page.locator(".xterm").filter({ visible: true }).count()) >= 1,
              "the requested sessions view must show a terminal on screen",
            );
            // The Bot's own chat turn is its current session — the one the
            // demo's prompt went to — not a worker and not the graph main.
            const host = await cli("status");
            const snapshot = await cli("rpc", "bot.snapshot", "--params", JSON.stringify({
              hostId: host.hostId, workspaceId: "", locale: "en-US",
            }));
            const linked = snapshot.bots.find((bot) => bot.id === `white-walker-${tag}`)?.currentSession;
            assert.equal(linked?.source, "chat", `the bot's current session is its chat turn: ${JSON.stringify(linked)}`);
            const history = await cli("rpc", "bot.history", "--params", JSON.stringify({
              hostId: host.hostId, workspaceId: demoWorkspaceId, botId: `white-walker-${tag}`, limit: 5,
            }));
            const turn = history.messages.find((message) => message.sessionId === linked.sessionId);
            assert.ok(turn, "the bot's history records the prompt the demo sent");
            assert.match(turn.prompt, /drogon-cli graph orchestrator-start --workspace /, "the recorded prompt names the exact dispatch");
            dispatcherSessionId = linked.sessionId;
            const allSessions = await cli("rpc", "session.list", "--params", JSON.stringify({ workspaceId: demoWorkspaceId }));
            const launched = allSessions.sessions.find((session) => session.id === dispatcherSessionId);
            assert.ok(launched, "the Bot links its dispatcher, not the graph main or a worker");
            if (!live) assert.equal(launched.verdict, "exited", "the Bot ended after admitting the graph");
            const activeGraph = await orchestratorStatus();
            assert.equal(activeGraph?.status, "running");
            assert.equal(activeGraph?.phase, "main", "workers execute inside the already-admitted graph main phase");
            const mainRunId = activeGraph.steps.find((step) => step.phase === "main" && step.status === "running")?.runId;
            const mainIdentity = /^session:([^:]+):(.+)$/.exec(mainRunId ?? "");
            assert.ok(mainIdentity, `graph main must expose a native session identity: ${mainRunId}`);
            assert.ok(alive.some((session) => session.id === mainIdentity[1] && session.incarnation === mainIdentity[2]), "the graph main is a real live workspace session");
            const workerSessions = alive.filter((session) => session.id !== dispatcherSessionId && session.id !== mainIdentity[1]);
            assert.ok(workerSessions.length >= 2, "parallelism counts worker terminals separately from the Bot dispatcher and graph main");
            const card = page.locator("[data-worktree-card-id]").filter({ has: page.getByText(`Run ${activeGraph.id}`, { exact: true }) });
            await card.getByText("Main agent · running", { exact: true }).waitFor();
            assert.equal(await card.getByRole("button", { name: "Work Graph · Running" }).getAttribute("aria-expanded"), "true");
            assert.equal(await card.getByText("Native workspace sessions", { exact: true }).isVisible(), true);
            const runtime = activeGraph.steps.find((step) => step.phase === "main" && step.status === "running")?.runtime;
            assert.ok(runtime, "running main retains its selected runtime");
            assert.equal(await card.getByText(`${runtime.harness}${runtime.model ? ` · ${runtime.model}` : ""}`, { exact: true }).isVisible(), true);
            report.checks.push("Sidebar reveals the native graph main and selected runtime beside its worker sessions");
            await page.locator(`[data-bot-session-row="white-walker-${tag}"]`).click({ timeout: 15_000 });
            await page.getByTestId("bot-session-header").waitFor();
            await page.getByTestId("bot-session-header").getByText("Launch prompt", { exact: true }).click();
            assert.equal(await page.getByTestId("bot-session-header").getByTestId("monitor-launch-prompt-text").textContent(), launched.args.find((arg) => arg.startsWith("Drogon task:\n")) ?? launched.args.at(-1));
            report.checks.push("Chats shows the Bot's own session with the prompt it was launched with; the graph main owns the workers");
            sessionsShot = path.join(fixture, `sessions-running-${attempt}.png`);
            await page.screenshot({ path: sessionsShot, animations: "disabled" });
            report.screenshots.push(sessionsShot);
            if (!live && fixtureHarness === "pi") {
              const observed = (await cli("rpc", "graph.observability_status", "--params", JSON.stringify({ workspaceId: demoWorkspaceId }))).observability;
              assert.ok(observed.evidence.some((entry) => entry.id === `session:${dispatcherSessionId}` && entry.status === "completed"));
              const reported = observed.usage.filter((entry) => entry.agentId === dispatcherSessionId && entry.id.startsWith("pi:"));
              assert.equal(reported.length, 1, "replayed Pi message usage is counted once");
              assert.equal(reported[0].inputTokens, 37);
              assert.equal(reported[0].outputTokens, 11);
              assert.equal(reported[0].cacheReadTokens, 2);
              assert.equal(reported[0].cacheWriteTokens, 1);
              assert.equal(reported[0].model, "fixture/dog-tinder");
              for (const session of alive.filter((session) => session.id !== dispatcherSessionId)) {
                const workerUsage = observed.usage.filter((entry) => entry.agentId === session.id && entry.id.startsWith("pi:"));
                assert.equal(workerUsage.length, 1, "each live Pi worker reports exactly one response through its own dispatch credential");
                assert.equal(workerUsage[0].role, "worker");
                assert.equal(typeof workerUsage[0].runId, "string");
              }
              await page.evaluate((workspaceId) => window.dispatchEvent(new CustomEvent("drogon:repro-demo-tour", { detail: { kind: "open-work-graph", workspaceId } })), demoWorkspaceId);
              await page.getByTestId("orchestrator-canvas").waitFor();
              assert.equal(await page.getByTestId("orchestrator-runtime-disclosure").count(), 0);
              await page.evaluate(() => window.dispatchEvent(new CustomEvent("drogon:repro-demo-tour", { detail: { kind: "focus-view", view: "evidence" } })));
              await page.getByTestId("work-graph-evidence-view").waitFor();
              const activityShot = path.join(fixture, `telemetry-running-${attempt}.png`);
              await page.screenshot({ path: activityShot, animations: "disabled" });
              report.screenshots.push(activityShot);
              await page.evaluate(() => window.dispatchEvent(new CustomEvent("drogon:repro-demo-tour", { detail: { kind: "focus-view", view: "usage" } })));
              await page.getByTestId("work-graph-usage-view").waitFor();
              const usageShot = path.join(fixture, `usage-running-${attempt}.png`);
              await page.screenshot({ path: usageShot, animations: "disabled" });
              report.screenshots.push(usageShot);
              const stillRunning = await cli("rpc", "session.list", "--params", JSON.stringify({ workspaceId: demoWorkspaceId }));
              assert.equal(stillRunning.sessions.find((session) => session.id === dispatcherSessionId)?.verdict, "exited");
              assert.ok(stillRunning.sessions.some((session) => session.verdict === "live"), "the graph workers outlive the Bot dispatcher");
              await page.locator(`[data-bot-session-row="white-walker-${tag}"]`).click();
              await page.getByTestId("bot-session-header").waitFor();
              report.checks.push("During the graph main phase, workers remain active after the Bot exits; rendered activity and fixture hook counters are attributed separately");
            }
            report.checks.push(
              `the viewer explicitly opened the run's sessions, with ${alive.length} alive: ${alive
                .map((session) => session.harnessId ?? session.command ?? session.id)
                .join(", ")}`,
            );
          }
          const run = await orchestratorStatus().catch(() => null);
          if (run && ["passed", "exhausted", "failed", "stopped"].includes(run.status)) return run;
          if (Date.now() > stop)
            throw new Error(
              `the orchestration did not settle in budget (most sessions alive at once: ${mostAlive})`,
            );
          await delay(1000);
        }
      })();
      assert.ok(
        mostAlive >= 2,
        `the dispatched graph main must fan out to parallel workers: most alive at once was ${mostAlive}`,
      );
      report.checks.push(
        `the dispatched graph main fanned out: ${mostAlive} worker sessions alive at once in the run's workspace`,
      );
      const roles = (rounds.steps ?? []).map((step) => `${step.iteration}:${step.phase}:${step.verdict ?? step.status}`);
      if (live) {
        // A real agent decides its own rounds: the run must settle without a
        // runtime failure, and what it found is reported as it happened.
        assert.ok(
          ["passed", "exhausted"].includes(rounds.status),
          `the live lane must settle on a verdict, got ${rounds.status}: ${rounds.error ?? ""} · ${roles.join(", ")}`,
        );
      } else {
        assert.equal(
          rounds.status,
          "passed",
          `the fixture lane must finish green, got ${rounds.status}`,
        );
        assert.ok(
          roles.some((entry) => entry.endsWith("findings")),
          `the adversarial round must find the missing undo: ${roles.join(", ")}`,
        );
      }
      report.rounds = roles;
      const health = await page.evaluate(() => window.drogon.status());
      assert.ok(health.ok && Number.isFinite(health.result.schedulerLastTickMs), "scheduler heartbeat must survive the real preload");
      assert.ok(Date.now() - health.result.schedulerLastTickMs < 60_000, "scheduler heartbeat must keep advancing");
      report.checks.push(`the orchestration ran its rounds and ${rounds.status}: ${roles.join(" · ")}`);

      // Third stop: the Work Graph's Agent telemetry, where the daemon itself
      // wrote every attempt and verdict of the rounds as they happened.
      await page.getByTestId("work-graph-evidence-view").waitFor({ timeout: 120_000 });
      const expectedTelemetry = live
        ? [/Workflow started/, /verdict: /, /Workflow (passed|exhausted)/]
        : [/Workflow started/, /verdict: findings/, /Workflow passed/];
      // The tab can mount with the previous poll's snapshot. Wait for the
      // final entry of THIS run, not just for the container to exist.
      const telemetryDeadline = Date.now() + 6_000;
      for (;;) {
        const telemetry = await page.getByTestId("work-graph-evidence-view").innerText();
        if (telemetry.includes(rounds.id) && expectedTelemetry.every((pattern) => pattern.test(telemetry))) break;
        assert.ok(Date.now() < telemetryDeadline, `Agent telemetry never showed the final outcome of ${rounds.id}`);
        await delay(100);
      }
      const telemetryShot = path.join(fixture, `telemetry-${attempt}.png`);
      await page.screenshot({ path: telemetryShot, animations: "disabled" });
      report.screenshots.push(telemetryShot);
      report.checks.push(
        "the tour showed the Work Graph's Agent telemetry, written by the daemon as the rounds ran",
      );
      // Last stop: the usage, after a beat on the telemetry.
      await page.getByTestId("work-graph-usage-view").waitFor({ timeout: 60_000 });
      report.checks.push("the tour ended on the Work Graph's Usage tab");

      // Exercise the same return route used when a run fails off-panel.
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("drogon:repro-demo-tour", {
        detail: { kind: "open-demo" },
      })));
      await page.getByTestId("repro-demo-run").waitFor();
      report.checks.push("the failure-return route opens the retained demo panel");
      // Back in Settings the panel is mounted again, so its own rows are
      // readable: wait for the last phase to settle there.
      await (async () => {
        const stop = Date.now() + 2 * 60_000;
        for (;;) {
          const status = await page
            .getByTestId("repro-demo-phase-evidence")
            .getAttribute("data-status")
            .catch(() => null);
          if (status === "done") return;
          if (status === "failed") {
            const note = await page.getByTestId("repro-demo-phase-evidence").innerText();
            throw new Error(`the evidence phase failed: ${note.replace(/\s+/g, " ")}`);
          }
          if (Date.now() > stop) throw new Error("the ledgers and the cost never settled");
          await delay(1000);
        }
      })();
      const cost = await page.getByTestId("repro-demo-cost").innerText();
      assert.match(cost, /\$\d/, `the cost tile must show a real number: ${cost}`);
      report.cost = cost.replace(/\s+/g, " ").trim();
      const evidence = await page.getByTestId("repro-demo-evidence").innerText();
      if (!live) assert.match(evidence, /undo/i, "the telemetry must name what the rounds found");
      const release = await page.getByTestId("repro-demo-release").innerText();
      assert.match(
        release,
        /the bot's own session/,
        `the workflow must be admitted by the bot's session, not by the panel: ${release}`,
      );
      report.checks.push("the bot's own session admitted the workflow — not the panel's fallback");
      report.checks.push(`the panel survived the tour and reports the cost: ${report.cost}`);
      report.runs.push({
        attempt,
        tag,
        runName,
        rounds: roles,
        status: rounds.status,
        cost: report.cost,
        mostAlive,
      });
      const panelShot = path.join(fixture, `settings-after-run-${attempt}.png`);
      await page.screenshot({ path: panelShot, animations: "disabled" });
      report.screenshots.push(panelShot);
      if (!live) {
        const beforeView = await cli("rpc", "session.list", "--params", JSON.stringify({ workspaceId: demoWorkspaceId }));
        assert.equal(beforeView.sessions.find((session) => session.id === dispatcherSessionId)?.verdict, "exited");
        await page.evaluate((workspaceId) => window.dispatchEvent(new CustomEvent("drogon:repro-demo-tour", {
          detail: { kind: "open-bots", workspaceId },
        })), demoWorkspaceId);
        const view = page.getByTestId(`open-session-white-walker-${tag}`);
        await view.waitFor();
        assert.equal((await view.innerText()).trim(), "View session");
        await view.click();
        await page.getByTestId("bot-session-header").waitFor();
        await delay(500);
        const afterView = await cli("rpc", "session.list", "--params", JSON.stringify({ workspaceId: demoWorkspaceId }));
        assert.deepEqual(afterView.sessions.map((session) => session.id).sort(), beforeView.sessions.map((session) => session.id).sort());
        report.checks.push("View session inspects the exited bot turn without creating or resuming a session");
      }
    }

    report.status = "PASSED";
  } catch (error) {
    report.failure = error instanceof Error ? error.message : String(error);
    // What the run's sessions printed, so an early exit of a real harness is
    // diagnosable from the report alone.
    try {
      const tails = [];
      const listed = await runAcceptanceProcess(
        cliPath,
        ["--data-dir", dataDir, "--json", "rpc", "session.list", "--params", "{}"],
        { timeout: 15_000 },
      ).then(({ stdout }) => JSON.parse(stdout)).catch(() => null);
      for (const session of listed?.result?.sessions ?? []) {
        const read = await runAcceptanceProcess(
          cliPath,
          ["--data-dir", dataDir, "--json", "rpc", "session.read", "--params",
            JSON.stringify({ sessionId: session.id, incarnation: session.incarnation, cursor: 0, limitBytes: 16_384 })],
          { timeout: 15_000 },
        ).then(({ stdout }) => JSON.parse(stdout)).catch(() => null);
        const bytes = read?.result?.dataBase64 ? Buffer.from(read.result.dataBase64, "base64").toString("utf8") : "";
        tails.push({
          sessionId: session.id,
          harnessId: session.harnessId ?? null,
          verdict: session.verdict,
          exitCode: session.exitCode ?? null,
          args: (session.args ?? []).map((arg) => (arg.length > 120 ? `${arg.slice(0, 120)}…(${arg.length})` : arg)),
          tail: bytes.slice(-6000),
        });
      }
      report.sessionTails = tails;
    } catch {
      // Diagnostics only; the failure above is the verdict.
    }
  } finally {
    try {
      await captureDescendants(
        [desktop, daemon].filter((child) => child && child.exitCode === null && child.signalCode === null)
          .map((child) => child.pid), owned,
      );
    } catch (error) {
      report.status = "FAILED";
      report.cleanup.push(`process capture unverifiable: ${error.message}`);
    }
    if (browser) await browser.close().catch(() => {});
    await stopOwned(desktop, "desktop", report);
    if (daemonHandle) {
      const stopped = await daemonHandle
        .stop()
        .then(() => "exited (quiescent shutdown, kernel-confirmed)")
        .catch((error) => `unverifiable: ${error.message}`);
      report.cleanup.push(`daemon: ${stopped}`);
      if (!stopped.startsWith("exited")) report.status = "FAILED";
    } else {
      await stopOwned(daemon, "daemon", report);
    }
    try {
      report.processes = await settleOwnedProcesses(owned);
      assert.ok(report.processes.every((entry) => entry.verdict === "exited"), "owned processes remain");
    } catch (error) {
      report.status = "FAILED";
      report.cleanup.push(`process exit unverifiable: ${error.message}`);
    }
    if (foreground) {
      try {
        report.osForeground = await foreground.stop();
        verifyForegroundObservation(report.osForeground, [desktop?.pid].filter(Boolean));
        report.checks.push("OS focus preserved: no desktop activation or visible native window");
      } catch (error) {
        report.status = "FAILED";
        report.cleanup.push(`OS focus verification failed: ${error.message}`);
      }
    }
    if (report.status === "PASSED") await rm(world, { recursive: true, force: true });
    report.finishedAt = new Date().toISOString();
    await writeFile(path.join(fixture, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

if (isMainModule()) {
  const mode = process.argv[2];
  if (mode === "--help") {
    process.stdout.write(
      "Usage: node scripts/accept-repro-demo.mjs [--check] [--runs <1-5>] [--live ...]\n" +
        "  --check      verify the built desktop and core binaries exist, run nothing\n" +
        "  --runs <n>   how many whole demos to run back to back (default 2: the\n" +
        "               second one proves a run can be repeated)\n" +
        "  --live --main-harness <id> [--main-model <id>] --subagent-harness <id> [--subagent-model <id>]\n" +
        "               run on the REAL harnesses installed here (real inference and spend):\n" +
        "               the main agent on one runtime, its subagents on another\n",
    );
  } else if (mode === "--check") {
    const result = await runCheck();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } else {
    const runsFlag = process.argv.indexOf("--runs");
    const runs = runsFlag === -1 ? 2 : Number(process.argv[runsFlag + 1]);
    if (!Number.isInteger(runs) || runs < 1 || runs > 5) {
      process.stderr.write("--runs takes 1..5\n");
      process.exit(1);
    }
    const flag = (name) => {
      const at = process.argv.indexOf(name);
      return at === -1 ? null : (process.argv[at + 1] ?? null);
    };
    let live = null;
    if (process.argv.includes("--live")) {
      const mainHarness = flag("--main-harness");
      const subagentHarness = flag("--subagent-harness") ?? mainHarness;
      if (!mainHarness || !HARNESS_DISPLAY_NAMES[mainHarness] || !HARNESS_DISPLAY_NAMES[subagentHarness]) {
        process.stderr.write("--live needs --main-harness (claude|codex|opencode|pi), optionally --subagent-harness\n");
        process.exit(1);
      }
      live = {
        main: { harness: mainHarness, model: flag("--main-model") ?? "" },
        subagents: {
          harness: subagentHarness,
          model: flag("--subagent-model") ?? (subagentHarness === mainHarness ? flag("--main-model") ?? "" : ""),
        },
      };
    }
    const report = await execute({ runs, live });
    process.exitCode = report.status === "PASSED" ? 0 : 1;
  }
}
