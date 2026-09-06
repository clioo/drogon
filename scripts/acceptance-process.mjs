import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
