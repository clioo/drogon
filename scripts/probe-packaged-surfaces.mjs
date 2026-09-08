import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import * as defaultFs from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runAcceptanceProcess, startAcceptanceProcess, stopAcceptanceProcess } from "./acceptance-process.mjs";
import { packagedFixtureDaemon } from "./packaged-fixture-daemon.mjs";
import { waitForTerminalText } from "./acceptance-terminal-text.mjs";
import { readEditorValue, waitForEditorRegistered } from "./acceptance-editor-text.mjs";

// Extended packaged-acceptance surfaces (journey J11): palette, Settings,
// Changes, Automations, Bots, status bar and Tasks, each as a real CDP
// journey with a screenshot. Nothing here mocks the service or the UI.

// Minimal fixture PATH the packaged app launches with (accept-desktop sets
// exactly this for the packaged Electron). `gh` is absent from these
// directories on macOS; the daemon's own GUI-launch fallbacks (notably
// /opt/homebrew/bin) may still resolve it, which the Tasks check reports
// honestly instead of assuming.
export const FIXTURE_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

/** Reads the palette opener's darwin chord from the keybinding registry. */
export function paletteOpenChord(definitionsSource) {
  // R7-I moved the registry to keybindings/definitions.ts (R14-B moved it to shared/keybindings): the command
  // palette opens from `worktree.palette`'s darwin binding (Mod+J), never a
  // hardcoded chord.
  const block = /id:\s*"worktree\.palette"[\s\S]*?darwin:\s*\[([^\]]*)\]/.exec(
    definitionsSource,
  );
  assert.ok(
    block,
    "worktree.palette must stay registered in keybindings/definitions.ts",
  );
  const first = /"([^"]+)"/.exec(block[1]);
  assert.ok(first, "worktree.palette must declare a darwin binding");
  const parts = first[1].split("+").map((part) => part.trim());
  const key = parts.at(-1).toLowerCase();
  assert.ok(key, `Unparseable palette chord: ${first[1]}`);
  return {
    chord: first[1],
    key,
    shift: parts.slice(0, -1).some((part) => part.toLowerCase() === "shift"),
  };
}

/** Parses the declared status-bar height out of the StatusBar source. */
export function declaredStatusBarHeight(componentSource) {
  // R6-A styles the strip with the source's exact Tailwind classes
  // (h-6/min-h-[24px]): the arbitrary min-h value is the literal px proof.
  const match = /min-h-\[(\d+(?:\.\d+)?)px\]/.exec(componentSource);
  assert.ok(match, "StatusBar must declare its height as min-h-[Npx]");
  return Number(match[1]);
}

/** True when an executable `name` resolves inside one of `fixturePath` dirs. */
export async function fixtureHasBinary(fs, fixturePath, name) {
  for (const dir of fixturePath.split(":")) {
    try {
      const stat = await fs.stat(path.join(dir, name));
      if (stat.isFile()) return true;
    } catch {
      // Absent from this directory; keep scanning.
    }
  }
  return false;
}

async function git(cwd, args) {
  // -c identity keeps the fixture off the user's global git config.
  await runAcceptanceProcess(
    "git",
    [
      "-c",
      "user.email=acceptance@drogon.local",
      "-c",
      "user.name=Drogon Acceptance",
      "-c",
      "init.defaultBranch=main",
      ...args,
    ],
    { cwd },
  );
}

/** A git repo whose origin points at GitHub (never fetched or pushed). */
async function prepareTasksRepo() {
  const repo = await mkdtemp(path.join(tmpdir(), "drogon-tasks-"));
  await git(repo, ["init"]);
  await writeFile(path.join(repo, "notes.txt"), "tasks fixture\n");
  await git(repo, ["add", "notes.txt"]);
  await git(repo, ["commit", "-m", "tasks fixture"]);
  await git(repo, [
    "remote",
    "add",
    "origin",
    "https://github.com/drogon-fixture/no-such-repo-acceptance.git",
  ]);
  return repo;
}

export function classifyTasksList(text, hasRows) {
  if (hasRows) return "issues-listed";
  if (/could not be spawned|install gh|gh_unavailable/i.test(text))
    return "gh-unavailable";
  if (/not authenticated|gh auth|gh_unauthenticated/i.test(text))
    return "gh-unauthenticated";
  if (/no origin remote|no_github_remote/i.test(text))
    return "no-github-remote";
  if (
    /No .* issues in |match this filter|No matching GitHub work|No project sources selected/i.test(
      text,
    )
  )
    return "empty-list";
  if (/exited with|timed out|killed/i.test(text)) return "gh-error";
  return `unexpected:${text.slice(0, 160)}`;
}

/** Counts automation runs by trigger from an `automation.history` envelope. */
export function summarizeAutomationHistory(history) {
  const runs = history?.runs ?? [];
  return {
    total: runs.length,
    manual: runs.filter((run) => run.trigger === "manual").length,
    scheduled: runs.filter((run) => run.trigger === "scheduled").length,
    statuses: [...new Set(runs.map((run) => run.status))],
  };
}

/** Fails closed when a measured strip overflows its own box horizontally. */
export function assertNoHorizontalOverflow(metrics, label) {
  assert.ok(
    metrics.scrollWidth <= metrics.clientWidth + 1,
    `${label} overflows horizontally: scrollWidth ${metrics.scrollWidth} > clientWidth ${metrics.clientWidth}`,
  );
}

/** True when a `browser snapshot` envelope carries the guest marker text. */
export function browserSnapshotShowsGuest(snapshot, marker) {
  const text =
    typeof snapshot === "string"
      ? snapshot
      : JSON.stringify(snapshot ?? "");
  return text.includes(marker);
}

/** Liveness of the `window.__drogonTerminals` debug registry. */
export function registryLiveness(size, totalRows) {
  if (size > 0 && totalRows > 0) return "live-buffers";
  if (size > 0) return "registry-without-rows";
  return "empty";
}

const MENTU_FIXTURE_RECIPE = {
  name: "acceptance-hello",
  description: "packaged acceptance probe",
  steps: [{ label: "say-hello", backend: "shell", prompt: "echo hi", timeout: 30 }],
};

/** Opens the right sidebar on Explorer from any state (chord, not click). */
async function ensureRightSidebar(page) {
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+Shift+E`);
  await page.waitForFunction(
    () => {
      const panel =
        document.querySelector('section[aria-label="Files"]') ??
        document.querySelector('[data-testid="right-sidebar"]');
      return panel && panel.getBoundingClientRect().width >= 200;
    },
    null,
    { timeout: 8000 },
  );
}

/** Explorer (right sidebar): fixture tree renders and opens the file into a
 *  main tab-group editor tab (R16-A, fixes #133) — never embedded in the
 *  right sidebar's 200-280px column. */
async function probeExplorerSurface({ page, workspace, output }) {
  const file = "sidebar-explorer.txt";
  await writeFile(path.join(workspace, file), "sidebar explorer body\n");
  await ensureRightSidebar(page);
  const panel = page.locator('section[aria-label="Files"]');
  // The tree refreshes off the file watcher; nudge the toolbar's own
  // Refresh affordance first so a delayed watch event cannot flake this.
  // (R16-D ported the fork's flat rows: entries are buttons, not treeitems.)
  await panel.getByRole("button", { name: "Refresh Explorer" }).click();
  await panel.getByRole("button", { name: file, exact: true }).click();
  await waitForEditorRegistered(page, file);
  assert.equal(await readEditorValue(page, file), "sidebar explorer body\n");
  assert.equal(
    await panel.locator(".editor-pane-surface").count(),
    0,
    "The Files panel must never embed the file editor (fixes #133)",
  );
  await page.getByRole("tab", { name: file, exact: true }).waitFor();
  await page.screenshot({
    path: path.join(output, "explorer.png"),
    animations: "disabled",
  });
  return ["right-sidebar-explorer-opens-fixture-file-into-editor"];
}

/** Mentu (right sidebar): the fixture recipe lists and its steps render. */
async function probeMentuSurface({ page, workspace, output }) {
  const recipesDir = path.join(workspace, ".mentu", "recipes");
  await mkdir(recipesDir, { recursive: true });
  await writeFile(
    path.join(recipesDir, "acceptance-hello.json"),
    JSON.stringify(MENTU_FIXTURE_RECIPE, null, 2) + "\n",
  );
  await page.getByRole("button", { name: "Mentu" }).click();
  const panel = page.locator('[data-testid="mentu-panel"]');
  await panel.waitFor();
  // R11-D ported the fork's Radix Select: the trigger is a combobox that stays
  // disabled until discovery finishes and the items live in a portal listbox,
  // so there are no <option> elements to read.
  const recipeSelect = panel.getByRole("combobox", { name: "Recipe", exact: true });
  await recipeSelect.waitFor();
  await recipeSelect.click({ timeout: 15000 });
  await page.getByRole("option", { name: "acceptance-hello", exact: true }).click();
  await panel.getByText("say-hello", { exact: true }).waitFor();
  await page.screenshot({
    path: path.join(output, "mentu.png"),
    animations: "disabled",
  });
  return ["right-sidebar-mentu-lists-fixture-recipe-with-steps"];
}

/** Source Control (right sidebar): the unstaged edit stages into Staged. */
async function probeSourceControlStage({ page, output }) {
  await page.getByRole("button", { name: /^Source Control( \(.*\))?$/ }).click();
  const panel = page.locator('section[aria-label="Changes"]');
  await panel.waitFor();
  // The ported listing renders one "Stage all" per non-empty stageable group
  // in Changes, Untracked order: the first is the Changes group's. The
  // "Staged Changes 1" assertion below fails closed if the wrong group was
  // staged (the untracked group holds two fixture files).
  await panel.getByRole("button", { name: "Stage all", exact: true }).first().click();
  // R10-B section headers are toggle buttons named "<label> <count>".
  await panel
    .getByRole("button", { name: "Staged Changes 1", exact: true })
    .waitFor();
  await page.screenshot({
    path: path.join(output, "changes-staged.png"),
    animations: "disabled",
  });
  return ["right-sidebar-source-control-stages-unstaged-edit"];
}

/** Session details (right sidebar): empty state or the live session record. */
async function probeSessionDetails({ page, output, expectSession }) {
  // R16-B: the activity bar no longer carries a Session details item (the
  // fork has none); the panel opens from the session header toggle. The
  // toggle toggles (the old activity button always opened), so only click
  // when the panel is not already visible from an earlier check.
  const panel = page.locator('aside[aria-label="Session details"]');
  if (!(await panel.isVisible().catch(() => false))) {
    await page
      .locator("header.session-header")
      .getByRole("button", { name: "Toggle session details", exact: true })
      .click();
    await panel.waitFor();
  }
  if (expectSession) {
    await panel.getByText("Command", { exact: true }).waitFor();
    const text = (await panel.textContent()) ?? "";
    assert.match(text, /live/);
  } else {
    await panel
      .getByText("Select a terminal to see its execution details.", {
        exact: true,
      })
      .waitFor();
  }
  await page.screenshot({
    path: path.join(
      output,
      expectSession ? "session-details.png" : "session-details-empty.png",
    ),
    animations: "disabled",
  });
  return [
    expectSession
      ? "right-sidebar-session-details-shows-live-session"
      : "right-sidebar-session-details-empty-without-sessions",
  ];
}

/** Tab strip "+" menu: a real terminal tab plus a browser tab with guest. */
async function probeTabStripAndBrowser({ page, cli, dataDir, workspaceId, output }) {
  // The strip's "+" trigger lives on the Sessions route: return home first
  // (the Bots empty check leaves the Bots route mounted).
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page
    .getByRole("button", { name: "New tab", exact: true })
    .first()
    .waitFor({ state: "visible" });
  // Count only the Sessions strip: the right sidebar renders its own tabs
  // (Mentu's Plan/Evidence) and may switch panels when a session starts.
  const SESSION_TABS = '[role="tablist"][aria-label="Sessions"] [role="tab"]';
  const tabs = () => page.locator(SESSION_TABS).count();
  const before = await tabs();
  await page
    .getByRole("button", { name: "New tab", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: /^New Terminal/ }).click();
  await page.waitForFunction(
    ({ selector, count }) => document.querySelectorAll(selector).length === count,
    { selector: SESSION_TABS, count: before + 1 },
    { timeout: 15000 },
  );
  const marker = `STRIP_${Date.now()}`;
  await page.locator(".xterm-helper-textarea").first().focus();
  await page.keyboard.type(`printf '${marker}\\n'`);
  await page.keyboard.press("Enter");
  await waitForTerminalText(page, marker, { timeout: 15000 });
  const terminalChecks = ["tab-strip-plus-menu-creates-terminal-with-live-output"];
  await page
    .getByRole("button", { name: "New tab", exact: true })
    .first()
    .click();
  await page
    .getByRole("menuitem", { name: /^New Browser Tab/ })
    .click();
  const pane = page.locator('[data-testid="browser-pane"]');
  await pane.waitFor();
  // The guest page renders in a sandboxed native view, never in DOM, so a
  // loopback HTTP fixture serves the marker page and the agent path
  // (`browser tabs`/`browser snapshot` through the daemon relay) proves it.
  const guest = `DROGON_BROWSER_GUEST_${Date.now()}`;
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<html><body><h1>${guest}</h1></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const guestUrl = `http://127.0.0.1:${server.address().port}/`;
  try {
    // The accept flow leaves a 760px viewport where the toolbar squeezes
    // the address slot to its 44px globe (the fork overlays the bar on
    // focus below 220px; this build keeps it collapsed): widen like a user
    // would before typing a URL.
    await page.setViewportSize({ width: 1440, height: 900 });
    // The fork's BrowserPane expects a user flow: click the address bar,
    // then type and press Enter (fill() bypasses the focus handlers that
    // open the suggestions and arm Enter-to-navigate).
    const address = pane.getByLabel("Address", { exact: true });
    await address.click({ timeout: 15000 });
    await address.pressSequentially(guestUrl, { timeout: 15000 });
    await page.keyboard.press("Enter");
    // Browser tabs mirror into the shared strip (the pane mounts with
    // hideTabStrip): the strip names the loaded host once navigation
    // commits. Scoped to the Sessions tablist: the right sidebar renders
    // its own tabs (Mentu Plan/Evidence) with overlapping roles.
    await page
      .locator('[role="tablist"][aria-label="Sessions"]')
      .getByRole("tab", { name: /127\.0\.0\.1/ })
      .first()
      .waitFor({ timeout: 30000 });
    await page.screenshot({
      path: path.join(output, "browser.png"),
      animations: "disabled",
    });
    terminalChecks.push("tab-strip-plus-menu-creates-browser-tab-rendering-guest");
    const deadline = Date.now() + 60000;
    let tabId = null;
    let lastListError = "no attempts";
    for (;;) {
      const listed = await runCliJson(
        cli,
        ["--data-dir", dataDir, "--json", "browser", "tabs", "--workspace", workspaceId],
        { timeout: 30000 },
      );
      const match =
        listed.ok === true
          ? listed.result.tabs.find(
              (tab) => tab.url === guestUrl && tab.loading === false,
            )
          : undefined;
      if (match) {
        tabId = match.tabId;
        break;
      }
      if (listed.ok !== true)
        lastListError = JSON.stringify(listed.error ?? listed);
      assert.ok(
        Date.now() < deadline,
        `CLI browser tabs must list the loaded guest (last: ${lastListError})`,
      );
      await delay(500);
    }
    const snapshot = await runCliJson(
      cli,
      ["--data-dir", dataDir, "--json", "browser", "snapshot", "--tab", tabId],
      { timeout: 30000 },
    );
    assert.equal(
      snapshot.ok,
      true,
      `CLI browser snapshot must succeed: ${JSON.stringify(snapshot.error ?? snapshot).slice(0, 300)}`,
    );
    assert.equal(
      browserSnapshotShowsGuest(snapshot.result, guest),
      true,
      "CLI browser snapshot must carry the guest marker",
    );
    terminalChecks.push("cli-browser-snapshot-proves-ui-created-guest");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  return { checks: terminalChecks, guest };
}

/** Composer and Add Project dialogs: options render, cancel leaves no trace. */
async function probeComposerAndAddProject({ page, output }) {
  await page.getByRole("button", { name: "New workspace", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Create workspace" });
  await composer.waitFor();
  const options = await composer
    .locator("#composer-project option")
    .allTextContents();
  assert.ok(
    options.some((text) => text.includes("folder")),
    "The composer must offer the folder project",
  );
  await page.screenshot({
    path: path.join(output, "composer.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await composer.waitFor({ state: "hidden" });
  const checks = ["new-workspace-composer-lists-folder-project-and-cancels"];
  await page
    .getByRole("button", { name: "Workspace options", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Add Project", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add Project" });
  await dialog.getByLabel("Folder or repository path").waitFor();
  await page.screenshot({
    path: path.join(output, "add-project.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  checks.push("add-project-dialog-renders-path-field-and-cancels");
  return checks;
}

/** Automations: CLI create, one manual run, history proof, UI row render. */
async function probeAutomationsCreateAndRun({ page, cli, dataDir, workspaceId, output }) {
  const name = `acceptance-probe-${Date.now()}`;
  const created = await runCliJson(
    cli,
    [
      "--data-dir",
      dataDir,
      "--json",
      "automation",
      "create",
      "--name",
      name,
      "--cron",
      "* * * * *",
      "--workspace",
      workspaceId,
      "--harness",
      "pi",
      "--prompt",
      "Acceptance probe run.",
    ],
    { timeout: 30000 },
  );
  assert.equal(created.ok, true);
  const id = created.result.id;
  assert.ok(id);
  const listed = await runCliJson(
    cli,
    ["--data-dir", dataDir, "--json", "automation", "list"],
    { timeout: 30000 },
  );
  assert.equal(listed.ok, true);
  assert.ok(
    listed.result.automations.some((entry) => entry.id === id),
    "automation.list must contain the created automation",
  );
  const ran = await runCliJson(
    cli,
    ["--data-dir", dataDir, "--json", "automation", "run", "--id", id],
    { timeout: 60000 },
  );
  assert.equal(ran.ok, true);
  const history = await runCliJson(
    cli,
    ["--data-dir", dataDir, "--json", "automation", "history", "--id", id],
    { timeout: 30000 },
  );
  assert.equal(history.ok, true);
  const summary = summarizeAutomationHistory(history.result);
  assert.equal(summary.total, 1);
  assert.equal(summary.manual, 1);
  // The accept flow leaves a 760px viewport where the toolbar's New
  // Automation entry overlaps Refresh: widen like a user would before
  // driving the toolbar.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Automations", exact: true }).click();
  await page.getByRole("heading", { name: "Automations", exact: true }).waitFor();
  // The list mounts before the CLI-side create: one user Refresh re-reads
  // it through the same path the toolbar always uses.
  await page
    .getByRole("button", { name: "Refresh automations", exact: true })
    .click();
  await page
    .locator(`[data-testid="automation-row-${id}"]`)
    .waitFor({ timeout: 30000 });
  await page.screenshot({
    path: path.join(output, "automations-created.png"),
    animations: "disabled",
  });
  return [
    "automations-cli-create-lists-new-automation",
    `automations-manual-run-recorded-once:${summary.statuses.join(",")}`,
    "automations-page-renders-created-row",
  ];
}

/** Bots: UI create plus one scheduled responsibility on the card. */
async function probeBotsCreateAndResponsibility({ page, output }) {
  await page.getByRole("button", { name: "Bots", exact: true }).click();
  const panel = page.locator('[data-testid="bots-panel"]');
  await panel.waitFor();
  await page.waitForFunction(
    () => {
      const inner = document.querySelector('[data-testid="bots-panel"]');
      return inner && inner.getBoundingClientRect().width > 0;
    },
    null,
    { timeout: 30000 },
  );
  await page.getByRole("button", { name: "New Bot", exact: true }).click();
  const form = page.getByRole("form", { name: "Create a Bot" });
  await form.waitFor();
  await form.getByLabel("Name (optional)").fill("Acceptance Bot");
  await form.getByRole("button", { name: "Create Bot", exact: true }).click();
  await panel.getByText("Acceptance Bot", { exact: true }).waitFor();
  await page.screenshot({
    path: path.join(output, "bots-created.png"),
    animations: "disabled",
  });
  const checks = ["bots-ui-create-renders-bot-in-list"];
  await panel.getByRole("button", { name: "Add responsibility", exact: true }).first().click();
  const responsibility = page.locator('[data-testid="responsibility-form"]');
  await responsibility.waitFor();
  await responsibility.getByLabel("Name").fill("Acceptance duty");
  await responsibility.getByLabel("Cron expression (UTC)").fill("* * * * *");
  await responsibility.getByLabel("Prompt").fill("Probe the scheduled duty.");
  await responsibility
    .getByRole("button", { name: "Save responsibility", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Run Acceptance duty", exact: true })
    .waitFor();
  await page.screenshot({
    path: path.join(output, "bots-responsibility.png"),
    animations: "disabled",
  });
  checks.push("bots-responsibility-card-renders-saved-duty-with-run");
  return checks;
}

/** Status bar: no horizontal overflow at narrow and wide viewports. */
async function probeStatusBarOverflow({ page, output }) {
  const original = page.viewportSize();
  try {
    for (const width of [760, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      const statusBar = page.locator('footer[data-testid="status-bar"]');
      await statusBar.waitFor();
      const metrics = await statusBar.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      assertNoHorizontalOverflow(metrics, `status-bar@${width}px`);
      await page.screenshot({
        path: path.join(output, `status-bar-${width}.png`),
        animations: "disabled",
      });
    }
  } finally {
    if (original) await page.setViewportSize(original);
  }
  return ["status-bar-no-overflow-at-760-and-1440"];
}

export async function probePackagedSurfaces({
  page,
  workspace,
  output,
  root,
  cli,
  dataDir,
  fs = defaultFs,
}) {
  const checks = [];
  const screenshot = (name) =>
    page.screenshot({ path: path.join(output, name), animations: "disabled" });

  // The exact binary the daemon's per-session hook files invoke must exist
  // inside the bundle and carry the hidden hook-event subcommand.
  const hookHelp = await runAcceptanceProcess(cli, [
    "internal",
    "hook-event",
    "--help",
  ]);
  assert.match(hookHelp.stdout, /--session.*--incarnation.*--event/s);
  checks.push("bundled-cli-resolves-inside-app-with-hook-event");

  const isMac = await page.evaluate(() =>
    navigator.userAgent.includes("Mac"),
  );
  const mod = isMac ? "Meta" : "Control";
  // Focus a non-editable surface so the chord reaches the window handler
  // rather than the focused terminal's helper textarea. (R9-B moved the
  // sidebar footer to the source toolbar; the "Service x.y.z" text is gone,
  // so readiness focuses its Reveal button instead.)
  const focusChrome = () =>
    page
      .getByRole("button", { name: "Reveal active workspace", exact: true })
      .click({ timeout: 5000 });

  // Palette chord comes from the keybinding registry, never hardcoded:
  // `worktree.palette`'s darwin binding (Mod+J since R7-I; the registry
  // moved to shared/ in R14-B).
  const { chord, key, shift } = paletteOpenChord(
    await readFile(
      path.join(
        root,
        "apps",
        "desktop",
        "src",
        "shared",
        "keybindings",
        "definitions.ts",
      ),
      "utf8",
    ),
  );
  await focusChrome();
  await page.keyboard.press(
    `${mod}${shift ? "+Shift" : ""}+${key.toUpperCase()}`,
  );
  const paletteInput = page.locator(".command-palette-input");
  await paletteInput.waitFor();
  // cmdk exposes the palette label on its input, not on a dialog role.
  // R12-B ported the source's jump palette, whose input is labelled "Jump to...".
  await page
    .getByRole("combobox", { name: "Jump to..." })
    .waitFor();
  await screenshot("palette.png");
  checks.push(`palette-opens-from-registry-chord-${chord.replaceAll("+", "-")}`);
  await page.keyboard.press("Escape");
  await paletteInput.waitFor({ state: "hidden" });

  // Settings opens from anywhere via Cmd+, and returns to the prior view.
  await focusChrome();
  await page.keyboard.press(`${mod}+,`);
  const settings = page.locator('section[aria-label="Settings"]');
  await settings.waitFor();
  await screenshot("settings.png");
  checks.push("settings-page-opens-from-shortcut");
  await page.getByRole("button", { name: "Back to app", exact: true }).click();
  await settings.waitFor({ state: "hidden" });
  await page.getByRole("heading", { name: "Start a session" }).waitFor();
  checks.push("settings-page-returns-to-prior-view");

  const workspaceId = await page.evaluate(async () => {
    const response = await window.drogon.workspaces();
    if (!response.ok) throw new Error(response.error.message);
    return response.result.workspaces[0].id;
  });
  assert.ok(workspaceId, "The fixture folder workspace must be registered");

  // Right sidebar: Explorer opens the fixture tree file into the editor.
  checks.push(...(await probeExplorerSurface({ page, workspace, output })));

  // Right sidebar: Mentu lists the fixture recipe with its steps.
  checks.push(...(await probeMentuSurface({ page, workspace, output })));

  // Changes renders the unstaged edit of the fixture repo. (R6-B hosts it
  // in the right activity bar as "Source Control"; the bare "Changes" name
  // is gone, so the match stays non-exact for the chord suffix.)
  // R16-B: Source Control is git-only per the fork's activity gating, so
  // the staging checks run on a git worktree (registered and cut through
  // the CLI) rather than the folder fixture.
  const changesRepo = await mkdtemp(path.join(tmpdir(), "drogon-changes-"));
  await git(changesRepo, ["init"]);
  await writeFile(path.join(changesRepo, "seed.txt"), "seed\n");
  await git(changesRepo, ["add", "seed.txt"]);
  await git(changesRepo, ["commit", "-m", "seed"]);
  const changesProject = await runCliJson(
    cli,
    ["--data-dir", dataDir, "--json", "project", "add", changesRepo, "--name", "changes-git"],
    { timeout: 30000 },
  );
  assert.equal(changesProject.ok, true);
  const changesProjectId =
    changesProject.result.project?.id ?? changesProject.result.id;
  assert.ok(changesProjectId, "project.add must return a project id");
  const changesWorktree = await runCliJson(
    cli,
    ["--data-dir", dataDir, "--json", "worktree", "create", "--project", changesProjectId, "--name", "changes-wt"],
    { timeout: 60000 },
  );
  assert.equal(changesWorktree.ok, true);
  // The dirty file must live in the worktree checkout (the panel under
  // test renders the SELECTED workspace's status, not the source repo's).
  const changesCheckout = changesWorktree.result.path ?? changesWorktree.result.worktree?.path;
  assert.ok(changesCheckout, "worktree.create must return the checkout path");
  const changedFile = "changes-fixture.txt";
  await writeFile(path.join(changesCheckout, changedFile), "committed baseline\n");
  await git(changesCheckout, ["add", changedFile]);
  await git(changesCheckout, ["commit", "-m", "acceptance baseline"]);
  await writeFile(
    path.join(changesCheckout, changedFile),
    "committed baseline\nunstaged edit\n",
  );
  // The sidebar lists projects from its last load, so pull the
  // CLI-created project in through Refresh connection, then select its
  // worktree card so the session view (and its git-gated activity bar)
  // renders for it.
  await page.getByRole("button", { name: "Refresh connection", exact: true }).click();
  await page.waitForFunction(
    () => document.body.textContent?.includes("changes-wt") ?? false,
    null,
    { timeout: 20000 },
  );
  if ((await page.getByRole("option", { name: /changes-wt/ }).count()) > 0) {
    await page.getByRole("option", { name: /changes-wt/ }).first().click();
  } else {
    await page.getByRole("button", { name: /changes-wt/ }).first().click();
  }
  await page.waitForFunction(
    () => {
      const header = document.querySelector("header.session-header strong");
      return header?.textContent?.includes("changes-wt") ?? false;
    },
    null,
    { timeout: 15000 },
  );
  const changesNav = page.getByRole("button", { name: /^Source Control( \(.*\))?$/ });
  assert.equal(await changesNav.isEnabled(), true);
  await changesNav.click();
  // The Changes view is a keep-alive mount that also renders off-route:
  // scope to the right-sidebar section so rows/buttons resolve exactly once.
  const changesPanel = page.locator('section[aria-label="Changes"]');
  await changesPanel.waitFor();
  // R10-B ported the source listing: rows are data-testid="source-control-entry"
  // (the old "Changed files" list label is gone).
  await changesPanel.locator('[data-testid="source-control-entry"]').first().waitFor();
  await changesPanel.getByText(changedFile, { exact: true }).waitFor();
  await page.getByLabel("Commit message", { exact: true }).waitFor();
  await screenshot("changes.png");
  checks.push("changes-panel-renders-unstaged-edit-for-fixture-repo");

  // Right sidebar: staging the unstaged edit moves it into Staged.
  checks.push(...(await probeSourceControlStage({ page, output })));
  // Later probes address the folder workspace again.
  await page.getByRole("button", { name: "Select folder" }).click();
  await page.getByRole("heading", { name: "Start a session" }).waitFor();

  // Right sidebar: with every session closed the details panel is empty.
  checks.push(
    ...(await probeSessionDetails({ page, output, expectSession: false })),
  );

  // Automations lists on a fresh daemon (empty, with the create entry).
  // (R8-O1 renders the empty state as titled copy, not an empty testid;
  // R16-C ported the source title "No automations across loaded hosts".)
  await page.getByRole("button", { name: "Automations", exact: true }).click();
  await page.getByRole("heading", { name: "Automations", exact: true }).waitFor();
  await page.getByText("No automations across loaded hosts", { exact: true }).waitFor();
  await page.locator('[data-testid="automations-new"]').waitFor();
  await screenshot("automations.png");
  checks.push("automations-page-lists-empty-with-create-entry");

  // Bots renders on a fresh daemon (empty, with the create entry). The
  // panel hydrates from bot.list, so the header resolves late: bound the
  // wait instead of assuming it is instant.
  // Scope to the inner BotsPanel mount: the page host stays keep-alive
  // mounted while hidden, so unscoped locators resolve ambiguously or
  // hidden.
  const gotoBots = async () => {
    await page.getByRole("button", { name: "Bots", exact: true }).click();
    await page.waitForFunction(
      () => {
        const panel = document.querySelector('[data-testid="bots-panel"]');
        return (
          panel &&
          panel.getBoundingClientRect().width > 0 &&
          getComputedStyle(panel).display !== "none" &&
          panel.closest('[data-testid="bots-page-host"]') !== null &&
          getComputedStyle(
            panel.closest('[data-testid="bots-page-host"]'),
          ).display !== "none"
        );
      },
      null,
      { timeout: 30000 },
    );
  };
  await gotoBots();
  // The header h1 resolves unreliably under keep-alive route churn while the
  // panel body provably renders, so the load-bearing proofs are the empty
  // state and the create entry (both scoped to the inner mount).
  const botsPanel = page.locator('[data-testid="bots-panel"]');
  await botsPanel.locator('[data-testid="bots-empty"]').waitFor({ timeout: 60000 });
  await botsPanel
    .getByRole("button", { name: "New Bot", exact: true })
    .waitFor({ timeout: 60000 });
  await screenshot("bots.png");
  checks.push("bots-page-renders-empty-with-create-entry");

  // Tab strip "+" menu: a terminal with live output plus a browser guest
  // proven through `drogon-cli browser snapshot`.
  const tabStrip = await probeTabStripAndBrowser({
    page,
    cli,
    dataDir,
    workspaceId,
    output,
  });
  checks.push(...tabStrip.checks);

  // Right sidebar: the new terminal session renders its live record.
  checks.push(
    ...(await probeSessionDetails({ page, output, expectSession: true })),
  );

  // Composer lists the folder project and cancels; Add Project renders its
  // path field and cancels.
  checks.push(...(await probeComposerAndAddProject({ page, output })));

  // Automations: one created automation, one manual run, UI row render.
  checks.push(
    ...(await probeAutomationsCreateAndRun({
      page,
      cli,
      dataDir,
      workspaceId,
      output,
    })),
  );

  // Bots: one created bot plus one scheduled responsibility with a run
  // control on its card.
  checks.push(...(await probeBotsCreateAndResponsibility({ page, output })));

  // Status bar is present and its rendered height matches the stylesheet.
  const statusBar = page.locator('footer[data-testid="status-bar"]');
  await statusBar.waitFor();
  assert.equal(await statusBar.isVisible(), true);
  const rendered = await statusBar.boundingBox();
  const declared = declaredStatusBarHeight(
    await readFile(
      path.join(
        root,
        "apps",
        "desktop",
        "src",
        "renderer",
        "src",
        "components",
        "status-bar",
        "StatusBar.tsx",
      ),
      "utf8",
    ),
  );
  assert.ok(
    rendered && Math.abs(rendered.height - declared) <= 1,
    `Status bar renders at ${rendered?.height}px, stylesheet declares ${declared}px`,
  );
  await statusBar.screenshot({ path: path.join(output, "status-bar.png") });
  checks.push(
    `status-bar-present-at-${Math.round(rendered.height)}px-matching-stylesheet-${declared}px`,
  );
  checks.push(...(await probeStatusBarOverflow({ page, output })));

  // Tasks serves the GitHub-remote fixture project and renders honestly:
  // the typed daemon error (gh missing/unauthed/repo) or the issue list,
  // never a blank panel or a crash.
  const tasksRepo = await prepareTasksRepo();
  const added = await runCliJson(
    cli,
    ["--data-dir", dataDir, "--json", "project", "add", tasksRepo],
    { timeout: 30000 },
  );
  assert.equal(added.ok, true);
  const ghInFixturePath = await fixtureHasBinary(fs, FIXTURE_PATH, "gh");
  // The sidebar project view loads at App refresh, so reload after the
  // CLI-side project add: the Tasks mount then reads the fresh groups.
  await page.reload();
  // R9-B: the sidebar footer is the source toolbar; its Reveal button is the
  // readiness anchor (the "Service x.y.z" text is gone).
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  // R8-G1 ported the source task-page: the page lives in the Tasks host
  // (a standalone page, no wrapping region since R16-B), the project
  // source is the SourceBar select, rows are role=button "Issue #n", and
  // the list root is the github list scroll container.
  const tasksList = page.locator('[data-testid="tasks-page-host"]');
  await tasksList.waitFor();
  const repoBase = path.basename(tasksRepo);
  const projectOptionReady = (name) =>
    [...document.querySelectorAll('[data-testid="tasks-page-host"] select')].some(
      (select) =>
        [...select.options].some((option) =>
          (option.textContent ?? "").includes(name),
        ),
    );
  try {
    await page.waitForFunction(projectOptionReady, repoBase, {
      timeout: 15000,
    });
  } catch {
    // The mount raced the project view refresh: one user Refresh re-reads
    // the groups through the same path the toolbar always uses.
    await page.getByRole("button", { name: /^Refresh GitHub work/ }).click();
    await page.waitForFunction(projectOptionReady, repoBase, {
      timeout: 15000,
    });
  }
  await page.waitForFunction(
    () => {
      const root = document.querySelector('[data-testid="tasks-page-host"]');
      if (!root) return false;
      const text = root.textContent ?? "";
      return (
        root.querySelector('[role="button"][aria-label^="Issue #"]') !== null ||
        root.querySelector('[role="alert"]') !== null ||
        /No matching GitHub work|No project sources selected|could not|not authenticated|no origin remote|exited with|timed out|killed/i.test(
          text,
        )
      );
    },
    null,
    { timeout: 60000 },
  );
  const tasksText = (await tasksList.textContent()) ?? "";
  const tasksRows = await tasksList
    .locator('[role="button"][aria-label^="Issue #"]')
    .count();
  const outcome = classifyTasksList(tasksText, tasksRows > 0);
  await screenshot("tasks.png");
  assert.ok(
    !outcome.startsWith("unexpected:"),
    `Tasks page must render issues or a typed gh error, saw: ${outcome}`,
  );
  if (!ghInFixturePath && outcome === "gh-unavailable")
    checks.push("tasks-page-renders-gh-unavailable-honestly-without-gh-in-fixture-path");
  else
    checks.push(
      `tasks-page-renders-honest-state-with-gh-${ghInFixturePath ? "in" : "outside"}-fixture-path:${outcome}`,
    );

  // Terminal buffer registry: the debug registry exposes live xterm buffers
  // (the reader the shared helper evaluates), never an empty handle.
  const terminalState = await page.evaluate(() => {
    const registry = window.__drogonTerminals;
    if (!registry || registry.size === 0) return { size: 0, rows: 0 };
    let rows = 0;
    for (const terminal of registry.values())
      rows += terminal.buffer.active.length;
    return { size: registry.size, rows };
  });
  assert.equal(
    registryLiveness(terminalState.size, terminalState.rows),
    "live-buffers",
    "window.__drogonTerminals must expose live buffers after the probes",
  );
  checks.push(
    `terminal-registry-exposes-live-buffers-x${terminalState.size}`,
  );

  return checks;
}

// The CLI exits non-zero for error envelopes while still printing the JSON
// envelope on stdout; this returns the parsed envelope either way and only
// throws when there is no envelope to read.
async function runCliJson(cli, args, options) {
  try {
    return JSON.parse((await runAcceptanceProcess(cli, args, options)).stdout);
  } catch (error) {
    if (typeof error.stdout === "string" && error.stdout.trim().length > 0)
      return JSON.parse(error.stdout);
    throw error;
  }
}

// Deterministic gh-unavailable proof at the daemon boundary: a second real
// daemon on its own data dir with a fixture-minimal PATH (no gh) must answer
// tasks.list for a GitHub-remote project with the typed gh_unavailable
// error. No mocks: real daemon binary, real CLI, real git repo.
export async function probeGhUnavailable({ daemon, cli, fs = defaultFs }) {
  assert.equal(
    await fixtureHasBinary(fs, FIXTURE_PATH, "gh"),
    false,
    `Refusing a vacuous gh-unavailable proof: gh resolves inside ${FIXTURE_PATH}`,
  );
  const gitBin = await fixtureHasBinary(fs, FIXTURE_PATH, "git");
  assert.equal(gitBin, true, `Fixture PATH ${FIXTURE_PATH} must provide git`);
  const dataDir = await mkdtemp(path.join(tmpdir(), "drogon-gh-"));
  const repo = await prepareTasksRepo();
  const child = startAcceptanceProcess(daemon, ["--data-dir", dataDir], {
    stdio: "ignore",
    env: { ...process.env, PATH: FIXTURE_PATH },
  });
  const fixture = packagedFixtureDaemon(daemon, cli, dataDir);
  const scrubbed = { ...process.env, PATH: FIXTURE_PATH };
  try {
    const deadline = Date.now() + 15000;
    for (;;) {
      try {
        const status = await runCliJson(
          cli,
          ["--data-dir", dataDir, "--json", "status"],
          { timeout: 2000, env: scrubbed },
        );
        if (status.ok === true) break;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await fixture.capture();
    const added = await runCliJson(
      cli,
      ["--data-dir", dataDir, "--json", "project", "add", repo],
      { timeout: 30000, env: scrubbed },
    );
    assert.equal(added.ok, true);
    const listed = await runCliJson(
      cli,
      [
        "--data-dir",
        dataDir,
        "--json",
        "rpc",
        "tasks.list",
        "--params",
        JSON.stringify({ projectId: added.result.id, state: "open" }),
      ],
      { timeout: 60000, env: scrubbed },
    );
    assert.equal(listed.ok, false);
    assert.equal(listed.error.code, "gh_unavailable");
    assert.match(listed.error.message, /gh/i);
    return ["daemon-tasks-list-reports-gh-unavailable-without-gh-in-path"];
  } finally {
    await fixture.stop().catch(() => {});
    await stopAcceptanceProcess(child).catch(() => {});
  }
}
