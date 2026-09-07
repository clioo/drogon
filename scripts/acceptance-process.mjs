import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
