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
// Since the work-graph takeover, the tab's CONTENT is the Orchestrator
// (`work-graph-pane`); the multi-node fixture-DAG rendering this probe used
// to exercise here (per-node projected statuses, a "Refresh" button, an
// inspector), and the recipe RUN journey (select → review → approve & run →
// per-step evidence) this probe used to drive through the right-sidebar
// Mentu panel, were both retired by 854c330b ("make orchestrator the only
// graph interface"): the single main-task node bound to the workspace's
// live session replaced the per-node designer/read view (that property now
// lives in probe-orchestrator.mjs, against the shipped UI), and
// `<MentuPanel>` (the recipe select/run/evidence UI) is mounted nowhere
// outside its own tests any more — the right sidebar's "Work Graph" activity
// tab now renders a single "Open Work Graph" button to the same Orchestrator
// tab. `drogon-cli mentu status`/`mentu open` still exercise the CLI-facing
// half of the recipe surface, unaffected by the takeover.

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
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
  await page.getByRole("menuitem", { name: "Work Graph", exact: true }).click();
  await page.getByRole("tab", { name: "Work Graph", exact: true }).waitFor();
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
  const mentuTab = page.getByRole("tab", { name: "Work Graph", exact: true });
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

  // 4. The probe's own recipe is discoverable in the workspace's
  //    `.mentu/recipes` (section 7 below asserts the daemon finds it and
  //    it is valid). (The multi-node work-graph fixture this section used
  //    to hand-write into `.drogon/graph.json` and re-read via a
  //    "Refresh" button rendered dead UI: 854c330b's Orchestrator
  //    takeover replaced WorkGraphPane's per-node badges/inspector with a
  //    single main-task node bound to the workspace's live session, so
  //    there is no shipped surface left for a hand-authored multi-node
  //    DAG, projected idle/blocked statuses, or a manual refresh control
  //    — grep confirms zero remaining `work-graph-refresh`/
  //    `data-work-graph-status`/`work-graph-totals`/
  //    `work-graph-node-inspector` in the renderer. probe-orchestrator.mjs
  //    now covers the real-run/real-state property this section stood
  //    for, against the shipped single-node model. The recipe RUN journey
  //    that used to follow here (select → review → approve & run →
  //    per-step evidence in the right-sidebar Mentu panel) is ALSO
  //    dropped: `<MentuPanel>` is mounted nowhere outside its own test
  //    files any more — grep confirms it — and the right sidebar's
  //    "Work Graph" activity tab now renders `WorkGraphPanel`
  //    (work-graph-panel.tsx), a single "Open Work Graph" button that
  //    only opens the SAME Orchestrator tab this probe already opened in
  //    section 1. There is no shipped UI left to select-and-run a named
  //    recipe by hand; `mentu status`/`mentu open` below still exercise
  //    the CLI-facing half of that surface, which does not depend on
  //    MentuPanel.)
  //    The viewport is normalized first — earlier probes leave narrow
  //    captures behind.
  await page.setViewportSize({ width: 1440, height: 900 });
  const recipesDir = path.join(workspace, ".mentu", "recipes");
  await mkdir(recipesDir, { recursive: true });
  await writeFile(
    path.join(recipesDir, "acceptance-mentu-tab.json"),
    `${JSON.stringify(MENTU_TAB_RECIPE, null, 2)}\n`,
  );

  // 5. A real theme switch (the Settings radio, persisted) with captures
  //    whose computed background/foreground are verified, then the
  //    horizontal-overflow budget on this surface.
  for (const theme of ["light", "dark"]) {
    const selection = await selectSettingsTheme(page, theme);
    await page.getByRole("tab", { name: "Work Graph", exact: true }).click();
    await panel.locator('[data-testid="work-graph-pane"]').waitFor();
    await captureThemeSurface(
      page,
      path.join(output, `mentu-tab-${theme}.png`),
      selection,
    );
  }
  await selectSettingsTheme(page, "light");
  await page.getByRole("tab", { name: "Work Graph", exact: true }).click();
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
  // Leave the viewport wide again: later probes (Tasks, theme relaunch)
  // assume a full-width canvas, and a stuck 760px clips their click
  // targets. Same restore the orchestrator probe already does.
  await page.setViewportSize({ width: 1440, height: 900 });

  // 6. Reload: the strip (and the Mentu tab's membership) comes back with no
  //    clicks, exactly like the editor/browser tabs.
  await page.reload();
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor({ timeout: 30000 });
  await page
    .getByRole("tab", { name: "Work Graph", exact: true })
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
  const focused = page.getByRole("tab", { name: "Work Graph", exact: true });
  await focused.waitFor();
  assert.equal(
    await focused.getAttribute("aria-selected"),
    "true",
    "the CLI-driven open must focus the Mentu tab",
  );
  await panel.locator('[data-testid="work-graph-pane"]').waitFor();
  checks.push("drogon-cli-mentu-open-focuses-the-mentu-tab");

  // 9. Closing the tab leaves the strip intact — the mirror image of the bug.
  await page.getByRole("button", { name: "Close tab Work Graph", exact: true }).click();
  await page
    .getByRole("tab", { name: "Work Graph", exact: true })
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
