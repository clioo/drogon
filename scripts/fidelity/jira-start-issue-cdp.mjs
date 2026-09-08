// R17-C fidelity driver: start-from-issue through the REAL app — drogond
// plus the Electron production bundle, seeded with the committed fake Jira
// server. Connects the fixture site over the real preload bridge, adds a
// git project, then drives `jira.startIssue` twice (idempotency), creates
// an issue over the bridge (`jira.createIssue` surfacing), re-reads the
// issue (ADF description), and screenshots the passing app state.
//
// Usage: node scripts/fidelity/jira-start-issue-cdp.mjs [--out <dir>]
// Requires: cargo build --workspace and pnpm --filter @drogon/desktop build
// already run (the script launches target/debug/drogond via the app).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import {
  startAcceptanceProcess,
  stopAcceptanceProcess,
} from "../acceptance-process.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const nodeBin = process.execPath;
const electron = path.join(
  root,
  "apps/desktop/node_modules/.bin/electron",
);
const appDir = path.join(root, "apps/desktop");
const fixtureScript = path.join(
  root,
  "scripts/fixtures/jira/fake-jira-server.mjs",
);
const outIndex = process.argv.indexOf("--out");
const outDir = outIndex !== -1
  ? path.resolve(process.argv[outIndex + 1])
  : path.join(root, ".preflight/fidelity/jira-start-issue");
await mkdir(outDir, { recursive: true });

// --- fixtures ---------------------------------------------------------------
const fixtureDir = mkdtempSync(path.join(tmpdir(), "drogon-jira-cdp-"));
const dataDir = path.join(fixtureDir, "data");
const electronProfile = path.join(fixtureDir, "electron-profile");
mkdirSync(dataDir, { recursive: true });

const repoDir = path.join(fixtureDir, "repo");
mkdirSync(repoDir, { recursive: true });
execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "ignore" });
execFileSync("git", ["config", "user.email", "fixture@example.com"], { cwd: repoDir });
execFileSync("git", ["config", "user.name", "Fixture"], { cwd: repoDir });
execFileSync("git", ["commit", "--allow-empty", "-m", "seed"], { cwd: repoDir, stdio: "ignore" });

const { existsSync } = await import("node:fs");
const fixtureLog = path.join(fixtureDir, "requests.jsonl");
const fixture = startAcceptanceProcess(
  nodeBin,
  [fixtureScript, "--port", "0", "--log", fixtureLog],
  { stdio: ["ignore", "pipe", "ignore"] },
);
let fixturePort = 0;
{
  let listenLine = "";
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const chunk = fixture.stdout.read();
    if (chunk) {
      listenLine += chunk.toString();
      const match = listenLine.match(/LISTEN (\d+)/);
      if (match) {
        fixturePort = Number(match[1]);
        break;
      }
    }
    await delay(50);
  }
}
assert.ok(fixturePort > 0, "fake Jira server did not publish a port");
const siteUrl = `http://127.0.0.1:${fixturePort}`;

// --- desktop ----------------------------------------------------------------
// Development never spawns drogond itself (native-runtime-bootstrap.ts:
// "Development relies on a manually-started drogond"), so start the freshly
// built daemon against the fixture data dir before the app boots.
const daemon = startAcceptanceProcess(
  path.join(root, "target/debug/drogond"),
  ["--data-dir", dataDir],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const daemonUp = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("drogond never created its socket")), 30_000);
  const poll = setInterval(() => {
    if (existsSync(path.join(dataDir, "runtime-v1.sock"))) {
      clearInterval(poll);
      clearTimeout(timer);
      resolve();
    }
  }, 100);
});
const desktop = startAcceptanceProcess(
  electron,
  [appDir, "--remote-debugging-port=0"],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      DROGON_DATA_DIR: dataDir,
      DROGON_ELECTRON_PROFILE: electronProfile,
      DROGON_BACKGROUND_WINDOW: "1",
      SHELL: "/bin/sh",
    },
  },
);
const report = { checks: [], cleanup: [], status: "FAILED" };
const check = (name, detail) => {
  report.checks.push({ name, detail });
  console.log(`ok - ${name}${detail ? ` (${detail})` : ""}`);
};
let browser;
let desktopOut = "";
await daemonUp;
try {
  desktop.stdout.on("data", (bytes) => {
    desktopOut = (desktopOut + bytes.toString()).slice(-16384);
  });
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timer = setTimeout(
      () => reject(new Error(`no DevTools endpoint: ${tail}`)),
      30_000,
    );
    desktop.stderr.on("data", (bytes) => {
      tail = (tail + bytes.toString()).slice(-8192);
      const match = tail.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    desktop.once("exit", () => {
      clearTimeout(timer);
      reject(new Error(`electron exited early: ${tail}`));
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  let page;
  for (let i = 0; i < 200 && !page; i += 1) {
    page = browser.contexts()[0]?.pages()[0];
    if (!page) await delay(100);
  }
  assert.ok(page, "renderer page never appeared");
  await page.waitForFunction(() => Boolean(window.drogon?.jira), null, {
    timeout: 30_000,
  });
  check("preload jira bridge exposed", "window.drogon.jira present");

  // Wait for the daemon the app spawned to finish booting (first boot
  // initializes SQLite; the bridge answers 'unverifiable' until then).
  await page.waitForFunction(
    async () => {
      try {
        const reply = await window.drogon.project.projectList();
        return Boolean(reply && reply.ok);
      } catch {
        return false;
      }
    },
    null,
    { timeout: 60_000, polling: 500 },
  );
  check("daemon reachable through the bridge", "project.list healthy");

  // Connect the fixture site through the real bridge (token sealed on disk
  // by the daemon, never touched here).
  const connected = await page.evaluate(
    async ({ siteUrl: url }) =>
      window.drogon.jira.jiraConnect({
        siteUrl: url,
        email: "carlos@example.com",
        apiToken: "fixture-token",
      }),
    { siteUrl },
  );
  assert.equal(connected.ok, true, `jiraConnect failed: ${JSON.stringify(connected)}`);
  check(
    "jiraConnect against the fixture site",
    JSON.stringify(connected.result).slice(0, 200),
  );

  const added = await page.evaluate(async (repoPath) => {
    const projects = await window.drogon.project.projectList();
    if (projects.ok && projects.result.projects.length > 0) {
      return projects.result.projects[0];
    }
    return (await window.drogon.project.projectAdd({ path: repoPath })).result;
  }, repoDir);
  assert.ok(added?.id, `projectAdd/list failed: ${JSON.stringify(added)}`);
  check("git project available for startIssue", added.id);

  // Start-from-issue: the daemon names the worktree the fork's way.
  const started = await page.evaluate(
    async ({ projectId, key }) =>
      window.drogon.jira.jiraStartIssue({ projectId, key }),
    { projectId: added.id, key: "DROG-1" },
  );
  assert.equal(started.ok, true, `jiraStartIssue failed: ${JSON.stringify(started)}`);
  assert.equal(started.result.ok, true);
  assert.equal(started.result.key, "DROG-1");
  assert.equal(
    started.result.seedName,
    "drog-1-project-setup-and-repo-bootstrap",
  );
  assert.equal(
    started.result.displayName,
    "DROG-1 Project setup and repo bootstrap",
  );
  assert.equal(
    started.result.worktree.title,
    "DROG-1 Project setup and repo bootstrap",
  );
  check(
    "jira.startIssue names the worktree the fork's way",
    `${started.result.worktree.branch} :: ${started.result.worktree.title}`,
  );

  const again = await page.evaluate(
    async ({ projectId, key }) =>
      window.drogon.jira.jiraStartIssue({ projectId, key }),
    { projectId: added.id, key: "DROG-1" },
  );
  assert.equal(again.result.worktree.id, started.result.worktree.id);
  check("jira.startIssue is idempotent", again.result.worktree.id);

  // Create surfacing through the same bridge the dialog uses.
  const created = await page.evaluate(async () => {
    const projects = await window.drogon.jira.jiraListProjects({});
    const types = await window.drogon.jira.jiraListIssueTypes({
      projectIdOrKey: "DROG",
    });
    return window.drogon.jira.jiraCreateIssue({
      siteId: projects.result[0]?.siteId,
      projectId: "10000",
      issueTypeId: types.result[0]?.id ?? "10001",
      title: "CDP surfaced issue",
      description: "Created through the real bridge.",
    });
  });
  assert.equal(created.ok, true, `jiraCreateIssue failed: ${JSON.stringify(created)}`);
  assert.equal(created.result.ok, true);
  assert.match(created.result.key, /^DROG-\d+$/);
  check("jira.createIssue surfaces the new key", created.result.key);

  // The detail read carries the daemon-rendered ADF description.
  const issue = await page.evaluate(
    async (key) => window.drogon.jira.jiraGetIssue({ key }),
    "DROG-1",
  );
  assert.equal(issue.ok, true);
  assert.match(issue.result.description, /Bootstrap the repository/);
  check("jira.getIssue renders ADF description to markdown");

  const transitions = await page.evaluate(
    async (key) => window.drogon.jira.jiraListTransitions({ key }),
    "DROG-1",
  );
  assert.equal(transitions.ok, true);
  assert.ok(transitions.result.length >= 2, "expected fixture transitions");
  check("jira.listTransitions degrades gracefully", `${transitions.result.length} transitions`);

  // The fixture saw the create POST — the bridge reached the server.
  const logged = readFileSync(fixtureLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.ok(
    logged.some(
      (entry) =>
        entry.method === "POST" &&
        /^\/rest\/api\/[23]\/issue$/.test(entry.path ?? ""),
    ),
    "fixture never received the create POST",
  );
  check("fixture observed POST /issue", `${logged.length} requests logged`);

  // Passing app state, evidence attached.
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, "start-issue.app.light.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, "start-issue.app.dark.png") });
  check("app screenshots captured", outDir);

  // Graceful exit: closing the window must take the app down on its own.
  await page.evaluate(() => window.close());
  const exit = await stopAcceptanceProcess(desktop, { timeoutMs: 15_000 });
  report.cleanup.push(`desktop: ${exit.verdict}`);
  assert.equal(exit.forced, false, "desktop required a forced kill");
  report.status = "PASSED";
} catch (error) {
  report.error = String(error?.stack ?? error);
  try {
    await page?.screenshot?.({
      path: path.join(outDir, "failure.png"),
    });
  } catch {}
  console.error(report.error);
  console.error("--- desktop stdout/stderr tail ---");
  console.error(desktopOut);
} finally {
  if (report.status !== "PASSED") {
    const result = await stopAcceptanceProcess(desktop, { timeoutMs: 5000 });
    report.cleanup.push(`desktop (failure path): ${result.verdict}`);
  }
  const daemonStop = await stopAcceptanceProcess(daemon, { timeoutMs: 10_000 });
  report.cleanup.push(`daemon: ${daemonStop.verdict}`);
  await stopAcceptanceProcess(fixture);
  await writeFile(
    path.join(outDir, "report.json"),
    JSON.stringify(
      { ...report, siteUrl, dataDir, repoDir },
      null,
      2,
    ),
  );
}

console.log(`status: ${report.status}`);
process.exit(report.status === "PASSED" ? 0 : 1);
