// Bundled drogon-cli status probe (journey J10 / task R12-I): read-only
// observation of the `drogon-cli` shim J3 installs under `<data-dir>/bin`
// (plus the `drogon` alias and PATH fallbacks). No writes, no credentials:
// only the resolved path and the first line of `--version`.
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import path from "node:path";
import {
  cliStatusResultSchema,
  type CliStatusResult,
} from "../shared/settings-contract";
import type { Result } from "../shared/session-contract";
import { dataDirectory } from "./native-client";

const PROBE_TIMEOUT_MS = 8_000;
const PROBE_MAX_BUFFER = 64 * 1024;

export type CliProbeRunOk = {
  ok: true;
  stdout: string;
  stderr: string;
  exitCode: number;
};
export type CliProbeRunFail = { ok: false; reason: string };
export type CliProbeRunResult = CliProbeRunOk | CliProbeRunFail;
export type CliProbeRunner = (
  file: string,
  args: string[],
  options: { timeoutMs: number; maxBuffer: number },
) => Promise<CliProbeRunResult>;

function defaultRunner(
  file: string,
  args: string[],
  options: { timeoutMs: number; maxBuffer: number },
): Promise<CliProbeRunResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        timeout: options.timeoutMs,
        maxBuffer: options.maxBuffer,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const errno = error as NodeJS.ErrnoException & { killed?: boolean };
          if (errno.code === "ENOENT")
            return resolve({ ok: false, reason: "not-installed" });
          if (errno.code === "ETIMEDOUT" || errno.killed === true)
            return resolve({ ok: false, reason: "timed-out" });
          const exitCode =
            typeof (error as { code?: unknown }).code === "number"
              ? ((error as { code: number }).code ?? 1)
              : 1;
          return resolve({
            ok: true,
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? ""),
            exitCode,
          });
        }
        resolve({ ok: true, stdout, stderr, exitCode: 0 });
      },
    );
  });
}

async function defaultIsExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export type CliProbeDeps = {
  /** Directory holding the J3 shims (`bin/drogon-cli` underneath). */
  dataDir?: string;
  /** Raw PATH to search when the shim dir has no candidate. */
  pathEnv?: string;
  /** PATH delimiter (`:` POSIX, `;` Windows). Defaults per platform. */
  pathDelimiter?: string;
  isExecutable?: (filePath: string) => Promise<boolean>;
  run?: CliProbeRunner;
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Ordered candidates: the data-dir shims first, then PATH lookups. */
export function cliCandidates(
  dataDir: string,
  pathEnv: string | undefined,
  pathDelimiter: string,
): { commandName: string; commandPath: string; fromPath: boolean }[] {
  const exe = process.platform === "win32" ? ".exe" : "";
  const out: { commandName: string; commandPath: string; fromPath: boolean }[] =
    [];
  for (const name of ["drogon-cli", "drogon"]) {
    out.push({
      commandName: name,
      commandPath: path.join(dataDir, "bin", `${name}${exe}`),
      fromPath: false,
    });
  }
  if (pathEnv) {
    for (const dir of pathEnv.split(pathDelimiter)) {
      if (dir === "") continue;
      for (const name of ["drogon-cli", "drogon"]) {
        out.push({
          commandName: name,
          commandPath: path.join(dir, `${name}${exe}`),
          fromPath: true,
        });
      }
    }
  }
  return out;
}

function unavailable(
  commandName: string,
  detail: string,
): Result<CliStatusResult> {
  const checked = cliStatusResultSchema.safeParse({
    available: false,
    commandName,
    commandPath: null,
    version: null,
    detail,
  });
  if (!checked.success) return internalError();
  return { ok: true, result: checked.data };
}

function internalError(): Result<never> {
  return {
    ok: false,
    error: {
      code: "internal_error",
      message: "The CLI status response does not match its contract.",
      retryable: false,
    },
  };
}

export async function probeCliStatus(
  deps: CliProbeDeps = {},
): Promise<Result<CliStatusResult>> {
  const dataDir = deps.dataDir ?? dataDirectory();
  const delimiter = deps.pathDelimiter ?? (process.platform === "win32" ? ";" : ":");
  const isExecutable = deps.isExecutable ?? defaultIsExecutable;
  const run = deps.run ?? defaultRunner;
  const candidates = cliCandidates(dataDir, deps.pathEnv ?? process.env.PATH, delimiter);

  let resolved: { commandName: string; commandPath: string } | null = null;
  for (const candidate of candidates) {
    if (await isExecutable(candidate.commandPath)) {
      resolved = candidate;
      break;
    }
  }
  if (!resolved)
    return unavailable(
      "drogon-cli",
      "drogon-cli is not installed or not on PATH (expected at <data-dir>/bin/drogon-cli).",
    );

  const versionRun = await run(resolved.commandPath, ["--version"], {
    timeoutMs: PROBE_TIMEOUT_MS,
    maxBuffer: PROBE_MAX_BUFFER,
  });
  if (!versionRun.ok) {
    const checked = cliStatusResultSchema.safeParse({
      available: true,
      commandName: resolved.commandName,
      commandPath: resolved.commandPath,
      version: null,
      detail:
        versionRun.reason === "timed-out"
          ? `Found at ${resolved.commandPath} but --version timed out.`
          : `Found at ${resolved.commandPath}.`,
    });
    if (!checked.success) return internalError();
    return { ok: true, result: checked.data };
  }
  const firstLine = versionRun.stdout
    .split("\n", 1)[0]
    ?.trim();
  const checked = cliStatusResultSchema.safeParse({
    available: true,
    commandName: resolved.commandName,
    commandPath: resolved.commandPath,
    version:
      versionRun.exitCode === 0 && firstLine
        ? truncate(firstLine, 256)
        : null,
    detail: `Available at ${resolved.commandPath}.`,
  });
  if (!checked.success) return internalError();
  return { ok: true, result: checked.data };
}

const invalid = {
  ok: false,
  error: {
    code: "invalid_argument",
    message: "Invalid CLI status request.",
    retryable: false,
  },
} as const;

/**
 * Registers `drogon:settingsCliStatus` with the same sender/frame gate
 * main/index.ts applies to its own bridge.
 */
export function registerSettingsCliBridge(
  getWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle("drogon:settingsCliStatus", async (event) => {
    const window = getWindow();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      return { ...invalid };
    return probeCliStatus();
  });
}
