// Issue #606: real desktop + real daemon over CDP. A leader session spawns
// two subagents the way a fan-out actually does it — `drogon-cli terminal
// create` from inside the leader's own PTY, so the daemon records
// `parentSessionId` from the inherited DROGON_SESSION_ID — and the tab strip
// has to group them under the leader, fold the whole group on one click,
// hand the prompt back to the leader while they are folded, and still be
// folded after a reload.
//
// The prompt half is proved by where the keystrokes land, not by which tab
// looks selected: every session runs a shell that appends each line it reads
// to its own file, so a line typed while the group is folded must show up in
// the leader's file and in neither subagent's.
//
// Run it from a plain shell. Inside a dispatched orchestration worker the
// inherited DROGON_* variables scope every CLI call to that dispatch, so this
// script's own fixture daemon answers `unauthorized` and the run dies waiting
// for readiness. `env -u DROGON_SESSION_ID -u DROGON_WORKSPACE_ID -u
// DROGON_DATA_DIR ... node scripts/accept-subagent-tab-groups.mjs` clears it.
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import {
  runAcceptanceProcess as exec,
  startAcceptanceProcess as start,
  stopAcceptanceProcess as stop,
} from "./acceptance-process.mjs";
import { packagedFixtureDaemon } from "./packaged-fixture-daemon.mjs";
import {
  startForegroundObservation,
  verifyForegroundObservation,
} from "./acceptance-foreground.mjs";
import { emulatePageFocus } from "./acceptance-page-focus.mjs";
import { installPrivateAcceptanceEnvironment } from "./acceptance-private-environment.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = path.join(root, "apps/desktop");
const electron = createRequire(path.join(appDir, "package.json"))("electron");
const cli = path.join(root, "target/debug/drogon-cli");
const daemonBinary = path.join(root, "target/debug/drogond");
// Short prefix on purpose: macOS caps unix socket paths at 104 bytes and the
// daemon socket lives under the fixture.
const fixture = await mkdtemp(path.join(tmpdir(), "dg-606-"));
const dataDir = path.join(fixture, "data");
const repo = path.join(fixture, "repo");
const output =
  process.env.TAB_GROUPS_OUT ??
  path.join(root, ".preflight/acceptance", `subagent-tab-groups-${Date.now()}`);
const report = {
  status: "FAILED",
  fixture,
  output,
  checks: [],
  screenshots: [],
  processes: [],
};
let desktop, daemon, browser, observer, daemonOwner, page;
const owned = new Map();

async function processRows() {
  const { stdout } = await exec("/bin/ps", ["-axo", "pid=,ppid=,lstart=,command="]);
  return stdout
    .trim()
    .split("\n")
    .map((line) => {
      const m = line
        .trim()
        .match(/^(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*)$/);
      return m && { pid: Number(m[1]), parent: Number(m[2]), identity: `${m[3]} ${m[4]}` };
    })
    .filter(Boolean);
}
// Descendants are captured while their parents are still alive: a passing
// check never proves a PTY exited.
async function captureChildren() {
  const rows = await processRows();
  const parents = new Set([desktop?.pid, daemon?.pid, ...owned.keys()].filter(Boolean));
  let added;
  do {
    added = false;
    for (const row of rows)
      if (parents.has(row.parent) && !parents.has(row.pid)) {
        parents.add(row.pid);
        owned.set(row.pid, row.identity);
        added = true;
      }
  } while (added);
}
async function cliJson(args, options = {}) {
  const { stdout } = await exec(cli, ["--data-dir", dataDir, "--json", ...args], {
    timeout: 30000,
    ...options,
  });
  const value = JSON.parse(stdout);
  assert.equal(value.ok, true, stdout);
  return value.result;
}
async function until(check, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(150);
  }
  throw new Error(`Timed out: ${label}`);
}
const exists = (file) => access(file).then(() => true, () => false);

/** Every session tab in strip order, with its lineage markers. */
const stripTabs = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"][data-testid="sortable-tab"]')].map(
      (tab) => ({
        id: tab.getAttribute("data-tab-id"),
        parent: tab.getAttribute("data-lineage-parent"),
        child: tab.getAttribute("data-lineage-child"),
        collapsed: tab.getAttribute("data-lineage-collapsed"),
        count:
          tab.querySelector('[data-lineage-child-count="true"]')?.textContent ??
          null,
        active: tab.getAttribute("data-active"),
      }),
    ),
  );
/** The session whose terminal the prompt would reach right now. */
const promptTabId = () =>
  page.evaluate(() => {
    const labelled = document
      .getElementById("active-session-panel")
      ?.getAttribute("aria-labelledby");
    return labelled ? labelled.replace(/^session-tab-/, "") : null;
  });
const readLines = async (file) =>
  (await exists(file))
    ? (await readFile(file, "utf8")).split("\n").filter(Boolean)
    : [];

try {
  await mkdir(output, { recursive: true });
  await mkdir(repo, { recursive: true });
  const env = { ...process.env };
  await installPrivateAcceptanceEnvironment(fixture, env);
  const git = (args) =>
    exec(
      "git",
      [
        "-c",
        "user.name=Drogon",
        "-c",
        "user.email=drogon@example.invalid",
        ...args,
      ],
      { env },
    );
  await git(["init", "-q", "-b", "main", repo]);
  await writeFile(path.join(repo, "README.md"), "tab group fixture\n");
  await git(["-C", repo, "add", "-A"]);
  await git(["-C", repo, "commit", "-q", "-m", "init"]);
  // Nothing in this process's own context may leak a session parent into the
  // control-path creates below; only the real leader PTY carries one.
  delete env.DROGON_SESSION_ID;
  delete env.DROGON_WORKSPACE_ID;

  if (process.platform === "darwin")
    observer = await startForegroundObservation(output);
  daemon = start(daemonBinary, ["--data-dir", dataDir], { env, stdio: "ignore" });
  await until(
    async () => {
      try {
        return await cliJson(["status"]);
      } catch {
        return false;
      }
    },
    "daemon readiness",
    30000,
  );
  daemonOwner = packagedFixtureDaemon(daemonBinary, cli, dataDir);
  await daemonOwner.capture();
  report.daemonIdentity = daemonOwner.identity();

  const project = await cliJson(["project", "add", repo, "--name", "fanout"], {
    env,
    cwd: fixture,
  });
  const worktree = await cliJson(
    ["worktree", "create", "--project", project.id, "--name", "leader", "--no-parent"],
    { env, cwd: fixture },
  );
  const workspaceId = worktree.workspaceId;
  report.workspaceId = workspaceId;

  // Each session records every line its PTY hands it, so "where the prompt
  // went" is a fact on disk rather than a rendered highlight.
  const sink = (name) => path.join(fixture, `${name}.in`);
  const recorder = async (name) => {
    const script = path.join(fixture, `${name}.sh`);
    await writeFile(
      script,
      `#!/bin/sh\nwhile IFS= read -r line; do printf '%s\\n' "$line" >> ${sink(name)}; done\n`,
    );
    return script;
  };
  const childOne = await recorder("child-one");
  const childTwo = await recorder("child-two");
  const leaderScript = path.join(fixture, "leader.sh");
  const spawned = path.join(fixture, "spawned");
  await writeFile(
    leaderScript,
    [
      "#!/bin/sh",
      // No --data-dir, and the workspace comes from the PTY's own exported
      // DROGON_WORKSPACE_ID: the lineage rides the same inherited env a real
      // fan-out has, never anything this probe hands in.
      `"${cli}" --json terminal create --workspace "$DROGON_WORKSPACE_ID" -- sh "${childOne}" > "${fixture}/c1.json" 2> "${fixture}/c1.err"`,
      `"${cli}" --json terminal create --workspace "$DROGON_WORKSPACE_ID" -- sh "${childTwo}" > "${fixture}/c2.json" 2> "${fixture}/c2.err"`,
      `touch "${spawned}"`,
      `while IFS= read -r line; do printf '%s\\n' "$line" >> ${sink("leader")}; done`,
    ].join("\n") + "\n",
  );
  const leader = await cliJson(
    ["terminal", "create", "--workspace", workspaceId, "--", "sh", leaderScript],
    { env, cwd: fixture },
  );
  report.leaderSessionId = leader.id;
  await until(() => exists(spawned), "leader spawned its two subagents", 45000);
  const created = [
    JSON.parse(await readFile(path.join(fixture, "c1.json"), "utf8")),
    JSON.parse(await readFile(path.join(fixture, "c2.json"), "utf8")),
  ];
  for (const record of created) assert.equal(record.ok, true, JSON.stringify(record));
  const childIds = created.map((record) => record.result.id);
  report.childSessionIds = childIds;
  for (const record of created)
    assert.equal(
      record.result.parentSessionId,
      leader.id,
      "a session created from inside the leader's PTY records it as the parent",
    );
  report.checks.push("daemon-records-parent-session-for-the-fan-out");

  desktop = start(electron, [appDir, "--remote-debugging-port=0"], {
    env: {
      ...env,
      DROGON_DATA_DIR: dataDir,
      DROGON_ELECTRON_PROFILE: path.join(fixture, "electron"),
      DROGON_BACKGROUND_WINDOW: "1",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  report.desktopPid = desktop.pid;
  let stderrText = "";
  desktop.stderr.on("data", (chunk) => {
    stderrText = (stderrText + chunk).slice(-16000);
  });
  const endpoint = await until(
    () => stderrText.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/)?.[1],
    "CDP endpoint",
    30000,
  );
  browser = await chromium.connectOverCDP(endpoint);
  page = await until(() => browser.contexts()[0]?.pages()[0], "renderer");
  page.setDefaultTimeout(30000);
  const consoleTail = [];
  page.on("console", (message) => {
    consoleTail.push(`${message.type()}: ${message.text()}`);
    if (consoleTail.length > 80) consoleTail.shift();
  });
  report.consoleTail = consoleTail;
  await emulatePageFocus(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Select leader", exact: true }).click();
  await until(async () => (await stripTabs()).length === 3, "three session tabs");

  // --- 1. Grouped under the leader, contiguous, marked as children. ---
  let tabs = await until(async () => {
    const rendered = await stripTabs();
    return rendered[0]?.parent === "true" ? rendered : false;
  }, "the leader tab gains its group disclosure");
  report.groupedStrip = tabs;
  assert.equal(tabs[0].id, leader.id, JSON.stringify(tabs));
  assert.deepEqual(
    tabs.slice(1).map((tab) => tab.id).sort(),
    [...childIds].sort(),
    "both subagent tabs stand next to their leader",
  );
  assert.ok(
    tabs.slice(1).every((tab) => tab.child === "true"),
    "each subagent tab is marked as a lineage child",
  );
  report.checks.push("subagents-render-grouped-under-their-leader");

  // --- 2. The prompt starts on a subagent, the way a fan-out leaves it. ---
  await page.locator(`[data-tab-id="${childIds[0]}"]`).click();
  await until(async () => (await promptTabId()) === childIds[0], "subagent holds the prompt");
  report.checks.push("a-visible-subagent-can-still-hold-the-prompt");

  // --- 3. One click folds the whole group. ---
  const disclosure = page.locator(
    `[data-tab-id="${leader.id}"] [data-tab-lineage-toggle="true"]`,
  );
  assert.equal(
    await disclosure.getAttribute("aria-label"),
    "Hide 2 child agents",
  );
  await disclosure.click();
  tabs = await until(async () => {
    const rendered = await stripTabs();
    return rendered.length === 1 ? rendered : false;
  }, "the group folds into its leader");
  assert.equal(tabs[0].id, leader.id);
  assert.equal(tabs[0].collapsed, "true");
  assert.equal(tabs[0].count, "+2");
  report.checks.push("one-click-collapses-the-whole-group");

  // --- 4. The prompt came back to the leader with the fold. ---
  assert.equal(
    await promptTabId(),
    leader.id,
    "a folded subagent must not keep the prompt",
  );
  const typed = `PROMPT-FOR-LEADER-${Date.now()}`;
  await page.locator("#active-session-panel .xterm-screen").click();
  await page.keyboard.type(typed);
  await page.keyboard.press("Enter");
  await until(
    async () => (await readLines(sink("leader"))).includes(typed),
    "the leader's shell reads the typed line",
    20000,
  );
  report.leaderInput = await readLines(sink("leader"));
  report.childOneInput = await readLines(sink("child-one"));
  report.childTwoInput = await readLines(sink("child-two"));
  assert.ok(
    !report.childOneInput.includes(typed) && !report.childTwoInput.includes(typed),
    `a folded subagent must receive nothing: ${JSON.stringify({
      one: report.childOneInput,
      two: report.childTwoInput,
    })}`,
  );
  report.checks.push("while-folded-the-prompt-reaches-only-the-main-agent");

  const collapsedShot = path.join(output, "strip-collapsed.png");
  await page.screenshot({ path: collapsedShot, animations: "disabled" });
  report.screenshots.push(collapsedShot);

  // --- 5. The fold is durable, not a render-time flag. ---
  report.envelope = await page.evaluate(
    (id) => JSON.parse(window.localStorage.getItem(`drogon:tab-strip:${id}`)).state,
    workspaceId,
  );
  assert.deepEqual(
    report.envelope.collapsedLineage,
    [leader.id],
    "the fold is written to the workspace's tab-strip envelope",
  );
  await page.reload();
  await page.getByRole("button", { name: "Select leader", exact: true }).click();
  tabs = await until(async () => {
    const rendered = await stripTabs();
    return rendered.length === 1 && rendered[0].collapsed === "true"
      ? rendered
      : false;
  }, "the group is still folded after a reload");
  assert.equal(tabs[0].count, "+2");
  assert.equal(await promptTabId(), leader.id);
  report.checks.push("the-fold-survives-a-reload-instead-of-resetting");

  // --- 6. And it unfolds again, back to the same three tabs. ---
  await page
    .locator(`[data-tab-id="${leader.id}"] [data-tab-lineage-toggle="true"]`)
    .click();
  tabs = await until(async () => {
    const rendered = await stripTabs();
    return rendered.length === 3 ? rendered : false;
  }, "the group unfolds");
  assert.deepEqual(
    tabs.map((tab) => tab.id),
    [leader.id, ...tabs.slice(1).map((tab) => tab.id)],
    JSON.stringify(tabs),
  );
  const expandedShot = path.join(output, "strip-expanded.png");
  await page.screenshot({ path: expandedShot, animations: "disabled" });
  report.screenshots.push(expandedShot);
  report.checks.push("the-group-unfolds-back-to-its-tabs");
  report.status = "PASSED";
} catch (error) {
  report.error = error.stack ?? String(error);
  if (page) {
    try {
      await page.screenshot({ path: path.join(output, "failure.png") });
    } catch {
      /* Preserve the original failure. */
    }
    try {
      report.stripAtFailure = await stripTabs();
    } catch {
      /* best effort */
    }
    try {
      report.promptTabAtFailure = await promptTabId();
    } catch {
      /* best effort */
    }
  }
} finally {
  try {
    await captureChildren();
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        report.cdpCloseError = String(error);
      }
    }
    if (desktop) report.desktopExit = await stop(desktop);
    if (daemonOwner) {
      try {
        report.daemonExit = await daemonOwner.stop();
      } catch (error) {
        report.quiescentShutdownError = String(error);
        if (daemon) report.daemonExit = await stop(daemon);
      }
    } else if (daemon) report.daemonExit = await stop(daemon);
    if (daemon) report.daemonProcessExit = await stop(daemon);
    // Identity is rechecked immediately before each signal so a reused pid
    // can never be the one we kill.
    for (const signal of ["SIGTERM", "SIGKILL"]) {
      const rows = await processRows();
      for (const row of rows)
        if (owned.get(row.pid) === row.identity) {
          try {
            process.kill(row.pid, signal);
          } catch {
            /* Already exited. */
          }
        }
      await delay(300);
    }
    report.processes = [...owned].map(([pid, identity]) => ({ pid, identity }));
    report.survivors = (await processRows()).filter(
      (row) => owned.get(row.pid) === row.identity,
    );
    assert.equal(report.survivors.length, 0);
    if (desktop) assert.equal(report.desktopExit.verdict, "exited");
    if (daemon) assert.equal(report.daemonProcessExit.verdict, "exited");
  } catch (error) {
    report.cleanupError = error.stack ?? String(error);
    report.status = "FAILED";
  }
  if (observer) {
    try {
      report.focus = await observer.stop();
      verifyForegroundObservation(report.focus, desktop ? [desktop.pid] : []);
    } catch (error) {
      report.focusError = String(error);
      report.status = "FAILED";
    }
  }
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        status: report.status,
        output,
        checks: report.checks,
        screenshots: report.screenshots,
        groupedStrip: report.groupedStrip,
        envelope: report.envelope,
        leaderInput: report.leaderInput,
        childOneInput: report.childOneInput,
        childTwoInput: report.childTwoInput,
        error: report.error,
        cleanupError: report.cleanupError,
        focusError: report.focusError,
        survivors: report.survivors,
        stripAtFailure: report.stripAtFailure,
        promptTabAtFailure: report.promptTabAtFailure,
        consoleTail: report.error ? report.consoleTail : undefined,
      },
      null,
      2,
    ),
  );
  if (report.status !== "PASSED") process.exitCode = 1;
}
