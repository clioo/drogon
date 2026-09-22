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
//
// Why the acceptance builds the Rust binaries itself instead of trusting
// the caller to have built them: a green run once certified a stale
// `drogond` built before the daemon fixes under test, passing only because
// the fixture was then a natively-named binary. The `cargo build` below
// makes the rest of the report mean anything; it aborts loudly when it
// fails, and the report records the binary mtimes plus HEAD so a reader
// can tell which code a report belongs to.
import assert from "node:assert/strict";
import { access, chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
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

/**
 * Known Mach-O magic numbers (all byte orders and widths `cc` can emit on
 * macOS, including fat/universal headers): each entry is the 4-byte header
 * as a lowercase hex string.
 */
export const MACH_O_MAGICS = new Set([
  "cefaedfe", // MH_MAGIC (32-bit, little-endian)
  "feedface", // MH_CIGAM (32-bit, big-endian)
  "cffaedfe", // MH_MAGIC_64 (64-bit, little-endian)
  "feedfacf", // MH_CIGAM_64 (64-bit, big-endian)
  "cafebabe", // FAT_MAGIC (universal, big-endian)
  "bebafeca", // FAT_CIGAM (universal, little-endian)
  "cafebabf", // FAT_MAGIC_64 (universal 64-bit, big-endian)
  "bfbafeca", // FAT_CIGAM_64 (universal 64-bit, little-endian)
]);

/** The ELF magic (`\x7fELF`), the native compiled format on Linux. */
export const ELF_MAGIC_HEX = "7f454c46";

/** The expected native compiled format name for a platform. */
export function nativeSleeperFormatName(platform = process.platform) {
  if (platform === "darwin") return "Mach-O";
  if (platform === "linux") return "ELF";
  return "native";
}

/**
 * True when a 4-byte file header is the platform's own native compiled
 * format: Mach-O on macOS, ELF on Linux. Scripts (`#!`), empty files and
 * the other platform's format all read false on every supported platform,
 * so a shell script under the fixture path can never pass this guard.
 */
export function isNativeCompiledSleeper(magic, platform = process.platform) {
  let bytes;
  if (Buffer.isBuffer(magic)) bytes = magic.subarray(0, 4);
  else if (magic instanceof Uint8Array) bytes = magic.subarray(0, 4);
  else if (Array.isArray(magic)) bytes = Buffer.from(magic.slice(0, 4));
  else return false;
  if (bytes.length < 4) return false;
  const hex = Buffer.from(bytes).toString("hex");
  if (platform === "darwin") return MACH_O_MAGICS.has(hex);
  if (platform === "linux") return hex === ELF_MAGIC_HEX;
  return false;
}

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

/** The late-foreground twin for Pi: a plain shell observed foregrounding
 *  the compiled `pi` sleeper after the UI already rendered it as a plain
 *  terminal. */
export function isObservedPiSession(row) {
  return (row?.harnessId ?? null) === null && row?.observedHarnessId === "pi";
}

/**
 * Project one side of the late-foreground transition for the JSON report:
 * the daemon row's identity/observation/state fields beside what the DOM
 * row actually read. Exported (like the tree projection above) so the
 * companion pins the report shape without launching an app. The DOM row
 * may come from either reader (`readAgentTree` rows carry `text` and
 * `identityTitle`; `measureGuideRows` rows carry `primaryText`), so both
 * are accepted and recorded as seen.
 */
export function projectLateForegroundSnapshot(daemonRow, domRow) {
  return {
    harnessId: daemonRow?.harnessId ?? null,
    observedHarnessId: daemonRow?.observedHarnessId ?? null,
    observedHarnessAt: daemonRow?.observedHarnessAt ?? null,
    hasForegroundChild: daemonRow?.hasForegroundChild ?? null,
    agentState: daemonRow?.agentState ?? null,
    agentStateAuthority: daemonRow?.agentStateAuthority ?? null,
    domText: domRow?.text ?? domRow?.primaryText ?? null,
    domIdentityTitle: domRow?.identityTitle ?? null,
  };
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
    // F3 guide layout: the same sleeper under the other provider names, so
    // a later multi-provider chain (Pi root, Codex child, Claude
    // grandchild, standalone Codex) is observed honestly through argv[0],
    // exactly like the claude chain above. `codex` is a free name; `pi` is
    // NOT (the worker section below writes a `pi` sleep *script* into
    // binDir, and writeFile follows symlinks — pointing bin/pi at the
    // compiled sleeper would clobber the binary). The observed-pi entry
    // therefore lives at bin/pidir/pi: its basename is still exactly `pi`,
    // which is all the daemon's argv[0] match reads.
    await symlink(path.join(versionsDir, "9.9.9"), path.join(binDir, "codex"));
    await writeFile(path.join(versionsDir, "7.7.7.c"), TIMED_SLEEPER_C_SOURCE);
    await exec("cc", ["-O2", "-o", path.join(versionsDir, "7.7.7"), path.join(versionsDir, "7.7.7.c")]);
    await rm(path.join(versionsDir, "7.7.7.c"));
    await chmod(path.join(versionsDir, "7.7.7"), 0o755);
    await mkdir(path.join(binDir, "pidir"), { recursive: true });
    await symlink(path.join(versionsDir, "7.7.7"), path.join(binDir, "pidir", "pi"));
    // Guard the failure mode that cost a debugging round: the observation
    // chain needs real native binaries (Mach-O on macOS, ELF on Linux — a
    // shell script under the same path is exec'd as sh and never observed,
    // which surfaces far away as a lineage timeout). Fail fast with the
    // cause instead.
    for (const binary of [path.join(versionsDir, "9.9.9"), path.join(versionsDir, "7.7.7")]) {
      const magic = (await readFile(binary)).subarray(0, 4);
      assert.ok(
        isNativeCompiledSleeper(magic),
        `${binary} is a compiled ${nativeSleeperFormatName()} sleeper, not a script`,
      );
    }
    // The orchestration worker's harness: a fixture that only sleeps, so
    // the worker-start check proves lineage with no model inference.
    await writeFile(path.join(binDir, "pi"), "#!/bin/sh\nsleep 120\n");
    await chmod(path.join(binDir, "pi"), 0o755);
    try {
      await access(path.join(appDir, "out/main/index.js"));
    } catch {
      throw new Error("Build the dev desktop first: pnpm --filter @drogon/desktop build");
    }
    // The binaries under test are built here, from this tree, as part of
    // the acceptance — never trusted from an earlier build (see the file
    // header). A cached rebuild is quick; a stale daemon would make every
    // check below certify the wrong code, so a failed build aborts the run.
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

    // Owner's sidebar design (2026-09-21): the card's own sentence states
    // what its agents are doing, the lane carries the workspace STATUS ring
    // (not agent activity), and every row states its own condition — with
    // the tree's parent end reading MAIN. Each check derives its expectation
    // from the rendered rows, so a sentence can never disagree with the tree
    // under it.
    const readCardDesign = async () =>
      page.evaluate((rootSessionId) => {
        const card = document.querySelector("[data-worktree-card-id]");
        const rows = [...document.querySelectorAll("[data-worktree-agent-row]")];
        const stateOf = (row) => row.querySelector("[data-worktree-agent-state]")?.getAttribute("data-worktree-agent-state") ?? null;
        const sentence = card?.querySelector(".shell-worktree-card-sentence")?.textContent?.trim() ?? null;
        const fold = card?.querySelector(".shell-worktree-card-fold");
        const statusRing = card?.querySelector('[data-worktree-card-status-slot] [role="img"]');
        const badge = card?.querySelector(".shell-worktree-agent-main-badge");
        return {
          sentence,
          states: rows.map(stateOf),
          labels: rows.map((row) => row.querySelector(".shell-worktree-agent-state-label")?.textContent?.trim() ?? null),
          rowIds: rows.map((row) => row.getAttribute("data-worktree-agent-row")),
          mainBadgeRowId: badge?.closest("[data-worktree-agent-row]")?.getAttribute("data-worktree-agent-row") ?? null,
          statusLabel: statusRing?.getAttribute("aria-label") ?? null,
          statusTone: statusRing?.className ?? null,
          statusDashed: Boolean(statusRing?.querySelector(".border-dashed")),
          foldExpanded: fold?.getAttribute("aria-expanded") ?? null,
          foldLabel: fold?.getAttribute("aria-label") ?? null,
          rootSessionId,
        };
      }, l1id);
    const design = await readCardDesign();
    report.cardDesign = design;
    assert.ok(design.sentence && design.sentence === design.sentence.toUpperCase(), `the card states its activity in an uppercase sentence (${design.sentence})`);
    assert.ok(!design.sentence.includes("NO SESSION"), "a card with three sessions never claims none");
    const expectedSentence = design.states.includes("needs_input")
      ? design.states.filter((state) => state === "needs_input")
      : design.states.includes("working")
        ? design.states.filter((state) => state === "working")
        : design.states.every((state) => state === "unknown")
          ? design.states
          : null;
    if (expectedSentence !== null) {
      const count = expectedSentence.length;
      const noun = count === 1 ? "AGENT" : "AGENTS";
      const expected = design.states.includes("needs_input")
        ? `${count} ${noun} NEED${count === 1 ? "S" : ""} INPUT`
        : design.states.includes("working")
          ? `${count} ${noun} WORKING`
          : `${count} ${noun} NOT REPORTING`;
      assert.equal(design.sentence, expected, `the sentence counts the rows it describes (${design.sentence})`);
    } else {
      assert.equal(design.sentence, "NO ACTIVE AGENTS", "quiet rows read as no active agents");
    }
    report.checks.push("the-card-states-its-agent-activity-in-words");
    // Every row states its own condition, main rows included: three rows,
    // three labels, and the MAIN badge only on the row that owns children.
    assert.equal(design.labels.length, 3, "every row carries a state label");
    assert.ok(design.labels.every((label) => typeof label === "string" && label.length > 0), `each row names its state (${JSON.stringify(design.labels)})`);
    assert.equal(design.mainBadgeRowId, l1id, "the root that owns subagents is the MAIN row");
    report.checks.push("every-row-states-its-condition-and-the-root-reads-main");
    // No status is set yet: the lane's ring says so instead of claiming one.
    assert.equal(design.statusLabel, "No status", "an unset status draws the dashed neutral ring");
    assert.equal(design.statusDashed, true, "the unset ring is the dashed one");
    assert.equal(design.foldExpanded, "true", "the card starts expanded");
    // The owner's decision, proven end to end: setting the worktree's
    // workspace status re-colours the lane's ring with the status' own icon.
    await cliJson(["rpc", "worktree.update", "--params", JSON.stringify({ worktreeId, workspaceStatus: "in-review" })], { env, cwd: fixture });
    const withStatus = await until(async () => {
      const next = await readCardDesign();
      return next.statusLabel === "Status In review" ? next : false;
    }, "setting the workspace status re-colours the card ring");
    assert.equal(withStatus.statusDashed, false, "a real status draws the status glyph, not the dashed ring");
    assert.ok(withStatus.statusTone.includes("text-[#16a34a]"), `the ring keeps the status' own colour (${withStatus.statusTone})`);
    report.checks.push("the-card-ring-carries-the-workspace-status");
    // The card's own chevron folds the whole tree and keeps the sentence.
    await page.locator(".shell-worktree-card-fold").click();
    await until(async () => (await readCardDesign()).rowIds.length === 0, "the card chevron folds the whole agent list");
    const foldedCard = await readCardDesign();
    assert.equal(foldedCard.foldExpanded, "false", "the chevron reports its collapsed state");
    assert.ok(foldedCard.sentence && foldedCard.sentence.length > 0, "a folded card still states its activity");
    await page.locator(".shell-worktree-card-fold").click();
    await until(async () => (await readCardDesign()).rowIds.length === 3, "the card chevron restores the tree");
    report.checks.push("the-card-chevron-folds-and-restores-the-whole-tree");

    // F3 guide layout: provider width budget at the natural sidebar width.
    // The leader's finding was provider names truncated to Cl.../C.../Cla...
    // beside MAIN and the state at ~280px. These asserts measure real
    // bounding boxes over CDP: every provider primary must read whole
    // (scrollWidth within clientWidth), MAIN and the state must draw inside
    // the card, and no row may clip horizontally. Recorded in the report
    // outside CHECK_NAMES (which the companion test pins).
    const measureGuideRows = (cardId) =>
      page.evaluate((id) => {
        const card = document.querySelector(`[data-worktree-card-id="${id}"]`);
        const sidebar = document.querySelector(".workspace-sidebar");
        const cardRect = card.getBoundingClientRect();
        const fold = card.querySelector(".shell-worktree-card-fold");
        const foldRect = fold ? fold.getBoundingClientRect() : null;
        const title = card.querySelector(".shell-worktree-card-name");
        const titleRect = title ? title.getBoundingClientRect() : null;
        // R1 finisher: connector geometry per tree node. Each node draws
        // its own vertical guide (::before) and elbow (::after) positioned
        // relative to itself, so the absolute line extents are the node
        // edge plus the pseudo offset — measured here, asserted inside the
        // card below.
        const treeConnectors = [...card.querySelectorAll("[data-lineage-depth]")].map((node) => {
          const nodeRect = node.getBoundingClientRect();
          const extentOf = (pseudo, rect) => {
            if (!pseudo || pseudo.content === "none") return null;
            const left = Number.parseFloat(pseudo.left);
            const width = Number.parseFloat(pseudo.width);
            if (!Number.isFinite(left) || !Number.isFinite(width)) return null;
            return {
              left: Math.round(rect.left + left),
              right: Math.round(rect.left + left + width),
            };
          };
          return {
            depth: Number(node.getAttribute("data-lineage-depth")),
            vertical: extentOf(getComputedStyle(node, "::before"), nodeRect),
            elbow: extentOf(getComputedStyle(node, "::after"), nodeRect),
          };
        });
        return {
          sidebarWidth: sidebar ? Math.round(sidebar.getBoundingClientRect().width) : null,
          cardRect: { left: cardRect.left, right: cardRect.right },
          cardFoldLeft: foldRect ? Math.round(foldRect.left) : null,
          cardTitleLeft: titleRect ? Math.round(titleRect.left) : null,
          treeConnectors,
          rows: [...card.querySelectorAll("[data-worktree-agent-row]")].map((row) => {
            const rowRect = row.getBoundingClientRect();
            const primary = row.querySelector("[data-worktree-agent-primary]");
            const primaryRect = primary.getBoundingClientRect();
            const firstChild = row.firstElementChild;
            const firstRect = firstChild ? firstChild.getBoundingClientRect() : null;
            const badge = row.querySelector(".shell-worktree-agent-main-badge");
            const badgeRect = badge ? badge.getBoundingClientRect() : null;
            const state = row.querySelector("[data-worktree-agent-state]");
            const stateRect = state ? state.getBoundingClientRect() : null;
            const stateLabel = row.querySelector(".shell-worktree-agent-state-label");
            const stateText = stateLabel?.textContent?.trim() ?? null;
            const tail = row.querySelector(".shell-worktree-agent-tail");
            const tailRect = tail ? tail.getBoundingClientRect() : null;
            const depthNode = row.closest("[data-lineage-depth]");
            return {
              id: row.getAttribute("data-worktree-agent-row"),
              primaryText: primary?.textContent ?? null,
              primaryClientW: primary?.clientWidth ?? null,
              primaryScrollW: primary?.scrollWidth ?? null,
              // R1 density: indent of this row's left edge from the card,
              // its lineage depth, and its full line box — root indent
              // proves the tree starts near the card edge (not squeezed
              // behind the header chrome), depth steps prove real nesting,
              // and the wrapped flag proves ordinary rows hold one line.
              depth: depthNode ? Number(depthNode.getAttribute("data-lineage-depth")) : null,
              rowLeft: Math.round(rowRect.left),
              rowRight: Math.round(rowRect.right),
              rowH: Math.round(rowRect.height),
              // R1 finisher: the row's leading slot (disclosure chevron on
              // parents, reserved gutter on lone roots) and the provider
              // text edge — nested relative to the card fold and title.
              disclosureLeft: firstRect ? Math.round(firstRect.left) : null,
              primaryLeft: Math.round(primaryRect.left),
              primaryRight: Math.round(primaryRect.right),
              tailRight: tailRect ? Math.round(tailRect.right) : null,
              wrapped: stateRect ? Math.round(stateRect.top) > Math.round(primaryRect.bottom) + 2 : null,
              stateText,
              badgeW: badgeRect ? Math.round(badgeRect.width) : null,
              badgeRight: badgeRect ? Math.round(badgeRect.right) : null,
              stateW: stateRect ? Math.round(stateRect.width) : null,
              stateLeft: stateRect ? Math.round(stateRect.left) : null,
              stateRight: stateRect ? Math.round(stateRect.right) : null,
              stateTop: stateRect ? Math.round(stateRect.top) : null,
              primaryBottom: Math.round(primaryRect.bottom),
              rowClientW: row.clientWidth,
              rowScrollW: row.scrollWidth,
              rowTop: Math.round(rowRect.top),
            };
          }),
        };
      }, cardId);
    const widthBudget = await measureGuideRows(worktreeId);
    report.widthBudget280 = widthBudget;
    assert.ok(
      widthBudget.sidebarWidth >= 260 && widthBudget.sidebarWidth <= 300,
      `the natural sidebar width is ~280px (saw ${widthBudget.sidebarWidth})`,
    );
    assert.equal(widthBudget.rows.length, 3, "three rows measured at natural width");
    for (const row of widthBudget.rows) {
      assert.ok(row.primaryText && row.primaryText.length > 2, `row ${row.id} names its provider (${row.primaryText})`);
      assert.ok(
        row.primaryScrollW <= row.primaryClientW + 1,
        `row ${row.id} provider reads whole: "${row.primaryText}" scrolls ${row.primaryScrollW}px in ${row.primaryClientW}px`,
      );
      assert.ok(row.stateW > 0, `row ${row.id} keeps its own state visible`);
      assert.ok(
        row.stateLeft >= widthBudget.cardRect.left - 1 && row.stateRight <= widthBudget.cardRect.right + 1,
        `row ${row.id} state draws inside the card`,
      );
      assert.ok(
        row.rowScrollW <= row.rowClientW + 1,
        `row ${row.id} never clips horizontally`,
      );
    }
    const budgetMain = widthBudget.rows.find((row) => row.id === l1id);
    assert.ok(budgetMain && budgetMain.badgeW > 0, "MAIN draws beside the root provider name");
    assert.ok(
      budgetMain.badgeRight <= widthBudget.cardRect.right + 1,
      "MAIN draws inside the card",
    );
    report.guideBudget280 = "pass";

    // R1 density: indent + line-box proof at the natural width. The root
    // starts near the card edge (the old header-squeezed column started
    // ~55px in), children step right per depth (real nesting with the
    // connector offsets intact), ordinary Idle/Working rows hold one line,
    // and a long not-reporting label may legitimately wrap at depth.
    const indentOf = (row, cardRect) => row.rowLeft - Math.round(cardRect.left);
    report.indent280 = Object.fromEntries(
      widthBudget.rows.map((row) => [row.id, indentOf(row, widthBudget.cardRect)]),
    );
    const rootRow280 = widthBudget.rows.find((row) => row.id === l1id);
    assert.ok(
      rootRow280 && indentOf(rootRow280, widthBudget.cardRect) <= 32,
      `the root starts near the card edge (indent ${rootRow280 ? indentOf(rootRow280, widthBudget.cardRect) : "?"}px)`,
    );
    const byDepth280 = [...widthBudget.rows].sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
    for (let index = 1; index < byDepth280.length; index += 1) {
      assert.ok(
        indentOf(byDepth280[index], widthBudget.cardRect) > indentOf(byDepth280[index - 1], widthBudget.cardRect),
        `depth ${byDepth280[index].depth} steps right of depth ${byDepth280[index - 1].depth}`,
      );
    }
    for (const row of widthBudget.rows) {
      assert.ok(
        row.tailRight !== null && row.tailRight <= Math.round(widthBudget.cardRect.right) + 1,
        `row ${row.id} actions draw inside the card`,
      );
      // Ordinary short states (Idle/Working/Exited) must hold one line at
      // the natural width; a long freshness sentence may wrap instead of
      // eating the provider name.
      if (row.stateText !== null && row.stateText.length <= 10) {
        assert.equal(row.wrapped, false, `row ${row.id} ("${row.primaryText}" ${row.stateText}) holds one line`);
      }
    }
    report.density280 = "pass";

    // R1 finisher: the tree nests genuinely instead of outdenting. The root
    // holds a real gutter inside the card (the R1 overcorrection sat 9px
    // in with its connectors clipped at the card edge; the old squeezed
    // column started ~55px in), the root disclosure sits right of the card
    // fold, the root provider text starts right of the workspace title,
    // every connector — including pseudo-element geometry — draws inside
    // the card, and depth steps read ~12px. Recorded outside CHECK_NAMES
    // (which the companion test pins).
    const cardLeft280 = Math.round(widthBudget.cardRect.left);
    const cardRight280 = Math.round(widthBudget.cardRect.right);
    const rootNest280 = widthBudget.rows.find((row) => row.id === l1id);
    const rootIndent280 = indentOf(rootNest280, widthBudget.cardRect);
    assert.ok(
      rootIndent280 >= 20 && rootIndent280 <= 40,
      `the root nests in a genuine gutter (indent ${rootIndent280}px)`,
    );
    assert.ok(
      widthBudget.cardFoldLeft !== null &&
        rootNest280.disclosureLeft !== null &&
        rootNest280.disclosureLeft > widthBudget.cardFoldLeft,
      `the root disclosure nests right of the card fold (${rootNest280.disclosureLeft} vs ${widthBudget.cardFoldLeft})`,
    );
    assert.ok(
      widthBudget.cardTitleLeft !== null &&
        rootNest280.primaryLeft > widthBudget.cardTitleLeft,
      `the root provider text starts right of the workspace title (${rootNest280.primaryLeft} vs ${widthBudget.cardTitleLeft})`,
    );
    assert.ok(
      widthBudget.treeConnectors.length === widthBudget.rows.length,
      `every row owns its connector node (${widthBudget.treeConnectors.length} nodes for ${widthBudget.rows.length} rows)`,
    );
    for (const connector of widthBudget.treeConnectors) {
      for (const [name, extent] of [["guide", connector.vertical], ["elbow", connector.elbow]]) {
        if (!extent) continue;
        assert.ok(
          extent.left >= cardLeft280 - 1 && extent.right <= cardRight280 + 1,
          `depth ${connector.depth} ${name} connector draws inside the card (${extent.left}..${extent.right} in ${cardLeft280}..${cardRight280})`,
        );
      }
    }
    const chain280 = [l1id, l2id, l3id].map((id) => widthBudget.rows.find((row) => row.id === id));
    assert.ok(chain280.every(Boolean), "the full chain is measured at natural width");
    for (let index = 1; index < chain280.length; index += 1) {
      const step = indentOf(chain280[index], widthBudget.cardRect) - indentOf(chain280[index - 1], widthBudget.cardRect);
      assert.ok(
        step >= 8 && step <= 20,
        `depth ${chain280[index].depth} steps ~12px right of its parent (step ${step}px)`,
      );
    }
    report.nesting280 = {
      rootIndent: rootIndent280,
      rootDisclosureLeft: rootNest280.disclosureLeft,
      cardFoldLeft: widthBudget.cardFoldLeft,
      rootPrimaryLeft: rootNest280.primaryLeft,
      cardTitleLeft: widthBudget.cardTitleLeft,
      connectors: widthBudget.treeConnectors,
    };

    // Discrimination probe: the previous row layout (one shared truncating
    // span for name + secondary beside non-shrinking MAIN/state) rebuilt
    // with the same recipe inside a hidden box at the live row width. It
    // must truncate there — otherwise the asserts above prove nothing about
    // the fix. Recipe-faithful reconstruction, honestly labeled: the live
    // document supplies the real Tailwind utilities and fonts.
    const oldLayoutProbe = await page.evaluate((liveRowWidth) => {
      const host = document.createElement("div");
      host.setAttribute("aria-hidden", "true");
      host.style.cssText = `position:fixed;left:-10000px;top:0;width:${liveRowWidth}px;`;
      host.innerHTML =
        `<div class="compact-agent-row flex h-6 min-w-0 items-center gap-1 overflow-hidden rounded-sm px-1 text-[11px] leading-none">` +
        `<span class="size-4 shrink-0"></span>` +
        `<span class="inline-flex shrink-0"><svg width="13" height="13"></svg></span>` +
        `<span class="min-w-0 flex-1 truncate"><span>Claude</span><span> - Fix the sidebar card order for real</span></span>` +
        `<span class="shell-worktree-agent-main-badge">MAIN</span>` +
        `<span class="shell-worktree-agent-state shrink-0"><svg width="10" height="10"></svg><span class="shell-worktree-agent-state-label">No update in 0m</span></span>` +
        `</div>`;
      document.body.appendChild(host);
      // The shared span is the truncation victim in the old layout: its
      // scroll width is the whole "Claude - <preview>" line while its
      // client width is what the shrink-0 tail leaves behind.
      const shared = host.querySelector(".truncate");
      const result = { clientW: shared.clientWidth, scrollW: shared.scrollWidth };
      host.remove();
      return result;
    }, widthBudget.rows[0].rowClientW);
    report.oldLayoutProbe = oldLayoutProbe;
    assert.ok(
      oldLayoutProbe.scrollW > oldLayoutProbe.clientW + 1,
      `the previous layout truncates at the same width (scrolls ${oldLayoutProbe.scrollW}px in ${oldLayoutProbe.clientW}px), so the budget asserts discriminate`,
    );
    checkCancelled();

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

    // R2 selected-copy regression: the native late-Pi failure that proved
    // the second gate — a plain shell in the SELECTED workspace rendered
    // Terminal and stayed Terminal for 90s after the daemon observed pi,
    // because the selected list adopted once (append-only) while the
    // sidebar merge prefers that copy. With the adopt reconciliation the
    // same row must update to Pi in place. Real shell, real native
    // binary, no inference, no reload, no workspace change.
    const lateSelectedShell = await cliJson(
      ["terminal", "create", "--workspace", workspaceId, "--", "/bin/sh"],
      { env, cwd: fixture },
    );
    assert.equal(lateSelectedShell.harnessId ?? null, null, "the selected late shell starts as a plain shell");
    const lateSelectedBeforeRow = await until(async () => {
      const row = await sessionRow(lateSelectedShell.id);
      return row && (row.harnessId ?? null) === null && (row.observedHarnessId ?? null) === null ? row : false;
    }, "the daemon lists the selected late shell with no harness identity");
    const expandSelectedPill = async () => {
      if ((await expandPill.count()) > 0) {
        const pill = expandPill.first();
        if ((await pill.getAttribute("aria-expanded").catch(() => null)) === "false") {
          await pill.click().catch(() => {});
        }
      }
    };
    const lateSelectedBeforeDom = await until(async () => {
      await expandSelectedPill();
      const measured = await measureGuideRows(worktreeId);
      return measured.rows.find((row) => row.id === lateSelectedShell.id) || false;
    }, "the sidebar lists the selected late plain shell");
    assert.match(
      String(lateSelectedBeforeDom.primaryText ?? ""),
      /Terminal \d/,
      "the selected late shell first renders as a plain terminal, not an agent",
    );
    await cliJson(
      ["terminal", "send", "--session", lateSelectedShell.id, "--incarnation", lateSelectedShell.incarnation, "--text",
        `exec ${quoteShellWord(path.join(binDir, "pidir", "pi"))} 600\n`],
      { env, cwd: fixture },
    );
    const lateSelectedAfterRow = await until(async () => {
      const row = await sessionRow(lateSelectedShell.id);
      return row && isObservedPiSession(row) ? row : false;
    }, "the daemon observes pi in the selected late shell's foreground");
    const lateSelectedPi = await until(async () => {
      await expandSelectedPill();
      const measured = await measureGuideRows(worktreeId);
      const row = measured.rows.find((candidate) => candidate.id === lateSelectedShell.id);
      return row && row.primaryText === "Pi" ? { measured, row } : false;
    }, "the selected sidebar row updates to Pi without a reload", 90000);
    assert.equal(
      lateSelectedPi.measured.rows.filter((row) => row.id === lateSelectedShell.id).length,
      1,
      "the selected foreground transition updates exactly one row — never a duplicate",
    );
    const lateSelectedActiveCard = await page.evaluate(
      () => document.querySelector('[data-worktree-card-id][data-active="true"]')?.getAttribute("data-worktree-card-id") ?? null,
    );
    assert.equal(lateSelectedActiveCard, worktreeId, "the selected transition lands with the same workspace selected");
    report.lateForegroundSelected = {
      boundary: "real-App metadata-only snapshot path (session.list rows to DOM) on the selected card, not mocked preload data",
      before: projectLateForegroundSnapshot(lateSelectedBeforeRow, lateSelectedBeforeDom),
      after: projectLateForegroundSnapshot(lateSelectedAfterRow, lateSelectedPi.row),
      cardRowIds: lateSelectedPi.measured.rows.map((row) => row.id),
      activeCardId: lateSelectedActiveCard,
    };
    report.checks.push("late-foreground-selected-observed-pi-updates-the-same-row");
    await cliJson(
      ["rpc", "session.stop", "--params", JSON.stringify({ sessionId: lateSelectedShell.id, incarnation: lateSelectedShell.incarnation })],
      { env, cwd: fixture },
    );
    await until(async () => (await sessionRow(lateSelectedShell.id))?.verdict === "exited", "the selected late shell exited");
    checkCancelled();

    // R2 observed-identity: the late-foreground transition the fixture
    // above misses — every agent there starts BEFORE the initial render,
    // so the UI never displays the plain terminal first. Here a real plain
    // shell renders as `Terminal N` with no harness identity, then execs
    // the compiled `pi` sleeper AFTER; the same card must update that row
    // to Pi in place (exactly one row for the session — never a
    // duplicate) with no reload and no workspace change. Real shell, real
    // native binary, no inference; the sleeper is quiet by design so the
    // turn state stays whatever the daemon derives, recorded not steered.
    // Additional coverage on its own folder card (unselected): the
    // selected-card regression above is the required proof; here the
    // host-wide poll copy is the only copy, so the same metadata-only
    // delta reaches the DOM through the fixed comparator alone.
    // Labeled accurately: a boundary-level real-App test of the
    // metadata-only snapshot path (session.list rows to DOM), not mocked
    // preload data — and not a claim about which comparator field flips,
    // so the report records the full before/after rows (including any
    // agentState move) without saying the old comparator would have
    // failed on identity alone.
    const lateProjectDir = path.join(fixture, "latefg");
    await mkdir(lateProjectDir, { recursive: true });
    const lateProject = await cliJson(["project", "add", lateProjectDir, "--name", "latefg"], { env, cwd: fixture });
    const lateTrees = await cliJson(["worktree", "list", "--project", lateProject.id], { env, cwd: fixture });
    assert.equal(lateTrees.worktrees.length, 1, "a folder project has exactly its implicit worktree");
    const lateWorktreeId = lateTrees.worktrees[0].id;
    const lateWorkspaceId = lateTrees.worktrees[0].workspaceId;
    const lateShell = await cliJson(
      ["terminal", "create", "--workspace", lateWorkspaceId, "--", "/bin/sh"],
      { env, cwd: fixture },
    );
    assert.equal(lateShell.harnessId ?? null, null, "the late shell starts as a plain shell");
    const lateBeforeRow = await until(async () => {
      const row = await sessionRow(lateShell.id);
      return row && (row.harnessId ?? null) === null && (row.observedHarnessId ?? null) === null ? row : false;
    }, "the daemon lists the late shell with no harness identity");
    // Card-scoped reads: a lone session renders a flat row, not a
    // `[role="treeitem"]` node, so the tree reader cannot see this card —
    // and the geometry probe throws before the card exists, so the waits
    // read through this null-safe projection and measure only afterwards.
    const readLateCardRows = async () =>
      page.evaluate((id) => {
        const card = document.querySelector(`[data-worktree-card-id="${id}"]`);
        if (!card) return null;
        return [...card.querySelectorAll("[data-worktree-agent-row]")].map((row) => ({
          id: row.getAttribute("data-worktree-agent-row"),
          primaryText: row.querySelector("[data-worktree-agent-primary]")?.textContent ?? null,
        }));
      }, lateWorktreeId);
    const lateBeforeDom = await until(async () => {
      const rows = await readLateCardRows();
      return rows?.find((row) => row.id === lateShell.id) || false;
    }, "the sidebar lists the late plain shell");
    assert.match(
      String(lateBeforeDom.primaryText ?? ""),
      /Terminal \d/,
      "the late shell first renders as a plain terminal, not an agent",
    );
    await cliJson(
      ["terminal", "send", "--session", lateShell.id, "--incarnation", lateShell.incarnation, "--text",
        `exec ${quoteShellWord(path.join(binDir, "pidir", "pi"))} 600\n`],
      { env, cwd: fixture },
    );
    const lateAfterRow = await until(async () => {
      const row = await sessionRow(lateShell.id);
      return row && isObservedPiSession(row) ? row : false;
    }, "the daemon observes pi in the late shell's foreground");
    const latePiRow = await until(async () => {
      const rows = await readLateCardRows();
      const row = rows?.find((candidate) => candidate.id === lateShell.id);
      return row && row.primaryText === "Pi" ? row : false;
    }, "the same sidebar row updates to Pi without a reload", 90000);
    const lateAfterDom = await measureGuideRows(lateWorktreeId);
    assert.equal(
      lateAfterDom.rows.filter((row) => row.id === lateShell.id).length,
      1,
      "the foreground transition updates exactly one row — the session is never duplicated",
    );
    const lateActiveCard = await page.evaluate(
      () => document.querySelector('[data-worktree-card-id][data-active="true"]')?.getAttribute("data-worktree-card-id") ?? null,
    );
    assert.equal(lateActiveCard, worktreeId, "the transition lands with the same workspace selected");
    report.lateForeground = {
      boundary: "real-App metadata-only snapshot path (session.list rows to DOM) on an unselected card, not mocked preload data",
      projectId: lateProject.id,
      worktreeId: lateWorktreeId,
      workspaceId: lateWorkspaceId,
      before: projectLateForegroundSnapshot(lateBeforeRow, lateBeforeDom),
      after: projectLateForegroundSnapshot(lateAfterRow, latePiRow),
      cardRowIds: lateAfterDom.rows.map((row) => row.id),
      activeCardId: lateActiveCard,
    };
    report.checks.push("late-foreground-observed-pi-updates-the-same-row");
    // The late shell stays listed until the fixture daemon stops; stop it
    // explicitly so no sleeper outlives the check.
    await cliJson(
      ["rpc", "session.stop", "--params", JSON.stringify({ sessionId: lateShell.id, incarnation: lateShell.incarnation })],
      { env, cwd: fixture },
    );
    await until(async () => (await sessionRow(lateShell.id))?.verdict === "exited", "the late shell exited");
    checkCancelled();

    // F3 guide layout continued: a second folder project proves multi-card
    // rhythm — first its no-session card, then a Pi root with Codex and
    // Claude Code descendants plus a standalone Codex agent. Fixture-only
    // sessions, explicitly labeled in the report; the rows render through
    // the product's own WorktreeCard path, never a hand-drawn page.
    const guide = { fixture: true, sessions: "observed sleeper binaries, no inference" };
    const project2Dir = path.join(fixture, "guidebiz");
    await mkdir(project2Dir, { recursive: true });
    const project2 = await cliJson(["project", "add", project2Dir, "--name", "guidebiz"], { env, cwd: fixture });
    const trees2 = await cliJson(["worktree", "list", "--project", project2.id], { env, cwd: fixture });
    assert.equal(trees2.worktrees.length, 1, "a folder project has exactly its implicit worktree");
    const worktree2Id = trees2.worktrees[0].id;
    const workspace2Id = trees2.worktrees[0].workspaceId;
    guide.projectId = project2.id;
    guide.worktreeId = worktree2Id;
    await until(async () => {
      const sentence = await page.evaluate(
        (id) => document.querySelector(`[data-worktree-card-id="${id}"] .shell-worktree-card-sentence`)?.textContent?.trim() ?? null,
        worktree2Id,
      );
      return sentence === "NO SESSION" ? true : false;
    }, "the second card states its empty condition");
    guide.noSessionSentence = "NO SESSION";
    const noSessionShot = path.join(output, "guide-layout-no-session.png");
    await page.screenshot({ path: noSessionShot, animations: "disabled" });
    report.screenshots.push(noSessionShot);

    // Pi root -> Codex child -> Claude grandchild, all observed through
    // argv[0] like the claude chain above, plus a standalone Codex root.
    const guideGrandchildScript = path.join(fixture, "guide-grandchild.sh");
    await writeFile(guideGrandchildScript, `#!/bin/sh\nexec ${quoteShellWord(path.join(binDir, "claude"))} 600\n`);
    await chmod(guideGrandchildScript, 0o755);
    const guideChildScript = path.join(fixture, "guide-child.sh");
    await writeFile(
      guideChildScript,
      [
        "#!/bin/sh",
        `${quoteShellWord(cli)} --json terminal create --workspace "$DROGON_WORKSPACE_ID" -- /bin/sh ${quoteShellWord(guideGrandchildScript)} > ${quoteShellWord(path.join(fixture, "guide-grandchild.json"))} 2> ${quoteShellWord(path.join(fixture, "guide-grandchild.err"))}`,
        `exec ${quoteShellWord(path.join(binDir, "codex"))} 600`,
      ].join("\n") + "\n",
    );
    await chmod(guideChildScript, 0o755);
    const guideRoot = await cliJson(["terminal", "create", "--workspace", workspace2Id, "--", "/bin/sh"], { env, cwd: fixture });
    await cliJson(
      ["terminal", "send", "--session", guideRoot.id, "--incarnation", guideRoot.incarnation, "--text",
        `${quoteShellWord(cli)} --json terminal create --workspace "$DROGON_WORKSPACE_ID" -- /bin/sh ${quoteShellWord(guideChildScript)} > ${quoteShellWord(path.join(fixture, "guide-child.json"))} 2> ${quoteShellWord(path.join(fixture, "guide-child.err"))}; exec ${quoteShellWord(path.join(binDir, "pidir", "pi"))} 600\n`],
      { env, cwd: fixture },
    );
    const guideLone = await cliJson(["terminal", "create", "--workspace", workspace2Id, "--", "/bin/sh"], { env, cwd: fixture });
    await cliJson(
      ["terminal", "send", "--session", guideLone.id, "--incarnation", guideLone.incarnation, "--text",
        `exec ${quoteShellWord(path.join(binDir, "codex"))} 600\n`],
      { env, cwd: fixture },
    );
    const guideChain = await until(async () => {
      let childId = null;
      let grandchildId = null;
      try {
        childId = JSON.parse(await readFile(path.join(fixture, "guide-child.json"), "utf8")).result.id;
        grandchildId = JSON.parse(await readFile(path.join(fixture, "guide-grandchild.json"), "utf8")).result.id;
      } catch {
        return false;
      }
      const [r, c, g, lone] = await Promise.all([
        sessionRow(guideRoot.id), sessionRow(childId), sessionRow(grandchildId), sessionRow(guideLone.id),
      ]);
      if (!r || !c || !g || !lone) return false;
      if (r.observedHarnessId !== "pi" || (r.harnessId ?? null) !== null) return false;
      if (c.observedHarnessId !== "codex" || c.parentSessionId !== guideRoot.id) return false;
      if (g.observedHarnessId !== "claude" || g.parentSessionId !== childId) return false;
      if (lone.observedHarnessId !== "codex" || (lone.parentSessionId ?? null) !== null) return false;
      return { rootId: r.id, childId: c.id, grandchildId: g.id, loneId: lone.id };
    }, "pi root with codex and claude descendants plus a standalone agent");
    guide.chain = guideChain;
    const guideMeasured = await until(async () => {
      const measured = await measureGuideRows(worktree2Id);
      return measured.rows.length === 4 ? measured : false;
    }, "the guide card lists all four fixture rows");
    report.guideMeasured = guideMeasured;
    const primaryById = new Map(guideMeasured.rows.map((row) => [row.id, row]));
    assert.equal(primaryById.get(guideChain.rootId)?.primaryText, "Pi", "the pi root reads Pi");
    assert.equal(primaryById.get(guideChain.childId)?.primaryText, "Codex", "the codex child reads Codex");
    assert.equal(primaryById.get(guideChain.grandchildId)?.primaryText, "Claude Code", "the claude grandchild reads Claude Code");
    assert.equal(primaryById.get(guideChain.loneId)?.primaryText, "Codex", "the standalone agent reads Codex");
    for (const row of guideMeasured.rows) {
      assert.ok(
        row.primaryScrollW <= row.primaryClientW + 1,
        `guide row ${row.id} provider reads whole: "${row.primaryText}" scrolls ${row.primaryScrollW}px in ${row.primaryClientW}px`,
      );
      assert.ok(row.stateW > 0, `guide row ${row.id} keeps its own state visible`);
      assert.ok(
        row.rowScrollW <= row.rowClientW + 1,
        `guide row ${row.id} never clips horizontally`,
      );
    }
    // R1 density on the multi-provider card: same indent + line-box proof
    // along the genuine Pi -> Codex -> Claude Code chain (the standalone
    // root shares depth 0, so the step assert follows the chain, not the
    // row order).
    const guideIndentOf = (row) => row.rowLeft - Math.round(guideMeasured.cardRect.left);
    report.indentGuide = Object.fromEntries(
      guideMeasured.rows.map((row) => [row.id, guideIndentOf(row)]),
    );
    const guideChainRows = [guideChain.rootId, guideChain.childId, guideChain.grandchildId].map(
      (id) => primaryById.get(id),
    );
    assert.ok(
      guideIndentOf(guideChainRows[0]) <= 32,
      `the pi root starts near the card edge (indent ${guideIndentOf(guideChainRows[0])}px)`,
    );
    assert.ok(
      guideIndentOf(guideChainRows[1]) > guideIndentOf(guideChainRows[0]) &&
        guideIndentOf(guideChainRows[2]) > guideIndentOf(guideChainRows[1]),
      "the codex child and claude grandchild step right down the chain",
    );
    for (const row of guideMeasured.rows) {
      assert.ok(
        row.tailRight !== null && row.tailRight <= Math.round(guideMeasured.cardRect.right) + 1,
        `guide row ${row.id} actions draw inside the card`,
      );
      if (row.stateText !== null && row.stateText.length <= 10) {
        assert.equal(row.wrapped, false, `guide row ${row.id} ("${row.primaryText}" ${row.stateText}) holds one line`);
      }
    }
    report.densityGuide = "pass";
    // R1 finisher: the same nesting proof on the genuine Pi -> Codex ->
    // Claude Code chain — genuine gutter, disclosure right of the card
    // fold, provider text right of the workspace title, connectors (with
    // pseudo geometry) inside the card, ~12px steps down the chain.
    const guideCardLeft = Math.round(guideMeasured.cardRect.left);
    const guideCardRight = Math.round(guideMeasured.cardRect.right);
    const guideRootIndent = guideIndentOf(guideChainRows[0]);
    assert.ok(
      guideRootIndent >= 20 && guideRootIndent <= 40,
      `the pi root nests in a genuine gutter (indent ${guideRootIndent}px)`,
    );
    assert.ok(
      guideMeasured.cardFoldLeft !== null &&
        guideChainRows[0].disclosureLeft !== null &&
        guideChainRows[0].disclosureLeft > guideMeasured.cardFoldLeft,
      `the pi disclosure nests right of the card fold (${guideChainRows[0].disclosureLeft} vs ${guideMeasured.cardFoldLeft})`,
    );
    assert.ok(
      guideMeasured.cardTitleLeft !== null &&
        guideChainRows[0].primaryLeft > guideMeasured.cardTitleLeft,
      `the pi provider text starts right of the workspace title (${guideChainRows[0].primaryLeft} vs ${guideMeasured.cardTitleLeft})`,
    );
    assert.ok(
      guideMeasured.treeConnectors.length === guideMeasured.rows.length,
      `every guide row owns its connector node (${guideMeasured.treeConnectors.length} nodes for ${guideMeasured.rows.length} rows)`,
    );
    for (const connector of guideMeasured.treeConnectors) {
      for (const [name, extent] of [["guide", connector.vertical], ["elbow", connector.elbow]]) {
        if (!extent) continue;
        assert.ok(
          extent.left >= guideCardLeft - 1 && extent.right <= guideCardRight + 1,
          `guide depth ${connector.depth} ${name} connector draws inside the card (${extent.left}..${extent.right} in ${guideCardLeft}..${guideCardRight})`,
        );
      }
    }
    for (let index = 1; index < guideChainRows.length; index += 1) {
      const step = guideIndentOf(guideChainRows[index]) - guideIndentOf(guideChainRows[index - 1]);
      assert.ok(
        step >= 8 && step <= 20,
        `guide depth ${guideChainRows[index].depth} steps ~12px right of its parent (step ${step}px)`,
      );
    }
    report.nestingGuide = {
      rootIndent: guideRootIndent,
      rootDisclosureLeft: guideChainRows[0].disclosureLeft,
      cardFoldLeft: guideMeasured.cardFoldLeft,
      rootPrimaryLeft: guideChainRows[0].primaryLeft,
      cardTitleLeft: guideMeasured.cardTitleLeft,
      connectors: guideMeasured.treeConnectors,
    };
    const guideBadges = await page.evaluate(
      (id) => [...document.querySelectorAll(`[data-worktree-card-id="${id}"] .shell-worktree-agent-main-badge`)]
        .map((badge) => badge.closest("[data-worktree-agent-row]")?.getAttribute("data-worktree-agent-row")),
      worktree2Id,
    );
    assert.deepEqual(guideBadges, [guideChain.rootId], "MAIN marks only the genuine root-with-children");
    const loneDisclosure = await page.locator(`[data-worktree-agent-row="${guideChain.loneId}"]`).locator('button[aria-label*="child agent"]').count();
    assert.equal(loneDisclosure, 0, "the standalone agent has no child disclosure");
    // The fixture sessions report whatever the daemon derives for
    // foreground sleepers (working while observed-busy, silence otherwise),
    // so the expected sentence is derived from the live row states with the
    // card's own rule — never hardcoded.
    const guideCardState = await page.evaluate((id) => {
      const card = document.querySelector(`[data-worktree-card-id="${id}"]`);
      return {
        sentence: card?.querySelector(".shell-worktree-card-sentence")?.textContent?.trim() ?? null,
        states: [...card.querySelectorAll("[data-worktree-agent-row]")].map(
          (row) => row.querySelector("[data-worktree-agent-state]")?.getAttribute("data-worktree-agent-state") ?? null,
        ),
      };
    }, worktree2Id);
    const guideSentence = guideCardState.sentence;
    const guideStates = guideCardState.states;
    const guideExpected = guideStates.includes("needs_input")
      ? `${guideStates.filter((s) => s === "needs_input").length} AGENT${guideStates.filter((s) => s === "needs_input").length === 1 ? " NEEDS" : "S NEED"} INPUT`
      : guideStates.includes("working")
        ? `${guideStates.filter((s) => s === "working").length} AGENT${guideStates.filter((s) => s === "working").length === 1 ? "" : "S"} WORKING`
        : guideStates.every((s) => s === "unknown")
          ? `${guideStates.length} AGENT${guideStates.length === 1 ? "" : "S"} NOT REPORTING`
          : "NO ACTIVE AGENTS";
    assert.equal(guideSentence, guideExpected, `the guide card states its fixture condition (${guideSentence})`);
    guide.liveStates = guideStates;
    guide.sentence = guideSentence;
    const multiShot = path.join(output, "guide-layout-multi.png");
    await page.screenshot({ path: multiShot, animations: "disabled" });
    report.screenshots.push(multiShot);
    // R1 finisher: the guide-comparable crop — the sidebar column alone,
    // framed like the owner's reference, beside the full frame above.
    const multiCrop = path.join(output, "guide-layout-multi-crop.png");
    await page.locator(".workspace-sidebar").screenshot({ path: multiCrop, animations: "disabled" });
    report.screenshots.push(multiCrop);

    // Collapsed parent, folded card and selection on the guide card —
    // scoped locators, so the first card's persisted folds are untouched.
    await disclosureFor(guideChain.childId).click();
    await until(async () => {
      const measured = await measureGuideRows(worktree2Id);
      return measured.rows.length === 3 && measured.rows.every((row) => row.id !== guideChain.grandchildId) ? true : false;
    }, "collapsing the codex child hides the claude grandchild");
    const collapsedParentShot = path.join(output, "guide-layout-collapsed-parent.png");
    await page.screenshot({ path: collapsedParentShot, animations: "disabled" });
    report.screenshots.push(collapsedParentShot);
    await disclosureFor(guideChain.childId).click();
    await until(async () => (await measureGuideRows(worktree2Id)).rows.length === 4, "the grandchild returns");
    const card2Fold = page.locator(`[data-worktree-card-id="${worktree2Id}"] .shell-worktree-card-fold`);
    await card2Fold.click();
    await until(async () => (await measureGuideRows(worktree2Id)).rows.length === 0, "the guide card chevron folds its list");
    const foldedSentence = await page.evaluate(
      (id) => document.querySelector(`[data-worktree-card-id="${id}"] .shell-worktree-card-sentence`)?.textContent?.trim() ?? null,
      worktree2Id,
    );
    assert.equal(foldedSentence, guideSentence, "a folded card still states its activity");
    const cardFoldedShot = path.join(output, "guide-layout-card-folded.png");
    await page.screenshot({ path: cardFoldedShot, animations: "disabled" });
    report.screenshots.push(cardFoldedShot);
    await card2Fold.click();
    await until(async () => (await measureGuideRows(worktree2Id)).rows.length === 4, "the guide card restores its list");
    const card2Select = page.locator(`[data-worktree-card-id="${worktree2Id}"] .shell-worktree-card-select`);
    await card2Select.scrollIntoViewIfNeeded();
    await card2Select.click();
    const selectTrajectory = [];
    let selected = false;
    for (let sample = 0; sample < 40 && !selected; sample += 1) {
      const state = await page.evaluate((id) => {
        const card = document.querySelector(`[data-worktree-card-id="${id}"]`);
        const button = card?.querySelector(".shell-worktree-card-select");
        const rect = button?.getBoundingClientRect() ?? null;
        const center = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
        return {
          active: card?.getAttribute("data-active") ?? null,
          ariaCurrent: button?.getAttribute("aria-current") ?? null,
          disabled: button?.disabled ?? null,
          centerTag: center ? `${center.tagName}.${String(center.className).split(" ")[0]}` : null,
        };
      }, worktree2Id);
      selectTrajectory.push(state);
      selected = state.active === "true";
      if (!selected) await delay(500);
    }
    report.selectTrajectory = selectTrajectory;
    assert.ok(selected, `the guide card selects (trajectory: ${JSON.stringify(selectTrajectory.slice(-4))})`);
    const selectedShot = path.join(output, "guide-layout-selected.png");
    await page.screenshot({ path: selectedShot, animations: "disabled" });
    report.screenshots.push(selectedShot);

    // R1 density: the selected card reads blue-tinted, not flat gray. The
    // cascaded colors come from the live stylesheet (getComputedStyle, not
    // source text): a gray wash resolves with equal red/blue channels while
    // the blue wash resolves blue-above-red. Measured against an unselected
    // card in the same capture, so the assert discriminates relatively.
    const readSelectionTint = () =>
      page.evaluate((id) => {
        const parse = (value) => {
          const text = String(value ?? "");
          const rgb = text.match(/rgba?\(([^)]+)\)/);
          if (rgb) {
            const [r, g, b] = rgb[1].split(",").map((part) => Number(part.trim()));
            if ([r, g, b].every(Number.isFinite)) return { kind: "rgb", r, g, b };
          }
          // Chromium resolves color-mix() to color(srgb …), not rgb().
          const srgb = text.match(/color\(\s*srgb\s+([0-9.eE+-]+)\s+([0-9.eE+-]+)\s+([0-9.eE+-]+)/);
          if (srgb) {
            return {
              kind: "rgb",
              r: Number(srgb[1]) * 255,
              g: Number(srgb[2]) * 255,
              b: Number(srgb[3]) * 255,
            };
          }
          // …or to oklab()/lab() (the light blue-600 wash arrives that way):
          // a blue tint reads b << 0 on the yellow-blue axis, gray ≈ 0.
          const lab = text.match(/(?:oklab|lab)\(([^)]+)\)/);
          if (lab) {
            const parts = lab[1].split("/")[0].trim().split(/\s+/).map(Number);
            if (parts.length >= 3 && parts.every(Number.isFinite)) {
              return { kind: "lab", l: parts[0], a: parts[1], b: parts[2] };
            }
          }
          return null;
        };
        const selectedCard = document.querySelector(`[data-worktree-card-id="${id}"][data-active="true"]`);
        const plainCard = document.querySelector("[data-worktree-card-id]:not([data-active='true'])");
        const selectedStyle = selectedCard ? getComputedStyle(selectedCard) : null;
        const plainStyle = plainCard ? getComputedStyle(plainCard) : null;
        return {
          selectedBackground: parse(selectedStyle?.backgroundColor),
          selectedBorder: parse(selectedStyle?.borderColor),
          plainBackground: parse(plainStyle?.backgroundColor),
          selectedBackgroundRaw: String(selectedStyle?.backgroundColor ?? ""),
          selectedBorderRaw: String(selectedStyle?.borderColor ?? ""),
        };
      }, worktree2Id);
    // Node-side tint verdicts over the plain parsed colors above (kept out
    // of the page closure: they run here, against the report values).
    // Blue excess over red (rgb serializations) or blue-axis depth (lab
    // serializations); a gray wash reads ~0 in both.
    const tintExcess = (color) => {
      if (!color) return null;
      if (color.kind === "lab") return { kind: "lab", excess: color.b };
      return { kind: "rgb", excess: color.b - color.r };
    };
    const isBlueWash = (color, { rgb = 8, lab = -0.02 } = {}) => {
      const measured = tintExcess(color);
      if (!measured) return false;
      return measured.kind === "lab" ? measured.excess <= lab : measured.excess >= rgb;
    };
    const tint = await readSelectionTint();
    report.selectionTint = tint;
    assert.ok(tint.selectedBackground && tint.selectedBorder, "the selected card resolves a background and border color");
    assert.ok(
      isBlueWash(tint.selectedBackground, { rgb: 8 }),
      `the selected wash is blue-tinted (${tint.selectedBackgroundRaw})`,
    );
    assert.ok(
      isBlueWash(tint.selectedBorder, { rgb: 20 }),
      `the selected border is blue-tinted (${tint.selectedBorderRaw})`,
    );
    if (tint.plainBackground && tint.selectedBackground?.kind === tint.plainBackground.kind) {
      const selectedExcess = tintExcess(tint.selectedBackground).excess;
      const plainExcess = tintExcess(tint.plainBackground).excess;
      const bluer =
        tint.selectedBackground.kind === "lab" ? selectedExcess < plainExcess : selectedExcess > plainExcess;
      assert.ok(bluer, "the selected card is bluer than its unselected sibling in the same capture");
    }
    report.selectionTinted = "pass";

    // R1 density: the card fold works from the keyboard alone — focus the
    // chevron and drive it with Enter, the way a keyboard-only user folds
    // the tree. Collapsed and restored through key presses, never clicks.
    const card2FoldButton = page.locator(`[data-worktree-card-id="${worktree2Id}"] .shell-worktree-card-fold`);
    await card2FoldButton.focus();
    assert.equal(await card2FoldButton.getAttribute("aria-expanded"), "true", "the fold starts expanded for keyboard input");
    await page.keyboard.press("Enter");
    await until(async () => (await measureGuideRows(worktree2Id)).rows.length === 0, "Enter on the fold hides the tree");
    await page.keyboard.press("Enter");
    await until(async () => (await measureGuideRows(worktree2Id)).rows.length === 4, "Enter again restores the tree");
    report.keyboardFold = "pass";

    // Responsive component validation (test-only widths in this isolated
    // instance through the product's own sidebar-width setting, never the
    // developer's working app): 320 and 400 must keep every provider
    // primary whole. The mandatory natural-width proof is above; these do
    // not replace it.
    report.guideWidths = { natural: guideMeasured };
    for (const testWidth of [320, 400]) {
      await page.evaluate((width) => {
        window.localStorage.setItem("drogon:shell:sidebar-width", String(width));
      }, testWidth);
      await page.reload();
      await page.getByRole("button", { name: "Select guidebiz", exact: true }).waitFor();
      const measured = await until(async () => {
        const next = await measureGuideRows(worktree2Id);
        return next.rows.length === 4 ? next : false;
      }, `the guide card renders again at ${testWidth}px`);
      assert.ok(
        Math.abs(measured.sidebarWidth - testWidth) <= 4,
        `the isolated sidebar measures ~${testWidth}px (saw ${measured.sidebarWidth})`,
      );
      for (const row of measured.rows) {
        assert.ok(
          row.primaryScrollW <= row.primaryClientW + 1,
          `guide row ${row.id} provider reads whole at ${testWidth}px: "${row.primaryText}"`,
        );
      }
      report.guideWidths[String(testWidth)] = measured;
      const widthShot = path.join(output, `guide-layout-${testWidth}.png`);
      await page.screenshot({ path: widthShot, animations: "disabled" });
      report.screenshots.push(widthShot);
    }
    await page.evaluate(() => {
      window.localStorage.setItem("drogon:shell:sidebar-width", "280");
    });
    await page.reload();
    await page.getByRole("button", { name: "Select guidebiz", exact: true }).waitFor();
    // R1 density: the same production card in the light theme — the theme
    // flips by removing the `.dark` root class (theme.ts), verified live
    // before capture. Provider names stay whole, states stay inside, and
    // the selected wash still reads blue-tinted with light contrast.
    // R1 density: the same production card in the light theme. An explicit
    // "light" choice goes through the app's own settings envelope
    // (drogon:settings:ui, settings-store.ts) and is applied by the app
    // itself on reload — a manual class removal gets clobbered by the
    // native theme relay, so the suite uses the product path. The previous
    // choice is restored afterwards, leaving no trace in the fixture.
    const themeKey = "drogon:settings:ui";
    const themeBefore = await page.evaluate((key) => {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null");
        return parsed?.settings?.theme ?? null;
      } catch {
        return null;
      }
    }, themeKey);
    await page.evaluate((key) => {
      let envelope = {};
      try {
        envelope = JSON.parse(window.localStorage.getItem(key) ?? "null") ?? {};
      } catch {
        envelope = {};
      }
      if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) envelope = {};
      const settings =
        envelope.settings && typeof envelope.settings === "object" && !Array.isArray(envelope.settings)
          ? envelope.settings
          : {};
      window.localStorage.setItem(key, JSON.stringify({ ...envelope, settings: { ...settings, theme: "light" } }));
    }, themeKey);
    await page.reload();
    await page.getByRole("button", { name: "Select guidebiz", exact: true }).waitFor();
    const lightState = await page.evaluate(() => ({
      dark: document.documentElement.classList.contains("dark"),
      sidebar: getComputedStyle(document.querySelector(".workspace-sidebar"))?.backgroundColor ?? null,
    }));
    report.lightCaptureState = { ...lightState, themeBefore };
    assert.equal(lightState.dark, false, "the app applies the light theme itself");
    // The reload can outrun selection hydration (the select button renders
    // before the active workspace restores), so reselect the guide card
    // explicitly — the tint proof needs a selected card, and the click is
    // the product's own selection path, not a state injection.
    const reselectGuide = page.locator(`[data-worktree-card-id="${worktree2Id}"] .shell-worktree-card-select`);
    await reselectGuide.scrollIntoViewIfNeeded();
    await reselectGuide.click();
    await until(async () => {
      const active = await page.evaluate(
        (id) => document.querySelector(`[data-worktree-card-id="${id}"]`)?.getAttribute("data-active"),
        worktree2Id,
      );
      return active === "true" ? true : false;
    }, "the guide card reselects for the light capture");
    const lightMeasured = await until(async () => {
      const next = await measureGuideRows(worktree2Id);
      return next.rows.length === 4 ? next : false;
    }, "the guide card renders again in the light theme");
    for (const row of lightMeasured.rows) {
      assert.ok(
        row.primaryScrollW <= row.primaryClientW + 1,
        `light row ${row.id} provider reads whole: "${row.primaryText}"`,
      );
      assert.ok(row.rowScrollW <= row.rowClientW + 1, `light row ${row.id} never clips horizontally`);
      assert.ok(
        row.stateLeft >= lightMeasured.cardRect.left - 1 && row.stateRight <= lightMeasured.cardRect.right + 1,
        `light row ${row.id} state draws inside the card`,
      );
    }
    const lightTint = await readSelectionTint();
    report.lightSelectionTint = lightTint;
    assert.ok(
      lightTint.selectedBackground && isBlueWash(lightTint.selectedBackground, { rgb: 8 }),
      `the selected wash stays blue-tinted in the light theme (${lightTint.selectedBackgroundRaw})`,
    );
    const lightShot = path.join(output, "guide-layout-light.png");
    await page.screenshot({ path: lightShot, animations: "disabled" });
    report.screenshots.push(lightShot);
    const lightCrop = path.join(output, "guide-layout-light-crop.png");
    await page.locator(".workspace-sidebar").screenshot({ path: lightCrop, animations: "disabled" });
    report.screenshots.push(lightCrop);
    report.lightTheme = "pass";
    await page.evaluate(([key, theme]) => {
      let envelope = {};
      try {
        envelope = JSON.parse(window.localStorage.getItem(key) ?? "null") ?? {};
      } catch {
        envelope = {};
      }
      if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) envelope = {};
      const settings =
        envelope.settings && typeof envelope.settings === "object" && !Array.isArray(envelope.settings)
          ? { ...envelope.settings }
          : {};
      if (theme === null || theme === undefined) delete settings.theme;
      else settings.theme = theme;
      window.localStorage.setItem(key, JSON.stringify({ ...envelope, settings }));
    }, [themeKey, themeBefore]);
    await page.reload();
    await page.getByRole("button", { name: "Select guidebiz", exact: true }).waitFor();
    // R1 density: reduced motion — the tree must render identically with
    // transitions suppressed (content is never gated on a reveal class),
    // proven by reloaded rows plus a capture under emulation.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await page.getByRole("button", { name: "Select guidebiz", exact: true }).waitFor();
    const reducedMeasured = await until(async () => {
      const next = await measureGuideRows(worktree2Id);
      return next.rows.length === 4 ? next : false;
    }, "the guide card renders again under reduced motion");
    assert.equal(reducedMeasured.rows.length, 4, "reduced motion keeps every fixture row");
    const reducedShot = path.join(output, "guide-layout-reduced-motion.png");
    await page.screenshot({ path: reducedShot, animations: "disabled" });
    report.screenshots.push(reducedShot);
    report.reducedMotion = "pass";
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.reload();
    await page.getByRole("button", { name: "Select guidebiz", exact: true }).waitFor();
    report.guide = guide;
    // R1 hook truth (activity authority): the guide sentence above is
    // derived from displayed row states, which cannot prove inference
    // authority. These CLI-only assertions pin the authority itself
    // against independent lifecycle fixtures — terminal noise on an
    // observed shell, and a real hook turn on a harness launch. No model
    // inference anywhere: the noise is typed text, the turn is a hook
    // event delivered over the daemon's own RPC. Outside CHECK_NAMES
    // (which the companion test pins); recorded here and in report.checks.
    const hookTruth = { fixture: true, sessions: "observed sleeper + hook-event lifecycle, no inference" };
    // 1. Terminal noise never manufactures hook proof: type into the
    // observed pi root (a shell hosting a sleeper). PTY echo flows, but
    // the row must never claim a hook-proven turn.
    const noiseRoot = await sessionRow(guideChain.rootId);
    await cliJson(
      ["terminal", "send", "--session", guideChain.rootId, "--incarnation", noiseRoot.incarnation, "--text", "echo hook-truth-noise-probe\n"],
      { env, cwd: fixture },
    );
    const noiseBytes = await until(async () => {
      const read = await cliJson(
        ["rpc", "session.read", "--params", JSON.stringify({ sessionId: guideChain.rootId, incarnation: noiseRoot.incarnation, cursor: 0 })],
        { env, cwd: fixture },
      );
      return read.dataBase64 && Buffer.from(read.dataBase64, "base64").toString("utf8").includes("hook-truth-noise-probe") ? true : false;
    }, "the terminal noise reaches the observed shell as PTY output");
    assert.ok(noiseBytes, "noise bytes are independently observed before the authority assertion");
    const noisyRow = await sessionRow(guideChain.rootId);
    assert.notEqual(noisyRow.agentState, "working", "terminal echo on an observed shell never reads working");
    assert.notEqual(noisyRow.agentStateAuthority ?? null, "hook", "terminal echo never deposits hook proof");
    hookTruth.noiseRow = { agentState: noisyRow.agentState, agentStateAuthority: noisyRow.agentStateAuthority ?? null };
    report.checks.push("hook-truth-terminal-noise-never-proves-a-turn");
    // 2. A real hook turn carries proof: launch pi through the product's
    // own harness surface with a fixture sleeper behind the harness name
    // (agentCmdOverrides, absolute path — no PATH dependence, no model),
    // then drive the pi hook namespace over session.hook_event.
    const hookPiScript = path.join(fixture, "hook-truth-pi.sh");
    await writeFile(hookPiScript, "#!/bin/sh\nexec sleep 60\n");
    await chmod(hookPiScript, 0o755);
    await writeFile(
      path.join(dataDir, "agent-settings.json"),
      JSON.stringify({
        version: 1,
        settings: {
          defaultTuiAgent: null,
          disabledTuiAgents: [],
          agentCmdOverrides: { pi: hookPiScript },
          agentDefaultArgs: {},
          agentDefaultEnv: {},
          agentStatusHooksEnabled: true,
          tabAutoGenerateTitle: false,
          promptCacheTimerEnabled: false,
          promptCacheTtlMs: 300000,
          codexSessionSourceHome: "",
        },
      }),
    );
    const hookLaunch = await cliJson(
      ["rpc", "harness.start", "--params", JSON.stringify({ workspaceId: workspace2Id, harnessId: "pi", permissionMode: "inherit", requestId: `hook-truth-${Date.now()}` })],
      { env, cwd: fixture },
    );
    assert.equal(hookLaunch.harnessId, "pi", "the hook fixture is a launched pi session");
    const hookTurn = await cliJson(
      ["rpc", "session.hook_event", "--params", JSON.stringify({ sessionId: hookLaunch.id, incarnation: hookLaunch.incarnation, event: "AgentStart" })],
      { env, cwd: fixture },
    );
    assert.equal(hookTurn.agentState, "working", "a real resumption hook opens a silent turn");
    assert.equal(hookTurn.agentStateAuthority, "hook", "the open turn carries hook proof");
    // 3. The hook-proven turn renders: while the turn is open, the sidebar
    // row for the harness session reads Working — the DOM proof the
    // CLI-only lifecycle above never waited on.
    const readHookRowState = (sessionId) =>
      page.evaluate((sid) => {
        const row = document.querySelector(`[data-worktree-agent-row="${sid}"]`);
        if (!row) return null;
        const state = row.querySelector("[data-worktree-agent-state]");
        return {
          cardId: row.closest("[data-worktree-card-id]")?.getAttribute("data-worktree-card-id") ?? null,
          state: state?.getAttribute("data-worktree-agent-state") ?? null,
          label: row.querySelector(".shell-worktree-agent-state-label")?.textContent?.trim() ?? null,
        };
      }, sessionId);
    const hookWorkingRow = await until(async () => {
      const row = await readHookRowState(hookLaunch.id);
      return row && row.state === "working" ? row : false;
    }, "the hook session row reads Working while the turn is open");
    assert.equal(hookWorkingRow.cardId, worktree2Id, "the hook session nests under the guide card");
    assert.equal(hookWorkingRow.label, "Working", "the open turn states Working in words");
    hookTruth.workingRow = hookWorkingRow;
    const hookWorkingShot = path.join(output, "guide-layout-hook-working.png");
    await page.screenshot({ path: hookWorkingShot, animations: "disabled" });
    report.screenshots.push(hookWorkingShot);
    const hookWorkingCrop = path.join(output, "guide-layout-hook-working-crop.png");
    await page.locator(".workspace-sidebar").screenshot({ path: hookWorkingCrop, animations: "disabled" });
    report.screenshots.push(hookWorkingCrop);
    const hookEnd = await cliJson(
      ["rpc", "session.hook_event", "--params", JSON.stringify({ sessionId: hookLaunch.id, incarnation: hookLaunch.incarnation, event: "AgentEnd" })],
      { env, cwd: fixture },
    );
    assert.equal(hookEnd.agentState, "idle", "a real turn end concludes to idle");
    assert.equal(hookEnd.agentStateAuthority, "hook", "the concluded turn keeps hook proof");
    // 4. The concluded turn renders: the same row reads Idle once AgentEnd
    // lands — real Working/Idle DOM evidence for the hook lifecycle.
    const hookIdleRow = await until(async () => {
      const row = await readHookRowState(hookLaunch.id);
      return row && row.state === "idle" ? row : false;
    }, "the hook session row reads Idle after the turn ends");
    assert.equal(hookIdleRow.cardId, worktree2Id, "the concluded turn stays under the guide card");
    assert.equal(hookIdleRow.label, "Idle", "the concluded turn states Idle in words");
    hookTruth.idleRow = hookIdleRow;
    const hookIdleShot = path.join(output, "guide-layout-hook-idle.png");
    await page.screenshot({ path: hookIdleShot, animations: "disabled" });
    report.screenshots.push(hookIdleShot);
    // R1 consistency: after AgentEnd the proven Pi row reads Idle while the
    // four other fixture agents never reported — unknown is not evidence of
    // inactivity, so the card states the four silent agents, never NO ACTIVE.
    const mixedUnknownSentence = await until(async () => {
      const sentence = await page.evaluate(
        (id) => document.querySelector(`[data-worktree-card-id="${id}"] .shell-worktree-card-sentence`)?.textContent?.trim() ?? null,
        worktree2Id,
      );
      return sentence === "4 AGENTS NOT REPORTING" ? sentence : false;
    }, "the mixed unknown+idle guide card states not-reporting, never no-active-agents");
    assert.equal(mixedUnknownSentence, "4 AGENTS NOT REPORTING", "four silent fixture agents beside one proven Idle read as not reporting");
    hookTruth.mixedUnknownSentence = mixedUnknownSentence;
    report.checks.push("mixed-unknown-idle-card-states-not-reporting");
    hookTruth.turnRow = { agentState: hookTurn.agentState, agentStateAuthority: hookTurn.agentStateAuthority };
    hookTruth.endRow = { agentState: hookEnd.agentState, agentStateAuthority: hookEnd.agentStateAuthority };
    // The harness.start session stays listed until the fixture daemon
    // stops; stop it explicitly so no harness child outlives the check.
    await cliJson(
      ["rpc", "session.stop", "--params", JSON.stringify({ sessionId: hookLaunch.id, incarnation: hookLaunch.incarnation })],
      { env, cwd: fixture },
    );
    await until(async () => (await sessionRow(hookLaunch.id))?.verdict === "exited", "the hook fixture session exited");
    report.checks.push("hook-truth-hook-lifecycle-carries-proof");
    report.hookTruth = hookTruth;
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
