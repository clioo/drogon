// MIT Copyright (c) 2026 Lovecast Inc.
// The orchestrator probe: commit 854c330b ("make orchestrator the only
// graph interface") deleted WorkGraphDesigner.tsx and the manual
// node-authoring canvas it drove. This probe replaces the stale
// probe-graph-designer.mjs and restates its properties against the
// SHIPPED Orchestrator (Subagent policy panel + canvas) — the graph's one
// interface now — rather than a UI that no longer exists:
//
//   1. honest empty/initial state: with NO `.drogon/graph.json` on disk and
//      no live session, opening Work Graph never invents a saved graph —
//      the Main-agent preview shows the honest placeholder "Configure the
//      main task", and the default policy is "Direct" (no delegate, no
//      adversarial). The old designer's "yours to author"/"the daemon
//      observes" ownership split is restated as: opening the tab writes at
//      most an EMPTY intent/state (never a fabricated node or run);
//   2. configuring the graph through the REAL Subagent policy panel: the
//      Main task's harness/model pickers against the real
//      `harness.list`/`harness.models` catalogs, one approved-runtime row
//      through the same pickers, and the two execution-mode toggles
//      (Adversarial testing / Delegate) proven mutually exclusive — every
//      write lands through `graph.write_intent` only, and the file's
//      `state` half is read back untouched (the daemon's half, never
//      authored here);
//   3. "Run workflow" goes through the ONE existing daemon path
//      (`graph.orchestrator_start`/`graph.orchestrator_status` — the same
//      seam accept-orchestrator-modes.mjs and accept-durable-
//      orchestrator.mjs already exercise) to a REAL `passed` verdict with a
//      real run id, while `.drogon/graph.json`'s `intent` bytes stay
//      byte-identical. The executed node's harness is "opencode", backed
//      by a local, chmod'd, offline Node.js script standing in for the
//      real binary (mirroring accept-durable-orchestrator.mjs's proven
//      fixture) — never a paid model call. NOTE: unlike the deleted
//      designer's per-node runs, the durable orchestrator does not mirror
//      run outcomes back into `graph.json`'s own `state.nodes[]` (verified
//      empirically: it stays `idle` through a real run) — the daemon's
//      observed run record lives in the separate orchestrator run store
//      this probe reads through `graph.orchestrator-status` instead, so
//      that RPC result is this probe's proof of "the daemon's state
//      change with a real run id", not the file's `state` section;
//   4. screenshots in light AND dark at 1440/1100/900/760 with the
//      existing no-horizontal-overflow budget.
//
// The old probe's canvas port-dragging, per-node dependsOn editing and
// shell-node-no-model rule have no shipped equivalent (the Orchestrator
// authors exactly one node, "orchestrator-main", through this panel) and
// are dropped rather than kept as dead locators.

import assert from "node:assert/strict";
import { readFile, writeFile, chmod, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runAcceptanceProcess } from "./acceptance-process.mjs";
import { selectSettingsTheme } from "./acceptance-theme.mjs";

const WIDTHS = [1440, 1100, 900, 760];
const MAIN_TASK_PROMPT = "Print the acceptance marker and report completion.";
const FIXTURE_MODEL = "fixture/main";

/** Screenshots only once the canvas has actually settled at this viewport:
 *  the policy panel scrolled back to top (it is independently scrollable
 *  and can retain a stale position from an earlier interaction) and "Fit
 *  view"'s own layout resolved (child cards inside the viewport, at a
 *  readable width) — the exact readiness check
 *  accept-durable-orchestrator.mjs already proved is needed after a
 *  `setViewportSize`, which otherwise races the canvas's own ResizeObserver
 *  and can capture an overlapping, not-yet-reflowed frame. */
async function shot(page, output, name) {
  await page
    .getByTestId("subagent-policy-panel")
    .evaluate((element) => {
      element.scrollTop = 0;
    })
    .catch(() => {});
  await until(
    async () =>
      page.evaluate(() => {
        const flow = document.querySelector('[data-testid="orchestrator-flow"]');
        if (!flow) return true; // no-session preview has no flow to fit
        const child = flow.getBoundingClientRect();
        const parent = flow.parentElement?.getBoundingClientRect();
        if (!parent) return false;
        return child.left >= parent.left - 1 && child.right <= parent.right + 1;
      }),
    "canvas layout settles before the screenshot",
    10000,
  );
  await page.screenshot({
    path: path.join(output, name),
    animations: "disabled",
  });
}

async function readGraph(workspace) {
  return JSON.parse(
    await readFile(path.join(workspace, ".drogon", "graph.json"), "utf8"),
  );
}

async function cliJson(cli, args, timeout = 20000) {
  const { stdout } = await runAcceptanceProcess(cli, args, { timeout });
  const envelope = JSON.parse(stdout);
  assert.equal(envelope.ok, true, `drogon-cli ${args.join(" ")}: ${stdout}`);
  return envelope.result;
}

async function until(check, label, timeout = 20000, every = 200) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`);
    await delay(every);
  }
}

/** A REAL executable standing in for the `opencode` binary the compiler's
 *  "shell" backend invokes (crates/drogon-core/src/graph/compiler.rs: a
 *  node whose harness is "opencode" compiles to `backend: "shell"`, so
 *  mentu-recipes runs this file directly — never a bespoke agent-cli
 *  protocol). Consumes exactly the argv/stdout contract
 *  accept-durable-orchestrator.mjs already proved against the pinned
 *  mentu-recipes runtime: `--version`, `models` (for the harness/model
 *  catalog probes) and `run --model <id> ... <prompt>`, echoing back the
 *  compiler's own completion keyword. No network, no credentials, no
 *  inference — fully offline and deterministic. */
function fixtureOpencodeSource() {
  return `#!${process.execPath}
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('opencode fixture 1.0'); process.exit(0); }
if (args[0] === 'models') { console.log('${FIXTURE_MODEL}'); process.exit(0); }
if (args[0] !== 'run') process.exit(20);
const prompt = args.at(-1);
console.log(prompt.match(/DROGON_NODE_[A-Z0-9_]+_DONE/g)?.at(-1) ?? 'fixture complete');
`;
}

async function selectHarness(page, root, testId, displayName) {
  await root.getByTestId(testId).click();
  await page.getByRole("option", { name: displayName, exact: true }).click();
}

/** The real per-harness model picker: search the real `harness.models`
 *  catalog, then pick the matching row. */
async function pickModel(page, root, prefix, model) {
  const value = root.getByTestId(`${prefix}-model-value`);
  await value.locator("xpath=..").getByRole("button", { name: "Browse models" }).click();
  const search = page.getByRole("combobox", { name: "Search models" });
  await search.waitFor();
  await search.fill(model);
  await page
    .locator('[role="listbox"] [role="option"]')
    .filter({ hasText: model })
    .first()
    .click();
}

export async function probeOrchestrator({
  page,
  workspace,
  output,
  cli,
  dataDir,
  workspaceId: knownWorkspaceId = null,
}) {
  const checks = [];
  await page.setViewportSize({ width: 1440, height: 900 });
  const panel = page.locator('[data-testid="mentu-tab-panel"]');

  // A real, chmod'd fixture stands in for the `opencode` binary so
  // `harness.list`/`harness.models` enumerate it for real — never a
  // fabricated catalog entry. Written directly into the daemon's already-
  // resolved fixture PATH directory (a sibling of `dataDir`, the same
  // layout accept-desktop.mjs, accept-orchestrator.mjs and
  // accept-durable-orchestrator.mjs all use), so no daemon restart is
  // needed and no other probe's fixtures are disturbed. Restored to
  // whatever this probe found there (nothing, on a plain `--files` dev
  // run) before returning.
  const fixtureBin = path.join(path.dirname(dataDir), "bin");
  const opencodeFixturePath = path.join(fixtureBin, "opencode");
  const priorOpencodeFixture = await readFile(opencodeFixturePath).catch(
    () => null,
  );
  await writeFile(opencodeFixturePath, fixtureOpencodeSource());
  await chmod(opencodeFixturePath, 0o700);

  // The right sidebar (file explorer) competes with the canvas + policy
  // panel for width at the narrow acceptance widths and has nothing to do
  // with the Work Graph; a probe that ran before this one may leave it
  // open (observed: at 760px this overlaps the canvas cards over the
  // policy panel text instead of the two stacking cleanly). The probe that
  // runs AFTER this one (probe-rendered-mentu-tab.mjs) needs it back open
  // to reach the right sidebar's OWN "Work Graph" activity-bar button, so
  // this closes and reopens it through the same global chord the app binds
  // ("sidebar.right.toggle" -> Cmd/Ctrl+L, shortcut-label.ts's
  // SIDEBAR_RIGHT_TOGGLE_CHORD) rather than clicking the panel's own
  // buttons: closing collapses the whole container, including its
  // activity-bar icons, to zero width (RightSidebar.tsx:
  // `open ? { width } : { width: 0 }`), so there is no click target left
  // once it is closed — only a chord reaches it either way.
  const sidebarToggleChord = process.platform === "darwin" ? "Meta+L" : "Control+L";
  const rightSidebarToggle = page.getByRole("button", { name: "Toggle right sidebar" });
  const rightSidebarWasOpen = await rightSidebarToggle.isVisible().catch(() => false);
  if (rightSidebarWasOpen) {
    await page.keyboard.press(sidebarToggleChord);
    await rightSidebarToggle.waitFor({ state: "hidden", timeout: 5000 });
  }

  try {
    // 1. Honest initial state: no `.drogon/graph.json` on disk, no session.
    //    A known starting theme (never assumed from whatever a prior probe
    //    left behind) so "-light.png" screenshots are actually light.
    await selectSettingsTheme(page, "light");
    await assert.rejects(
      readGraph(workspace),
      /ENOENT/,
      "no graph.json must exist before this probe touches anything",
    );
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Work Graph", exact: true })
      .click();
    await page.getByRole("tab", { name: "Work Graph", exact: true }).waitFor();
    const canvas = panel.locator('[data-testid="orchestrator-canvas"]');
    await canvas.waitFor();
    const mainPreview = panel.locator('[data-testid="orchestrator-main-agent"]');
    await mainPreview.waitFor({ timeout: 10000 });
    assert.match(
      (await mainPreview.innerText()) ?? "",
      /Configure the main task/,
      "an unconfigured main task must say so honestly, never show invented content",
    );
    const policyPanel = panel.locator('[data-testid="subagent-policy-panel"]');
    await policyPanel.waitFor();
    const summary = policyPanel.locator('[data-testid="subagent-policy-summary"]');
    assert.match(
      (await summary.innerText()) ?? "",
      /Direct/,
      "the default policy must be Direct: no delegate, no adversarial",
    );
    // Merely opening the tab may create the file (a read seam that ensures
    // it exists), but it must never invent a node or a run: at most an
    // empty intent and an empty, never-observed state.
    const opened = await readGraph(workspace).catch(() => null);
    if (opened) {
      assert.equal(opened.intent.nodes.length, 0, JSON.stringify(opened));
      assert.equal(opened.state.nodes.length, 0, JSON.stringify(opened));
    }
    await shot(page, output, "orchestrator-empty-light.png");
    checks.push("orchestrator-honest-empty-state-no-graph-json-and-no-invented-node");

    const workspaceId =
      knownWorkspaceId ??
      (await page.evaluate(async (workspacePath) => {
        const listed = await window.drogon.workspaces();
        if (!listed.ok) return null;
        const tail = workspacePath.split("/").filter(Boolean).pop();
        return (
          listed.result.workspaces.find((item) => item.path === workspacePath)?.id ??
          listed.result.workspaces.find((item) => item.path.endsWith(`/${tail}`))?.id ??
          null
        );
      }, workspace));
    assert.ok(workspaceId, "the probe needs the workspace id for orchestrator-status");

    // 2. Configure the Main task through the REAL panel: prompt, harness
    //    and model pickers against the real catalogs. Every write lands
    //    through `graph.write_intent` only — `state` stays untouched.
    const mainTaskBox = page.getByRole("textbox", { name: "Main task", exact: true });
    await mainTaskBox.fill(MAIN_TASK_PROMPT);
    await until(
      async () =>
        (await readGraph(workspace).catch(() => null))?.intent.nodes.find(
          (node) => node.id === "orchestrator-main",
        )?.prompt === MAIN_TASK_PROMPT,
      "main task prompt autosaves",
      15000,
    );
    const afterPrompt = await readGraph(workspace);
    assert.equal(afterPrompt.version, 1);
    assert.equal(afterPrompt.intent.nodes.length, 1);
    assert.ok(
      afterPrompt.state.nodes.length <= 1 &&
        afterPrompt.state.nodes.every((node) => node.status === "idle" && !node.runId),
      "saving intent must never invent state: " + JSON.stringify(afterPrompt.state),
    );
    checks.push("main-task-prompt-writes-through-graph-write-intent-only");

    await selectHarness(page, policyPanel, "main-task-harness", "OpenCode");
    await until(
      async () => (await readGraph(workspace)).intent.nodes[0].harness === "opencode",
      "main task harness autosaves",
      15000,
    );
    await pickModel(page, policyPanel, "main-task", FIXTURE_MODEL);
    await until(
      async () => (await readGraph(workspace)).intent.nodes[0].model === FIXTURE_MODEL,
      "main task model autosaves",
      15000,
    );
    const configured = await readGraph(workspace);
    assert.equal(configured.intent.nodes[0].harness, "opencode");
    assert.equal(configured.intent.nodes[0].model, FIXTURE_MODEL);
    assert.equal(configured.intent.nodes[0].prompt, MAIN_TASK_PROMPT);
    checks.push("main-task-harness-and-model-picked-from-the-real-catalogs");

    // One approved-runtime row through the same real pickers, then removed
    // again — this run stays in Direct mode, where approved runtimes are
    // unused, so the policy is clean before "Run workflow".
    await policyPanel.getByTestId("add-approved-runtime").click();
    await policyPanel.getByTestId("approved-runtime-row-0").waitFor();
    await selectHarness(page, policyPanel, "approved-runtime-0-harness", "OpenCode");
    await pickModel(page, policyPanel, "approved-runtime-0", FIXTURE_MODEL);
    await until(
      async () => {
        const runtimes = (await readGraph(workspace)).intent.policy.approvedRuntimes;
        return runtimes.length === 1 && runtimes[0].harness === "opencode" && runtimes[0].model === FIXTURE_MODEL;
      },
      "approved runtime autosaves",
      15000,
    );
    await policyPanel.getByTestId("approved-runtime-0-remove").click();
    await until(
      async () => (await readGraph(workspace)).intent.policy.approvedRuntimes.length === 0,
      "approved runtime removal autosaves",
      15000,
    );
    checks.push("approved-runtime-harness-and-model-picked-from-the-real-catalogs");

    // Execution modes: "choose at most one". Enabling either one turns the
    // other off in the same saved policy.
    await policyPanel.getByTestId("delegate-toggle").click();
    await until(
      async () => {
        const p = (await readGraph(workspace)).intent.policy;
        return p.delegate === true && p.adversarial.enabled === false;
      },
      "delegate-on policy",
      15000,
    );
    await policyPanel.getByTestId("adversarial-toggle").click();
    await until(
      async () => {
        const p = (await readGraph(workspace)).intent.policy;
        return p.delegate === false && p.adversarial.enabled === true;
      },
      "adversarial replaces delegate",
      15000,
    );
    await policyPanel.getByTestId("adversarial-toggle").click();
    const directPolicy = await until(
      async () => {
        const g = await readGraph(workspace);
        const p = g.intent.policy;
        return (p.delegate === false && p.adversarial.enabled === false) && g;
      },
      "back to direct policy",
      15000,
    );
    assert.ok(directPolicy.state.nodes.length <= 1);
    assert.match((await summary.innerText()) ?? "", /Direct/);
    checks.push("execution-modes-are-mutually-exclusive-and-write-through-intent-only");
    await shot(page, output, "orchestrator-configured-light.png");

    // 3. Run workflow through the ONE existing daemon path. The executed
    //    node is the local "opencode" fixture — no paid inference.
    const orchestratorStatus = async () =>
      (
        await cliJson(cli, [
          "--data-dir",
          dataDir,
          "--json",
          "graph",
          "orchestrator-status",
          "--workspace",
          workspaceId,
        ])
      ).run;
    const beforeIntent = JSON.stringify((await readGraph(workspace)).intent);
    await panel.getByTestId("orchestrator-run-workflow").click();
    const finished = await until(
      async () => {
        const run = await orchestratorStatus();
        return run && run.status !== "running" && run.status !== "stopping" && run;
      },
      "orchestrator run settles",
      60000,
      500,
    );
    assert.equal(finished.status, "passed", JSON.stringify(finished, null, 2));
    assert.equal(finished.steps.length, 1, JSON.stringify(finished.steps));
    assert.equal(finished.steps[0].phase, "main");
    assert.equal(finished.steps[0].runtime.harness, "opencode");
    assert.equal(finished.steps[0].runtime.model, FIXTURE_MODEL);
    assert.ok(
      typeof finished.steps[0].runId === "string" && finished.steps[0].runId.length > 0,
      `a real run must record a real run id: ${JSON.stringify(finished.steps[0])}`,
    );
    const terminal = panel.locator('[data-testid="orchestrator-terminal"]');
    await until(
      async () => (await terminal.innerText()).includes("Last run:"),
      "the terminal renders the real receipt",
      15000,
    );
    assert.equal(await terminal.getAttribute("data-state"), "ready", await terminal.innerText());
    const afterRun = await readGraph(workspace);
    assert.equal(
      JSON.stringify(afterRun.intent),
      beforeIntent,
      "a run must never touch the intent half",
    );
    checks.push(
      "run-workflow-goes-through-the-durable-orchestrator-to-a-real-passed-verdict-with-a-shell-fixture-and-intent-untouched",
    );
    await shot(page, output, "orchestrator-run-passed-light.png");

    // 4. Screenshots: light + dark, every acceptance width, no overflow.
    for (const theme of ["light", "dark"]) {
      await selectSettingsTheme(page, theme);
      await page.getByRole("tab", { name: "Work Graph", exact: true }).click();
      await canvas.waitFor();
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.ok(
          overflow <= 0,
          `the orchestrator must not scroll horizontally at ${width}px ${theme} (overflow ${overflow}px)`,
        );
        await shot(page, output, `orchestrator-${theme}-${width}.png`);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await selectSettingsTheme(page, "light");
    await page.getByRole("tab", { name: "Work Graph", exact: true }).click();
    await canvas.waitFor();
    checks.push("orchestrator-screenshots-light-dark-and-no-overflow-1440-1100-900-760");

    // Leave the strip as the probe found it: the Mentu tab probe that runs
    // next expects a strip without a Work Graph tab.
    await page
      .getByRole("button", { name: "Close tab Work Graph", exact: true })
      .click();
    await page
      .getByRole("tab", { name: "Work Graph", exact: true })
      .waitFor({ state: "detached" });

    return checks;
  } finally {
    if (priorOpencodeFixture === null) {
      await rm(opencodeFixturePath, { force: true });
    } else {
      await writeFile(opencodeFixturePath, priorOpencodeFixture);
    }
    if (rightSidebarWasOpen && !(await rightSidebarToggle.isVisible().catch(() => false))) {
      await page.keyboard.press(sidebarToggleChord);
      await rightSidebarToggle.waitFor({ timeout: 5000 }).catch(() => {});
    }
  }
}
