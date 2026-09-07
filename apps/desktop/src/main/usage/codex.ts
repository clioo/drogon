// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only; never edit the reference):
//   src/main/rate-limits/codex-auth-presence.ts (gate the fetch on
//     CODEX_HOME/auth.json so signed-out machines never spawn Codex)
//   src/main/rate-limits/codex-rpc-rate-limit-probe.ts (initialize +
//     account/rateLimits/read JSON-RPC over a read-only app-server child)
//   src/main/codex-cli/codex-read-only-app-server-args.ts (read-only args)
// Read-only: spawns `codex app-server` with approval never + sandbox
// read-only. Never writes credentials, config, or any other file; the child
// is always terminated and every failure resolves fail-closed.
import { spawn, type ChildProcess } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { ProviderUsage } from "../../shared/usage-contract";
import {
  classifyCodexRateLimitWindows,
  CODEX_SESSION_WINDOW_MINUTES,
  CODEX_WEEKLY_WINDOW_MINUTES,
  mapCodexRateLimitWindow,
  type CodexRateLimitWindowsSnapshot,
} from "./windows";

const RPC_INIT_TIMEOUT_MS = 15_000;
const RPC_TIMEOUT_MS = 10_000;
const AUTH_PROBE_TIMEOUT_MS = 5_000;

const READ_ONLY_APP_SERVER_ARGS = [
  "-c",
  "approval_policy=never",
  "-s",
  "read-only",
  "-a",
  "never",
  "app-server",
] as const;

function closed(status: ProviderUsage["status"], error: string): ProviderUsage {
  return {
    provider: "codex",
    session: null,
    weekly: null,
    updatedAt: Date.now(),
    error,
    status,
  };
}

function codexHomeDir(): string {
  return process.env.CODEX_HOME || path.join(homedir(), ".codex");
}

async function authFilePresent(codexHome: string): Promise<boolean> {
  try {
    await access(path.join(codexHome, "auth.json"), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Minimal PATH lookup for the `codex` executable; null when not installed. */
export async function resolveCodexCommand(
  pathEnv: string = process.env.PATH ?? "",
): Promise<string | null> {
  const dirs = pathEnv
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, process.platform === "win32" ? "codex.exe" : "codex");
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not runnable here; keep scanning PATH.
    }
  }
  return null;
}

type RpcResponse = {
  id?: number;
  result?: { rateLimits?: CodexRateLimitWindowsSnapshot | null };
  error?: { code?: number; message?: string };
};

function rpcLine(id: number, method: string, params?: unknown): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} })}\n`;
}

function readRateLimitsViaRpc(child: ChildProcess, signal?: AbortSignal): Promise<ProviderUsage> {
  return new Promise<ProviderUsage>((resolve) => {
    let buffer = "";
    let settled = false;
    let rpcId = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stdin = child.stdin;
    const stdout = child.stdout;
    const stderr = child.stderr;
    let stderrText = "";

    const kill = () => {
      try {
        child.kill();
      } catch {
        // Already gone; the usage number is what matters, not the kill.
      }
    };
    const settle = (result: ProviderUsage) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      stdout?.off("data", onStdoutData);
      stderr?.off("data", onStderrData);
      kill();
      resolve(result);
    };
    const arm = (ms: number, message: string) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => settle(closed("error", message)), ms);
    };
    const onAbort = () => settle(closed("error", "Codex usage fetch aborted."));
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    let initId = -1;
    let rateLimitsId = -1;
    const onStderrData = (chunk: Buffer) => {
      stderrText += chunk.toString();
      if (stderrText.length > 20_000) stderrText = stderrText.slice(-20_000);
    };
    const onStdoutData = (chunk: Buffer) => {
      buffer += chunk.toString();
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;
        let message: RpcResponse;
        try {
          message = JSON.parse(line) as RpcResponse;
        } catch {
          continue;
        }
        if (message.id === initId) {
          arm(RPC_TIMEOUT_MS, "Codex usage request timed out.");
          try {
            stdin?.write(
              `${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`,
            );
            rateLimitsId = ++rpcId;
            stdin?.write(rpcLine(rateLimitsId, "account/rateLimits/read"));
          } catch {
            settle(closed("error", "Could not talk to the Codex helper."));
          }
          continue;
        }
        if (message.id !== rateLimitsId || message.id === -1) continue;
        if (message.error) {
          settle(closed("error", "Codex reported a usage error."));
          return;
        }
        const classified = classifyCodexRateLimitWindows(message.result?.rateLimits);
        settle({
          provider: "codex",
          session: mapCodexRateLimitWindow(classified.session, CODEX_SESSION_WINDOW_MINUTES),
          weekly: mapCodexRateLimitWindow(classified.weekly, CODEX_WEEKLY_WINDOW_MINUTES),
          updatedAt: Date.now(),
          error: null,
          status: "ok",
        });
      }
    };

    child.on("error", (error: Error) => {
      const code = (error as NodeJS.ErrnoException).code;
      settle(
        closed(
          code === "ENOENT" ? "unavailable" : "error",
          code === "ENOENT"
            ? "Codex CLI not found."
            : "Could not start the Codex helper.",
        ),
      );
    });
    child.on("close", () => {
      settle(closed("error", "Codex helper exited before reporting usage."));
    });
    stdout?.on("data", onStdoutData);
    stderr?.on("data", onStderrData);
    arm(RPC_INIT_TIMEOUT_MS, "Codex usage request timed out.");
    try {
      initId = ++rpcId;
      stdin?.write(rpcLine(initId, "initialize", { clientInfo: { name: "drogon", version: "0.1.0" } }));
    } catch {
      settle(closed("error", "Could not talk to the Codex helper."));
    }
  });
}

export type CodexUsageDeps = {
  codexHome?: string;
  resolveCommand?: () => Promise<string | null>;
  spawnAppServer?: (command: string) => ChildProcess;
};

export async function readCodexUsage(deps: CodexUsageDeps = {}): Promise<ProviderUsage> {
  const home = deps.codexHome ?? codexHomeDir();
  const authed = await withTimeout(authFilePresent(home), AUTH_PROBE_TIMEOUT_MS);
  if (authed !== true) {
    return closed("unavailable", "Codex is not signed in on this machine.");
  }
  const command = await (deps.resolveCommand ?? resolveCodexCommand)();
  if (!command) {
    return closed("unavailable", "Codex CLI not found.");
  }
  const spawnFn =
    deps.spawnAppServer ??
    ((cmd: string) =>
      spawn(cmd, [...READ_ONLY_APP_SERVER_ARGS], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, CODEX_HOME: home },
      }));
  let child: ChildProcess;
  try {
    child = spawnFn(command);
  } catch {
    return closed("error", "Could not start the Codex helper.");
  }
  return readRateLimitsViaRpc(child);
}
