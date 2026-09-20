// Issue #622, part C: end-to-end acceptance for the 3-level sidebar agent tree.
//
// Real dev desktop + real fixture daemon over CDP. In a FOLDER workspace a
// plain shell session execs a fixture `claude` binary (an agent started
// inside an existing shell session); that agent spawns a subagent the same
// way, which spawns its own. The sidebar must show the 3-level tree rooted
// at the main agent, collapse/expand must work at every level and persist,
// and the root row must read the agent, not `Terminal 1 - zsh`.
//
// The fixture agent is a tiny C program compiled with `cc` into a temp bin
// directory under `versions/<n>` and symlinked as `claude` (a
// `sleep(argv[1])` program) — the owner's real version-directory install
// shape, where the canonical executable basename is a version number and
// only the process's own `argv[0]` names the harness. A shell script named
// `claude` does NOT work (the kernel execs the interpreter, so the path
// resolves to `/bin/sh`, and shells are deliberately not argv-scanned),
// and a copy of a system binary does NOT work either (macOS SIGKILLs
// ad-hoc copies of signed platform binaries). Without `cc` the run skips
// with a clear message, never a silent pass.
//
// No real model inference anywhere in this script: every level is the
// compiled sleeper, and the orchestration worker uses a fixture `pi` shell
// script that only sleeps.
//
// Run it from a plain shell. Inside a dispatched orchestration worker the
// inherited DROGON_* variables scope every CLI call to that dispatch, so
// this script's own fixture daemon answers `unauthorized`:
//   env -u DROGON_SESSION_ID -u DROGON_WORKSPACE_ID -u DROGON_DATA_DIR \
//     -u DROGON_INCARNATION -u DROGON_TERMINAL \
//     node scripts/accept-sidebar-agent-tree.mjs
import assert from "node:assert/strict";
import { access, chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
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

/** The nine named checks from the issue, in acceptance order. */
export const CHECK_NAMES = [
  "folder-workspace-hosts-the-agent-session",
  "daemon-observes-the-agent-started-inside-a-shell",
  "root-row-reads-the-agent-not-terminal-1-zsh",
  "sidebar-shows-a-three-level-tree",
  "collapsing-the-root-hides-both-descendants",
  "collapsing-depth-two-keeps-depth-one-visible",
  "the-fold-survives-a-reload",
  "expanding-restores-the-whole-path",
  "orchestration-worker-nests-under-the-session-that-started-it",
];

/** localStorage key holding the persisted lineage folds (see
 *  worktree-card-agents-expansion-state.ts). */
export const COLLAPSE_STORAGE_KEY = "drogon:shell:collapsed-lineage-parents";

/** The C source of the fixture agent: a real binary named `claude` that
 *  sleeps `argv[1]` seconds, so the daemon's foreground observation names
 *  it directly. */
export const TIMED_SLEEPER_C_SOURCE =
  "#include <stdlib.h>\n" +
  "#include <unistd.h>\n" +
  "int main(int argc, char **argv) { unsigned s = argc > 1 ? (unsigned)atoi(argv[1]) : 8; sleep(s); return 0; }\n";

/** Single-quote a string for POSIX shell interpolation. */
export function quoteShellWord(text) {
  return `'${String(text).replaceAll("'", "'\\''")}'`;
}

/**
 * One sidebar agent-tree row, projected from what the DOM said. Exported so
 * its shape is testable without launching an app: a silent change here
 * would turn every tree assertion below into a tautology over `undefined`.
 *
 * The page closure only reads attributes; the projection happens here, in
 * Node: the packaged renderer ships `script-src 'self'` and rejects string
 * evaluation, so a page closure can never call an imported helper.
 */
export function projectAgentTreeRow(raw) {
  const level = raw.level === null || raw.level === undefined ? null : Number(raw.level);
  const depth = raw.depth === null || raw.depth === undefined ? null : Number(raw.depth);
  return {
    sessionId: raw.sessionId ?? null,
    cardId: raw.cardId ?? null,
    level: Number.isSafeInteger(level) ? level : null,
    depth: Number.isSafeInteger(depth) ? depth : null,
    expanded: raw.expanded ?? null,
    text: raw.text ?? null,
    hasTerminalSvg: raw.hasTerminalSvg ?? null,
    identityTitle: raw.identityTitle ?? null,
  };
}

/**
 * Parse the persisted lineage-fold envelope: the raw localStorage string
 * for {@link COLLAPSE_STORAGE_KEY}, a plain object of worktree id to
 * string-id arrays. Anything else (missing, corrupt JSON, wrong shape)
 * parses to null — collapse state is cosmetic, so the script asserts on
 * the parsed value rather than throwing past it.
 */
export function parseCollapsedLineageEnvelope(raw) {
  if (typeof raw !== "string" || raw === "") return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const folds = {};
  for (const [worktreeId, ids] of Object.entries(parsed)) {
    if (typeof worktreeId !== "string" || worktreeId === "") continue;
    if (!Array.isArray(ids)) continue;
    const clean = [...new Set(ids.filter((id) => typeof id === "string" && id !== ""))];
    if (clean.length === 0) continue;
    folds[worktreeId] = clean;
  }
  return folds;
}

/** A daemon session row whose only harness identity is the observed agent:
 *  launched as a plain shell, now foregrounding the fixture. */
export function isObservedClaudeSession(row) {
  return (row?.harnessId ?? null) === null && row?.observedHarnessId === "claude";
}

/** The root row names the agent instead of the shell it started as. */
export function rootRowTextIsAgentNotTerminal(text) {
  const value = String(text ?? "");
  return value.includes("Claude") && !/Terminal \d/.test(value) && !value.includes("zsh");
}

/**
 * The acceptance run. Kept behind a main guard (the idiom
 * check-test-discrimination.mjs uses) so importing this module for its
 * pure projections never launches a daemon, an Electron app or a PTY.
 */
export async function runSidebarAgentTreeAcceptance() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const appDir = path.join(root, "apps/desktop");
  const require = createRequire(path.join(appDir, "package.json"));
  const electron = require("electron");
  const { chromium } = require("playwright");
  const cli = path.join(root, "target/debug/drogon-cli");
  const daemonBinary = path.join(root, "target/debug/drogond");
  // Short prefix on purpose: the daemon socket lives under the fixture and
  // macOS caps unix socket paths at 104 bytes.
  const fixture = await mkdtemp(path.join(tmpdir(), "dg-622-"));
  const dataDir = path.join(fixture, "data");
  const projectDir = path.join(fixture, "agenttree");
  const binDir = path.join(fixture, "bin");
  const output =
    process.env.SIDEBAR_AGENT_TREE_OUT ??
    path.join(root, ".preflight/acceptance", `sidebar-agent-tree-${Date.now()}`);
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

  async function processRows() {
    const { stdout } = await exec("/bin/ps", ["-axo", "pid=,ppid=,lstart=,command="]);
    return stdout
      .trim()
      .split("\n")
      .map((line) => {
        const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*)$/);
        return m && { pid: Number(m[1]), parent: Number(m[2]), identity: `${m[3]} ${m[4]}` };
      })
      .filter(Boolean);
  }
  // Descendants are captured while their parents are still alive: a passing
  // check never proves a PTY exited.
  async function captureChildren() {
    const rows = await processRows();
    const parents = new Set(
      [desktop?.pid, daemon?.pid, ...owned.keys()].filter(Boolean),
    );
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
  const exists = (file) => access(file).then(() => true, () => false);
  const readAgentTree = async () =>
    (
      await page.evaluate(() =>
        [...document.querySelectorAll('[role="treeitem"]')].map((node) => ({
          sessionId:
            node.querySelector("[data-worktree-agent-row]")?.getAttribute("data-worktree-agent-row") ?? null,
          cardId: node.closest("[data-worktree-card-id]")?.getAttribute("data-worktree-card-id") ?? null,
          level: node.getAttribute("aria-level"),
          depth: node.getAttribute("data-lineage-depth"),
          expanded: node.getAttribute("aria-expanded"),
          text: (node.textContent ?? "").slice(0, 200),
          hasTerminalSvg: Boolean(node.querySelector("svg.lucide-terminal")),
          identityTitle:
            node.querySelector("[data-worktree-agent-row] span[title]")?.getAttribute("title") ?? null,
        })),
      )
    ).map(projectAgentTreeRow);
  const disclosureFor = (sessionId) =>
    page.locator(`[data-worktree-agent-row="${sessionId}"]`).locator('button[aria-label*="child agent"]');
  const readCollapseEnvelope = async () =>
    parseCollapsedLineageEnvelope(
      await page.evaluate((key) => window.localStorage.getItem(key), COLLAPSE_STORAGE_KEY),
    );

  try {
    await mkdir(output, { recursive: true });
    await mkdir(projectDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    try {
      await exec("cc", ["--version"]);
    } catch {
      report.status = "SKIPPED";
      report.skipReason =
        "cc is unavailable, so the real `claude` fixture binary cannot be compiled; a shell script or copied binary would not be observed (see header).";
      return report;
    }
    checkCancelled();
    // The real fixture agent: a compiled binary under `versions/<n>`,
    // symlinked as `claude` — the owner's real install shape, where the
    // canonical executable basename is a version number and only the
    // process's own `argv[0]` names the harness. Every reference below
    // keeps execing the `claude` symlink path, so the acceptance proves
    // that shape instead of agreeing with a natively-named binary.
    const versionsDir = path.join(binDir, "versions");
    await mkdir(versionsDir, { recursive: true });
    await writeFile(path.join(versionsDir, "9.9.9.c"), TIMED_SLEEPER_C_SOURCE);
    await exec("cc", ["-O2", "-o", path.join(versionsDir, "9.9.9"), path.join(versionsDir, "9.9.9.c")]);
    await rm(path.join(versionsDir, "9.9.9.c"));
    await chmod(path.join(versionsDir, "9.9.9"), 0o755);
    await symlink(path.join(versionsDir, "9.9.9"), path.join(binDir, "claude"));
    // The orchestration worker's harness: a fixture that only sleeps, so
    // the worker-start check proves lineage with no model inference.
    await writeFile(path.join(binDir, "pi"), "#!/bin/sh\nsleep 120\n");
    await chmod(path.join(binDir, "pi"), 0o755);
    try {
      await access(path.join(appDir, "out/main/index.js"));
    } catch {
      throw new Error("Build the dev desktop first: pnpm --filter @drogon/desktop build");
    }
    // Nothing in this process's own context may leak into the fixture:
    // every DROGON_* variable (session, workspace, dispatch, run, data
    // dir, incarnation, terminal) would scope the control-path CLI calls
    // below to a foreign dispatch or session. Only the real session PTYs
    // carry those variables, via the daemon's own exports.
    env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith("DROGON_")) delete env[key];
    }
    await installPrivateAcceptanceEnvironment(fixture, env);
    env.PATH = `${binDir}:/usr/bin:/bin:/usr/sbin:/sbin`;
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

    // A plain folder registered as a project: the sidebar renders one
    // folder card whose implicit worktree owns the agent sessions.
    const project = await cliJson(["project", "add", projectDir, "--name", "agenttree"], {
      env,
      cwd: fixture,
    });
    assert.equal(project.kind, "folder", "the acceptance workspace is a folder project");
    const trees = await cliJson(["worktree", "list", "--project", project.id], { env, cwd: fixture });
    assert.equal(trees.worktrees.length, 1, "a folder project has exactly its implicit worktree");
    const worktreeId = trees.worktrees[0].id;
    const workspaceId = trees.worktrees[0].workspaceId;
    report.projectId = project.id;
    report.worktreeId = worktreeId;
    report.workspaceId = workspaceId;

    // Level 1 (root): a plain shell session, exactly the issue's case of an
    // agent started inside an existing shell session.
    const level1 = await cliJson(["terminal", "create", "--workspace", workspaceId, "--", "/bin/sh"], {
      env,
      cwd: fixture,
    });
    assert.equal(level1.harnessId ?? null, null, "the root starts as a plain shell");
    report.level1SessionId = level1.id;
    // Level 3 execs the fixture straight away; level 2 spawns level 3 the
    // honest way — `terminal create` from inside its own PTY, so the daemon
    // records the creator as `parentSessionId` from the inherited
    // DROGON_SESSION_ID — and then becomes the fixture itself. No
    // --data-dir and no --workspace flag: the lineage rides the same
    // inherited PTY env a real fan-out has, never anything this probe
    // hands in.
    const level3Script = path.join(fixture, "level3.sh");
    await writeFile(level3Script, `#!/bin/sh\nexec ${quoteShellWord(path.join(binDir, "claude"))} 600\n`);
    await chmod(level3Script, 0o755);
    const level2Script = path.join(fixture, "level2.sh");
    await writeFile(
      level2Script,
      [
        "#!/bin/sh",
        `${quoteShellWord(cli)} --json terminal create --workspace "$DROGON_WORKSPACE_ID" -- /bin/sh ${quoteShellWord(level3Script)} > ${quoteShellWord(path.join(fixture, "level3.json"))} 2> ${quoteShellWord(path.join(fixture, "level3.err"))}`,
        `exec ${quoteShellWord(path.join(binDir, "claude"))} 600`,
      ].join("\n") + "\n",
    );
    await chmod(level2Script, 0o755);
    // ONE line into the root's PTY: spawn level 2, then `exec` the fixture
    // so the session leader itself becomes the `claude` binary.
    await cliJson(
      [
        "terminal",
        "send",
        "--session",
        level1.id,
        "--incarnation",
        level1.incarnation,
        "--text",
        `${quoteShellWord(cli)} --json terminal create --workspace "$DROGON_WORKSPACE_ID" -- /bin/sh ${quoteShellWord(level2Script)} > ${quoteShellWord(path.join(fixture, "level2.json"))} 2> ${quoteShellWord(path.join(fixture, "level2.err"))}; exec ${quoteShellWord(path.join(binDir, "claude"))} 600\n`,
      ],
      { env, cwd: fixture },
    );
    const sessionRow = async (id) =>
      (await cliJson(["rpc", "session.list", "--params", "{}"])).sessions.find((row) => row.id === id) ?? null;
    // The observation memoizes for ~1s per session, so this poll always
    // reads past the TTL before concluding anything.
    const lineage = await until(async () => {
      const [l1, l2id, l3id] = await (async () => {
        let second = null;
        let third = null;
        try {
          second = JSON.parse(await readFile(path.join(fixture, "level2.json"), "utf8")).result.id;
          third = JSON.parse(await readFile(path.join(fixture, "level3.json"), "utf8")).result.id;
        } catch {
          return [null, null, null];
        }
        return [level1.id, second, third];
      })();
      if (!l2id || !l3id) return false;
      const rows = await Promise.all([sessionRow(level1.id), sessionRow(l2id), sessionRow(l3id)]);
      if (rows.some((row) => !row || !isObservedClaudeSession(row))) return false;
      return { l1: rows[0], l2: rows[1], l3: rows[2] };
    }, "three-level observed chain level1 -> level2 -> level3");
    assert.equal(lineage.l2.parentSessionId, level1.id, "level 2 nests under the session that started it");
    assert.equal(lineage.l3.parentSessionId, lineage.l2.id, "level 3 nests under the session that started it");
    assert.equal(lineage.l1.parentSessionId ?? null, null, "the root stays parentless");
    report.level2SessionId = lineage.l2.id;
    report.level3SessionId = lineage.l3.id;
    report.lineage = {
      level1: { id: lineage.l1.id, harnessId: lineage.l1.harnessId, observedHarnessId: lineage.l1.observedHarnessId },
      level2: { id: lineage.l2.id, parentSessionId: lineage.l2.parentSessionId, observedHarnessId: lineage.l2.observedHarnessId },
      level3: { id: lineage.l3.id, parentSessionId: lineage.l3.parentSessionId, observedHarnessId: lineage.l3.observedHarnessId },
    };
    const l1id = level1.id;
    const l2id = lineage.l2.id;
    const l3id = lineage.l3.id;

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
    page.on("pageerror", (error) => {
      if (report.pageErrors.length < 20) report.pageErrors.push(error.message);
    });
    await emulatePageFocus(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await captureChildren();
    checkCancelled();

    await page.getByRole("button", { name: "Select agenttree", exact: true }).waitFor();
    const registered = (await cliJson(["rpc", "workspace.list", "--params", "{}"])).workspaces;
    const folderWorkspace = registered.find((workspace) => workspace.id === workspaceId);
    assert.equal(folderWorkspace?.kind, "folder", "the agent session lives in a registered folder workspace");
    assert.equal((await sessionRow(l1id))?.workspaceId, workspaceId, "the root session is attached to the folder workspace");
    await until(async () => {
      const rows = await readAgentTree();
      return rows.some((row) => row.sessionId === l1id && row.cardId === worktreeId) ? rows : false;
    }, "the folder card lists the agent session");
    report.checks.push("folder-workspace-hosts-the-agent-session");
    report.checks.push("daemon-observes-the-agent-started-inside-a-shell");

    // The root row reads the agent, not the shell it started as.
    const expandedRows = await until(async () => {
      const rows = await readAgentTree();
      const root = rows.find((row) => row.sessionId === l1id);
      return root && rootRowTextIsAgentNotTerminal(root.text) ? rows : false;
    }, "the root row reads the agent");
    const rootRow = expandedRows.find((row) => row.sessionId === l1id);
    assert.equal(rootRow.identityTitle, "Claude", "the root row carries the agent identity");
    assert.equal(rootRow.hasTerminalSvg, false, "the root row renders the harness icon, not the plain terminal glyph");
    report.rootRow = rootRow;
    report.checks.push("root-row-reads-the-agent-not-terminal-1-zsh");

    // The full 3-level tree, nested under the root in the same card.
    const expectTree = (rows, specs, label) => {
      assert.deepEqual(
        rows.map((row) => [row.level, row.depth, row.sessionId, row.cardId]),
        specs.map(([level, depth, sessionId]) => [level, depth, sessionId, worktreeId]),
        label,
      );
    };
    expectTree(expandedRows, [[1, 0, l1id], [2, 1, l2id], [3, 2, l3id]], "three treeitem rows at levels 1, 2, 3");
    report.checks.push("sidebar-shows-a-three-level-tree");
    const expandedShot = path.join(output, "tree-expanded.png");
    await page.screenshot({ path: expandedShot, animations: "disabled" });
    report.screenshots.push(expandedShot);

    // Collapse the root: both descendants leave the tree.
    assert.equal(await disclosureFor(l1id).getAttribute("aria-label"), "Hide 1 child agent");
    await disclosureFor(l1id).click();
    const rootCollapsed = await until(async () => {
      const rows = await readAgentTree();
      return rows.length === 1 && rows[0].sessionId === l1id ? rows : false;
    }, "collapsing the root hides both descendants");
    assert.equal(rootCollapsed[0].level, 1);
    report.checks.push("collapsing-the-root-hides-both-descendants");
    const foldedShot = path.join(output, "tree-folded.png");
    await page.screenshot({ path: foldedShot, animations: "disabled" });
    report.screenshots.push(foldedShot);

    // Collapse at depth two keeps depth one visible.
    await disclosureFor(l1id).click();
    await until(async () => (await readAgentTree()).some((row) => row.sessionId === l3id), "the whole path expands again");
    assert.equal(await disclosureFor(l2id).getAttribute("aria-label"), "Hide 1 child agent");
    await disclosureFor(l2id).click();
    const depthTwoCollapsed = await until(async () => {
      const rows = await readAgentTree();
      return rows.length === 2 && rows.some((row) => row.sessionId === l3id) === false ? rows : false;
    }, "collapsing depth two keeps depth one visible");
    expectTree(depthTwoCollapsed, [[1, 0, l1id], [2, 1, l2id]], "depth one stays visible while depth two folds");
    report.checks.push("collapsing-depth-two-keeps-depth-one-visible");

    // The fold survives a renderer reload, and the stored localStorage
    // value is what proves it — not just the pixels.
    const storedFold = await page.evaluate((key) => window.localStorage.getItem(key), COLLAPSE_STORAGE_KEY);
    const envelope = await readCollapseEnvelope();
    report.collapseEnvelope = { raw: storedFold, parsed: envelope, worktreeId, l2id };
    assert.ok(envelope, "the fold is written to the lineage-collapse envelope");
    assert.deepEqual(envelope[worktreeId] ?? null, [l2id], "the envelope folds exactly the depth-two parent");
    await page.reload();
    await page.getByRole("button", { name: "Select agenttree", exact: true }).waitFor();
    const reloadedRows = await until(async () => {
      const rows = await readAgentTree();
      return rows.some((row) => row.sessionId === l1id) ? rows : false;
    }, "the card renders again after reload");
    expectTree(reloadedRows, [[1, 0, l1id], [2, 1, l2id]], "the same node is still folded after reload");
    assert.deepEqual(
      (await readCollapseEnvelope())[worktreeId] ?? null,
      [l2id],
      "the stored value still folds the same node after reload",
    );
    report.checks.push("the-fold-survives-a-reload");

    // Expanding restores the whole path.
    await disclosureFor(l2id).click();
    const restoredRows = await until(async () => {
      const rows = await readAgentTree();
      return rows.length === 3 && rows.some((row) => row.sessionId === l3id) ? rows : false;
    }, "expanding restores the whole path");
    expectTree(restoredRows, [[1, 0, l1id], [2, 1, l2id], [3, 2, l3id]], "the whole path is visible again");
    assert.deepEqual((await readCollapseEnvelope()) ?? {}, {}, "expanding clears the stored fold");
    report.checks.push("expanding-restores-the-whole-path");
    checkCancelled();

    // A worker started from inside a session nests under that session: the
    // worker-start runs in a real PTY, so the daemon records the inherited
    // DROGON_SESSION_ID as the worker's parentSessionId. Fixture harness,
    // no inference.
    const hostId = (await cliJson(["status"])).hostId;
    const run = (
      await cliJson(["orchestration", "run-create", "--objective", "sidebar lineage probe", "--host", hostId], {
        env,
        cwd: fixture,
      })
    ).run;
    const scope = [
      "--run",
      run.runId,
      "--coordinator-id",
      run.coordinatorId,
      "--consumer-generation",
      String(run.consumerGeneration),
    ];
    const taskId = (
      await cliJson(["orchestration", "task-create", ...scope, "--instructions", "probe worker nesting", "--title", "lineage probe"], {
        env,
        cwd: fixture,
      })
    ).task.taskId;
    const workerParentScript = path.join(fixture, "worker-parent.sh");
    await writeFile(
      workerParentScript,
      [
        "#!/bin/sh",
        // Same inherited-env lineage as the agent chain above: no
        // --data-dir, so the worker-start sees the PTY's own
        // DROGON_SESSION_ID and records it as the worker's parent.
        `${quoteShellWord(cli)} --json orchestration worker-start ${scope.map(quoteShellWord).join(" ")} --task ${quoteShellWord(taskId)} --workspace ${quoteShellWord(workspaceId)} --harness pi --timeout-ms 600000 > ${quoteShellWord(path.join(fixture, "worker.json"))} 2> ${quoteShellWord(path.join(fixture, "worker.err"))}`,
        `touch ${quoteShellWord(path.join(fixture, "worker.done"))}`,
        "sleep 120",
      ].join("\n") + "\n",
    );
    await chmod(workerParentScript, 0o755);
    const workerParent = await cliJson(
      ["terminal", "create", "--workspace", workspaceId, "--", "/bin/sh", workerParentScript],
      { env, cwd: fixture },
    );
    await until(() => exists(path.join(fixture, "worker.done")), "the worker-start ran inside the session");
    const workerStarted = JSON.parse(await readFile(path.join(fixture, "worker.json"), "utf8"));
    assert.equal(workerStarted.ok, true, `worker-start succeeded: ${await readFile(path.join(fixture, "worker.err"), "utf8")}`);
    const workerSessionId = workerStarted.result.sessionIdentity.sessionId;
    assert.notEqual(workerSessionId, workerParent.id, "the worker owns its own session");
    const workerRow = await until(async () => {
      const row = await sessionRow(workerSessionId);
      return row && row.parentSessionId === workerParent.id ? row : false;
    }, "the worker records the starting session as its parent");
    report.worker = {
      dispatchId: workerStarted.result.dispatchId,
      sessionId: workerSessionId,
      parentSessionId: workerRow.parentSessionId,
      workerParentSessionId: workerParent.id,
    };
    // The worker nests in the same sidebar tree, under its starter. Its
    // starter is a second root, so the card shows the compact "N agents"
    // summary pill by design; expanding the pill reveals both lineages.
    const expandPill = page.locator(
      `[data-worktree-card-id="${worktreeId}"] button[aria-label^="Expand "][aria-label*=" agent"]`,
    );
    const workerTreeRow = await until(async () => {
      if ((await expandPill.count()) > 0) {
        const pill = expandPill.first();
        if ((await pill.getAttribute("aria-expanded").catch(() => null)) === "false") {
          await pill.click().catch(() => {});
        }
      }
      const rows = await readAgentTree();
      return rows.find((candidate) => candidate.sessionId === workerSessionId && candidate.level === 2) || false;
    }, "the worker nests under its starter in the sidebar", 90000);
    assert.equal(workerTreeRow.cardId, worktreeId, "the worker nests in the folder card");
    report.workerTreeRow = workerTreeRow;
    report.checks.push("orchestration-worker-nests-under-the-session-that-started-it");
    await cliJson(["orchestration", "worker-stop", ...scope, "--dispatch", workerStarted.result.dispatchId], {
      env,
      cwd: fixture,
    });
    await until(async () => (await sessionRow(workerSessionId))?.verdict === "exited", "the worker session exited");
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
        report.treeAtFailure = await readAgentTree();
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
      await captureChildren();
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
        report.checks.push("OS activation and window visibility preserved throughout launch, interaction and shutdown");
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
        skipReason: report.skipReason,
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
  await runSidebarAgentTreeAcceptance();
}
