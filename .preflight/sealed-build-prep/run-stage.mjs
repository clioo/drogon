#!/usr/bin/env node
// DRAFT sealed-build stage driver — prep-lane artifact, NOT wired into any build.
// Executes exactly one stage command under the audited custody/deadline
// primitives from <root>/scripts/acceptance-process.mjs (shell:false,
// windowsHide:true) with bounded *descendant* cleanup via a detached process
// group: deadline -> SIGTERM to -pgid -> 5s grace -> SIGKILL to -pgid ->
// 2s force wait. Verdict vocabulary matches acceptance-process.mjs exactly:
// "exited" is reported ONLY when the direct child's exit is observed;
// every other outcome is "unverifiable" (loss of contact never proves exit).
//
// Usage:
//   node .preflight/sealed-build-prep/run-stage.mjs --root <repoRoot>
//     --stage <S1..S11> --deadline-ms <n> --log <retainedLog> --receipt <dir>
//     [--cwd <dir>] [--env-json '{"K":"V"}'] -- <file> <args...>
//
// Exit codes: 0 stage exited 0; 2 spawn/driver failure; 3 deadline exceeded;
// 4 stage exited nonzero / signaled. A JSON receipt is ALWAYS appended to
// <receipt>/stage-receipts.jsonl, including on driver failure.

import { appendFileSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

function usageFail(message) {
  console.error(`run-stage: ${message}`);
  console.error(
    "usage: run-stage.mjs --root R --stage S --deadline-ms N --log L --receipt D [--cwd C] [--env-json J] -- <file> <args...>",
  );
  process.exit(2);
}

const raw = process.argv.slice(2);
const sep = raw.indexOf("--");
if (sep === -1) usageFail("missing -- separator before stage command");
const flags = raw.slice(0, sep);
const command = raw.slice(sep + 1);
if (command.length === 0) usageFail("no stage command after --");

const opt = {};
for (let i = 0; i < flags.length; i += 2) {
  if (!flags[i].startsWith("--") || i + 1 >= flags.length) usageFail("bad flags");
  opt[flags[i].slice(2)] = flags[i + 1];
}
for (const key of ["root", "stage", "deadline-ms", "log", "receipt"]) {
  if (!opt[key]) usageFail(`missing --${key}`);
}
const deadlineMs = Number(opt["deadline-ms"]);
if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) usageFail("bad --deadline-ms");

const root = path.resolve(opt.root);
const receiptDir = path.resolve(opt.receipt);
mkdirSync(receiptDir, { recursive: true });
mkdirSync(path.dirname(path.resolve(opt.log)), { recursive: true });
const logFd = openSync(path.resolve(opt.log), "a");

const { startAcceptanceProcess, waitAcceptanceExit } = await import(
  pathToFileURL(path.join(root, "scripts", "acceptance-process.mjs")).href
);

const receipt = {
  stage: opt.stage,
  file: command[0],
  argv: command.slice(1),
  cwd: opt.cwd ? path.resolve(opt.cwd) : process.cwd(),
  deadlineMs,
  verdict: "unverifiable",
  code: null,
  signal: null,
  forced: false,
  groupCleanup: { termSent: false, killSent: false },
  log: path.resolve(opt.log),
  error: null,
};

function finish(exitCode) {
  receipt.endedAt = new Date().toISOString();
  appendFileSync(
    path.join(receiptDir, "stage-receipts.jsonl"),
    JSON.stringify(receipt) + "\n",
  );
  process.exit(exitCode);
}

// Resolve the stage file without a shell: absolute path, or PATH lookup.
let file = command[0];
if (!path.isAbsolute(file) || file.includes(path.sep)) {
  if (!file.includes(path.sep)) {
    const found = spawnSync("/usr/bin/which", [file], { encoding: "utf8" });
    const hit = found.status === 0 ? found.stdout.trim().split("\n")[0] : "";
    if (!hit) {
      receipt.error = `stage binary not on PATH: ${file}`;
      console.error(`run-stage: ${receipt.error}`);
      finish(2);
    }
    file = hit;
  }
  file = path.resolve(receipt.cwd, file);
}

let env = { ...process.env };
if (opt["env-json"]) {
  try {
    env = { ...env, ...JSON.parse(opt["env-json"]) };
  } catch (error) {
    receipt.error = `bad --env-json: ${error.message}`;
    console.error(`run-stage: ${receipt.error}`);
    finish(2);
  }
}

let child;
try {
  child = startAcceptanceProcess(file, command.slice(1), {
    cwd: receipt.cwd,
    env,
    detached: true, // new pgid => signals to -pid reach ALL descendants
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (error) {
  receipt.error = `spawn failed: ${error.message}`;
  console.error(`run-stage: ${receipt.error}`);
  finish(2);
}

const { writeSync } = await import("node:fs");
child.stdout.on("data", (chunk) => {
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  try {
    writeSync(logFd, buf);
  } catch {}
  process.stdout.write(buf);
});
child.stderr.on("data", (chunk) => {
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  try {
    writeSync(logFd, buf);
  } catch {}
  process.stderr.write(buf);
});

const killGroup = (signal) => {
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch {
    return false;
  }
};

const GRACE_MS = 5000;
const FORCE_MS = 2000;

const timer = setTimeout(async () => {
  // Deadline: bounded group teardown. The direct child's exit may still be
  // observed during grace; otherwise the verdict stays "unverifiable".
  receipt.groupCleanup.termSent = killGroup("SIGTERM");
  const graceful = await waitAcceptanceExit(child, GRACE_MS);
  if (graceful.verdict === "exited") {
    Object.assign(receipt, graceful, { forced: false });
    receipt.error = `deadline ${deadlineMs}ms exceeded; group SIGTERM reaped the stage`;
    console.error(`run-stage: ${receipt.error}`);
    finish(3);
  }
  receipt.forced = true;
  receipt.groupCleanup.killSent = killGroup("SIGKILL");
  const forcedResult = await waitAcceptanceExit(child, FORCE_MS);
  Object.assign(receipt, forcedResult, { forced: true });
  receipt.error = `deadline ${deadlineMs}ms exceeded; group SIGKILL forced=${receipt.groupCleanup.killSent}`;
  console.error(`run-stage: ${receipt.error}`);
  finish(3);
}, deadlineMs);

child.once("error", async (error) => {
  clearTimeout(timer);
  receipt.error = `stage process error: ${error.message}`;
  console.error(`run-stage: ${receipt.error}`);
  finish(2);
});

child.once("exit", async () => {
  clearTimeout(timer);
  const observed = await waitAcceptanceExit(child, 0);
  Object.assign(receipt, observed);
  if (observed.verdict !== "exited") {
    receipt.error = "stage end unobservable; classifying unverifiable, never exited";
    console.error(`run-stage: ${receipt.error}`);
    finish(2);
  }
  if (observed.code !== 0) {
    receipt.error = `stage exited code=${observed.code} signal=${observed.signal}`;
    console.error(`run-stage: ${receipt.error}`);
    finish(4);
  }
  finish(0);
});
