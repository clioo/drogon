// Read-only settings probes (journey J10): git identity of the selected
// workspace and `gh auth status`. Bounded child processes only — no writes,
// no credentials leave the host (the gh output is truncated display text).
import { execFile } from "node:child_process";
import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import {
  ghAuthStatusResultSchema,
  gitIdentityInputSchema,
  gitIdentityResultSchema,
  type GhAuthStatusResult,
  type GitIdentityResult,
  type GitIdentityInput,
} from "../shared/settings-contract";
import type { Result } from "../shared/session-contract";

const PROBE_TIMEOUT_MS = 8_000;
const PROBE_MAX_BUFFER = 64 * 1024;
const GH_OUTPUT_MAX_CHARS = 2_048;

export type ProbeRunOk = {
  ok: true;
  stdout: string;
  stderr: string;
  exitCode: number;
};
export type ProbeRunFail = { ok: false; reason: string };
export type ProbeRunResult = ProbeRunOk | ProbeRunFail;
export type ProbeRunner = (
  file: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number; maxBuffer: number },
) => Promise<ProbeRunResult>;

function defaultRunner(
  file: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number; maxBuffer: number },
): Promise<ProbeRunResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        cwd: options.cwd,
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
          // A nonzero exit still carries output (e.g. `gh auth status`
          // explains the login state on stderr); report it as a run.
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

/**
 * Parses one `git config <key>` run. Exit 0 yields the trimmed value (or
 * null when empty); exit 1 means unset; any other exit is unparseable.
 */
export function parseGitConfigValue(run: ProbeRunOk): string | null {
  if (run.exitCode !== 0 && run.exitCode !== 1) return null;
  const trimmed = run.stdout.trim();
  return trimmed === "" ? null : trimmed;
}

const NOT_INSTALLED_REASON: Record<string, string> = {
  git: "git is not installed or not on PATH",
  gh: "gh is not installed or not on PATH",
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export async function probeGitIdentity(
  input: GitIdentityInput,
  run: ProbeRunner = defaultRunner,
): Promise<Result<GitIdentityResult>> {
  const parsed = gitIdentityInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: {
        code: "invalid_argument",
        message: "Invalid git identity request.",
        retryable: false,
      },
    };
  const { workspacePath } = parsed.data;
  const options = {
    cwd: workspacePath,
    timeoutMs: PROBE_TIMEOUT_MS,
    maxBuffer: PROBE_MAX_BUFFER,
  };
  const [nameRun, emailRun] = await Promise.all([
    run("git", ["config", "user.name"], options),
    run("git", ["config", "user.email"], options),
  ]);
  // Effective identity for the workspace (repo, then global fallback — the
  // same value git itself would use for a commit there).
  if (!nameRun.ok || !emailRun.ok) {
    const reason =
      nameRun.ok === false && nameRun.reason === "not-installed"
        ? NOT_INSTALLED_REASON.git
        : "git did not respond in time";
    const checked = gitIdentityResultSchema.safeParse({
      workspacePath,
      available: false,
      name: null,
      email: null,
      reason,
    });
    if (!checked.success) return internalError();
    return { ok: true, result: checked.data };
  }
  const checked = gitIdentityResultSchema.safeParse({
    workspacePath,
    available: true,
    name: parseGitConfigValue(nameRun),
    email: parseGitConfigValue(emailRun),
    reason: null,
  });
  if (!checked.success) return internalError();
  return { ok: true, result: checked.data };
}

/**
 * Parses one `gh auth status` run: exit 0 means logged in; any other exit
 * with gh present means not logged in (gh explains why on stderr); a
 * missing binary is unavailable, never "logged out".
 */
export function parseGhAuthStatus(run: ProbeRunOk): {
  loggedIn: boolean;
  output: string;
} {
  const combined = `${run.stdout}\n${run.stderr}`.trim();
  return {
    loggedIn: run.exitCode === 0,
    output: truncate(combined === "" ? "(no output)" : combined, GH_OUTPUT_MAX_CHARS),
  };
}

export async function probeGhAuthStatus(
  run: ProbeRunner = defaultRunner,
): Promise<Result<GhAuthStatusResult>> {
  const result = await run("gh", ["auth", "status"], {
    timeoutMs: PROBE_TIMEOUT_MS,
    maxBuffer: PROBE_MAX_BUFFER,
  });
  if (!result.ok) {
    const output =
      result.reason === "not-installed"
        ? NOT_INSTALLED_REASON.gh
        : "gh did not respond in time";
    const checked = ghAuthStatusResultSchema.safeParse({
      available: false,
      loggedIn: false,
      output,
    });
    if (!checked.success) return internalError();
    return { ok: true, result: checked.data };
  }
  const parsed = parseGhAuthStatus(result);
  const checked = ghAuthStatusResultSchema.safeParse({
    available: true,
    ...parsed,
  });
  if (!checked.success) return internalError();
  return { ok: true, result: checked.data };
}

function internalError(): Result<never> {
  return {
    ok: false,
    error: {
      code: "internal_error",
      message: "The settings probe response does not match its contract.",
      retryable: false,
    },
  };
}

const invalid = {
  ok: false,
  error: {
    code: "invalid_argument",
    message: "Invalid settings probe request.",
    retryable: false,
  },
} as const;

/**
 * Registers `drogon:settingsGitIdentity` / `drogon:settingsGhAuthStatus`
 * with the same sender/frame gate main/index.ts applies to its own bridge.
 */
export function registerSettingsProbes(
  getWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle("drogon:settingsGitIdentity", async (event, input: unknown) => {
    const window = getWindow();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      return { ...invalid };
    return probeGitIdentity(input as GitIdentityInput);
  });
  ipcMain.handle("drogon:settingsGhAuthStatus", async (event) => {
    const window = getWindow();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      return { ...invalid };
    return probeGhAuthStatus();
  });
}
