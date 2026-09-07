import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import * as defaultFs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAcceptanceProcess, startAcceptanceProcess, stopAcceptanceProcess } from "./acceptance-process.mjs";
import { packagedFixtureDaemon } from "./packaged-fixture-daemon.mjs";

// Extended packaged-acceptance surfaces (journey J11): palette, Settings,
// Changes, Automations, Bots, status bar and Tasks, each as a real CDP
// journey with a screenshot. Nothing here mocks the service or the UI.

// Minimal fixture PATH the packaged app launches with (accept-desktop sets
// exactly this for the packaged Electron). `gh` is absent from these
// directories on macOS; the daemon's own GUI-launch fallbacks (notably
// /opt/homebrew/bin) may still resolve it, which the Tasks check reports
// honestly instead of assuming.
export const FIXTURE_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

/** Reads palette.openCommands' chord from the shortcut registry source. */
export function paletteOpenChord(shortcutsSource) {
  const match = /id:\s*"palette\.openCommands",\s*chord:\s*"([^"]+)"/.exec(
    shortcutsSource,
  );
  assert.ok(match, "palette.openCommands must stay registered in shortcuts.ts");
  const parts = match[1].split("+").map((part) => part.trim());
  const key = parts.at(-1).toLowerCase();
  assert.ok(key, `Unparseable palette chord: ${match[1]}`);
  return {
    chord: match[1],
    key,
    shift: parts.slice(0, -1).some((part) => part.toLowerCase() === "shift"),
  };
}

/** Parses the declared `.status-bar` height out of the app stylesheet. */
export function declaredStatusBarHeight(cssText) {
  const match = /\.status-bar\s*\{[^}]*height:\s*(\d+(?:\.\d+)?)px/.exec(
    cssText,
  );
  assert.ok(match, "The stylesheet must declare .status-bar height in px");
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

/** Turns the registered folder workspace into a dirty git repo. */
async function prepareChangesRepo(workspace) {
  const file = "changes-fixture.txt";
  await git(workspace, ["init"]);
  await writeFile(path.join(workspace, file), "committed baseline\n");
  await git(workspace, ["add", file]);
  await git(workspace, ["commit", "-m", "acceptance baseline"]);
  await writeFile(path.join(workspace, file), "committed baseline\nunstaged edit\n");
  return file;
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
  // rather than the focused terminal's helper textarea.
  const focusChrome = () =>
    page.getByText("Service 0.1.0", { exact: true }).click({ timeout: 5000 });

  // Palette chord comes from the shortcut registry, never hardcoded: after
  // R6-A lands this reads CmdOrCtrl+J, before it CmdOrCtrl+K.
  const { chord, key, shift } = paletteOpenChord(
    await readFile(
      path.join(root, "apps", "desktop", "src", "renderer", "src", "shortcuts.ts"),
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
  await page
    .getByRole("combobox", { name: "Command palette" })
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

  // Changes renders the unstaged edit of the fixture repo.
  const changedFile = await prepareChangesRepo(workspace);
  const changesNav = page.getByRole("button", { name: "Changes", exact: true });
  assert.equal(await changesNav.isEnabled(), true);
  await changesNav.click();
  const changesPanel = page.locator(".changes-panel");
  await changesPanel.waitFor();
  await page.getByLabel("Changed files", { exact: true }).waitFor();
  await changesPanel.getByText(changedFile, { exact: true }).waitFor();
  await page.getByLabel("Commit message", { exact: true }).waitFor();
  await screenshot("changes.png");
  checks.push("changes-panel-renders-unstaged-edit-for-fixture-repo");

  // Automations lists on a fresh daemon (empty, with the create entry).
  await page.getByRole("button", { name: "Automations", exact: true }).click();
  await page.getByRole("heading", { name: "Automations", exact: true }).waitFor();
  await page.locator('[data-testid="automations-empty"]').waitFor();
  await page.locator('[data-testid="automations-new"]').waitFor();
  await screenshot("automations.png");
  checks.push("automations-page-lists-empty-with-create-entry");

  // Bots renders on a fresh daemon (empty, with the create entry).
  await page.getByRole("button", { name: "Bots", exact: true }).click();
  const botsPanel = page.locator('section[aria-label="Bots"]');
  await botsPanel.waitFor();
  await page.getByRole("heading", { name: "Bots", exact: true }).waitFor();
  await page.getByRole("button", { name: "New Bot", exact: true }).waitFor();
  await page.locator('[data-testid="bots-empty"]').waitFor();
  await screenshot("bots.png");
  checks.push("bots-page-renders-empty-with-create-entry");

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
        "assets",
        "main.css",
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
  await page.getByText("Service 0.1.0", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  // R8-G1 ported the source task-page: the page lives in the Tasks section,
  // the project source is the SourceBar select, rows are role=button
  // "Issue #n", and the list root is the github list scroll container.
  const tasksList = page.locator('section[aria-label="Tasks"]');
  await tasksList.waitFor();
  const repoBase = path.basename(tasksRepo);
  const projectOptionReady = (name) =>
    [...document.querySelectorAll('section[aria-label="Tasks"] select')].some(
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
      const root = document.querySelector('section[aria-label="Tasks"]');
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
