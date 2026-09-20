#!/usr/bin/env node
// scripts/run-journeys.mjs — sequential machine gate for the journey layer.
//
// Reads scripts/journeys.manifest.json (override with --manifest <path>) and
// runs each listed journey one at a time with its own bounded timeout and its
// own fresh temporary DROGON_DATA_DIR and DROGON_ELECTRON_PROFILE, always
// with DROGON_BACKGROUND_WINDOW=1. Rendered journeys are driven over CDP by
// the journey scripts themselves; this runner never touches OS activation.
//
// Exit codes (all non-zero paths print the reason first):
//   0 — at least one journey passed and none failed.
//   1 — at least one journey failed (timeouts and leftover child processes
//       count as failures), or every journey skipped.
//   2 — the manifest is missing, unparseable, invalid, or lists zero
//       journeys. A run that executed nothing is never reported as success.
//
// Skips: an entry with `requires: "bundle"` runs only when a packaged bundle
// is genuinely present (the entry's own `--bundle <path>` argument, else the
// DROGON_BUNDLE environment variable, must exist). An entry with
// `requires: "pi"` runs only when a `pi` binary is on PATH. Every skip is
// printed with its reason and counted separately; a run whose journeys all
// skipped exits 1, never 0.
//
// Cleanup: each journey spawns detached in its own process group. After the
// journey exits — or after its timeout kills it — the runner SIGKILLs any
// survivors in that group and verifies the group is gone before deleting the
// journey's temp dirs. A journey whose group cannot be verified dead fails.
// Only node builtins are used.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access, constants, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = path.normalize(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_MANIFEST = path.join("scripts", "journeys.manifest.json");
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const KILL_GRACE_MS = 5000;
const VERIFY_GRACE_MS = 2000;

// Worker-identity and ambient-state variables that must never leak from the
// caller's shell into a journey: a present DROGON_DISPATCH_CAPABILITY makes
// drogon-cli send it as the wire credential, which a journey-owned daemon
// truthfully rejects, and ambient data/profile dirs would break isolation.
const STRIPPED_ENV = [
  "DROGON_DISPATCH_CAPABILITY",
  "DROGON_RUN_ID",
  "DROGON_TASK_ID",
  "DROGON_DISPATCH_ID",
  "DROGON_HOST_ID",
  "DROGON_SESSION_ID",
  "DROGON_SESSION_INCARNATION",
  "DROGON_HOOK_INCARNATION",
  "DROGON_HOOK_MARKER",
  "DROGON_HOOK_CLI",
  "DROGON_HOOK_USAGE_ONLY",
  "DROGON_WORKSPACE_ID",
  "DROGON_TERMINAL",
  "DROGON_CLI_COMMAND",
  "DROGON_MENTU_RUNTIME",
  "DROGON_DATA_DIR",
  "DROGON_ELECTRON_PROFILE",
  "PI_SESSION_FILE",
];

const VALID_REQUIRES = new Set([null, "bundle", "pi"]);

function usageError(message) {
  const error = new Error(message);
  error.code = "USAGE";
  return error;
}

export function loadManifest(rawText, manifestPath) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw usageError(`${manifestPath}: unparseable manifest: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw usageError(`${manifestPath}: manifest must be a JSON object`);
  if (!Array.isArray(parsed.journeys))
    throw usageError(`${manifestPath}: manifest must contain a "journeys" array`);
  if (parsed.journeys.length === 0)
    throw usageError(`${manifestPath}: manifest lists zero journeys`);
  return parsed.journeys.map((entry, index) => validateEntry(entry, index, manifestPath));
}

function validateEntry(entry, index, manifestPath) {
  const where = `${manifestPath} journeys[${index}]`;
  if (!entry || typeof entry !== "object" || Array.isArray(entry))
    throw usageError(`${where}: entry must be an object`);
  if (typeof entry.name !== "string" || entry.name.length === 0)
    throw usageError(`${where}: entry needs a non-empty string "name"`);
  if (typeof entry.script !== "string" || entry.script.length === 0)
    throw usageError(`${where}: entry needs a non-empty string "script"`);
  if (entry.script.startsWith("/") || /^[A-Za-z]:\\/.test(entry.script))
    throw usageError(`${where}: "script" must be a repo-relative path`);
  const scriptPath = path.normalize(path.join(root, entry.script));
  const containment = path.relative(root, scriptPath);
  if (containment === "" || containment.startsWith("..") || path.isAbsolute(containment))
    throw usageError(`${where}: "script" must stay inside the repository`);
  if (!existsSync(scriptPath))
    throw usageError(`${where}: script not found: ${entry.script}`);
  const args = entry.args ?? [];
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string"))
    throw usageError(`${where}: "args" must be an array of strings`);
  if (!VALID_REQUIRES.has(entry.requires ?? null))
    throw usageError(`${where}: "requires" must be null, "bundle" or "pi"`);
  const timeoutMs = entry.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw usageError(`${where}: "timeoutMs" must be a positive number`);
  if (typeof entry.note !== "string" || entry.note.length === 0)
    throw usageError(`${where}: entry needs a one-line "note"`);
  return {
    name: entry.name,
    script: entry.script,
    scriptPath,
    args,
    requires: entry.requires ?? null,
    timeoutMs: Math.floor(timeoutMs),
    note: entry.note,
  };
}

export async function executableOnPath(name, envPath = process.env.PATH ?? "") {
  const suffixes = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    for (const suffix of suffixes) {
      try {
        await access(path.join(dir, `${name}${suffix}`), constants.X_OK);
        return true;
      } catch {
        // Keep scanning the rest of PATH.
      }
    }
  }
  return false;
}

// A prerequisite counts as present only when it is genuinely usable: an
// absent bundle or harness is a skip with a reason, never a pass.
export async function checkPrerequisite(entry) {
  if (entry.requires === "pi") {
    if (await executableOnPath("pi")) return { ok: true };
    return { ok: false, reason: "pi harness absent from PATH" };
  }
  if (entry.requires === "bundle") {
    const flagIndex = entry.args.indexOf("--bundle");
    const candidate =
      flagIndex !== -1 ? entry.args[flagIndex + 1] : process.env.DROGON_BUNDLE;
    if (typeof candidate === "string" && candidate.length > 0 && existsSync(candidate))
      return { ok: true };
    return {
      ok: false,
      reason:
        "packaged bundle absent (set DROGON_BUNDLE or pass --bundle <path> to run)",
    };
  }
  return { ok: true };
}

export function journeyEnv(dataDir, profileDir) {
  const env = { ...process.env };
  for (const key of STRIPPED_ENV) delete env[key];
  env.DROGON_DATA_DIR = dataDir;
  env.DROGON_ELECTRON_PROFILE = profileDir;
  env.DROGON_BACKGROUND_WINDOW = "1";
  return env;
}

function groupState(pgid) {
  try {
    process.kill(-pgid, 0);
    return "live";
  } catch (error) {
    if (error?.code === "ESRCH") return "exited";
    return `unverifiable:${error?.code ?? "unknown"}`;
  }
}

async function killGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal);
    return true;
  } catch {
    return false;
  }
}

// Settle one journey's whole process group: signal survivors, then prove the
// group is gone. Returns null when clean, else the failure reason. A live
// group (or one the kernel momentarily reports as EPERM while a reaped
// group number settles) is polled, never trusted on first sight: only a
// group that is still present after the whole window fails the journey.
async function settleGroup(pgid) {
  await killGroup(pgid, "SIGKILL");
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (groupState(pgid) === "exited") return null;
    await delay(250);
  }
  const state = groupState(pgid);
  if (state === "exited") return null;
  if (state === "live") return "journey left child processes behind";
  return `child cleanup unverifiable (process group ${state})`;
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

export async function runJourney(entry) {
  const startedAt = Date.now();
  const workdir = await mkdtemp(path.join(tmpdir(), "drogon-journey-"));
  const dataDir = path.join(workdir, "data");
  const profileDir = path.join(workdir, "electron-profile");
  let child = null;
  let timedOut = false;
  try {
    child = spawn(process.execPath, [entry.scriptPath, ...entry.args], {
      cwd: root,
      env: journeyEnv(dataDir, profileDir),
      stdio: ["ignore", "inherit", "inherit"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const pgid = child.pid;
    if (!pgid) return fail(startedAt, "journey process could not start");
    const outcome = await new Promise((resolve) => {
      const timer = setTimeout(async () => {
        timedOut = true;
        await killGroup(pgid, "SIGTERM");
        // Unref'd: the live child handle already keeps the loop alive, so a
        // journey that ignores SIGTERM still gets its SIGKILL on schedule.
        setTimeout(() => void killGroup(pgid, "SIGKILL"), KILL_GRACE_MS).unref?.();
        resolve({ timeout: true });
      }, entry.timeoutMs);
      timer.unref?.();
      void waitForExit(child).then((exit) => {
        clearTimeout(timer);
        resolve({ timeout: false, ...exit });
      });
    });
    if (outcome.timeout) {
      await waitForExit(child);
      await delay(VERIFY_GRACE_MS);
      const leftover = await settleGroup(pgid);
      return fail(
        startedAt,
        `timeout after ${entry.timeoutMs}ms${leftover ? `; ${leftover}` : "; all child processes reaped"}`,
      );
    }
    const leftover = await settleGroup(pgid);
    if (leftover) return fail(startedAt, leftover);
    if (outcome.code !== 0)
      return fail(
        startedAt,
        outcome.signal
          ? `exited by signal ${outcome.signal}`
          : `exited with code ${outcome.code}`,
      );
    return { status: "pass", seconds: elapsed(startedAt) };
  } catch (error) {
    try {
      if (child?.pid) await settleGroup(child.pid);
    } catch {
      // The reported error below already carries the failure.
    }
    return fail(startedAt, `runner error: ${error.message}`);
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }

  function fail(start, reason) {
    return { status: "fail", seconds: elapsed(start), reason };
  }
  function elapsed(start) {
    return (Date.now() - start) / 1000;
  }
}

export async function runAll(journeys) {
  const results = [];
  for (const entry of journeys) {
    const prereq = await checkPrerequisite(entry);
    if (!prereq.ok) {
      console.log(`SKIP ${entry.name}: ${prereq.reason}`);
      results.push({ name: entry.name, status: "skip", reason: prereq.reason });
      continue;
    }
    const result = await runJourney(entry);
    if (result.status === "pass") {
      console.log(`PASS ${entry.name} (${result.seconds.toFixed(1)}s)`);
    } else {
      console.log(`FAIL ${entry.name} (${result.seconds.toFixed(1)}s): ${result.reason}`);
    }
    results.push({ name: entry.name, ...result });
  }
  return results;
}

function parseArgs(argv) {
  let manifest = path.join(root, DEFAULT_MANIFEST);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--manifest") {
      const value = argv[i + 1];
      if (!value) throw usageError("Usage: run-journeys.mjs [--manifest <path>]");
      manifest = path.resolve(value);
      i += 1;
    } else {
      throw usageError("Usage: run-journeys.mjs [--manifest <path>]");
    }
  }
  return manifest;
}

function summarize(results) {
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;
  console.log(
    `journeys: ${passed} passed, ${failed} failed, ${skipped} skipped (${results.length} total)`,
  );
  return { passed, failed, skipped };
}

async function main() {
  let manifestPath;
  try {
    manifestPath = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`run-journeys: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  let raw;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    console.error(`run-journeys: manifest missing: ${manifestPath}`);
    process.exitCode = 2;
    return;
  }
  let journeys;
  try {
    journeys = loadManifest(raw, manifestPath);
  } catch (error) {
    console.error(`run-journeys: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  const results = await runAll(journeys);
  const { passed, failed } = summarize(results);
  if (failed > 0 || passed === 0) {
    if (passed === 0 && failed === 0)
      console.error("run-journeys: every journey skipped; skips are never passes");
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
