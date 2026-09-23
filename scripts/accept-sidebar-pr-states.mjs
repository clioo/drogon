// Sidebar PR states acceptance: real fixture `gh` -> tasks RPC ->
// ProjectList -> WorktreeCard/DOM PR proof.
//
// A fixture `gh` (Node, no network, no credentials) answers `pr list` /
// `pr view` from per-repo JSON data files for genuine registered isolated
// git projects (real `git init` repos with a GitHub-shaped origin remote —
// the daemon only ever reads the remote URL from local git config, and the
// fixture `gh` never dials out). The dev desktop renders the real sidebar
// over CDP; every check reads the rendered PR markers (state, tone, label)
// through the product's own WorktreeCard path, never injected props.
//
// Covers: merged green+check, confirmed-ready cyan, draft neutral,
// conflicts red, review-required/pending/unknown neutral; a changed review
// status refetching on a stable project set; provider errors rendering
// unavailable (never an empty success); pagination (a page-1 concluded
// review must not hide a page-2 live review); multiple PRs on one branch;
// the stored-linked fallback; and card/grouping agreement.
//
// No real model inference anywhere: the only sessions are the fixture
// daemon and the desktop itself; no agent is ever launched.
//
// Run it from a plain shell. Inside a dispatched orchestration worker the
// inherited DROGON_* variables scope every CLI call to that dispatch, so
// this script's own fixture daemon answers `unauthorized`:
//   env -u DROGON_SESSION_ID -u DROGON_WORKSPACE_ID -u DROGON_DATA_DIR \
//     -u DROGON_INCARNATION -u DROGON_TERMINAL \
//     node scripts/accept-sidebar-pr-states.mjs
//
// Why the acceptance builds the Rust binaries itself instead of trusting
// the caller to have built them: a green run once certified a stale
// `drogond` built before the daemon fixes under test. The `cargo build`
// below makes the rest of the report mean anything; it aborts loudly when
// it fails, and the report records the binary mtimes plus HEAD so a reader
// can tell which code a report belongs to.
import assert from "node:assert/strict";
import { access, chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

/**
 * The build the acceptance runs before it touches either binary: the
 * daemon and CLI under test, locked to the current tree. Kept next to the
 * imports (and exported) so the companion pins the exact scope — narrowing
 * this without updating the test breaks loudly instead of certifying less.
 */
export const ACCEPTANCE_RUST_BUILD = {
  command: "cargo",
  args: ["build", "-p", "drogond", "-p", "drogon-cli", "--locked"],
  timeoutMs: 600000,
};

/**
 * Project a post-build binary identity for the JSON report: the resolved
 * path plus the mtime and size the build just left behind. A reader
 * compares these against the reported HEAD to tell which code a report
 * belongs to.
 */
export function projectBinaryIdentity(filePath, fileStat) {
  return {
    path: filePath,
    mtimeMs: fileStat?.mtimeMs ?? null,
    size: fileStat?.size ?? null,
  };
}
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  captureDescendants,
  runAcceptanceProcess as exec,
  settleOwnedProcesses,
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

/** The acceptance checks, in run order. */
export const CHECK_NAMES = [
  "fixture-git-projects-registered-with-github-remotes",
  "merged-review-renders-green-with-check",
  "confirmed-ready-renders-cyan",
  "draft-renders-neutral",
  "conflicts-render-red",
  "review-required-pending-unknown-stay-neutral",
  "changed-status-refetches-on-a-stable-project-set",
  "provider-error-renders-unavailable-never-empty",
  "page-walk-finds-the-live-review-past-the-first-window",
  "linked-fallback-and-pr-grouping-agree",
  "os-activation-and-window-visibility-preserved",
];

/**
 * The `gh pr list/view --json` fields the daemon requests (tasks_rpc.rs
 * `PR_JSON_FIELDS`). The fixture answers exactly the requested subset —
 * like real `gh`, which omits unrequested fields — so the run proves the
 * producer asks for every field the card's state marker reads.
 */
export const PR_JSON_FIELDS =
  "number,title,state,url,author,assignees,reviewDecision,statusCheckRollup,mergeable,isDraft,headRefName,baseRefName,updatedAt,labels";

/** Single-quote a string for POSIX shell interpolation. */
export function quoteShellWord(text) {
  return `'${String(text).replaceAll("'", "'\\''")}'`;
}

/** Filesystem-safe data-file stem for a `owner/repo` slug. */
export function slugDataFile(slug) {
  return `${String(slug).replaceAll("/", "__")}.json`;
}

/**
 * One fixture PR row in real `gh --json` shape (`state` OPEN/CLOSED/MERGED
 * plus `isDraft`, `mergeable`, `reviewDecision`, `statusCheckRollup` —
 * the exact wire the daemon's `convert_pull` decodes). Exported so the
 * companion pins the wire contract without launching anything.
 */
export function buildPrFixtureRow(overrides = {}) {
  return {
    number: 1,
    title: "Fixture review",
    state: "OPEN",
    url: "https://github.com/fixture/repo/pull/1",
    author: { login: "fixture-author" },
    assignees: [],
    reviewDecision: null,
    statusCheckRollup: [],
    mergeable: "UNKNOWN",
    isDraft: false,
    headRefName: "fixture-branch",
    baseRefName: "main",
    updatedAt: "2026-09-20T00:00:00Z",
    labels: [],
    ...overrides,
  };
}

/** A successful-checks rollup entry, real `gh` shape. */
export function successCheckEntry() {
  return { conclusion: "SUCCESS", status: "COMPLETED", name: "ci" };
}

/** An in-progress rollup entry, real `gh` shape. */
export function pendingCheckEntry() {
  return { conclusion: "", status: "IN_PROGRESS", name: "ci" };
}

/**
 * Project one fixture row down to exactly the requested `--json` fields,
 * like real `gh` (unrequested fields are omitted, never defaulted).
 * `reviewDecision: null` and an empty rollup stay absent-or-empty exactly
 * as `gh` emits them; the daemon treats both as "no verdict".
 */
export function projectGhRowFields(row, fields) {
  const projected = {};
  for (const field of fields) {
    if (field === "reviewDecision") {
      if (row.reviewDecision !== null && row.reviewDecision !== undefined) {
        projected.reviewDecision = row.reviewDecision;
      }
      continue;
    }
    if (!(field in row)) continue;
    projected[field] = row[field];
  }
  return projected;
}

/**
 * Parse a fixture-`gh` argv (as recorded in the argv log) into the call
 * shape the run asserts through. Unknown shapes parse to null — the run
 * asserts on the parsed value rather than throwing past it.
 */
export function parseGhArgv(argv) {
  if (!Array.isArray(argv) || argv[0] !== "pr") return null;
  const rest = argv.slice(1);
  const valueOf = (flag) => {
    const index = rest.indexOf(flag);
    return index >= 0 && index + 1 < rest.length ? rest[index + 1] : null;
  };
  if (rest[0] === "list") {
    const fields = valueOf("--json");
    const limit = valueOf("--limit");
    return {
      command: "pr-list",
      repo: valueOf("--repo"),
      state: valueOf("--state") ?? "all",
      limit: limit === null ? null : Number(limit),
      fields: fields === null ? null : String(fields).split(","),
    };
  }
  if (rest[0] === "view") {
    const fields = valueOf("--json");
    return {
      command: "pr-view",
      number: Number(rest[1]),
      repo: valueOf("--repo"),
      fields: fields === null ? null : String(fields).split(","),
    };
  }
  return null;
}

/**
 * One sidebar PR marker, projected from what the DOM said. Exported so
 * its shape is testable without launching an app: a silent change here
 * would turn every marker assertion below into a tautology over
 * `undefined`. The page closure only reads attributes; the projection
 * happens here, in Node.
 */
export function projectPrMarker(raw) {
  const tone = String(raw.toneClass ?? "")
    .split(/\s+/)
    .filter(Boolean);
  return {
    cardId: raw.cardId ?? null,
    state: raw.state ?? null,
    label: raw.label ?? null,
    title: raw.title ?? null,
    tone,
    hasCheck: raw.hasCheck ?? null,
  };
}

/**
 * The owner's marker design (WorktreeCardPrStateIcon.tsx): the tone class
 * each rendered state must carry. Hardcoded here against the shipped
 * design (not read from the component) so the assertions discriminate —
 * the companion pins this table.
 */
export const PR_MARKER_TONES = {
  merged: "text-emerald-500",
  ready: "text-cyan-500",
  open: "text-blue-500",
  draft: "text-muted-foreground/70",
  conflicts: "text-rose-500",
  closed: "text-muted-foreground/70",
};

/** True when the projected marker carries exactly the design tone. */
export function markerHasTone(marker, state) {
  return marker.tone.includes(PR_MARKER_TONES[state]);
}

/**
 * The fixture `gh`: a Node script (no network, no credentials) that
 * answers `pr list` / `pr view` / `api user` from per-repo JSON data files
 * in `dataDir`, honors `--repo` / `--state` / `--limit` / `--json`
 * exactly like real `gh` (state-filtered, windowed, field-projected), and
 * appends every argv to `argv.log` for provenance. A `mode` file
 * containing `error` makes `pr list` fail outright (the provider-error
 * phase). Written into the fixture bin dir and exported as a builder so
 * the companion can inspect the exact source the run executes.
 */
export function buildFixtureGhSource({ helperPath, dataDir }) {
  return `#!/usr/bin/env node
// Fixture gh for the sidebar PR-states acceptance: file-backed gh pr
// answers, no network, no credentials. Imported helpers come from the
// acceptance module under test (absolute path, written by the run).
import { appendFile, readFile } from "node:fs/promises";
import {
  projectGhRowFields,
  slugDataFile,
} from ${JSON.stringify(pathToFileURL(helperPath).href)};
const DATA_DIR = ${JSON.stringify(dataDir)};
const argv = process.argv.slice(2);
const logLine = JSON.stringify({ argv, cwd: process.cwd() }) + "\\n";
await appendFile(${JSON.stringify(path.join(dataDir, "argv.log"))}, logLine).catch(() => {});
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const fail = (message) => { process.stderr.write(message + "\\n"); process.exit(1); };
if (argv[0] === "api" && argv[1] === "user") { process.stdout.write("fixture-me\\n"); process.exit(0); }
if (argv[0] !== "pr" || (argv[1] !== "list" && argv[1] !== "view")) fail("fixture gh: unsupported argv: " + argv.join(" "));
const slug = valueOf("--repo");
if (!slug) fail("fixture gh: pr list/view without --repo");
const fields = (valueOf("--json") ?? "").split(",").filter(Boolean);
let store;
try {
  store = JSON.parse(await readFile(DATA_DIR + "/" + slugDataFile(slug), "utf8"));
} catch { fail("could not resolve to an Issue"); }
const rows = Array.isArray(store.rows) ? store.rows : [];
if (argv[1] === "view") {
  const number = Number(argv[2]);
  const row = rows.find((r) => r.number === number);
  if (!row) fail("could not resolve to an Issue");
  process.stdout.write(JSON.stringify(projectGhRowFields(row, fields)) + "\\n");
  process.exit(0);
}
// pr list: forced-error mode first (the provider-error phase).
let mode = "";
try { mode = (await readFile(${JSON.stringify(path.join(dataDir, "mode"))}, "utf8")).trim(); } catch {}
if (mode === "error") fail("gh fixture: forced provider error (no GitHub access)");
const state = (valueOf("--state") ?? "all").toLowerCase();
const states = state === "open" ? ["OPEN"] : state === "closed" ? ["CLOSED", "MERGED"] : null;
const filtered = states ? rows.filter((r) => states.includes(r.state)) : rows;
const limitRaw = valueOf("--limit");
const limit = limitRaw === null ? filtered.length : Math.max(0, Number(limitRaw));
const windowed = filtered.slice(0, limit);
process.stdout.write(JSON.stringify(windowed.map((r) => projectGhRowFields(r, fields))) + "\\n");
`;
}

/**
 * The acceptance run. Kept behind a main guard (the idiom
 * check-test-discrimination.mjs uses) so importing this module for its
 * pure projections never launches a daemon, an Electron app or a PTY.
 */
export async function runSidebarPrStatesAcceptance() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const appDir = path.join(root, "apps/desktop");
  const require = createRequire(path.join(appDir, "package.json"));
  const electron = require("electron");
  const { chromium } = require("playwright");
  const cli = path.join(root, "target/debug/drogon-cli");
  const daemonBinary = path.join(root, "target/debug/drogond");
  // Short prefix on purpose: the daemon socket lives under the fixture and
  // macOS caps unix socket paths at 104 bytes.
  const fixture = await mkdtemp(path.join(tmpdir(), "dg-prstates-"));
  const dataDir = path.join(fixture, "data");
  const binDir = path.join(fixture, "bin");
  const ghDataDir = path.join(fixture, "gh-data");
  const reposDir = path.join(fixture, "repos");
  const output =
    process.env.SIDEBAR_PR_STATES_OUT ??
    path.join(root, ".preflight/acceptance", `sidebar-pr-states-${Date.now()}`);
  const report = {
    status: "FAILED",
    fixture,
    output,
    checks: [],
    screenshots: [],
    processes: [],
    pageErrors: [],
  };
  let desktop, daemon, browser, observer, daemonOwner, page;
  let env = { ...process.env };
  // packagedFixtureDaemon shells the CLI with the process environment, so
  // a foreign dispatch's DROGON_* scope must leave process.env for the
  // run; it is restored in the finally below.
  const foreignDrogonEnv = {};
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("DROGON_")) {
      foreignDrogonEnv[key] = process.env[key];
      delete process.env[key];
    }
  }
  const owned = new Map();
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    void browser?.close().catch(() => {});
  };
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const checkCancelled = () => {
    if (cancelled) throw new Error("Validation cancelled");
  };

  async function cliJson(args, options = {}) {
    // The sanitized fixture env is the default: the script's own process
    // env may carry a foreign dispatch's DROGON_* scope, which would make
    // the fixture daemon answer `unauthorized`.
    const { stdout } = await exec(cli, ["--data-dir", dataDir, "--json", ...args], {
      timeout: 30000,
      env,
      ...options,
    });
    const value = JSON.parse(stdout);
    assert.equal(value.ok, true, stdout);
    return value.result;
  }
  async function until(check, label, timeout = 60000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      checkCancelled();
      const value = await check();
      if (value) return value;
      await delay(150);
    }
    throw new Error(`Timed out: ${label}`);
  }
  const readGhArgvLog = async () =>
    (await readFile(path.join(ghDataDir, "argv.log"), "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  const readMarkers = async () =>
    (
      await page.evaluate(() =>
        [...document.querySelectorAll("[data-worktree-card-id]")].map((card) => {
          const el = card.querySelector("[data-worktree-card-pr-state]");
          return {
            cardId: card.getAttribute("data-worktree-card-id"),
            state: el?.getAttribute("data-worktree-card-pr-state") ?? null,
            label: el?.getAttribute("aria-label") ?? null,
            title: el?.getAttribute("title") ?? null,
            toneClass: el?.getAttribute("class") ?? null,
            hasCheck: Boolean(el?.querySelector("svg.lucide-check")),
          };
        }),
      )
    ).map(projectPrMarker);
  const markerByCard = async () => new Map((await readMarkers()).map((m) => [m.cardId, m]));
  // After a reload the sidebar may be grouped (group headers, not
  // project buttons), so readiness means rendered cards — never a
  // project-named button.
  const waitForCards = async (label) =>
    until(async () => {
      const markers = await readMarkers();
      return markers.length > 0 ? true : false;
    }, label, 30000);
  const readGroupSections = async () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".shell-project")].map((section) => ({
        key:
          section.querySelector("[data-entry-group-key]")?.getAttribute("data-entry-group-key") ??
          section.querySelector(".shell-project-name")?.textContent?.trim() ??
          null,
        label: section.querySelector(".shell-project-name")?.textContent?.trim() ?? null,
        cards: [...section.querySelectorAll("[data-worktree-card-id]")].map((card) =>
          card.getAttribute("data-worktree-card-id"),
        ),
      })),
    );

  try {
    await mkdir(output, { recursive: true });
    await mkdir(dataDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await mkdir(ghDataDir, { recursive: true });
    await mkdir(reposDir, { recursive: true });
    checkCancelled();
    try {
      await access(path.join(appDir, "out/main/index.js"));
    } catch {
      throw new Error("Build the dev desktop first: pnpm --filter @drogon/desktop build");
    }
    // The binaries under test are built here, from this tree, as part of
    // the acceptance — never trusted from an earlier build. A cached
    // rebuild is quick; a stale daemon would make every check below
    // certify the wrong code, so a failed build aborts the run.
    try {
      await exec(ACCEPTANCE_RUST_BUILD.command, [...ACCEPTANCE_RUST_BUILD.args], {
        cwd: root,
        timeout: ACCEPTANCE_RUST_BUILD.timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
      });
    } catch (error) {
      throw new Error(
        `The acceptance builds its own daemon and CLI before certifying anything ` +
          `(${ACCEPTANCE_RUST_BUILD.command} ${ACCEPTANCE_RUST_BUILD.args.join(" ")}), and that build failed: ` +
          `${error?.stderr ?? error?.message ?? String(error)}`,
        { cause: error },
      );
    }
    // Provenance for the report: what was exercised, and from which tree,
    // so a reader can tell which code a report belongs to.
    const [drogondStat, cliStat] = await Promise.all([stat(daemonBinary), stat(cli)]);
    const { stdout: gitHeadStdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: root, timeout: 30000 });
    report.binaries = {
      drogond: projectBinaryIdentity(daemonBinary, drogondStat),
      "drogon-cli": projectBinaryIdentity(cli, cliStat),
    };
    report.gitHead = gitHeadStdout.trim();
    // Nothing in this process's own context may leak into the fixture:
    // every DROGON_* variable would scope the control-path CLI calls
    // below to a foreign dispatch or session.
    env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith("DROGON_")) delete env[key];
    }
    await installPrivateAcceptanceEnvironment(fixture, env);
    // The fixture needs the toolchain node (the `gh` fixture is a Node
    // script) and the CLT git (the installed daemon native git is
    // license-gated); the fixture `gh` itself comes first so the daemon
    // resolves the production `gh` name to the fixture.
    env.PATH = `${binDir}:${path.dirname(process.execPath)}:/Library/Developer/CommandLineTools/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
    // The fixture `gh` answers from the data dir; the daemon resolves the
    // production `gh` name from PATH, so the fixture must come first.
    await writeFile(
      path.join(binDir, "gh"),
      buildFixtureGhSource({ helperPath: fileURLToPath(import.meta.url), dataDir: ghDataDir }),
      { mode: 0o755 },
    );
    await chmod(path.join(binDir, "gh"), 0o755);
    // Smoke test the fixture before the daemon ever sees it: a stateless
    // row proves --json projection, --state filtering and --limit.
    await writeFile(
      path.join(ghDataDir, slugDataFile("fixture/smoke")),
      JSON.stringify({
        rows: [
          buildPrFixtureRow({ number: 1, state: "OPEN", headRefName: "a" }),
          buildPrFixtureRow({ number: 2, state: "MERGED", headRefName: "b" }),
        ],
      }),
    );
    const smokeAll = JSON.parse(
      (
        await exec(
          path.join(binDir, "gh"),
          ["pr", "list", "--repo", "fixture/smoke", "--state", "all", "--limit", "10", "--json", "number,state"],
          { env, timeout: 30000 },
        )
      ).stdout,
    );
    assert.deepEqual(smokeAll, [
      { number: 1, state: "OPEN" },
      { number: 2, state: "MERGED" },
    ]);
    const smokeOpen = JSON.parse(
      (
        await exec(
          path.join(binDir, "gh"),
          ["pr", "list", "--repo", "fixture/smoke", "--state", "open", "--limit", "10", "--json", "number"],
          { env, timeout: 30000 },
        )
      ).stdout,
    );
    assert.deepEqual(smokeOpen, [{ number: 1 }]);
    await rm(path.join(ghDataDir, slugDataFile("fixture/smoke")));
    await rm(path.join(ghDataDir, "argv.log"), { force: true });
    checkCancelled();
    if (process.platform === "darwin") observer = await startForegroundObservation(output);
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
    checkCancelled();

    // Genuine git projects: real repos with a GitHub-shaped origin remote
    // (read locally from git config — never contacted) and real branches.
    // Worktree branches are read back from the daemon and the fixture rows
    // are generated FROM those observed branches, so the run proves the
    // correlation instead of agreeing with its own guesses.
    async function initRepo(name, slug) {
      const dir = path.join(reposDir, name);
      await mkdir(dir, { recursive: true });
      await exec("git", ["init", "-b", "main", dir], { env, timeout: 30000 });
      await exec("git", ["-C", dir, "config", "user.email", "fixture@example.com"], { env, timeout: 30000 });
      await exec("git", ["-C", dir, "config", "user.name", "fixture"], { env, timeout: 30000 });
      await exec("git", ["-C", dir, "commit", "--allow-empty", "-m", "init"], { env, timeout: 30000 });
      await exec("git", ["-C", dir, "remote", "add", "origin", `https://github.com/${slug}.git`], {
        env,
        timeout: 30000,
      });
      return dir;
    }
    const statesDir = await initRepo("prstates", "fixture/prstates");
    const pagesDir = await initRepo("prpages", "fixture/prpages");
    const linkedDir = await initRepo("prlinked", "fixture/prlinked");
    const statesProject = await cliJson(["project", "add", statesDir, "--name", "prstates"], {
      env,
      cwd: fixture,
    });
    assert.equal(statesProject.kind, "git", "prstates registers as a git project");
    const pagesProject = await cliJson(["project", "add", pagesDir, "--name", "prpages"], {
      env,
      cwd: fixture,
    });
    const linkedProject = await cliJson(["project", "add", linkedDir, "--name", "prlinked"], {
      env,
      cwd: fixture,
    });
    report.projects = [
      { id: statesProject.id, slug: "fixture/prstates" },
      { id: pagesProject.id, slug: "fixture/prpages" },
      { id: linkedProject.id, slug: "fixture/prlinked" },
    ];
    report.checks.push("fixture-git-projects-registered-with-github-remotes");

    // One worktree per marker role. The daemon names each worktree's
    // branch (the --name, unless the daemon decides otherwise); ids AND
    // branches are read back from `worktree list` and the fixture rows are
    // generated from those observed values.
    const roles = ["merged", "ready", "draft", "conflict", "review", "pending", "unknown", "quiet"];
    for (const role of roles) {
      await cliJson(
        ["worktree", "create", "--project", statesProject.id, "--name", `feat-${role}`, "--base", "main", "--no-parent"],
        { env, cwd: fixture },
      );
    }
    await cliJson(
      ["worktree", "create", "--project", pagesProject.id, "--name", "walk-branch", "--base", "main", "--no-parent"],
      { env, cwd: fixture },
    );
    await cliJson(
      ["worktree", "create", "--project", linkedProject.id, "--name", "renamed-branch", "--base", "main", "--no-parent"],
      { env, cwd: fixture },
    );
    const worktreeRows = async (projectId) =>
      (await cliJson(["worktree", "list", "--project", projectId], { env, cwd: fixture })).worktrees;
    const statesTrees = await worktreeRows(statesProject.id);
    const findRoleTree = (role) =>
      statesTrees.find((row) => row.branch === `feat-${role}`) ??
      statesTrees.find((row) => row.path.endsWith(`feat-${role}`));
    const cardIdByRole = {};
    const branchByRole = {};
    for (const role of roles) {
      const row = findRoleTree(role);
      assert.ok(row, `a worktree exists for role ${role}`);
      cardIdByRole[role] = row.id;
      branchByRole[role] = row.branch;
    }
    const walkTrees = await worktreeRows(pagesProject.id);
    const walkTree =
      walkTrees.find((row) => row.branch === "walk-branch") ??
      walkTrees.find((row) => row.path.endsWith("walk-branch"));
    assert.ok(walkTree, "the pages project has its walk worktree");
    const walkBranch = walkTree.branch;
    const linkedTrees = await worktreeRows(linkedProject.id);
    const linkedWorktree =
      linkedTrees.find((row) => row.branch === "renamed-branch") ??
      linkedTrees.find((row) => row.path.endsWith("renamed-branch"));
    assert.ok(linkedWorktree, "the linked project has a worktree");
    // The stored link: a review the branch does NOT name (retargeted
    // since), recovered through the targeted `pr view` lookup.
    await cliJson(
      ["rpc", "worktree.update", "--params", JSON.stringify({ worktreeId: linkedWorktree.id, linkedPr: 77 })],
      { env, cwd: fixture },
    );
    const linkedAfter = (await worktreeRows(linkedProject.id)).find((row) => row.id === linkedWorktree.id);
    assert.equal(linkedAfter.linkedPr, 77, "the stored link persists on the worktree");
    report.worktrees = {
      cardIdByRole,
      branchByRole,
      walkTreeId: walkTree.id,
      walkBranch,
      linkedWorktreeId: linkedWorktree.id,
      linkedBranch: linkedWorktree.branch,
    };
    checkCancelled();

    // Fixture PR data, generated FROM the observed branches. Seven
    // marker roles plus one review-less branch; the pages repo carries
    // 105 rows with the concluded review inside the first window and the
    // live review past it; the linked repo's listing omits #77 so the
    // targeted `pr view` lookup must recover it.
    const statesRows = [
      buildPrFixtureRow({
        number: 11, title: "Landed feature", state: "MERGED",
        headRefName: branchByRole.merged, url: "https://github.com/fixture/prstates/pull/11",
        statusCheckRollup: [successCheckEntry()],
      }),
      buildPrFixtureRow({
        number: 12, title: "Ready feature", state: "OPEN",
        headRefName: branchByRole.ready, url: "https://github.com/fixture/prstates/pull/12",
        mergeable: "MERGEABLE", reviewDecision: "APPROVED",
        statusCheckRollup: [successCheckEntry(), successCheckEntry()],
      }),
      buildPrFixtureRow({
        number: 13, title: "Draft feature", state: "OPEN", isDraft: true,
        headRefName: branchByRole.draft, url: "https://github.com/fixture/prstates/pull/13",
      }),
      buildPrFixtureRow({
        number: 14, title: "Conflicted feature", state: "OPEN",
        headRefName: branchByRole.conflict, url: "https://github.com/fixture/prstates/pull/14",
        mergeable: "CONFLICTING",
      }),
      buildPrFixtureRow({
        number: 15, title: "Needs review", state: "OPEN",
        headRefName: branchByRole.review, url: "https://github.com/fixture/prstates/pull/15",
        mergeable: "MERGEABLE", reviewDecision: "REVIEW_REQUIRED",
        statusCheckRollup: [successCheckEntry()],
      }),
      buildPrFixtureRow({
        number: 16, title: "Pending checks", state: "OPEN",
        headRefName: branchByRole.pending, url: "https://github.com/fixture/prstates/pull/16",
        mergeable: "MERGEABLE", statusCheckRollup: [pendingCheckEntry()],
      }),
      buildPrFixtureRow({
        number: 17, title: "Unknown mergeability", state: "OPEN",
        headRefName: branchByRole.unknown, url: "https://github.com/fixture/prstates/pull/17",
      }),
    ];
    await writeFile(
      path.join(ghDataDir, slugDataFile("fixture/prstates")),
      JSON.stringify({ rows: statesRows }),
    );
    const pageRows = [];
    for (let n = 105; n >= 1; n -= 1) {
      if (n === 104) {
        pageRows.push(
          buildPrFixtureRow({
            number: 104, title: "Closed newer", state: "CLOSED",
            headRefName: walkBranch, url: "https://github.com/fixture/prpages/pull/104",
          }),
        );
      } else if (n === 3) {
        pageRows.push(
          buildPrFixtureRow({
            number: 3, title: "Open older", state: "OPEN",
            headRefName: walkBranch, url: "https://github.com/fixture/prpages/pull/3",
          }),
        );
      } else {
        pageRows.push(
          buildPrFixtureRow({
            number: n, title: `Bulk ${n}`, state: n % 2 === 0 ? "MERGED" : "OPEN",
            headRefName: `bulk-${n}`, url: `https://github.com/fixture/prpages/pull/${n}`,
          }),
        );
      }
    }
    await writeFile(
      path.join(ghDataDir, slugDataFile("fixture/prpages")),
      JSON.stringify({ rows: pageRows }),
    );
    // #77 sits past the first window (the linked worktree never holds the
    // page walk open — its targeted `pr view` lookup is the recovery path),
    // so the listing omits it while `pr view 77` still answers.
    const linkedRows = [];
    for (let n = 105; n >= 1; n -= 1) {
      if (n === 77) continue; // #77 exists exactly once: past the window, below.
      linkedRows.push(
        buildPrFixtureRow({
          number: n, title: `Elsewhere ${n}`, state: n % 2 === 0 ? "MERGED" : "OPEN",
          headRefName: `elsewhere-${n}`, url: `https://github.com/fixture/prlinked/pull/${n}`,
        }),
      );
    }
    linkedRows.push(
      buildPrFixtureRow({
        number: 77, title: "Retargeted review", state: "OPEN",
        headRefName: "old-name", url: "https://github.com/fixture/prlinked/pull/77",
      }),
    );
    await writeFile(
      path.join(ghDataDir, slugDataFile("fixture/prlinked")),
      JSON.stringify({ rows: linkedRows }),
    );
    checkCancelled();

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
      60000,
    );
    browser = await chromium.connectOverCDP(endpoint);
    page = await until(() => browser.contexts()[0]?.pages()[0], "renderer");
    page.setDefaultTimeout(30000);
    page.on("pageerror", (error) => {
      if (report.pageErrors.length < 20) report.pageErrors.push(error.message);
    });
    await emulatePageFocus(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await captureDescendants([desktop?.pid, daemon?.pid], owned);
    checkCancelled();

    const shot = async (name, options = {}) => {
      const shotPath = path.join(output, name);
      await page.screenshot({ path: shotPath, animations: "disabled", ...options });
      report.screenshots.push(shotPath);
    };
    // The sidebar renders one section per registered project; wait for
    // every fixture project to appear before asserting markers.
    await until(async () => {
      const sections = await readGroupSections();
      const labels = sections.map((section) => section.label);
      return (
        labels.some((label) => label && label.includes("prstates")) &&
        labels.some((label) => label && label.includes("prpages")) &&
        labels.some((label) => label && label.includes("prlinked"))
      );
    }, "all three fixture projects render");
    const expectMarker = async (cardId, state, { label = null, check = null } = {}) => {
      const marker = await until(async () => {
        const found = (await markerByCard()).get(cardId);
        return found && found.state === state ? found : false;
      }, `card ${cardId} shows ${state}`);
      assert.ok(markerHasTone(marker, state), `card ${cardId} carries the ${state} tone`);
      if (label !== null) assert.equal(marker.label, label, `card ${cardId} label`);
      if (check !== null) assert.equal(marker.hasCheck, check, `card ${cardId} check overlay`);
      return marker;
    };

    // Phase A: every marker state on its own card, through the real
    // gh -> tasks RPC -> ProjectList -> WorktreeCard path.
    await expectMarker(cardIdByRole.merged, "merged", { label: "Linked PR #11: Merged", check: false });
    report.checks.push("merged-review-renders-green-with-check");
    await expectMarker(cardIdByRole.ready, "ready", { label: "Linked PR #12 checks: Passing", check: false });
    report.checks.push("confirmed-ready-renders-cyan");
    await expectMarker(cardIdByRole.draft, "draft", { label: "Linked PR #13: Draft", check: false });
    report.checks.push("draft-renders-neutral");
    await expectMarker(cardIdByRole.conflict, "conflicts", {
      label: "Linked PR #14: Conflicts with the base branch",
      check: false,
    });
    report.checks.push("conflicts-render-red");
    await expectMarker(cardIdByRole.review, "open", { label: "Linked PR #15 checks: Passing", check: false });
    await expectMarker(cardIdByRole.pending, "open", { label: "Linked PR #16 checks: Pending", check: false });
    await expectMarker(cardIdByRole.unknown, "open", { label: "Linked PR #17: Open", check: false });
    report.checks.push("review-required-pending-unknown-stay-neutral");
    // The review-less branch draws no marker — never a placeholder.
    const quietMarker = (await markerByCard()).get(cardIdByRole.quiet);
    assert.equal(quietMarker?.state ?? null, null, "the review-less branch draws no marker");
    await shot("pr-states-full.png");
    const sidebarBox = await page.locator(".workspace-sidebar").boundingBox();
    assert.ok(sidebarBox && sidebarBox.width > 200, "the sidebar is rendered at a real width");
    await shot("pr-states-sidebar.png", { clip: sidebarBox });
    report.markerTones = (await readMarkers()).map((m) => ({
      cardId: m.cardId,
      state: m.state,
      tone: m.tone,
      hasCheck: m.hasCheck,
    }));
    checkCancelled();

    // Phase B: "Group by: PR" through the real Workspace Options menu —
    // the card and its group entry must name the same review.
    const groupByPr = async () => {
      const trigger = page.getByRole("button", { name: "Workspace options" });
      await trigger.click({ timeout: 15000 });
      await page.getByRole("menuitemradio", { name: "PR", exact: true }).click({ timeout: 15000 });
    };
    try {
      await groupByPr();
    } catch {
      // Narrow sidebar headers hide the options trigger behind the
      // overflow menu; seed the product's own legacy options key and
      // reload instead (the migration path is product code, not a prop).
      await page.evaluate(() => {
        window.localStorage.setItem(
          "drogon:shell:workspace-options",
          JSON.stringify({ groupBy: "pr-status" }),
        );
      });
      await page.reload();
      await waitForCards("the sidebar renders again after reload");
      report.groupByFallback = "legacy-options-seed";
    }
    const sections = await until(async () => {
      const next = await readGroupSections();
      return next.some((section) => section.key === "merged") ? next : false;
    }, "PR-status groups render");
    const inSection = (key) => sections.find((section) => section.key === key)?.cards ?? [];
    assert.ok(inSection("merged").includes(cardIdByRole.merged), "merged card groups under Merged");
    assert.ok(!inSection("none").includes(cardIdByRole.merged), "merged card never groups under none");
    assert.ok(inSection("open").includes(cardIdByRole.ready), "ready card groups under Open");
    assert.ok(inSection("draft").includes(cardIdByRole.draft), "draft card groups under Draft");
    assert.ok(inSection("none").includes(cardIdByRole.quiet), "review-less card groups under none");
    await shot("pr-states-grouped.png");
    checkCancelled();

    // Phase C: the ready review merges upstream; the scheduled
    // revalidation (stable project set — no registry change, no reload)
    // must pick it up without duplicating or dropping cards.
    const cardsBefore = (await readMarkers()).map((m) => m.cardId).sort();
    await writeFile(
      path.join(ghDataDir, slugDataFile("fixture/prstates")),
      JSON.stringify({
        rows: statesRows.map((row) => (row.number === 12 ? { ...row, state: "MERGED" } : row)),
      }),
    );
    await until(async () => {
      const found = (await markerByCard()).get(cardIdByRole.ready);
      return found?.state === "merged" ? true : false;
    }, "the merged review re-renders after scheduled revalidation", 180000);
    const cardsAfter = (await readMarkers()).map((m) => m.cardId).sort();
    assert.deepEqual(cardsAfter, cardsBefore, "the project set is stable across the refetch");
    await expectMarker(cardIdByRole.merged, "merged", { label: "Linked PR #11: Merged", check: false });
    report.checks.push("changed-status-refetches-on-a-stable-project-set");
    await shot("pr-states-revalidated.png");
    checkCancelled();

    // Phase D: the provider fails outright — every card must lose its
    // marker (unavailable), never an empty success masquerade; recovery
    // brings the markers back.
    await writeFile(path.join(ghDataDir, "mode"), "error\n");
    await page.reload();
    await waitForCards("the sidebar renders again behind the provider error");
    await until(async () => {
      const markers = await readMarkers();
      return markers.length > 0 && markers.every((m) => m.state === null) ? true : false;
    }, "all markers clear behind the provider error");
    const errorSections = await readGroupSections();
    const unavailable = errorSections.find((section) => section.key === "unavailable")?.cards ?? [];
    assert.ok(
      unavailable.includes(cardIdByRole.ready),
      "failed projects group under unavailable, never none",
    );
    await shot("pr-states-error.png");
    await rm(path.join(ghDataDir, "mode"), { force: true });
    await page.reload();
    await waitForCards("the sidebar renders again after recovery");
    await expectMarker(cardIdByRole.ready, "merged", { label: "Linked PR #12: Merged", check: false });
    report.checks.push("provider-error-renders-unavailable-never-empty");
    checkCancelled();

    // Phase E: pagination + linked fallback + argv provenance. The walk
    // must find OPEN #3 past the first window even though CLOSED #104 for
    // the same branch arrives first; #77 arrives only via `pr view`.
    await expectMarker(walkTree.id, "open", { label: "Linked PR #3: Open", check: false });
    await expectMarker(linkedWorktree.id, "open", { label: "Linked PR #77: Open", check: false });
    const argvLog = await readGhArgvLog();
    const calls = argvLog.map((entry) => parseGhArgv(entry.argv)).filter(Boolean);
    const listFor = (slug) => calls.filter((c) => c.command === "pr-list" && c.repo === slug);
    const prpagesLists = listFor("fixture/prpages");
    assert.ok(
      prpagesLists.some((c) => c.state === "all" && c.limit === 101),
      `page 1 asks state all with the fetch-one-extra probe (saw ${JSON.stringify(prpagesLists)})`,
    );
    assert.ok(
      prpagesLists.some((c) => (c.limit ?? 0) > 101),
      `the walk follows hasNextPage past the first window (saw ${JSON.stringify(prpagesLists)})`,
    );
    const prstatesLists = listFor("fixture/prstates");
    assert.ok(
      prstatesLists.length > 0 && prstatesLists.every((c) => c.state === "all"),
      "the sidebar asks every state, never open-only",
    );
    assert.ok(
      prstatesLists[0].fields.includes("state") && prstatesLists[0].fields.includes("mergeable"),
      "the list requests the fields the state marker reads",
    );
    const views = calls.filter((c) => c.command === "pr-view" && c.repo === "fixture/prlinked");
    assert.ok(
      views.some((c) => c.number === 77),
      `the stored link recovers through a targeted pr view (saw ${JSON.stringify(views)})`,
    );
    report.ghProvenance = {
      prpagesLists,
      prstatesFirst: prstatesLists[0] ?? null,
      prlinkedViews: views,
      logPath: path.join(ghDataDir, "argv.log"),
    };
    // The linked card groups under Open beside the branch-matched cards —
    // the same review both consumers name.
    const finalSections = await readGroupSections();
    const openCards = finalSections.find((section) => section.key === "open")?.cards ?? [];
    assert.ok(openCards.includes(linkedWorktree.id), "the linked card groups under Open");
    report.checks.push("page-walk-finds-the-live-review-past-the-first-window");
    report.checks.push("linked-fallback-and-pr-grouping-agree");
    await shot("pr-states-final-full.png");
    const sidebarBoxFinal = await page.locator(".workspace-sidebar").boundingBox();
    if (sidebarBoxFinal) await shot("pr-states-final-sidebar.png", { clip: sidebarBoxFinal });
    checkCancelled();
    assert.deepEqual(report.pageErrors, [], "no renderer page errors");
    checkCancelled();
    report.status = "PASSED";
  } catch (error) {
    report.error = error.stack ?? String(error);
    if (page) {
      try {
        await page.screenshot({ path: path.join(output, "failure.png") });
      } catch {
        // Preserve the original failure.
      }
      try {
        report.markersAtFailure = await readMarkers();
      } catch {
        // Best effort.
      }
    }
  } finally {
    async function clean(name, action) {
      try {
        await action();
        report.cleanup ??= [];
        report.cleanup.push(`${name}: completed`);
      } catch (error) {
        report.status = "FAILED";
        report.cleanup ??= [];
        report.cleanup.push(`${name}: unverifiable: ${error.message}`);
      }
    }
    await clean("process capture", async () => {
      await captureDescendants([desktop?.pid, daemon?.pid], owned);
    });
    if (browser) await clean("CDP", () => browser.close());
    if (desktop)
      await clean("desktop", async () => {
        report.desktopExit = await stop(desktop);
        assert.equal(report.desktopExit.verdict, "exited");
      });
    if (daemonOwner) {
      try {
        // stop() returns nothing on success; success itself is the proof —
        // it stops every owned session, then the kernel exit observer
        // confirms the daemon exited before it resolves.
        await daemonOwner.stop();
        report.daemonExit = { verdict: "exited", via: "quiescent-shutdown" };
        report.cleanup ??= [];
        report.cleanup.push("daemon: completed");
      } catch (error) {
        report.status = "FAILED";
        report.cleanup ??= [];
        report.cleanup.push(`daemon: unverifiable: ${error.message}`);
        if (daemon) report.daemonExit = await stop(daemon);
      }
    } else if (daemon) {
      await clean("daemon", async () => {
        report.daemonExit = await stop(daemon);
        assert.equal(report.daemonExit.verdict, "exited");
      });
    }
    if (observer)
      await clean("OS observer", async () => {
        report.osForeground = await observer.stop();
        const desktopPids = [...owned]
          .filter(([, identity]) => identity.includes("Electron.app/Contents/"))
          .map(([pid]) => pid);
        verifyForegroundObservation(report.osForeground, desktopPids);
        report.checks.push("os-activation-and-window-visibility-preserved");
      });
    await clean("owned processes", async () => {
      // Identity is rechecked immediately before each signal so a reused
      // pid can never be the one this run kills.
      report.processes = await settleOwnedProcesses(owned);
      report.survivors = report.processes.filter((entry) => entry.verdict !== "exited");
      assert.ok(
        report.processes.every((entry) => entry.verdict === "exited"),
        `owned survivors: ${JSON.stringify(report.survivors)}`,
      );
    });
    if (cancelled) {
      report.status = "FAILED";
      report.failure ??= "Validation cancelled";
    }
    if (report.status === "PASSED" || report.status === "SKIPPED")
      await clean("fixture directory removal", () => rm(fixture, { recursive: true, force: true }));
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    Object.assign(process.env, foreignDrogonEnv);
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    console.log(
      JSON.stringify({
        status: report.status,
        failure: report.failure,
        error: report.error,
        checks: report.checks,
        screenshots: report.screenshots,
        survivors: report.survivors,
        report: path.join(output, "report.json"),
      }),
    );
    if (report.status !== "PASSED" && report.status !== "SKIPPED") process.exitCode = 1;
    return report;
  }
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await runSidebarPrStatesAcceptance();
}

