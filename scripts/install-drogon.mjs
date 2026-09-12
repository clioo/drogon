#!/usr/bin/env node
// MIT Copyright (c) 2026 Lovecast Inc.
// `make install`: one command that replaces the installed Drogon with a fresh
// build of this checkout and brings both halves back up.
//
//   package -> verify -> quit the app -> stop its detached daemon ->
//   swap /Applications/Drogon.app -> relaunch -> confirm the new daemon
//
// The daemon is deliberately detached (it outlives the app bundle it came
// from), so replacing the bundle alone leaves a new renderer talking to an old
// service. This script stops it through the INSTALLED bundle's own scoped
// `drogon-stop-daemon` before the swap, then lets the new app spawn the new
// one. Nothing here is silent: every process it stops is matched by exact
// executable path, revalidated immediately before any signal, and reported.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  lstat,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  APP_BUNDLE_ID,
  bundlePaths,
  verifiedBuildInfo,
} from "./desktop-artifacts.mjs";
import { runAcceptanceProcess } from "./acceptance-process.mjs";

export const APP_NAME = "Drogon.app";
export const DEFAULT_APPLICATIONS = "/Applications";
export const PREVIOUS_PREFIX = ".Drogon-previous-";
const STAGING_PREFIX = ".drogon-install-";

export function parseInstallArgs(argv) {
  const options = {
    bundle: null,
    fromMain: false,
    applications: DEFAULT_APPLICATIONS,
    restart: true,
    keep: 1,
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
      case "--bundle":
        options.bundle = value();
        break;
      case "--from-main":
        options.fromMain = true;
        break;
      case "--applications":
        options.applications = value();
        break;
      case "--no-restart":
        options.restart = false;
        break;
      case "--keep": {
        const keep = Number(value());
        assert.ok(
          Number.isInteger(keep) && keep >= 0,
          "--keep needs a non-negative whole number",
        );
        options.keep = keep;
        break;
      }
      default:
        assert.fail(`Unknown option: ${flag}`);
    }
  }
  assert.ok(
    !(options.fromMain && options.bundle),
    "--from-main builds its own bundle; drop --bundle",
  );
  options.source = options.bundle
    ? "bundle"
    : options.fromMain
      ? "main"
      : "checkout";
  return options;
}

/** A process line belongs to `prefix` only on an argv boundary, so a
 *  neighbouring bundle (`Drogon.app.previous/...`) is never mistaken for it. */
export function commandMatches(command, prefix) {
  return command === prefix || command.startsWith(`${prefix} `);
}

/** Parse `ps -axo pid=,command=` output into the entries owned by `prefix`. */
export function matchingProcesses(psOutput, prefix) {
  const matches = [];
  for (const line of psOutput.split("\n")) {
    const parsed = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!parsed) continue;
    const command = parsed[2].trim();
    if (commandMatches(command, prefix))
      matches.push({ pid: Number(parsed[1]), command });
  }
  return matches;
}

/**
 * Stop every process whose command line is `prefix`: SIGTERM, wait, then
 * SIGKILL only what is still there. The command line is re-read before each
 * signal so a recycled pid belonging to someone else is never signalled.
 */
export async function stopProcesses(prefix, deps) {
  const {
    listProcesses,
    kill,
    sleep,
    now = () => Date.now(),
    graceMs = 15000,
    forceMs = 5000,
    pollMs = 200,
  } = deps;
  const alivePids = async () =>
    matchingProcesses(await listProcesses(), prefix).map((entry) => entry.pid);
  const requested = await alivePids();
  const result = { prefix, requested, stopped: [], forced: [], survivors: [] };
  if (requested.length === 0) return result;

  for (const pid of requested)
    if ((await alivePids()).includes(pid)) kill(pid, "SIGTERM");
  const waitForExit = async (pids, budgetMs) => {
    const deadline = now() + budgetMs;
    let remaining = pids;
    while (remaining.length > 0 && now() < deadline) {
      await sleep(pollMs);
      const current = await alivePids();
      remaining = remaining.filter((pid) => current.includes(pid));
    }
    return remaining;
  };
  let remaining = await waitForExit(requested, graceMs);
  for (const pid of remaining) {
    if (!(await alivePids()).includes(pid)) continue;
    kill(pid, "SIGKILL");
    result.forced.push(pid);
  }
  remaining = await waitForExit(remaining, forceMs);
  result.survivors = remaining;
  result.stopped = requested.filter((pid) => !remaining.includes(pid));
  return result;
}

export function packagedBundle(text) {
  const records = text.split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const packaged = records.findLast((record) => record?.status === "PACKAGED");
  assert.ok(packaged?.bundle, "The packager did not report a bundle");
  return packaged;
}

export function buildMainRunDirectory(text) {
  const match = /^Build directory \(retained[^)]*\): (.+)$/m.exec(text);
  assert.ok(match, "build-main.sh did not report its build directory");
  return match[1].trim();
}

export function previousBundleName(date = new Date()) {
  return `${PREVIOUS_PREFIX}${date.toISOString().replace(/[:.]/g, "-")}.app`;
}

/** Retained rollback copies are timestamped, so name order is age order. */
export function stalePreviousBundles(names, keep) {
  const previous = names
    .filter((name) => name.startsWith(PREVIOUS_PREFIX) && name.endsWith(".app"))
    .sort();
  return previous.slice(0, Math.max(0, previous.length - keep));
}

async function pathKind(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function runStep(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      ...options,
      stdio: ["ignore", "pipe", "inherit"],
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      // Progress belongs on stderr; stdout stays the machine receipt.
      process.stderr.write(chunk);
    });
    child.once("error", reject);
    child.once("close", (code, signal) =>
      code === 0
        ? resolve(stdout)
        : reject(
            new Error(`${path.basename(file)} exited with ${signal ?? code}`),
          ),
    );
  });
}

async function listProcesses() {
  const { stdout } = await runAcceptanceProcess(
    "/bin/ps",
    ["-axo", "pid=,command="],
    { timeout: 30000, maxBuffer: 32 * 1024 * 1024 },
  );
  return stdout;
}

const liveProcessDeps = {
  listProcesses,
  kill: (pid, signal) => {
    try {
      process.kill(pid, signal);
    } catch (error) {
      // ESRCH: it exited between the re-check and the signal, which is the
      // outcome we wanted anyway.
      if (error.code !== "ESRCH") throw error;
    }
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

async function waitForProcess(prefix, budgetMs) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const found = matchingProcesses(await listProcesses(), prefix);
    if (found.length > 0)
      return { verdict: "live", pids: found.map((entry) => entry.pid) };
    if (Date.now() >= deadline) return { verdict: "unverifiable", pids: [] };
    await liveProcessDeps.sleep(500);
  }
}

/** Quit the installed app the way the user would, so its `will-quit` cleanup
 *  runs; fall back to signals when AppleScript is unavailable or refused. */
async function quitInstalledApp(bundles) {
  const prefixes = bundles.map((bundle) =>
    path.join(bundle, "Contents", "MacOS", "Drogon"),
  );
  const running = async () => {
    const output = await listProcesses();
    return prefixes.flatMap((prefix) => matchingProcesses(output, prefix));
  };
  if ((await running()).length === 0)
    return { requested: [], stopped: [], forced: [], survivors: [] };
  try {
    // Only ever sent to an app that is already running: `tell ... to quit`
    // would otherwise launch it first.
    await runAcceptanceProcess(
      "/usr/bin/osascript",
      ["-e", `tell application id "${APP_BUNDLE_ID}" to quit`],
      { timeout: 30000 },
    );
  } catch (error) {
    process.stderr.write(
      `AppleScript quit unavailable (${error.message.split("\n")[0]}); ` +
        "using signals.\n",
    );
  }
  const stops = [];
  for (const prefix of prefixes)
    stops.push(await stopProcesses(prefix, liveProcessDeps));
  return {
    requested: stops.flatMap((stop) => stop.requested),
    stopped: stops.flatMap((stop) => stop.stopped),
    forced: stops.flatMap((stop) => stop.forced),
    survivors: stops.flatMap((stop) => stop.survivors),
  };
}

/** Stop the detached daemon that belongs to the installed bundle, preferring
 *  the bundle's own scoped stop script over new teardown logic. */
async function stopInstalledDaemon(installed) {
  const daemon = bundlePaths(installed).daemon;
  const prefix = `${daemon} --data-dir`;
  const script = path.join(path.dirname(daemon), "drogon-stop-daemon");
  let via = "stop-script";
  if (await pathKind(script)) {
    try {
      await runAcceptanceProcess(script, [], { timeout: 60000 });
    } catch (error) {
      process.stderr.write(`drogon-stop-daemon reported: ${error.message}\n`);
    }
  } else {
    via = "signals";
    await stopProcesses(prefix, liveProcessDeps);
  }
  const survivors = matchingProcesses(await listProcesses(), prefix);
  return {
    via,
    daemon,
    survivors: survivors.map((entry) => entry.pid),
    verdict: survivors.length === 0 ? "exited" : "unverifiable",
  };
}

async function bundleIdentifier(bundle) {
  const { stdout } = await runAcceptanceProcess("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleIdentifier",
    path.join(bundle, "Contents", "Info.plist"),
  ]);
  return stdout.trim();
}

async function verifyBundle(bundle) {
  const info = await verifiedBuildInfo(bundle);
  await runAcceptanceProcess(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", bundle],
    { timeout: 180000 },
  );
  assert.equal(
    await bundleIdentifier(bundle),
    APP_BUNDLE_ID,
    `${bundle} is not a Drogon bundle`,
  );
  return info;
}

/** Copy beside the target, verify the copy, then two renames. A failed second
 *  rename puts the working app straight back. */
async function swapBundle({ applications, target, source, keep }) {
  const staging = await mkdtemp(path.join(applications, STAGING_PREFIX));
  try {
    const staged = path.join(staging, APP_NAME);
    // ditto keeps the signature, xattrs and symlinks a signed bundle needs.
    await runAcceptanceProcess("/usr/bin/ditto", [source, staged], {
      timeout: 900000,
    });
    await verifyBundle(staged);
    let previous = null;
    if (await pathKind(target)) {
      previous = path.join(applications, previousBundleName());
      await rename(target, previous);
    }
    try {
      await rename(staged, target);
    } catch (error) {
      if (previous) await rename(previous, target);
      throw error;
    }
    const kept = stalePreviousBundles(await readdir(applications), keep);
    for (const stale of kept)
      await rm(path.join(applications, stale), {
        recursive: true,
        force: true,
      });
    return previous;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function buildBundle(options, root) {
  if (options.source === "bundle") return realpath(options.bundle);
  if (options.source === "main") {
    const script = path.join(root, "scripts", "build-main.sh");
    const output = await runStep(script, [], { cwd: root });
    const run = buildMainRunDirectory(output);
    return packagedBundle(await readFile(path.join(run, "package.log"), "utf8"))
      .bundle;
  }
  const packager = path.join(root, "scripts", "package-desktop.mjs");
  return packagedBundle(
    await runStep(process.execPath, [packager], { cwd: root }),
  ).bundle;
}

export async function install(argv) {
  const options = parseInstallArgs(argv);
  assert.equal(
    process.platform,
    "darwin",
    "make install currently targets macOS",
  );
  const root = fileURLToPath(new URL("..", import.meta.url));
  const applications = await realpath(options.applications);
  const target = path.join(applications, APP_NAME);

  const source = await buildBundle(options, root);
  const info = await verifyBundle(source);

  // Identify — and refuse — anything at the target that is not a Drogon
  // app, before a byte of it moves. The incumbent is only asked for its
  // identity: an older build may legitimately fail today's bundle invariants
  // and must still be replaceable (and kept for rollback).
  const existing = await pathKind(target);
  const installed = existing ? await realpath(target) : null;
  if (installed) {
    assert.notEqual(
      installed,
      source,
      "That build is already the installed one",
    );
    assert.equal(
      await bundleIdentifier(installed),
      APP_BUNDLE_ID,
      `${target} is not a Drogon bundle; refusing to replace it`,
    );
  }
  const app = installed
    ? await quitInstalledApp([...new Set([target, installed])])
    : { requested: [], stopped: [], forced: [], survivors: [] };
  assert.deepEqual(app.survivors, [], "The installed Drogon did not quit");
  const daemon = installed
    ? await stopInstalledDaemon(installed)
    : { via: "none", daemon: null, survivors: [], verdict: "exited" };

  const previous = await swapBundle({
    applications,
    target,
    source,
    keep: options.keep,
  });

  const unverifiable = { verdict: "unverifiable", pids: [] };
  let relaunch = {
    started: false,
    app: unverifiable,
    daemon: unverifiable,
  };
  if (options.restart) {
    await runAcceptanceProcess("/usr/bin/open", ["-a", target], {
      timeout: 60000,
    });
    relaunch = {
      started: true,
      app: await waitForProcess(
        path.join(target, "Contents", "MacOS", "Drogon"),
        30000,
      ),
      daemon: await waitForProcess(
        `${bundlePaths(target).daemon} --data-dir`,
        60000,
      ),
    };
  }
  return {
    status: "INSTALLED",
    application: target,
    revision: info.revision,
    version: info.version,
    source,
    previousBundle: previous,
    stoppedApp: app,
    stoppedDaemon: daemon,
    relaunch,
  };
}

// argv[1] may contain spaces, so compare real URLs rather than a template.
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (import.meta.url === entry) {
  const receipt = await install(process.argv.slice(2));
  console.log(JSON.stringify(receipt));
  process.stderr.write(
    `\nDrogon ${receipt.version} (${receipt.revision.slice(0, 12)}) is ` +
      `installed at ${receipt.application}.\n` +
      (receipt.relaunch.started
        ? `App: ${receipt.relaunch.app.verdict}. ` +
          `Service: ${receipt.relaunch.daemon.verdict}.\n`
        : "Not relaunched (--no-restart).\n"),
  );
}
