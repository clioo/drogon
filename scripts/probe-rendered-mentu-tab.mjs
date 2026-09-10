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
// UI validation is CDP + screenshots in both themes, and the widths the MVP
// promises must not scroll horizontally.

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

  // 2. The Mentu tab selected itself and shows the wide recipe surface.
  const mentuTab = page.getByRole("tab", { name: "Mentu", exact: true });
  assert.equal(
    await mentuTab.getAttribute("aria-selected"),
    "true",
    "opening Mentu must select its tab",
  );
  const panel = page.locator('[data-testid="mentu-tab-panel"]');
  await panel.waitFor();
  await panel.locator('[data-testid="recipe-pane"]').waitFor();
  checks.push("mentu-tab-renders-the-wide-recipe-surface");

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

  // 4. A recipe written into the workspace is discovered in this tab.
  const recipesDir = path.join(workspace, ".mentu", "recipes");
  await mkdir(recipesDir, { recursive: true });
  await writeFile(
    path.join(recipesDir, "acceptance-mentu-tab.json"),
    `${JSON.stringify(MENTU_TAB_RECIPE, null, 2)}\n`,
  );
  await page.getByRole("button", { name: "Refresh recipes", exact: true }).click();
  await page.locator("#recipe-selector").click({ timeout: 15000 });
  await page
    .getByRole("option", { name: "acceptance-mentu-tab", exact: true })
    .click();
  await panel.getByText("tab-step-one", { exact: true }).waitFor();
  await panel.getByText("tab-step-two", { exact: true }).waitFor();
  checks.push("a-recipe-is-visible-in-the-mentu-tab");

  // 5. A real theme switch (the Settings radio, persisted) with captures
  //    whose computed background/foreground are verified, then the
  //    horizontal-overflow budget on this surface.
  for (const theme of ["light", "dark"]) {
    const selection = await selectSettingsTheme(page, theme);
    await page.getByRole("tab", { name: "Mentu", exact: true }).click();
    await panel.locator('[data-testid="recipe-pane"]').waitFor();
    await captureThemeSurface(
      page,
      path.join(output, `mentu-tab-${theme}.png`),
      selection,
    );
  }
  await selectSettingsTheme(page, "light");
  await page.getByRole("tab", { name: "Mentu", exact: true }).click();
  await panel.locator('[data-testid="recipe-pane"]').waitFor();
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
  await panel.locator('[data-testid="recipe-pane"]').waitFor();
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
