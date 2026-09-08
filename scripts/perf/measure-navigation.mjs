#!/usr/bin/env node
// Navigation-latency acceptance probe (R16-BF): measures user-perceived
// page-open and startup latency of the Drogon desktop against the live
// orca-drogon reference, with stable budgets in `--check` mode.
//
//   # Reference (attach only: never starts, stops, types into, or reloads
//   # the live instance; sidebar-rail navigation only):
//   node scripts/perf/measure-navigation.mjs --reference-cdp http://127.0.0.1:9445
//
//   # Packaged candidate (harness owns the lifecycle: spawns the bundle,
//   # ensures one git project + worktree + workspace + --sessions-count
//   # shell sessions, measures cold start + opens, stops everything by PID):
//   node scripts/perf/measure-navigation.mjs --bundle <Drogon.app> \
//     --data-dir /tmp/drogon-perf-data --profile-dir /tmp/drogon-perf-profile \
//     --fixture-repo /tmp/drogon-perf-repo --sessions-count 6 \
//     --worktree-name perf-wt --out report.json
//
//   # Budget check (Drogon within 1.25x of the reference per metric;
//   # page opens also <= 300 ms absolute):
//   node scripts/perf/measure-navigation.mjs --check --report drogon.json \
//     --reference reference.json
//
// Every metric reports 5 samples with median + p95. Page-open timing is
// click-to-content: an in-page performance.now() stamp taken immediately
// before the Playwright click, to the moment the page's content marker is
// visibly painted (keep-alive hosts stay mounted while hidden, so mount
// presence alone never counts). Long Tasks overlapping each sample are
// attributed from the buffered longtask entries for root-cause work.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { packagedFixtureDaemon } from "../packaged-fixture-daemon.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = args[i + 1];
  return next !== undefined && !next.startsWith("--") ? next : true;
};
const MODE = flag("reference-cdp", null)
  ? "reference"
  : flag("bundle", null)
    ? "bundle"
    : flag("check", false)
      ? "check"
      : null;
if (!MODE) {
  console.error(
    "usage: measure-navigation.mjs (--reference-cdp <url> | --bundle <app> | --check --report <f> --reference <f>) [--samples N] [--out <f>]",
  );
  process.exit(1);
}
const SAMPLES = Number(flag("samples", "5"));
const OUT = flag("out", null);
const OPEN_TIMEOUT = 15000;

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, rank)];
}
function summarize(samples) {
  const valid = samples.filter((s) => typeof s.ms === "number");
  const sorted = valid.map((s) => s.ms).sort((a, b) => a - b);
  return {
    unit: "ms",
    samples: valid.map((s) => Math.round(s.ms * 10) / 10),
    states: valid.map((s) => s.state),
    median: sorted.length ? Math.round(percentile(sorted, 50) * 10) / 10 : null,
    p95: sorted.length ? Math.round(percentile(sorted, 95) * 10) / 10 : null,
    longtasks: {
      count: valid.reduce((n, s) => n + (s.longtasks?.count ?? 0), 0),
      totalMs: Math.round(valid.reduce((n, s) => n + (s.longtasks?.total ?? 0), 0) * 10) / 10,
      maxMs: Math.round(Math.max(0, ...valid.map((s) => s.longtasks?.max ?? 0)) * 10) / 10,
    },
  };
}

// Content markers: visible paint of loaded content, never keep-alive
// mount presence. Each `ready` runs in-page and returns a state label or
// null while the page is still loading.
const PAGES = [
  {
    id: "sessions",
    nav: { name: "Sessions", exact: true },
    content: "[data-testid='sortable-tab']",
    ready: `(() => {
      const tabs = [...document.querySelectorAll("[data-testid='sortable-tab']")].filter((el) => el.getBoundingClientRect().width > 0);
      return tabs.length ? "tabs:" + tabs.length : null;
    })()`,
  },
  {
    id: "bots",
    nav: { name: "Bots", exact: true },
    // Copy-identical in both apps (the port keeps the fork's header verbatim);
    // keep-alive testids differ, so readiness keys off the header sentence
    // plus the mutually exclusive body states (loading / alert / empty / list).
    content: "text=Your team of agents",
    ready: `(() => {
      if (!/Your team of agents/.test(document.body.innerText)) return null;
      if (document.querySelector('[aria-label="Loading Bots"]')) return null;
      // Toasts and live-region announcers are chrome, not page errors: only
      // a failure-shaped alert counts (the fork's and the port's error copy
      // both read "could not be loaded" with a Retry).
      const failed = [...document.querySelectorAll('[role="alert"]')].some((el) => /could not|failed|not available|retry/i.test(el.innerText || ""));
      if (failed) return "error";
      if (/No Bots yet/.test(document.body.innerText)) return "empty";
      return "rows";
    })()`,
  },
  {
    id: "tasks",
    nav: { name: "Tasks", exact: true },
    content: "text=TITLE / CONTEXT",
    ready: `(() => {
      const text = document.body.innerText;
      if (!/TITLE \\/ CONTEXT/.test(text)) return null;
      if (/#\\d{2,}/.test(text)) return "rows";
      if (/No .* issues in |match this filter|No matching GitHub|No project sources|could not be spawned|not authenticated|install gh/i.test(text)) return "empty";
      if (/Could not load/i.test(text)) return "error";
      return null;
    })()`,
  },
  {
    id: "automations",
    nav: { name: "Automations", exact: true },
    content: "text=New Automation",
    ready: `(() => {
      const text = document.body.innerText;
      if (!/New Automation/.test(text)) return null;
      if (/No automations|Start from a template/i.test(text)) return "empty";
      if (/Could not load/i.test(text)) return "error";
      if (!document.querySelector("main [class*='pulse']")) return "rows";
      return null;
    })()`,
  },
  {
    id: "mentu",
    nav: { name: "Mentu" },
    content: "[data-testid='mentu-panel']",
    ready: `(() => {
      const host = document.querySelector("[data-testid='mentu-panel']");
      if (!host || host.getBoundingClientRect().width === 0) return null;
      return "ready";
    })()`,
  },
  {
    id: "settings",
    nav: { name: "Settings" },
    // Settings is a full page (no sidebar): content is its own shell, and
    // the way back is its "Back to app" row, not the Sessions rail entry.
    content: ".settings-view-shell",
    backNav: { name: "Back to app" },
    ready: `(() => {
      const shell = document.querySelector(".settings-view-shell");
      if (!shell || shell.getBoundingClientRect().width === 0) return null;
      return /General|Appearance|Agents/.test(shell.innerText) ? "ready" : null;
    })()`,
  },
  {
    id: "meetings",
    nav: { name: "Meetings", exact: true },
    optional: true,
    content: "main, [role='main']",
    ready: `(() => {
      const btn = [...document.querySelectorAll("button")].find((el) => (el.textContent || "").trim() === "Meetings" && el.getAttribute("aria-current") === "page");
      return btn ? "ready" : null;
    })()`,
  },
];

async function clickNav(page, nav) {
  const locator = page.getByRole("button", nav);
  if ((await locator.count()) > 1) {
    await locator.first().click();
    return "first-of-many";
  }
  await locator.click();
}

/** Which of the known pages exist in this app (Meetings/Mentu may not). */
async function discover(page) {
  const found = [];
  for (const spec of PAGES) {
    const count = await page.getByRole("button", spec.nav).count().catch(() => 0);
    console.error(`discover: ${spec.id} navCount=${count} url=${page.url()}`);
    if (count === 0) {
      console.error(`note: page '${spec.id}' has no nav entry; skipped`);
      continue;
    }
    found.push({ ...spec, navCount: count });
  }
  if (!found.some((s) => s.id === "sessions")) throw new Error("sessions nav entry missing: cannot anchor rounds");
  return found;
}

/** One Sessions-anchored round: Sessions -> page -> Sessions, each leg timed. */
async function runRound(page, specs) {
  const legs = {};
  const sessions = specs.find((s) => s.id === "sessions");
  if (!sessions) {
    for (const spec of specs) legs[spec.id] = busyLeg();
    return legs;
  }
  // The live reference may be mid-use by its owner: a missing or covered
  // nav entry marks the leg busy instead of forcing anything.
  const guard = async (spec) =>
    (await page.getByRole("button", spec.nav).count().catch(() => 0)) > 0;
  if (!(await guard(sessions))) {
    for (const spec of specs) legs[spec.id] = busyLeg();
    return legs;
  }
  await clickNav(page, sessions.nav).catch(() => {});
  for (const spec of specs.filter((s) => s.id !== "sessions")) {
    const g = await guard(spec);
    console.error(`leg: ${spec.id} guard=${g}`);
    legs[spec.id] = g ? await measureOpen(page, spec) : busyLeg();
    console.error(`leg: ${spec.id} ->`, JSON.stringify(legs[spec.id]));
    // Full pages (Settings) hide the rail: their own back control returns.
    const backSpec = spec.backNav ? { ...sessions, nav: spec.backNav } : sessions;
    const gb = await guard(backSpec);
    legs[`back:${spec.id}`] = gb ? await measureOpen(page, backSpec) : busyLeg();
  }
  return legs;
}

function busyLeg() {
  return { ms: null, state: "reference-busy", longtasks: { count: 0, total: 0, max: 0 } };
}

async function connectEndpoint(endpoint) {
  const browser = await chromium.connectOverCDP(endpoint);
  // A cold first run (bundled daemon spawn + schema init) can keep the
  // window pageless for well over ten seconds; wait like drogon-ui.mjs.
  let page = null;
  for (let i = 0; i < 360 && !page; i++) {
    const pages = browser.contexts().flatMap((c) => c.pages());
    page =
      pages.find((p) => p.url().startsWith("file:")) ??
      pages.find((p) => !/^https?:/.test(p.url())) ??
      pages[0] ??
      null;
    if (!page) await delay(250);
  }
  if (!page) throw new Error("no renderer page on this endpoint");
  // Background windows run unfocused; emulate focus so :focus styling and
  // hasFocus() behave as for a real user (same as scripts/qa/drogon-ui.mjs).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  page.setDefaultTimeout(OPEN_TIMEOUT);
  return { browser, page };
}

async function measureOpen(page, spec) {
  const t0 = await page.evaluate(() => performance.now());
  try {
    await clickNav(page, spec.nav);
  } catch {
    return busyLeg();
  }
  try {
    await page.locator(spec.content).first().waitFor({ state: "visible", timeout: OPEN_TIMEOUT });
  } catch {
    return { ms: null, state: "marker-timeout", longtasks: { count: 0, total: 0, max: 0 } };
  }
  // Content paint: poll the in-page readiness predicate past the
  // keep-alive host becoming visible (skeletons and spinners do not count).
  const deadline = Date.now() + OPEN_TIMEOUT;
  let state = null;
  while (Date.now() < deadline) {
    state = await page.evaluate(spec.ready);
    if (state) break;
    await delay(50);
  }
  const t1 = await page.evaluate(() => performance.now());
  const longtasks = await page.evaluate((from) => {
    const entries = performance.getEntriesByType("longtask").filter((e) => e.startTime >= from);
    return {
      count: entries.length,
      total: entries.reduce((n, e) => n + e.duration, 0),
      max: entries.length ? Math.max(...entries.map((e) => e.duration)) : 0,
    };
  }, t0);
  return { ms: state ? t1 - t0 : null, state: state ?? "content-timeout", longtasks };
}

/** Spawns the packaged bundle with an isolated data/profile pair and
 *  resolves once the sidebar is rendered with projects. Returns the child
 *  pid, the CDP endpoint, and the spawn-to-ready wall time. */
async function spawnBundle(bundle, dataDir, profileDir) {
  const executable = path.join(bundle, "Contents", "MacOS", "Drogon");
  if (!existsSync(executable)) throw new Error(`not a packaged Drogon bundle: ${bundle}`);
  await mkdir(dataDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });
  const t0 = Date.now();
  const child = spawn(executable, ["--remote-debugging-port=0"], {
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      DROGON_DATA_DIR: dataDir,
      DROGON_ELECTRON_PROFILE: profileDir,
      DROGON_BACKGROUND_WINDOW: "1",
    },
  });
  child.unref();
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timeout = setTimeout(() => reject(new Error(`no debugging endpoint: ${tail.slice(-500)}`)), 45000);
    child.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error("Electron exited before publishing an endpoint"));
    });
    child.stderr.on("data", (bytes) => {
      tail = (tail + bytes.toString()).slice(-8192);
      const match = tail.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });
  const { browser, page } = await connectEndpoint(endpoint);
  // Sidebar rendered with projects: the Reveal control plus a project row.
  await page.getByRole("button", { name: "Reveal active workspace", exact: true }).waitFor({ timeout: 45000 });
  const breakdown = await page.evaluate(() => {
    const [nav] = performance.getEntriesByType("navigation");
    return nav
      ? {
          domContentLoadedMs: Math.round((nav.domContentLoadedEventEnd - nav.startTime) * 10) / 10,
          loadEventMs: Math.round((nav.loadEventEnd - nav.startTime) * 10) / 10,
        }
      : null;
  });
  await browser.close();
  return { pid: child.pid, endpoint, ms: Date.now() - t0, breakdown };
}

async function stopPid(pid) {
  if (!pid) return false;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return false;
    }
  }
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await delay(200);
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  return false;
}

/** Synchronous drogon-cli call against the bundle's daemon; returns the
 *  result payload or throws with the envelope error. */
function cliJson(cliBin, dataDir, argv) {
  const child = spawnSync(cliBin, ["--data-dir", dataDir, "--json", ...argv], { encoding: "utf8" });
  if (child.status !== 0) throw new Error(`cli ${argv[0]} exited ${child.status}: ${child.stderr?.slice(0, 200)}`);
  const envelope = JSON.parse(String(child.stdout ?? ""));
  if (!envelope.ok) throw new Error(`cli ${argv[0]}: ${envelope.error?.message ?? "failed"}`);
  return envelope.result ?? {};
}

/**
 * Ensures the navigation fixtures exist: one git project (added from
 * --fixture-repo when the data dir has none), one worktree, one workspace,
 * and --sessions shell sessions (topped up, never trimmed). Returns the
 * workspace id and worktree name for the UI selection step, plus whether
 * anything was created (a mid-startup creation can miss the sidebar digest
 * race, so callers respawn once when created is true).
 */
function ensureFixtures(cliBin, dataDir, options, live = false) {
  const sessionTarget = options.sessions;
  let workspaces = cliJson(cliBin, dataDir, ["workspace", "list"]).workspaces ?? [];
  let workspace = options.workspace
    ? workspaces.find((w) => w.id === options.workspace) ?? null
    : (workspaces.find((w) => w.kind === "git") ?? workspaces[0] ?? null);
  const workspaceExisted = workspace !== null;
  let worktreeName = options.worktreeName ?? null;
  if (!workspace) {
    if (!options.fixtureRepo) {
      throw new Error("no workspace registered: pass --fixture-repo <git checkout> to create the fixtures");
    }
    const projects = cliJson(cliBin, dataDir, ["project", "list"]).projects ?? [];
    let project = projects.find((p) => p.kind === "git") ?? projects[0] ?? null;
    if (!project) project = cliJson(cliBin, dataDir, ["project", "add", options.fixtureRepo]);
    worktreeName = `perf-wt-${Date.now().toString(36)}`;
    const worktree = cliJson(cliBin, dataDir, ["worktree", "create", "--project", project.id, "--name", worktreeName]);
    workspace = cliJson(cliBin, dataDir, ["workspace", "add", worktree.path]);
  }
  // Rows (live or exited stubs) survive daemon restarts by design (session
  // survival): the sampled colds only top up the row count so tab counts
  // stay exact. The setup spawn passes live=true so the agent-state
  // stimulus always has live sessions to act on.
  const listed = cliJson(cliBin, dataDir, ["terminal", "list", "--workspace", workspace.id]).sessions ?? [];
  let created = !workspaceExisted;
  const have = live
    ? listed.filter((s) => s.verdict === "live").length
    : listed.length;
  for (let i = have; i < sessionTarget; i++) {
    cliJson(cliBin, dataDir, ["terminal", "create", "--workspace", workspace.id, "--", "/bin/sleep", "600"]);
    created = true;
  }
  if (!worktreeName) {
    // Reused data dir: adopt an existing worktree card for selection.
    try {
      const projects = cliJson(cliBin, dataDir, ["project", "list"]).projects ?? [];
      for (const project of projects) {
        const worktrees = cliJson(cliBin, dataDir, ["worktree", "list", "--project", project.id]).worktrees ?? [];
        // List rows carry branch/title, never name: the sidebar card shows
        // the branch for untitled worktrees.
        const match = worktrees.find((w) => w.branch || w.title) ?? null;
        if (match) {
          worktreeName = match.title || match.branch;
          break;
        }
      }
    } catch {
      // Selection stays skipped; legs record the gap honestly.
    }
  }
  return { workspaceId: workspace.id, worktreeName, created };
}

/** Best-effort worktree selection so scoped pages (Bots) have a scope. */
async function selectWorktree(page, worktreeName) {
  if (!worktreeName) return "skipped";
  // A CLI-created project/worktree reaches the sidebar through the
  // project.changes digest, so the card may arrive seconds after the CLI
  // returns; wait for it instead of racing it.
  const target = page.getByText(worktreeName).first();
  try {
    await target.waitFor({ state: "visible", timeout: 30000 });
  } catch {
    return "no-card";
  }
  await target.click();
  const tabs = await page
    .getByTestId("sortable-tab")
    .first()
    .waitFor({ state: "visible", timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  return tabs ? "selected" : "no-tabs";
}

/**
 * Worktree card update after an agent-state change: writes text into a live
 * shell session (the PTY echoes it as real output activity), then times the
 * shared Working badge (`aria-label="Working"`, one selector for session
 * tabs and worktree cards) painting. Same projection path as agent output;
 * no model, no harness, no native notification.
 */
async function measureWorktreeCardUpdate(page, cliBin, dataDir, workspaceId, ping) {
  const listed = cliJson(cliBin, dataDir, ["terminal", "list", "--workspace", workspaceId]).sessions ?? [];
  const victim = listed.filter((s) => s.verdict === "live").at(-1);
  if (!victim?.incarnation) return { ms: null, state: "no-live-session", longtasks: { count: 0, total: 0, max: 0 } };
  const t0 = await page.evaluate(() => performance.now());
  const sent = spawnSync(
    cliBin,
    ["--data-dir", dataDir, "--json", "terminal", "send",
      "--session", victim.id, "--incarnation", victim.incarnation, "--text", ping],
    { encoding: "utf8", input: "" },
  );
  if (sent.status !== 0) {
    return { ms: null, state: "send-error", longtasks: { count: 0, total: 0, max: 0 } };
  }
  try {
    await page.getByLabel("Working").first().waitFor({ state: "visible", timeout: OPEN_TIMEOUT });
  } catch {
    return { ms: null, state: "propagation-timeout", longtasks: { count: 0, total: 0, max: 0 } };
  }
  const t1 = await page.evaluate(() => performance.now());
  return { ms: t1 - t0, state: "working", longtasks: { count: 0, total: 0, max: 0 } };
}

/** Waits for the Working badge to decay back (silence window) between stimuli. */
async function waitForWorkingClear(page) {
  try {
    await page.getByLabel("Working").first().waitFor({ state: "hidden", timeout: 12000 });
    return true;
  } catch {
    return false;
  }
}

/** Session tab switch with N terminals: first tab -> last tab, timed to
 *  the newly selected tab painting as current. */
async function measureTabSwitch(page) {
  const tabs = page.getByTestId("sortable-tab");
  const count = await tabs.count();
  if (count < 2) return { ms: null, state: "fewer-than-2-tabs", longtasks: { count: 0, total: 0, max: 0 } };
  await tabs.first().click();
  await delay(300);
  const t0 = await page.evaluate(() => performance.now());
  await tabs.nth(count - 1).click();
  try {
    await page.waitForFunction(
      (n) => {
        const list = [...document.querySelectorAll("[data-testid='sortable-tab']")];
        const el = list[n];
        return el && (el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-current") === "true");
      },
      count - 1,
      { timeout: OPEN_TIMEOUT },
    );
  } catch {
    return { ms: null, state: "tab-timeout", longtasks: { count: 0, total: 0, max: 0 } };
  }
  const t1 = await page.evaluate(() => performance.now());
  return { ms: t1 - t0, state: `tabs:${count}`, longtasks: { count: 0, total: 0, max: 0 } };
}

const PAGE_OPEN_BUDGET_MS = 300;
const PARITY_RATIO = 1.25;
// R16-BF2 push: the worktree card must track a session-state change in under
// 200 ms median now that the daemon pushes (hook/PTY activity →
// `session.events.poll` → `ui:session-state-changed`) instead of waiting for
// the 2 s `session.list` poll. No reference leg exists (report-only before),
// so this is an absolute budget on the sealed bundle.
const WORKTREE_CARD_BUDGET_MS = 200;

function checkReport(report, reference) {
  const refMetrics = reference.metrics ?? {};
  const results = {};
  for (const [id, metric] of Object.entries(report.metrics ?? {})) {
    // Every open:/back: leg is a sidebar-rail page open: ratio against the
    // same reference leg plus the 300 ms absolute budget. Lifecycle and
    // interaction metrics without a reference fixture stay report-only —
    // except the pushed worktree-card update, which carries its own budget.
    const isPageOpen = id.startsWith("open:") || id.startsWith("back:");
    const ref = refMetrics[id];
    if (metric.median === null) {
      results[id] = { status: "fail", reason: "no valid samples" };
      continue;
    }
    if (id === "update:worktree-card") {
      const ok = metric.median <= WORKTREE_CARD_BUDGET_MS;
      results[id] = {
        status: ok ? "pass" : "fail",
        drogonMedianMs: metric.median,
        absoluteBudgetMs: WORKTREE_CARD_BUDGET_MS,
        ok,
      };
      continue;
    }
    if (!isPageOpen || !ref || ref.median === null) {
      results[id] = { status: "info", reason: "report-only: no reference median for this metric" };
      continue;
    }
    const ratio = metric.median / ref.median;
    const okRatio = ratio <= PARITY_RATIO;
    const okAbsolute = metric.median <= PAGE_OPEN_BUDGET_MS;
    results[id] = {
      status: okRatio && okAbsolute ? "pass" : "fail",
      drogonMedianMs: metric.median,
      referenceMedianMs: ref.median,
      ratio: Math.round(ratio * 100) / 100,
      ratioBudget: PARITY_RATIO,
      absoluteBudgetMs: PAGE_OPEN_BUDGET_MS,
      okRatio,
      okAbsolute,
    };
  }
  return results;
}

async function main() {
  if (MODE === "check") {
    const { readFile } = await import("node:fs/promises");
    const reportPath = flag("report", null);
    const referencePath = flag("reference", null);
    if (!reportPath || !referencePath) {
      console.error("--check needs --report <f> --reference <f>");
      process.exit(1);
    }
    const report = JSON.parse(await readFile(path.resolve(String(reportPath)), "utf8"));
    const reference = JSON.parse(await readFile(path.resolve(String(referencePath)), "utf8"));
    const results = checkReport(report, reference);
    console.log(JSON.stringify({ report: reportPath, reference: referencePath, results }, null, 2));
    if (OUT) await writeFile(path.resolve(OUT), JSON.stringify({ results }, null, 2) + "\n");
    process.exit(Object.values(results).some((r) => r.status === "fail") ? 1 : 0);
  }

  const startedAt = new Date().toISOString();
  if (MODE === "reference") {
    const url = String(flag("reference-cdp"));
    const res = await fetch(`${url}/json/version`).catch(() => null);
    if (!res?.ok) throw new Error(`reference CDP unreachable at ${url}`);
    // Attach read-only: Playwright drives sidebar-rail navigation only;
    // this mode never types, reloads, or stops the instance.
    const { browser, page } = await connectEndpoint((await res.json()).webSocketDebuggerUrl);
    const initial = await page.evaluate(() => document.querySelector("[aria-current='page']")?.textContent?.trim()?.slice(0, 30) ?? null);
    // The live instance may be mid-use: wait for a settled sidebar.
    let specs = [];
    for (let attempt = 0; attempt < 12 && !specs.some((s) => s.id === "sessions"); attempt++) {
      if (attempt > 0) await delay(5000);
      specs = await discover(page).catch(() => []);
    }
    const legs = {};
    for (let round = 0; round < SAMPLES; round++) {
      const roundLegs = await runRound(page, specs);
      for (const [k, v] of Object.entries(roundLegs)) (legs[k] ??= []).push(v);
    }
    // Leave the instance where it was found.
    const target = specs.find((s) => s.nav.name === initial) ?? specs[0];
    if (target) await clickNav(page, target.nav).catch(() => {});
    const metrics = Object.fromEntries(Object.entries(legs).map(([k, v]) => [k.startsWith("back:") ? k : `open:${k}`, summarize(v)]));
    const report = { app: "orca-drogon-reference", mode: MODE, startedAt, samples: SAMPLES, metrics };
    console.log(JSON.stringify(report, null, 2));
    if (OUT) await writeFile(path.resolve(OUT), JSON.stringify(report, null, 2) + "\n");
    await browser.close();
    return;
  }

  // MODE === "bundle": harness-owned lifecycle on an isolated data dir.
  const bundle = path.resolve(String(flag("bundle")));
  const dataDir = path.resolve(String(flag("data-dir", path.join("/tmp", "drogon-perf-data"))));
  const profileDir = path.resolve(String(flag("profile-dir", path.join("/tmp", "drogon-perf-profile"))));
  const cliBin = path.join(bundle, "Contents", "Resources", "bin", "drogon-cli");
  const fixtureOptions = {
    sessions: Number(flag("sessions-count", "6")),
    fixtureRepo: flag("fixture-repo", null) ? path.resolve(String(flag("fixture-repo"))) : null,
    workspace: flag("workspace", null) ? String(flag("workspace")) : null,
    worktreeName: flag("worktree-name", null) ? String(flag("worktree-name")) : null,
  };
  async function stopInstance(browser, pid) {
    await browser.close();
    await stopPid(pid);
    // Bundle mode never started a daemon of its own: the packaged app
    // bootstrapped its bundled one, so shut it down quiescently through
    // the same helper the sealed acceptance uses (stops live sessions,
    // asks for shutdown, kernel-verifies the exit).
    try {
      const fixture = packagedFixtureDaemon(null, cliBin, dataDir);
      await fixture.capture();
      await fixture.stop();
    } catch (error) {
      console.error(`daemon shutdown: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function setupInstance() {
    // Returns a connected { browser, page, pid } with live fixtures and a
    // selected worktree. Mid-startup creations can miss the sidebar digest
    // race, so a spawn that created anything restarts once (unmeasured)
    // before measuring.
    for (let attempt = 0; attempt < 2; attempt++) {
      const spawned = await spawnBundle(bundle, dataDir, profileDir);
      const connected = await connectEndpoint(spawned.endpoint);
      const fixtures = ensureFixtures(cliBin, dataDir, fixtureOptions, true);
      if (!fixtureOptions.worktreeName && fixtures.worktreeName) {
        fixtureOptions.worktreeName = fixtures.worktreeName;
      }
      const selected = await selectWorktree(connected.page, fixtureOptions.worktreeName);
      console.error(`fixtures: workspace=${fixtures.workspaceId} worktree=${fixtures.worktreeName} select=${selected} created=${fixtures.created}`);
      if (selected !== "no-card" || !fixtures.created) return { ...connected, pid: spawned.pid, fixtures };
      await stopInstance(connected.browser, spawned.pid);
    }
    throw new Error("worktree card never appeared after respawn");
  }

  const coldSamples = [];
  const coldBreakdowns = [];
  const legs = {};
  const tabSwitches = [];
  const propagations = [];
  let fixtures = null;
  // Setup spawn (unmeasured): live sessions for the interaction metrics.
  {
    const setup = await setupInstance();
    fixtures = setup.fixtures;
    try {
      for (let i = 0; i < 3; i++) {
        const switched = await measureTabSwitch(setup.page);
        console.error("tabswitch:", JSON.stringify(switched));
        tabSwitches.push(switched);
      }
      for (let i = 0; i < SAMPLES; i++) {
        if (i > 0) {
          await delay(5000);
          if (!(await waitForWorkingClear(setup.page))) {
            propagations.push({ ms: null, state: "no-decay", longtasks: { count: 0, total: 0, max: 0 } });
            continue;
          }
        }
        const propagated = await measureWorktreeCardUpdate(
          setup.page, cliBin, dataDir, fixtures.workspaceId, `perf-ping-${i}`,
        );
        console.error("card-update:", JSON.stringify(propagated));
        propagations.push(propagated);
        if (propagated.ms === null) break;
      }
    } finally {
      await stopInstance(setup.browser, setup.pid);
    }
  }
  for (let cold = 0; cold < SAMPLES; cold++) {
    const { pid, endpoint, ms, breakdown } = await spawnBundle(bundle, dataDir, profileDir);
    coldSamples.push(ms);
    if (breakdown) coldBreakdowns.push(breakdown);
    const { browser, page } = await connectEndpoint(endpoint);
    try {
      fixtures = ensureFixtures(cliBin, dataDir, fixtureOptions);
      if (!fixtureOptions.worktreeName && fixtures.worktreeName) fixtureOptions.worktreeName = fixtures.worktreeName;
      console.error(`fixtures: workspace=${fixtures.workspaceId} worktree=${fixtures.worktreeName} select=${await selectWorktree(page, fixtureOptions.worktreeName)}`);
      const specs = await discover(page);
      const roundLegs = await runRound(page, specs);
      for (const [k, v] of Object.entries(roundLegs)) (legs[k] ??= []).push(v);
    } finally {
      await stopInstance(browser, pid);
    }
  }
  const metrics = {
    "cold-start": {
      unit: "ms",
      samples: coldSamples,
      median: percentile([...coldSamples].sort((a, b) => a - b), 50),
      p95: percentile([...coldSamples].sort((a, b) => a - b), 95),
      breakdownMedian: coldBreakdowns[0] ?? null,
    },
    ...Object.fromEntries(Object.entries(legs).map(([k, v]) => [k.startsWith("back:") ? k : `open:${k}`, summarize(v)])),
    "switch:session-tab": summarize(tabSwitches),
    "update:worktree-card": summarize(propagations),
  };
  const report = { app: "drogon-bundle", mode: MODE, bundle, startedAt, samples: SAMPLES, fixtures, metrics };
  console.log(JSON.stringify(report, null, 2));
  if (OUT) await writeFile(path.resolve(OUT), JSON.stringify(report, null, 2) + "\n");
}

await main();

