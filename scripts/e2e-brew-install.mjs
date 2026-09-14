#!/usr/bin/env node
// MIT Copyright (c) 2026 Lovecast Inc.
// Clean-room end-to-end audit of the public Homebrew install flow:
//
//   brew tap -> brew install --cask -> quarantine/spctl -> drogon-cli ->
//   headless first launch -> brew upgrade --cask -> brew uninstall -> brew zap
//
// The clean room is a throwaway Homebrew prefix cloned under a temp dir, an
// isolated --appdir/--binarydir, a fresh HOME, a fresh DROGON_DATA_DIR and a
// sanitized PATH. It never touches the developer's /Applications/Drogon.app,
// ~/Applications, ~/Library/Application Support/Drogon, or the shared
// /opt/homebrew prefix. Every step asserts with the real command output
// captured; the run prints a JSON summary and exits non-zero on failure.
//
// Fidelity limits (documented, not hidden): a throwaway prefix exercises the
// same cask stanzas, the same quarantine behaviour and the same bundle bytes
// as a default-prefix install, but Homebrew's own prefix layout (Cellar,
// Caskroom, shims) lives under the temp dir instead of /opt/homebrew. The
// launch step spawns Contents/MacOS/Drogon directly (never `open -a`) with
// DROGON_BACKGROUND_WINDOW=1 so OS focus is never stolen.
//
// Typical full run (two 145MB downloads plus a shallow brew clone) takes
// 20-40 minutes:
//
//   node scripts/e2e-brew-install.mjs
//   node scripts/e2e-brew-install.mjs --keep   # keep the room for inspection
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  captureDescendants,
  settleOwnedProcesses,
  startAcceptanceProcess,
  stopAcceptanceProcess,
} from "./acceptance-process.mjs";

const execFileAsync = promisify(execFileCallback);

export const TAP_NAME = "clioo/drogon";
export const TAP_URL = "https://github.com/clioo/homebrew-drogon.git";
export const BREW_URL = "https://github.com/Homebrew/brew.git";
export const CASK_TOKEN = "drogon";
export const APP_NAME = "Drogon.app";
export const BUNDLE_ID = "ai.clioo.drogon";
export const SANITIZED_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
export const BREW_TIMEOUT_MS = 10 * 60 * 1000;
export const LAUNCH_TIMEOUT_MS = 90 * 1000;

export function parseBrewAuditArgs(argv) {
  const options = {
    keep: false,
    tapUrl: TAP_URL,
    fromRev: null,
    toRev: null,
    jsonPath: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => {
      const next = argv[index + 1];
      assert.ok(next !== undefined, `${flag} needs a value`);
      index += 1;
      return next;
    };
    switch (flag) {
      case "--keep":
        options.keep = true;
        break;
      case "--tap-url":
        options.tapUrl = value();
        break;
      case "--from-rev":
        options.fromRev = value();
        break;
      case "--to-rev":
        options.toRev = value();
        break;
      case "--json":
        options.jsonPath = value();
        break;
      default:
        assert.fail(`Unknown option: ${flag}`);
    }
  }
  return options;
}

// Parse the fields of Casks/drogon.rb this audit asserts on. Kept to plain
// line matching: the cask DSL is stable and a full Ruby parse is overkill.
export function parseCaskRuby(text) {
  const pick = (pattern) => text.match(pattern)?.[1] ?? null;
  const version = pick(/^\s*version\s+"([^"]+)"/m);
  const sha256 = pick(/^\s*sha256\s+"([0-9a-f]{64})"/m);
  const urlTemplate = pick(/^\s*url\s+"([^"]+)"/m);
  const app = pick(/^\s*app\s+"([^"]+)"/m);
  const binary = pick(/^\s*binary\s+"([^"]+)"/m);
  const uninstallExecutable = pick(/executable:\s+"([^"]+)"/m);
  const zapBlock = text.match(/zap\s+trash:\s*\[([\s\S]*?)\]/m)?.[1] ?? "";
  const zapTrash = [...zapBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const caveats = text.match(/caveats\s+<<~EOS([\s\S]*?)EOS/m)?.[1] ?? null;
  assert.ok(version, "cask has no version stanza");
  assert.ok(sha256, "cask has no sha256 stanza");
  assert.ok(urlTemplate, "cask has no url stanza");
  return {
    version,
    sha256,
    url: urlTemplate.replaceAll("#{version}", version),
    app,
    binary,
    uninstallExecutable,
    zapTrash,
    caveats,
    advertisesAdHoc: caveats !== null && /ad-hoc/i.test(caveats),
  };
}

// Compare Drogon versions like 0.1.0-rc.2 (a final release outranks its
// release candidates). Returns -1/0/1.
export function compareDrogonVersions(a, b) {
  const parts = (v) => {
    const match = v.match(/^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/);
    assert.ok(match, `not a Drogon version: ${v}`);
    return match.slice(1).map((n, i) => (n === undefined ? (i === 3 ? Number.POSITIVE_INFINITY : 0) : Number(n)));
  };
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < 4; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

export function spctlAccepted(output) {
  return /: accepted/.test(output);
}

export function quarantineAttributePresent(xattrOutput) {
  return /com\.apple\.quarantine/.test(xattrOutput);
}

// Fresh Homebrew installations refuse third-party casks until the tap is
// trusted. The failure text names the recovery command.
export function tapNeedsTrust(output) {
  return /untrusted tap/i.test(output);
}

// Every room-owned path must stay under the room root. Anything else is a
// safety abort, never a best effort.
export function assertRoomContained(roomDir, candidate) {
  const relative = path.relative(roomDir, candidate);
  assert.ok(
    relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative)),
    `refusing path outside the clean room: ${candidate}`,
  );
}

// Daemon match mirroring scripts/drogon-stop-daemon.sh (bundle binary plus
// the --data-dir boundary), additionally scoped to this room's data dir as a
// full path segment so /tmp/x never matches /tmp/x-evil. The shell hook
// scopes by bundle path instead, which is equally room-unique per run.
export function commandMatchesDaemon(command, daemonPath, dataDir) {
  const prefix = `${daemonPath} --data-dir `;
  if (!command.startsWith(prefix)) return false;
  const extra = command.slice(prefix.length);
  return extra === dataDir || extra.startsWith(`${dataDir} `) || extra.startsWith(`${dataDir}/`);
}

export async function step(steps, name, fn) {
  const started = Date.now();
  try {
    const detail = (await fn()) ?? null;
    steps.push({ name, status: "PASSED", detail, durationMs: Date.now() - started });
    return detail;
  } catch (error) {
    steps.push({
      name,
      status: "FAILED",
      detail: String(error?.message ?? error).slice(0, 4000),
      durationMs: Date.now() - started,
    });
    throw error;
  }
}

export function skipStep(steps, name, detail) {
  steps.push({ name, status: "SKIPPED", detail, durationMs: 0 });
}

export function summarizeRun({ steps, cleanup, versions, durationMs }) {
  const failed = steps.filter((s) => s.status === "FAILED");
  const skipped = steps.filter((s) => s.status === "SKIPPED");
  return {
    kind: "brew-cleanroom-audit",
    status: failed.length > 0 ? "FAILED" : "PASSED",
    versions,
    steps: steps.map((s) => ({
      name: s.name,
      status: s.status,
      detail: s.detail ?? null,
      durationMs: s.durationMs ?? null,
    })),
    cleanup,
    durationMs,
    counts: {
      passed: steps.filter((s) => s.status === "PASSED").length,
      failed: failed.length,
      skipped: skipped.length,
    },
  };
}

// ---- live clean-room machinery (darwin only) ----

export async function runHostCommand(file, args, { timeoutMs = 60_000, env = process.env, cwd } = {}) {
  try {
    const result = await execFileAsync(file, args, {
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      env,
      ...(cwd ? { cwd } : {}),
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? String(error.message ?? error),
    };
  }
}

export async function makeCleanRoom() {
  // Canonicalize the room root: TMPDIR on macOS contains the /var ->
  // /private/var symlink, and external tools (brew, ps) report resolved
  // paths. Every containment check below compares against this form.
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), "drogon-brew-e2e-")));
  const room = {
    dir,
    home: path.join(dir, "home"),
    appdir: path.join(dir, "Applications"),
    bindir: path.join(dir, "bin"),
    cache: path.join(dir, "cache"),
    dataDir: path.join(dir, "drogon-data"),
    electronProfile: path.join(dir, "electron-profile"),
    prefix: path.join(dir, "homebrew"),
  };
  for (const p of Object.values(room)) await mkdir(p, { recursive: true });
  await mkdir(path.join(room.dir, "tmp"), { recursive: true });
  const brewEnv = {
    ...process.env,
    HOME: room.home,
    HOMEBREW_CACHE: room.cache,
    HOMEBREW_NO_AUTO_UPDATE: "1",
    HOMEBREW_NO_ANALYTICS: "1",
    HOMEBREW_NO_ENV_HINTS: "1",
    HOMEBREW_NO_INSTALL_CLEANUP: "1",
    HOMEBREW_CASK_OPTS: `--appdir=${room.appdir} --binarydir=${room.bindir}`,
  };
  return { room, brewEnv };
}

export function launchEnv(room) {
  return {
    PATH: SANITIZED_PATH,
    HOME: room.home,
    TMPDIR: path.join(room.dir, "tmp"),
    DROGON_DATA_DIR: room.dataDir,
    DROGON_ELECTRON_PROFILE: room.electronProfile,
    DROGON_BACKGROUND_WINDOW: "1",
    SHELL: "/bin/sh",
  };
}

export async function brew(brewBin, brewEnv, args, { timeoutMs = BREW_TIMEOUT_MS } = {}) {
  const result = await runHostCommand(brewBin, args, { timeoutMs, env: brewEnv });
  if (result.code !== 0) {
    throw new Error(
      `brew ${args.join(" ")} exited ${result.code}\nstdout: ${result.stdout.slice(-3000)}\nstderr: ${result.stderr.slice(-3000)}`,
    );
  }
  return result;
}

// Distinct cask versions in the throwaway tap's history, oldest first.
export async function tapCaskVersions(tapDir) {
  const log = await runHostCommand("git", ["-C", tapDir, "log", "--format=%H", "--", "Casks/drogon.rb"], {
    timeoutMs: 60_000,
  });
  assert.equal(log.code, 0, `git log on the tap failed: ${log.stderr.slice(-500)}`);
  const revs = log.stdout.trim().split("\n").filter(Boolean).reverse();
  const versions = [];
  for (const rev of revs.slice(-10)) {
    const show = await runHostCommand("git", ["-C", tapDir, "show", `${rev}:Casks/drogon.rb`], {
      timeoutMs: 60_000,
    });
    if (show.code !== 0) continue;
    let parsed;
    try {
      parsed = parseCaskRuby(show.stdout);
    } catch {
      continue;
    }
    if (!versions.some((v) => v.version === parsed.version)) {
      versions.push({ rev, version: parsed.version, sha256: parsed.sha256 });
    }
  }
  return versions;
}

export async function tapCheckout(tapDir, rev) {
  const result = await runHostCommand("git", ["-C", tapDir, "checkout", "-q", rev], { timeoutMs: 60_000 });
  assert.equal(result.code, 0, `tap checkout ${rev} failed: ${result.stderr.slice(-500)}`);
}

// Walk a tree, returning relative paths (sockets recorded, never followed).
export async function snapshotTree(root) {
  const out = new Set();
  const walk = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      out.add(path.relative(root, full));
      if (entry.isDirectory() && !entry.isSymbolicLink()) await walk(full);
    }
  };
  await walk(root);
  return out;
}

export async function processCommandLine(pid) {
  try {
    const result = await execFileAsync("/bin/ps", ["-p", String(pid), "-o", "command="], { timeout: 10_000 });
    return result.stdout.trim();
  } catch {
    return null;
  }
}

export async function cliStatus(cliBin, dataDir, extraEnv = {}) {
  return runHostCommand(cliBin, ["--data-dir", dataDir, "status"], {
    timeoutMs: 30_000,
    env: { ...process.env, ...extraEnv },
  });
}

// Start the installed bundle headless and wait until its detached daemon
// answers `drogon-cli status`. Returns the app child plus the daemon pid the
// bundle spawned. An early app exit (e.g. a broken signature/JIT sandbox)
// surfaces with the captured stderr tail instead of a bare timeout.
export async function launchInstalledApp({ appDir, cliBin, room, timeoutMs = LAUNCH_TIMEOUT_MS, owned }) {
  const executable = path.join(appDir, "Contents", "MacOS", "Drogon");
  const daemonPath = path.join(appDir, "Contents", "Resources", "bin", "drogond");
  const env = launchEnv(room);
  const child = startAcceptanceProcess(executable, ["--remote-debugging-port=0"], {
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, ...env },
  });
  if (child.pid) await captureDescendants([child.pid], owned);
  let stderrTail = "";
  child.stderr?.on("data", (bytes) => {
    stderrTail = (stderrTail + bytes.toString()).slice(-8192);
  });
  let exitInfo = null;
  child.once("exit", (code, signal) => {
    exitInfo = { code, signal };
  });
  try {
    const deadline = Date.now() + timeoutMs;
    let lastStatus = null;
    let daemonPids = [];
    while (Date.now() < deadline) {
      if (exitInfo) {
        throw new Error(
          `Drogon.app exited (code ${exitInfo.code} signal ${exitInfo.signal}) before its daemon answered; stderr tail: ${stderrTail.slice(-2000) || "<empty>"}`,
        );
      }
      daemonPids = await findDaemonPids(daemonPath, room.dataDir);
      lastStatus = await cliStatus(cliBin, room.dataDir, env);
      if (lastStatus.code === 0 && daemonPids.length > 0) {
        if (child.pid) await captureDescendants([child.pid], owned);
        return { child, daemonPids, statusStdout: lastStatus.stdout, stderrTail };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(
      `daemon never answered within ${timeoutMs}ms (last status exit ${lastStatus?.code}: ${(lastStatus?.stderr ?? "").slice(-1000)}; daemon pids: ${JSON.stringify(daemonPids)}; stderr tail: ${stderrTail.slice(-1000) || "<empty>"})`,
    );
  } catch (error) {
    // Never leave a half-started app behind on a failed launch: the room
    // reaper is the backstop, but the owner stops what it started first.
    await stopAcceptanceProcess(child, { graceMs: 5000, forceMs: 2000 }).catch(() => {});
    throw error;
  }
}

export async function stopLaunchedApp(launched) {
  if (!launched) return { app: null, forced: false };
  const result = await stopAcceptanceProcess(launched.child, { graceMs: 8000, forceMs: 3000 });
  return { app: result.verdict, forced: result.forced };
}

// Stop the detached daemon through the bundle's own scoped hook (the same
// script the cask uninstall stanza runs), then confirm with a scoped ps
// re-check. Never signals by bare executable name.
export async function stopDaemonViaBundleHook(appDir, dataDir) {
  const hook = path.join(appDir, "Contents", "Resources", "bin", "drogon-stop-daemon");
  const daemonPath = path.join(appDir, "Contents", "Resources", "bin", "drogond");
  const before = await findDaemonPids(daemonPath, dataDir);
  const result = await runHostCommand("/bin/sh", [hook], { timeoutMs: 30_000 });
  const after = await findDaemonPids(daemonPath, dataDir);
  return { hookExit: result.code, hookStderr: result.stderr.slice(-1000), before, after };
}

export async function pathExists(p) {
  try {
    await lstat(p);
    return true;
  } catch {
    return false;
  }
}

export function expandZapPath(entry, home) {
  if (entry === "~") return home;
  if (entry.startsWith("~/")) return path.join(home, entry.slice(2));
  return entry;
}

// ---- audit phases ----

export async function auditFreshInstall(ctx, cask) {
  const { brewBin, brewEnv, room, steps } = ctx;
  const appDir = path.join(room.appdir, APP_NAME);
  const cliBin = path.join(room.bindir, "drogon-cli");

  await step(steps, `install ${cask.version}`, async () => {
    const result = await brew(brewBin, brewEnv, ["install", "--cask", `${TAP_NAME}/${CASK_TOKEN}`]);
    assert.ok(await pathExists(appDir), `app missing after install: ${appDir}\n${result.stderr.slice(-1000)}`);
    assert.ok(await pathExists(cliBin), `binary shim missing after install: ${cliBin}`);
    return result.stderr.slice(-1500) || result.stdout.slice(-1500);
  });

  await step(steps, `quarantine+spctl ${cask.version}`, async () => {
    const xattr = await runHostCommand("/usr/bin/xattr", ["-p", "com.apple.quarantine", appDir], { timeoutMs: 30_000 });
    const quarantined = xattr.code === 0 || quarantineAttributePresent(xattr.stdout + xattr.stderr);
    // Homebrew may quarantine the downloaded zip rather than the installed
    // .app; check the executable too before calling it unquarantined.
    let quarantineEvidence = (xattr.stdout + xattr.stderr).slice(-500);
    if (!quarantined) {
      const exe = await runHostCommand("/usr/bin/xattr", ["-p", "com.apple.quarantine", path.join(appDir, "Contents", "MacOS", "Drogon")], { timeoutMs: 30_000 });
      quarantineEvidence = (exe.stdout + exe.stderr).slice(-500);
      assert.ok(exe.code === 0, `no quarantine attribute on the installed app (Homebrew should quarantine cask downloads): ${quarantineEvidence}`);
    }
    const spctl = await runHostCommand("/usr/sbin/spctl", ["-a", "-t", "exec", appDir], { timeoutMs: 60_000 });
    const accepted = spctlAccepted(spctl.stdout + spctl.stderr);
    if (cask.advertisesAdHoc) {
      // The cask's own caveats tell the user this build is ad-hoc signed and
      // needs Open Anyway: spctl must NOT silently accept it, or the caveat
      // (and the README signing note) would be describing the wrong UX.
      assert.ok(!accepted, `ad-hoc cask unexpectedly accepted by spctl: ${spctl.stdout}${spctl.stderr}`);
      return `quarantined; spctl rejects (matches ad-hoc caveats): ${(spctl.stdout + spctl.stderr).slice(-300)}`;
    }
    assert.ok(accepted, `notarized cask rejected by spctl (a real user gets a Gatekeeper prompt): ${spctl.stdout}${spctl.stderr}`);
    return `quarantined; spctl accepted (notarized): ${(spctl.stdout + spctl.stderr).slice(-300)} | quarantine: ${quarantineEvidence.slice(-200)}`;
  });

  await step(steps, `drogon-cli ${cask.version}`, async () => {
    const version = await runHostCommand(cliBin, ["--version"], { timeoutMs: 30_000 });
    assert.equal(version.code, 0, `drogon-cli --version failed: ${version.stderr.slice(-500)}`);
    assert.ok(version.stdout.includes(cask.version), `drogon-cli --version ${JSON.stringify(version.stdout.trim())} != cask ${cask.version}`);
    const bare = await runHostCommand("/usr/bin/env", ["-i", `PATH=${SANITIZED_PATH}`, cliBin, "--version"], {
      timeoutMs: 30_000,
      env: { PATH: SANITIZED_PATH },
    });
    assert.equal(bare.code, 0, `drogon-cli needs more than a bare PATH: ${bare.stderr.slice(-500)}`);
    assert.ok(bare.stdout.includes(cask.version), `bare-PATH version mismatch: ${JSON.stringify(bare.stdout.trim())}`);
    return version.stdout.trim();
  });

  return { appDir, cliBin };
}

export async function auditLaunch(ctx, appDir, cliBin, label = "first launch headless") {
  const { room, steps, owned } = ctx;
  const daemonPath = path.join(appDir, "Contents", "Resources", "bin", "drogond");
  let launched = null;
  try {
    const detail = await step(steps, label, async () => {
      launched = await launchInstalledApp({ appDir, cliBin, room, owned });
      const dataStat = await stat(room.dataDir);
      assert.ok(dataStat.isDirectory(), "data directory was not created");
      assert.ok(!path.relative(room.dir, room.dataDir).startsWith(".."), "data dir escaped the room");
      return `daemon pids ${JSON.stringify(launched.daemonPids)}; status: ${launched.statusStdout.trim().slice(0, 500)}`;
    });
    return { launched, detail };
  } catch (error) {
    if (launched) {
      await stopLaunchedApp(launched).catch(() => {});
      await stopDaemonViaBundleHook(appDir, room.dataDir).catch(() => {});
    }
    throw error;
  }
}

export async function auditUninstallZap(ctx, appDir, cliBin, cask, homeBefore) {
  const { brewBin, brewEnv, room, steps } = ctx;
  const daemonPath = path.join(appDir, "Contents", "Resources", "bin", "drogond");

  await step(steps, "uninstall stops the daemon", async () => {
    const running = await findDaemonPids(daemonPath, room.dataDir);
    assert.ok(running.length > 0, "no daemon running before uninstall; hook has nothing to prove");
    const commands = Object.fromEntries(
      await Promise.all(running.map(async (pid) => [pid, await processCommandLine(pid)])),
    );
    const result = await brew(brewBin, brewEnv, ["uninstall", "--cask", `${TAP_NAME}/${CASK_TOKEN}`]);
    for (const pid of running) {
      const after = await processCommandLine(pid);
      assert.ok(after === null || after !== commands[pid], `daemon pid ${pid} still runs the same command after uninstall`);
    }
    assert.ok(!(await pathExists(appDir)), "app still present after uninstall");
    assert.ok(!(await pathExists(cliBin)), "drogon-cli shim still present after uninstall");
    const survivors = await findDaemonPids(daemonPath, room.dataDir);
    assert.deepEqual(survivors, [], `hook left daemons behind: ${JSON.stringify(survivors)}`);
    return result.stderr.slice(-1500) || result.stdout.slice(-1500);
  });

  await step(steps, "zap removes the real footprint", async () => {
    const trashPaths = cask.zapTrash.map((entry) => expandZapPath(entry, room.home));
    const missing = [];
    for (const p of trashPaths) {
      if (!(await pathExists(p))) missing.push(p);
    }
    const result = await brew(brewBin, brewEnv, ["zap", "--cask", `${TAP_NAME}/${CASK_TOKEN}`]);
    const remaining = [];
    for (const p of trashPaths) {
      if (await pathExists(p)) remaining.push(p);
    }
    assert.deepEqual(remaining, [], `zap left trash behind: ${JSON.stringify(remaining)}`);
    const homeAfter = await snapshotTree(room.home);
    const leftovers = [...homeAfter].filter((p) => !homeBefore.has(p));
    assert.deepEqual(leftovers, [], `product wrote paths the zap stanza misses: ${JSON.stringify(leftovers)}`);
    return `zap cleared ${trashPaths.length} paths (${missing.length} already absent pre-zap); no untracked leftovers under the fresh HOME`;
  });
}

async function developerFingerprint() {
  // Prove the developer's own install was never touched: a stable fingerprint
  // of the real app and data dir, compared again after the run.
  const probe = async (p) => {
    try {
      const s = await lstat(p);
      return `${p} mtime=${s.mtimeMs} size=${s.size}`;
    } catch {
      return `${p} ABSENT`;
    }
  };
  return [
    await probe("/Applications/Drogon.app"),
    await probe(path.join(process.env.HOME ?? "~", "Library", "Application Support", "Drogon")),
  ].join("\n");
}

async function readTapCask(tapDir) {
  const text = await readFile(path.join(tapDir, "Casks", "drogon.rb"), "utf8");
  return { text, ...parseCaskRuby(text) };
}

// Best-effort reaping of anything the run started that is still alive inside
// the room: scoped to pids whose command line lives under the room dir, with
// the identity revalidated immediately before each signal. Never broad kills.
async function reapRoomProcesses(room, owned) {
  const reaped = [];
  const list = await runHostCommand("/bin/ps", ["-axo", "pid=,ppid=,lstart=,command="], { timeoutMs: 20_000 });
  if (list.code !== 0) return [{ verdict: "unverifiable", note: "ps failed" }];
  for (const line of list.stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const command = match[4];
    if (!command.includes(room.dir)) continue;
    if (pid === process.pid) continue;
    const identity = `${match[3]} ${command}`;
    if (owned.has(pid) && owned.get(pid) !== identity) continue; // recycled pid
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      reaped.push({ pid, verdict: "unverifiable", note: "SIGTERM refused" });
      continue;
    }
    let gone = false;
    for (let i = 0; i < 40 && !gone; i += 1) {
      await new Promise((r) => setTimeout(r, 250));
      gone = (await processCommandLine(pid)) !== command;
    }
    if (!gone) {
      try {
        if ((await processCommandLine(pid)) === command) process.kill(pid, "SIGKILL");
      } catch { /* exited between check and signal */ }
      await new Promise((r) => setTimeout(r, 500));
      gone = (await processCommandLine(pid)) !== command;
    }
    reaped.push({ pid, command: command.slice(0, 200), verdict: gone ? "exited" : "live" });
  }
  return reaped;
}

async function main() {
  const started = Date.now();
  const options = parseBrewAuditArgs(process.argv.slice(2));
  const steps = [];
  const owned = new Map();
  const versions = {};
  const cleanup = {
    ownedProcesses: [],
    roomReap: [],
    developerInstallUntouched: null,
    roomRemoved: false,
    roomPath: null,
  };
  let room = null;
  let brewEnv = null;
  let runError = null;
  try {
    if (process.platform !== "darwin") {
      skipStep(steps, "clean-room brew audit", `requires macOS, running on ${process.platform}`);
    } else {
      const fingerprintBefore = await developerFingerprint();
      ({ room, brewEnv } = await makeCleanRoom());
      cleanup.roomPath = room.dir;
      const homeBefore = await snapshotTree(room.home);
      const brewBin = path.join(room.prefix, "bin", "brew");
      const ctx = { brewBin, brewEnv, room, steps, owned };

      await step(steps, "create clean room", async () => {
        for (const p of [room.appdir, room.bindir, room.home, room.dataDir]) assertRoomContained(room.dir, p);
        assert.notEqual(room.home, process.env.HOME, "fresh HOME must differ from the real HOME");
        assert.notEqual(room.dataDir, path.join(process.env.HOME ?? "", "Library", "Application Support", "Drogon"));
        return `room=${room.dir}`;
      });

      await step(steps, "clone throwaway Homebrew prefix", async () => {
        const clone = await runHostCommand("git", ["clone", "--depth", "1", BREW_URL, room.prefix], {
          timeoutMs: BREW_TIMEOUT_MS,
        });
        assert.equal(clone.code, 0, `brew clone failed: ${clone.stderr.slice(-1000)}`);
        const version = await runHostCommand(brewBin, ["--version"], { timeoutMs: 120_000, env: brewEnv });
        assert.equal(version.code, 0, `throwaway brew does not run: ${version.stderr.slice(-1000)}`);
        return version.stdout.trim().split("\n")[0];
      });

      let trustRequired = false;
      const tapDir = await step(steps, `tap ${TAP_NAME}`, async () => {
        const first = await runHostCommand(brewBin, ["tap", TAP_NAME, options.tapUrl], {
          timeoutMs: BREW_TIMEOUT_MS,
          env: brewEnv,
        });
        if (first.code !== 0 && tapNeedsTrust(first.stdout + first.stderr)) {
          // What a fresh-Mac user hits following the README: trust the tap,
          // then tap again. Recorded, not hidden: the README must say this.
          await brew(brewBin, brewEnv, ["trust", "--tap", TAP_NAME]);
          await brew(brewBin, brewEnv, ["tap", TAP_NAME, options.tapUrl]);
          trustRequired = true;
        } else if (first.code !== 0) {
          throw new Error(
            `brew tap exited ${first.code}\nstdout: ${first.stdout.slice(-2000)}\nstderr: ${first.stderr.slice(-2000)}`,
          );
        }
        const dirResult = await brew(brewBin, brewEnv, ["--repo", TAP_NAME]);
        const dir = dirResult.stdout.trim().split("\n").pop();
        assertRoomContained(room.dir, dir);
        return dir;
      });
      versions.trustRequiredOnFreshPrefix = trustRequired;

      let fromEntry = null;
      let toEntry = null;
      await step(steps, "resolve upgrade pair", async () => {
        const all = await tapCaskVersions(tapDir);
        assert.ok(all.length > 0, "tap history serves no drogon cask version");
        toEntry = all[all.length - 1];
        fromEntry = all.length > 1 ? all[all.length - 2] : all[0];
        if (options.toRev) {
          await tapCheckout(tapDir, options.toRev);
          toEntry = { rev: options.toRev, ...(await readTapCask(tapDir)) };
        }
        if (options.fromRev) {
          await tapCheckout(tapDir, options.fromRev);
          fromEntry = { rev: options.fromRev, ...(await readTapCask(tapDir)) };
        }
        versions.from = fromEntry.version;
        versions.to = toEntry.version;
        return `from=${fromEntry.version}@${fromEntry.rev.slice(0, 12)} to=${toEntry.version}@${toEntry.rev.slice(0, 12)}`;
      });

      // Fresh-install leg against the TO version (what a new user gets today):
      // install -> quarantine/spctl -> cli -> headless launch -> uninstall ->
      // zap, leaving the room clean for the upgrade leg.
      await tapCheckout(tapDir, toEntry.rev);
      const caskTo = await readTapCask(tapDir);
      const fresh = await auditFreshInstall(ctx, caskTo);
      const firstLaunch = await auditLaunch(ctx, fresh.appDir, fresh.cliBin);
      await stopLaunchedApp(firstLaunch.launched).catch(() => {});
      await auditUninstallZap(ctx, fresh.appDir, fresh.cliBin, caskTo, homeBefore);

      if (versions.from === versions.to) {
        skipStep(steps, "upgrade previous -> current", `single-version tap history (${versions.to}); nothing to upgrade from`);
      } else {
        // Upgrade leg: install FROM, seed a daemon + data, upgrade to TO,
        // then uninstall + zap the upgraded install.
        const homeBeforeUpgrade = await snapshotTree(room.home);
        await tapCheckout(tapDir, fromEntry.rev);
        const caskFrom = await readTapCask(tapDir);
        await step(steps, `install previous ${caskFrom.version}`, async () => {
          await brew(brewBin, brewEnv, ["install", "--cask", `${TAP_NAME}/${CASK_TOKEN}`]);
          assert.ok(await pathExists(fresh.appDir), "previous-version app missing after install");
          return `installed ${caskFrom.version}`;
        });
        const seeded = await auditLaunch(ctx, fresh.appDir, fresh.cliBin, `launch previous ${caskFrom.version}`);
        const oldDaemonPid = seeded.launched.daemonPids[0];
        const oldDaemonCmd = await processCommandLine(oldDaemonPid);
        const dataBefore = await snapshotTree(room.dataDir);
        await stopLaunchedApp(seeded.launched).catch(() => {});
        await tapCheckout(tapDir, toEntry.rev);
        await step(steps, `upgrade ${versions.from} -> ${versions.to}`, async () => {
          const result = await brew(brewBin, brewEnv, ["upgrade", "--cask", `${TAP_NAME}/${CASK_TOKEN}`]);
          const afterCmd = await processCommandLine(oldDaemonPid);
          assert.ok(afterCmd === null || afterCmd !== oldDaemonCmd, `old daemon pid ${oldDaemonPid} still runs after upgrade: ${(afterCmd ?? "").slice(0, 200)}`);
          const versionOut = await runHostCommand(fresh.cliBin, ["--version"], { timeoutMs: 30_000 });
          assert.ok(versionOut.stdout.includes(versions.to), `upgraded cli reports ${JSON.stringify(versionOut.stdout.trim())}, want ${versions.to}`);
          return `old daemon pid ${oldDaemonPid} gone; cli now ${versionOut.stdout.trim()}; brew: ${(result.stderr.slice(-1000) || result.stdout.slice(-1000))}`;
        });
        const upgradedLaunch = await auditLaunch(ctx, fresh.appDir, fresh.cliBin, `launch upgraded ${versions.to}`);
        await step(steps, "upgraded data opens without loss", async () => {
          const dataAfter = await snapshotTree(room.dataDir);
          const lost = [...dataBefore].filter((p) => !p.endsWith(".sock") && !dataAfter.has(p));
          assert.deepEqual(lost, [], `data files lost across upgrade: ${JSON.stringify(lost.slice(0, 20))}`);
          return `data dir preserved (${dataAfter.size} entries); status: ${upgradedLaunch.launched.statusStdout.trim().slice(0, 300)}`;
        });
        await stopLaunchedApp(upgradedLaunch.launched).catch(() => {});
        await auditUninstallZap(ctx, fresh.appDir, fresh.cliBin, caskTo, homeBeforeUpgrade);
      }

      const fingerprintAfter = await developerFingerprint();
      await step(steps, "developer install untouched", async () => {
        assert.equal(fingerprintAfter, fingerprintBefore, `developer's install changed:\nbefore:\n${fingerprintBefore}\nafter:\n${fingerprintAfter}`);
        return fingerprintBefore.replaceAll("\n", " | ");
      });
    }
  } catch (error) {
    runError = error;
    if (!steps.some((s) => s.status === "FAILED")) {
      steps.push({ name: "run", status: "FAILED", detail: String(error?.message ?? error).slice(0, 4000), durationMs: 0 });
    }
  } finally {
    if (room) {
      try {
        cleanup.ownedProcesses = await settleOwnedProcesses(owned);
      } catch (error) {
        cleanup.ownedProcesses = [{ verdict: "unverifiable", note: String(error?.message ?? error).slice(0, 300) }];
      }
      try {
        cleanup.roomReap = await reapRoomProcesses(room, owned);
      } catch (error) {
        cleanup.roomReap = [{ verdict: "unverifiable", note: String(error?.message ?? error).slice(0, 300) }];
      }
      if (!options.keep) {
        await rm(room.dir, { recursive: true, force: true });
        cleanup.roomRemoved = !(await pathExists(room.dir));
      } else {
        cleanup.roomRemoved = false;
      }
    }
  }
  const summary = summarizeRun({ steps, cleanup, versions, durationMs: Date.now() - started });
  if (runError && summary.status !== "FAILED") summary.status = "FAILED";
  console.log(JSON.stringify(summary, null, 2));
  if (options.jsonPath) await writeFile(options.jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  process.exitCode = summary.status === "PASSED" ? 0 : 1;
}

const invokedAsScript =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) await main();


// The detached daemon matching this bundle's binary and --data-dir boundary,
// mirroring scripts/drogon-stop-daemon.sh matching rules.
export async function findDaemonPids(daemonPath, dataDir) {
  const result = await runHostCommand("/bin/ps", ["-axo", "pid=,command="], { timeoutMs: 20_000 });
  assert.equal(result.code, 0, "ps failed");
  const pids = [];
  for (const line of result.stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    if (!match) continue;
    if (commandMatchesDaemon(match[2], daemonPath, dataDir)) pids.push(Number(match[1]));
  }
  return pids;
}

