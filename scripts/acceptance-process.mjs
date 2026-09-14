import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const execFileAsync = promisify(execFile);

async function processRows() {
  const { stdout } = await runAcceptanceProcess("/bin/ps", ["-axo", "pid=,ppid=,lstart=,command="], { timeout: 20_000 });
  return stdout.trim().split("\n").map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*)$/);
    return match && { pid: Number(match[1]), parent: Number(match[2]), identity: `${match[3]} ${match[4]}` };
  }).filter(Boolean);
}

/** Capture descendants before their parent closes. Never infer ownership from an executable name. */
export async function captureDescendants(seeds, owned) {
  const rows = await processRows();
  const parents = new Set(seeds.filter(Boolean));
  let added;
  do {
    added = false;
    for (const row of rows) {
      if (parents.has(row.parent) && !parents.has(row.pid)) {
        parents.add(row.pid);
        owned.set(row.pid, row.identity);
        added = true;
      }
    }
  } while (added);
  for (const seed of seeds.filter(Boolean)) {
    const row = rows.find((candidate) => candidate.pid === seed);
    if (row) owned.set(seed, row.identity);
  }
  return owned;
}

/** Settle only survivors whose captured identity still matches; never signal a reused PID. */
export async function settleOwnedProcesses(owned) {
  const verdicts = [];
  for (const [pid, identity] of owned) {
    let rows = await processRows();
    let row = rows.find((candidate) => candidate.pid === pid);
    if (!row || row.identity !== identity) {
      verdicts.push({ pid, identity, verdict: "exited" });
      continue;
    }
    try { process.kill(pid, "SIGTERM"); }
    catch {
      verdicts.push({ pid, identity, verdict: "unverifiable", note: "SIGTERM refused" });
      continue;
    }
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await delay(250);
      rows = await processRows();
      row = rows.find((candidate) => candidate.pid === pid);
      if (!row || row.identity !== identity) break;
    }
    if (row && row.identity === identity) {
      try { process.kill(pid, "SIGKILL"); } catch { /* Gone between observation and signal. */ }
      await delay(400);
      rows = await processRows();
      row = rows.find((candidate) => candidate.pid === pid);
      verdicts.push({ pid, identity, verdict: row && row.identity === identity ? "live" : "exited", note: "terminated by the run that started it" });
      continue;
    }
    verdicts.push({ pid, identity, verdict: "exited", note: "terminated by the run that started it" });
  }
  return verdicts;
}

export function waitAcceptanceExit(child, timeoutMs) {
  const observed = () => ({
    verdict: "exited",
    code: child.exitCode,
    signal: child.signalCode,
  });
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve(observed());
  return new Promise((resolve) => {
    const finish = (result) => {
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      resolve(result);
    };
    const onExit = () => finish(observed());
    const timer = setTimeout(
      () => finish({ verdict: "unverifiable" }),
      timeoutMs,
    );
    child.once("exit", onExit);
  });
}

export async function stopAcceptanceProcess(
  child,
  { graceMs = 5000, forceMs = 2000 } = {},
) {
  if (child.exitCode !== null || child.signalCode !== null)
    return { ...(await waitAcceptanceExit(child, 0)), forced: false };
  if (!child.pid) return { verdict: "unverifiable", forced: false };
  let forced = false;
  try {
    child.kill("SIGTERM");
    const graceful = await waitAcceptanceExit(child, graceMs);
    if (graceful.verdict === "exited") return { ...graceful, forced };
    forced = true;
    child.kill("SIGKILL");
    return { ...(await waitAcceptanceExit(child, forceMs)), forced };
  } catch (error) {
    return { verdict: "unverifiable", forced, error: error.message };
  }
}

export function startAcceptanceProcess(file, args, options = {}) {
  return spawn(file, args, { ...options, shell: false, windowsHide: true });
}

export function runAcceptanceProcess(file, args, options = {}) {
  return execFileAsync(file, args, {
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    ...options,
    shell: false,
    windowsHide: true,
  });
}
