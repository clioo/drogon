// Regression for the reported bug: "when you click plus and click Mentu, the
// tab system disappears". The "+" menu's Mentu entry used to set a full-page
// ROUTE (`MENTU_ROUTE_ID`), and a full-page route hides the terminal column —
// the column that owns the tab strip — so the whole tab system vanished.
//
// This probe drives the real app over CDP and proves Mentu is a REAL TAB:
// it appears in the strip beside the session tabs, selecting and closing it
// behave like any other tab, the strip survives (tablist still present, every
// earlier tab still there), the membership survives a renderer reload, and
// `drogon-cli mentu open` reaches the same tab through the daemon's desktop
// relay with the renderer's own verdict. It also proves `drogon-cli mentu
// status` agrees with the daemon's runtime report (never an optimistic
// guess) and that the workspace's recipe inventory is real.
//
// Since the work-graph takeover, the tab's CONTENT is the WORK GRAPH read
// from `<workspace>/.drogon/graph.json`: this probe now also proves the
// graph renders the real fixture DAG with the daemon's own statuses
// (including `unverifiable`), that a node's evidence (exit code, streams,
// drift) renders ON the node, and that the Refresh re-read flips a node's
// status. The recipe RUN journey (select → review → approve & run →
// per-step evidence) moved intact to the right-sidebar Mentu panel, which
// still owns the recipe surface — same assertions, same runtime, new
// entry point.

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runAcceptanceProcess } from "./acceptance-process.mjs";
import {
  captureThemeSurface,
  selectSettingsTheme,
} from "./acceptance-theme.mjs";

const WIDTHS = [1440, 1100, 900, 760];

const MENTU_TAB_RECIPE = {
  name: "acceptance-mentu-tab",
  description: "sealed acceptance probe: the Mentu tab's own recipe",
  steps: [
    {
      label: "tab-step-one",
      backend: "shell",
      prompt: "printf 'MENTU-TAB-STEP-ONE\\n'",
      timeout: 30,
    },
    {
      label: "tab-step-two",
      backend: "shell",
      depends_on: ["tab-step-one"],
      prompt: "printf 'MENTU-TAB-STEP-TWO\\n'",
      timeout: 30,
    },
  ],
};

// The work-graph fixture: the exact contract shape the daemon writes.
// One leader (succeeded, with usage), one shell build (running first,
// then succeeded after the Refresh flip), one agent review left
// `unverifiable` (loss of contact — its own outcome), and one disabled
// node (not to relaunch). The failed node carries streams + drift so the
// inspector assertions exercise evidence ON the node.
function workGraphFixture(buildStatus) {
  return {
    version: 1,
    intent: {
      nodes: [
        {
          id: "n0",
          title: "Plan the migration",
          harness: "pi",
          model: "qwen3.8-flash-next-nvidia-nvfp4",
          dependsOn: [],
          prompt: "Read the repo and plan the migration.",
          enabled: true,
        },
        {
          id: "n1",
          title: "Build workspace",
          harness: "shell",
          model: null,
          dependsOn: ["n0"],
          prompt: "pnpm build",
          enabled: true,
        },
        {
          id: "n2",
          title: "Review changes",
          harness: "pi",
          model: null,
          dependsOn: ["n0"],
          prompt: "Review the diff.",
          enabled: true,
        },
        {
          id: "n3",
          title: "Old exporter",
          harness: "pi",
          model: null,
          dependsOn: ["n1"],
          prompt: "Retired node.",
          enabled: false,
        },
      ],
    },
    state: {
      updatedAt: "2026-09-11T12:00:00.000Z",
      nodes: [
        {
          id: "n0",
          status: "succeeded",
          runId: "run-accept-1",
          startedAt: "2026-09-11T11:58:00.000Z",
          endedAt: "2026-09-11T11:59:00.000Z",
          evidence: {
            exitCode: 0,
            stdout: "plan ready",
            stdoutPath: ".drogon/runs/run-accept-1/n0.out",
            usage: {
              model: "qwen3.8-flash-next-nvidia-nvfp4",
              inputTokens: 120,
              outputTokens: 45,
              usageKnown: true,
            },
          },
        },
        { id: "n1", status: buildStatus },
        {
          id: "n2",
          status: "unverifiable",
          lastError: "contact lost mid-run",
        },
      ],
    },
  };
}

function failedBuildState(graph) {
  graph.state.nodes = graph.state.nodes.map((node) =>
    node.id === "n1"
      ? {
          ...node,
          status: "failed",
          endedAt: "2026-09-11T12:01:00.000Z",
          lastError: "Completion policy was not satisfied",
          evidence: {
            exitCode: 1,
            stdout: "WORK-GRAPH-STDOUT-MARKER",
            stderr: "error: recipe compile failed",
            drift: { expected: ["src/lib.rs"], created: ["src/lib.rs", "src/extra.rs"] },
          },
        }
      : node,
  );
  return graph;
}

async function shot(page, output, name) {
  await page.screenshot({
    path: path.join(output, name),
    animations: "disabled",
  });
}

async function stripLabels(page) {
  // Scoped to the STRIP's tablist: the Mentu surfaces render their own
  // role="tab" view switchers (Graph/Run/Evidence/Metrics), which are not
  // strip tabs.
  return page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[role="tablist"][aria-label="Sessions"] [role="tab"]',
      ),
    ].map((el) => ({
      label: el.getAttribute("aria-label") ?? "",
      id: el.getAttribute("data-tab-id") ?? "",
      selected: el.getAttribute("aria-selected") === "true",
    })),
  );
}

async function cliJson(cli, args, timeout = 30000) {
  try {
    return JSON.parse(
      (await runAcceptanceProcess(cli, args, { timeout })).stdout,
    );
  } catch (error) {
    if (typeof error.stdout === "string" && error.stdout.trim().length > 0)
      return JSON.parse(error.stdout);
    throw error;
  }
}

/** Waits until the locator's text contains the expected fragment. */
async function waitForText(locator, fragment, timeout = 15000) {
  await locator
    .getByText(fragment, { exact: false })
    .first()
    .waitFor({ timeout });
}

export async function probeRenderedMentuTab({
  page,
  workspace,
  output,
  cli,
  dataDir,
  workspaceId: knownWorkspaceId = null,
}) {
  const checks = [];
  // The suite's CLI and data dir are needed well before the run step now:
  // the Run Recipe control DELEGATES to the workspace's main agent session,
  // so this probe has to start one (the shared sealed fixture) and wait for
  // it to be idle before the click. Resolve the workspace id up front and
  // reuse it for the later `mentu status`/`mentu open` calls.
  const workspaceId =
    knownWorkspaceId ??
    (await page.evaluate(async (workspacePath) => {
      const listed = await window.drogon.workspaces();
      if (!listed.ok) return null;
      // The daemon canonicalizes paths (a /var temp dir becomes /private/var),
      // so match on the last segment instead of requiring byte equality.
      const tail = workspacePath.split("/").filter(Boolean).pop();
      return (
        listed.result.workspaces.find((item) => item.path === workspacePath)?.id ??
        listed.result.workspaces.find((item) => item.path.endsWith(`/${tail}`))?.id ??
        null
      );
    }, workspace));
  assert.ok(workspaceId, "the probe needs the workspace id for its CLI calls");
  // The strip already holds the workspace's terminal tab(s) by now.
  const before = await stripLabels(page);
  assert.ok(
    before.length > 0,
    `the strip must hold the session tabs before the probe, saw ${JSON.stringify(before)}`,
  );

  // 1. The reported reproduction: plus menu -> Mentu.
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page.getByRole("menuitem", { name: "Mentu", exact: true }).click();
  await page.getByRole("tab", { name: "Mentu", exact: true }).waitFor();
  const after = await stripLabels(page);
  assert.equal(
    after.length,
    before.length + 1,
    `the Mentu tab must be ADDED to the strip, not replace it: before=${JSON.stringify(before.map((t) => t.label))} after=${JSON.stringify(after.map((t) => t.label))}`,
  );
  // Every earlier tab is still in the strip: this is exactly what used to
  // break (the whole strip disappeared).
  for (const entry of before)
    assert.ok(
      after.some((candidate) => candidate.label === entry.label),
      `tab ${entry.label} disappeared when Mentu opened: ${JSON.stringify(after.map((t) => t.label))}`,
    );
  // The strip itself is still a rendered tablist, and the column that owns
  // it is not hidden (the old route did `display: none` on it).
  await page.getByRole("tablist", { name: "Sessions" }).waitFor();
  const stripVisible = await page.evaluate(() => {
    const list = document.querySelector('[role="tablist"][aria-label="Sessions"]');
    if (!list) return null;
    const box = list.getBoundingClientRect();
    return { width: box.width, height: box.height };
  });
  assert.ok(
    stripVisible && stripVisible.width > 0 && stripVisible.height > 0,
    `the tab strip must stay laid out, saw ${JSON.stringify(stripVisible)}`,
  );
  checks.push("mentu-plus-menu-opens-a-real-tab-and-the-strip-survives");

  // 2. The Mentu tab selected itself and shows the WORK GRAPH surface —
  //    the tab's content since the work-graph takeover.
  const mentuTab = page.getByRole("tab", { name: "Mentu", exact: true });
  assert.equal(
    await mentuTab.getAttribute("aria-selected"),
    "true",
    "opening Mentu must select its tab",
  );
  const panel = page.locator('[data-testid="mentu-tab-panel"]');
  await panel.waitFor();
  await panel.locator('[data-testid="work-graph-pane"]').waitFor();
  checks.push("mentu-tab-renders-the-work-graph-surface");

  // 3. Selecting a session tab and coming back keeps both surfaces working.
  const sessionLabel = before[0].label;
  await page.getByRole("tab", { name: sessionLabel, exact: true }).click();
  assert.equal(
    await mentuTab.getAttribute("aria-selected"),
    "false",
    "leaving the Mentu tab must clear its selection",
  );
  assert.equal(
    await page
      .getByRole("tab", { name: sessionLabel, exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await mentuTab.click();
  assert.equal(await mentuTab.getAttribute("aria-selected"), "true");
  checks.push("mentu-tab-is-focusable-like-any-other-tab");

  // 4. The work-graph fixture is written into the workspace and the tab
  //    renders it: the DAG with the daemon's own statuses, the aggregate
  //    strip, and `unverifiable` spelled as its own outcome.
  const recipesDir = path.join(workspace, ".mentu", "recipes");
  await mkdir(recipesDir, { recursive: true });
  await writeFile(
    path.join(recipesDir, "acceptance-mentu-tab.json"),
    `${JSON.stringify(MENTU_TAB_RECIPE, null, 2)}\n`,
  );
  const drogonDir = path.join(workspace, ".drogon");
  await mkdir(drogonDir, { recursive: true });
  const graphPath = path.join(drogonDir, "graph.json");
  await writeFile(graphPath, `${JSON.stringify(workGraphFixture("running"), null, 2)}\n`);
  await panel.locator('[data-testid="work-graph-refresh"]').click();
  await panel.getByText("Plan the migration", { exact: true }).waitFor({ timeout: 15000 });
  await panel.getByText("Build workspace", { exact: true }).waitFor();
  await panel.getByText("Review changes", { exact: true }).waitFor();
  const statusBadge = panel.locator('[data-work-graph-status="running"]');
  await statusBadge.waitFor();
  const unverifiableBadge = panel.locator('[data-work-graph-status="unverifiable"]');
  await unverifiableBadge.waitFor();
  assert.match(
    (await unverifiableBadge.innerText()) ?? "",
    /Unverifiable/i,
    "loss of contact must render as Unverifiable, never as failed or succeeded",
  );
  const totals = panel.locator('[data-testid="work-graph-totals"]');
  await totals.waitFor();
  assert.match(
    (await totals.innerText()) ?? "",
    /Input tokens: 120/,
    `the aggregate strip must sum the recorded usage, saw ${JSON.stringify(await totals.innerText())}`,
  );
  assert.match((await totals.innerText()) ?? "", /Cost: unavailable/);
  checks.push("work-graph-tab-renders-the-fixture-dag-with-real-statuses");

  // 4b. Evidence lives ON the node: selecting the node shows its exit
  //     code, streams and drift right there, with the shell/agent
  //     distinction intact. Then the Refresh re-read flips a node's
  //     status — the live-update seam the daemon writes through.
  await panel.getByText("Plan the migration", { exact: true }).click();
  const inspector = panel.locator('[data-testid="work-graph-node-inspector"]');
  await inspector.waitFor();
  await waitForText(inspector, "plan ready");
  const inspectorText = (await inspector.innerText()) ?? "";
  assert.match(inspectorText, /run-accept-1/);
  assert.match(inspectorText, /qwen3\.8-flash-next-nvidia-nvfp4/);
  await panel.getByText("Old exporter", { exact: true }).click();
  await waitForText(inspector, "not to relaunch");

  // The daemon settles the build and records its failure: a Refresh (and
  // the pane's own poll) must flip the badge and surface the evidence.
  await writeFile(graphPath, `${JSON.stringify(failedBuildState(workGraphFixture("failed")), null, 2)}\n`);
  await panel.locator('[data-testid="work-graph-refresh"]').click();
  await panel.locator('[data-work-graph-status="failed"]').waitFor({ timeout: 15000 });
  await panel.getByText("Build workspace", { exact: true }).click();
  await waitForText(inspector, "Completion policy was not satisfied");
  const buildInspectorText = (await inspector.innerText()) ?? "";
  assert.match(buildInspectorText, /WORK-GRAPH-STDOUT-MARKER/);
  assert.match(buildInspectorText, /src\/lib\.rs/);
  assert.match(buildInspectorText, /src\/extra\.rs/);
  assert.match(buildInspectorText, /not applicable \(shell node\)/);
  checks.push("work-graph-evidence-renders-on-the-node-and-refresh-flips-status");

  // 4c. The recipe RUN journey moved intact to the right-sidebar Mentu
  //     panel, which owns the recipe surface since the takeover: select,
  //     review, approve & run against the pinned runtime, then per-step
  //     evidence. Same assertions the tab used to make — new entry point.
  await page.locator('.right-sidebar-header-drag button[aria-label="Mentu"]').click();
  const sidePanel = page.locator('[data-testid="mentu-panel"]');
  await sidePanel.waitFor();
  const recipeSelect = sidePanel.getByRole("combobox", { name: "Recipe", exact: true });
  await recipeSelect.click({ timeout: 15000 });
  await page
    .getByRole("option", { name: "acceptance-mentu-tab", exact: true })
    .click();
  await sidePanel.getByText("tab-step-one", { exact: true }).waitFor();
  await sidePanel.getByText("tab-step-two", { exact: true }).waitFor();
  checks.push("a-recipe-is-visible-in-the-mentu-panel");

  // 4c-pre. The panel's run control DELEGATES to the workspace's MAIN agent
  //     session (#441), so start a real harness session first — the shared
  //     sealed fixture (probe-agent-settings.mjs) stands in for an agent
  //     that read the drogon-cli skill and answers the prompt by invoking
  //     the documented command. Without a live idle agent the click has no
  //     target and the run can never start; this is what makes the journey
  //     prove the whole button -> session -> agent -> CLI -> daemon -> run
  //     chain.
  const fixtureAgent = await cliJson(cli, [
    "--data-dir",
    dataDir,
    "--json",
    "harness",
    "start",
    "--workspace",
    workspaceId,
    "--harness",
    "claude",
  ]);
  assert.equal(fixtureAgent.ok, true, JSON.stringify(fixtureAgent));
  const agentSessionId = fixtureAgent.result.id;
  const agentDeadline = Date.now() + 30000;
  for (;;) {
    const listed = await cliJson(cli, [
      "--data-dir",
      dataDir,
      "--json",
      "terminal",
      "list",
      "--workspace",
      workspaceId,
    ]);
    const agent = listed.result.sessions.find(
      (session) => session.id === agentSessionId,
    );
    if (agent && agent.agentState === "idle") break;
    if (Date.now() >= agentDeadline)
      throw new Error(
        `the main agent session never went idle: ${JSON.stringify(agent ?? null)}`,
      );
    await delay(500);
  }
  // The shell's own session list must have caught up before the click, or
  // the controller still believes the workspace has no main session and
  // refuses the delegation it was about to make.
  await sidePanel
    .locator('[data-testid="mentu-main-session-hint"]')
    .waitFor({ state: "hidden", timeout: 20000 });
  checks.push("mentu-delegation-target-agent-session-idle");

  // 4c-run. Drive the SAME review -> approve & run controller from the
  //     panel: the click stages the review, the second approves that hash
  //     and hands the run to the main agent session.
  const runButton = sidePanel.locator('[data-testid="mentu-run"]');
  await runButton.click();
  // Review stages the exact recipe bytes; the second click approves that
  // hash and hands the run to the workspace's main agent session.
  await sidePanel.getByRole("button", { name: "Approve & run", exact: true }).waitFor({ timeout: 15000 });
  await sidePanel.getByRole("button", { name: "Approve & run", exact: true }).click();
  const runStatus = sidePanel.locator('[data-testid="mentu-run-status"]');
  await runStatus.waitFor({ timeout: 180000 });
  // Any terminal verdict renders here; the probe asserts WHICH one, so a
  // failed run is reported as a failed run instead of a timeout.
  await runStatus
    .getByText(/Succeeded|Failed|Cancelled|Unavailable/i)
    .waitFor({ timeout: 180000 });
  const statusText = (await runStatus.innerText()) ?? "";
  assert.match(
    statusText,
    /Succeeded/i,
    `the recipe run must succeed, saw ${JSON.stringify(statusText)}; panel text: ${JSON.stringify((await sidePanel.innerText())?.slice(0, 2000))}`,
  );
  await sidePanel.getByRole("tab", { name: "Evidence", exact: true }).click();
  const evidence = sidePanel.locator('[data-testid="recipe-evidence"]');
  await evidence.waitFor();
  await evidence.getByText("tab-step-one", { exact: true }).waitFor();
  await evidence.getByText("tab-step-two", { exact: true }).waitFor();
  const stdoutBlocks = await evidence
    .locator('pre[aria-label="stdout output"]')
    .allTextContents();
  assert.ok(
    stdoutBlocks.some((text) => text.includes("MENTU-TAB-STEP-ONE")),
    `the first step's stdout evidence must carry its marker, saw ${JSON.stringify(stdoutBlocks)}`,
  );
  assert.ok(
    stdoutBlocks.some((text) => text.includes("MENTU-TAB-STEP-TWO")),
    `the second step's stdout evidence must carry its marker, saw ${JSON.stringify(stdoutBlocks)}`,
  );
  checks.push("mentu-panel-runs-a-recipe-and-shows-per-step-evidence");
  // Back to the Mentu tab for the chrome checks below.
  await mentuTab.click();

  // 5. A real theme switch (the Settings radio, persisted) with captures
  //    whose computed background/foreground are verified, then the
  //    horizontal-overflow budget on this surface.
  for (const theme of ["light", "dark"]) {
    const selection = await selectSettingsTheme(page, theme);
    await page.getByRole("tab", { name: "Mentu", exact: true }).click();
    await panel.locator('[data-testid="work-graph-pane"]').waitFor();
    await captureThemeSurface(
      page,
      path.join(output, `mentu-tab-${theme}.png`),
      selection,
    );
  }
  await selectSettingsTheme(page, "light");
  await page.getByRole("tab", { name: "Mentu", exact: true }).click();
  await panel.locator('[data-testid="work-graph-pane"]').waitFor();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(
      overflow <= 0,
      `the Mentu tab must not scroll horizontally at ${width}px (overflow ${overflow}px)`,
    );
    await shot(page, output, `mentu-tab-${width}.png`);
  }
  checks.push("mentu-tab-no-horizontal-overflow-1440-1100-900-760");

  // 6. Reload: the strip (and the Mentu tab's membership) comes back with no
  //    clicks, exactly like the editor/browser tabs.
  await page.reload();
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor({ timeout: 30000 });
  await page
    .getByRole("tab", { name: "Mentu", exact: true })
    .waitFor({ timeout: 30000 });
  assert.equal(
    await page.getByRole("tablist", { name: "Sessions" }).count(),
    1,
    "the strip must come back after a reload",
  );
  checks.push("mentu-tab-membership-persists-across-a-renderer-reload");

  if (!cli || !dataDir) return checks;

  // 7. `drogon-cli mentu status` must agree with the daemon's own runtime
  //    report — and must never claim a runtime this host does not have.
  const status = await cliJson(cli, [
    "--data-dir",
    dataDir,
    "--json",
    "mentu",
    "status",
    "--workspace",
    workspaceId,
  ]);
  assert.equal(status.ok, true, JSON.stringify(status.error ?? status));
  const report = status.result;
  assert.ok(
    ["installed", "not_installed", "partially_available"].includes(report.verdict),
    `unexpected verdict ${report.verdict}`,
  );
  if (report.runtime.available) {
    assert.equal(report.verdict, "installed", JSON.stringify(report));
    assert.equal(report.runtime.lockMatches, true, JSON.stringify(report));
  } else if (report.runtime.actualSha256 === null) {
    assert.equal(report.verdict, "not_installed", JSON.stringify(report));
  } else {
    assert.equal(report.verdict, "partially_available", JSON.stringify(report));
  }
  assert.equal(report.workspace.id, workspaceId);
  assert.ok(
    report.workspace.recipes.total >= 1,
    `the probe's own recipe must be discovered, saw ${JSON.stringify(report.workspace.recipes)}`,
  );
  assert.equal(
    report.workspace.recipes.invalid.length,
    0,
    `the probe's recipe must be valid, saw ${JSON.stringify(report.workspace.recipes.invalid)}`,
  );
  checks.push("mentu-status-agrees-with-the-daemon-and-never-guesses");

  // 8. The Bot-facing verb: `drogon-cli mentu open` opens the same tab in the
  //    running app, through the daemon relay, with the renderer's verdict.
  await page.getByRole("tab", { name: sessionLabel, exact: true }).click();
  const opened = await cliJson(cli, [
    "--data-dir",
    dataDir,
    "--json",
    "mentu",
    "open",
    "--workspace",
    workspaceId,
    "--recipe",
    "acceptance-mentu-tab",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(opened.ok, true, JSON.stringify(opened.error ?? opened));
  assert.equal(opened.result.opened, true, JSON.stringify(opened.result));
  assert.equal(opened.result.recipeId, "acceptance-mentu-tab");
  const focused = page.getByRole("tab", { name: "Mentu", exact: true });
  await focused.waitFor();
  assert.equal(
    await focused.getAttribute("aria-selected"),
    "true",
    "the CLI-driven open must focus the Mentu tab",
  );
  await panel.locator('[data-testid="work-graph-pane"]').waitFor();
  checks.push("drogon-cli-mentu-open-focuses-the-mentu-tab");

  // 9. Closing the tab leaves the strip intact — the mirror image of the bug.
  await page.getByRole("button", { name: "Close tab Mentu", exact: true }).click();
  await page
    .getByRole("tab", { name: "Mentu", exact: true })
    .waitFor({ state: "detached" });
  const remaining = await stripLabels(page);
  assert.ok(
    remaining.length >= 1,
    `the strip must survive closing the Mentu tab, saw ${JSON.stringify(remaining)}`,
  );
  for (const entry of before)
    assert.ok(
      remaining.some((candidate) => candidate.label === entry.label),
      `tab ${entry.label} disappeared when Mentu closed`,
    );
  checks.push("closing-the-mentu-tab-keeps-the-strip-intact");

  return checks;
}
