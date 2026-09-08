// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/main/ports/local-workspace-port-attribution.ts
//     (attributePortToWorkspace, path/text normalization, boundary matching)
//   src/main/ports/local-workspace-platform-port-scanner.ts
//     (parseLsofListeningOutput, loadDarwinProcessMetadata)
//   src/main/ports/local-workspace-port-address.ts
//     (parseAddressWithPort, dedupeRawPorts, connectHostForBindHost)
// Adapted: probes are this repo's workspaces ({ id, path }); the scan runs
// in-process (no worker pool, no cooldown/backoff state machine); Windows
// stays fail-closed unavailable like the rest of the usage probes.
import { readlink } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";

export type WorkspacePortProbe = { id: string; path: string };

export type RawListeningPort = {
  host: string;
  port: number;
  pid?: number;
  processName?: string;
  commandLine?: string;
  cwd?: string;
};

export type WorkspacePortOwner = {
  workspaceId: string;
  confidence: "cwd" | "command";
};

const PROBE_TIMEOUT_MS = 5_000;

function exec(
  command: string,
  args: string[],
): Promise<{ stdout: string; error: Error | null }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      resolve({ stdout: typeof stdout === "string" ? stdout : "", error });
    });
  });
}

export function connectHostForBindHost(host: string): string {
  if (host === "*" || host === "0.0.0.0" || host === "::") {
    return "localhost";
  }
  return host;
}

export function dedupeRawPorts(ports: RawListeningPort[]): RawListeningPort[] {
  const seen = new Set<string>();
  const result: RawListeningPort[] = [];
  for (const port of ports) {
    const key = `${connectHostForBindHost(port.host)}:${port.port}:${port.pid ?? "unknown"}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(port);
  }
  return result;
}

export function parseAddressWithPort(
  value: string,
): { host: string; port: number } | null {
  const trimmed = value.trim().replace(/\s+\(LISTEN\)$/i, "");
  const bracketed = trimmed.match(/^\[([^\]]+)\]:(\d+)$/);
  if (bracketed) {
    return { host: bracketed[1], port: Number.parseInt(bracketed[2], 10) };
  }
  const match = trimmed.match(/^(.+):(\d+)$/);
  if (!match) {
    return null;
  }
  const port = Number.parseInt(match[2], 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    return null;
  }
  return { host: match[1], port };
}

/** Parses `lsof -nP -iTCP -sTCP:LISTEN -F pcn` records (p=pid, c=command, n=address). */
export function parseLsofListeningOutput(output: string): RawListeningPort[] {
  const ports: RawListeningPort[] = [];
  let currentPid: number | undefined;
  let currentProcessName: string | undefined;

  for (const line of output.split("\n")) {
    if (!line) {
      continue;
    }
    const tag = line[0];
    const value = line.slice(1);
    if (tag === "p") {
      const pid = Number.parseInt(value, 10);
      currentPid = Number.isFinite(pid) ? pid : undefined;
      currentProcessName = undefined;
    } else if (tag === "c") {
      currentProcessName = value;
    } else if (tag === "n") {
      const parsed = parseAddressWithPort(value);
      if (parsed) {
        ports.push({
          pid: currentPid,
          processName: currentProcessName,
          ...parsed,
        });
      }
    }
  }

  return dedupeRawPorts(ports);
}

type ProcessMetadata = { processName?: string; commandLine?: string; cwd?: string };

/** cwd + command line per pid; the source's sequential darwin probe. */
export async function loadDarwinProcessMetadata(
  pids: Set<number>,
): Promise<Map<number, ProcessMetadata>> {
  const result = new Map<number, ProcessMetadata>();
  const pidList = Array.from(pids).join(",");
  if (!pidList) {
    return result;
  }

  // Why sequential, not Promise.all: matches the source's probe cadence, so
  // one slow lsof cannot pile up concurrent metadata spawns.
  const cwdOutput = await exec("lsof", ["-a", "-p", pidList, "-d", "cwd", "-Fn"]);
  const commandOutput = cwdOutput.error
    ? { stdout: "" }
    : await exec("ps", ["-p", pidList, "-o", "pid=", "-o", "command="]);

  let currentPid: number | null = null;
  for (const line of cwdOutput.stdout.split("\n")) {
    if (line.startsWith("p")) {
      const pid = Number.parseInt(line.slice(1), 10);
      currentPid = Number.isFinite(pid) ? pid : null;
    } else if (line.startsWith("n") && currentPid != null) {
      result.set(currentPid, {
        ...result.get(currentPid),
        cwd: line.slice(1) || undefined,
      });
    }
  }

  for (const line of commandOutput.stdout.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) {
      continue;
    }
    const pid = Number.parseInt(match[1], 10);
    result.set(pid, {
      ...result.get(pid),
      commandLine: match[2].trim() || undefined,
    });
  }

  return result;
}

async function loadLinuxProcessMetadata(
  pid: number,
): Promise<ProcessMetadata> {
  const readText = async (filePath: string): Promise<string | undefined> => {
    try {
      const { readFile } = await import("node:fs/promises");
      return await readFile(filePath, "utf-8");
    } catch {
      return undefined;
    }
  };
  const [comm, cmdline, cwd] = await Promise.all([
    readText(`/proc/${pid}/comm`),
    readText(`/proc/${pid}/cmdline`),
    readlink(`/proc/${pid}/cwd`).catch(() => undefined),
  ]);
  return {
    processName: comm?.trim() || undefined,
    commandLine: cmdline?.split("\u0000").join(" ").trim() || undefined,
    cwd,
  };
}

async function mapLinuxInodesToPids(inodes: Set<number>): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (inodes.size === 0) {
    return result;
  }
  let pids: string[];
  try {
    pids = (await readdir("/proc")).filter((entry) => /^\d+$/.test(entry));
  } catch {
    return result;
  }
  for (const pidText of pids) {
    let fds: string[];
    try {
      fds = await readdir(`/proc/${pidText}/fd`);
    } catch {
      continue;
    }
    const pid = Number.parseInt(pidText, 10);
    for (const fd of fds) {
      let link: string;
      try {
        link = await readlink(`/proc/${pidText}/fd/${fd}`);
      } catch {
        continue;
      }
      const match = link.match(/^socket:\[(\d+)\]$/);
      if (!match) {
        continue;
      }
      const inode = Number.parseInt(match[1], 10);
      if (inodes.has(inode)) {
        result.set(inode, pid);
      }
    }
  }
  return result;
}

/**
 * Scans every listening TCP port with owning-pid metadata (lsof -F pcn on
 * macOS, /proc/net/tcp on Linux) and attaches cwd/command-line evidence so
 * ports can be attributed to workspace processes.
 */
export async function scanPlatformListeningPorts(): Promise<{
  ports: RawListeningPort[];
  metadataAvailable: boolean;
}> {
  if (process.platform === "darwin") {
    const { stdout, error } = await exec("lsof", [
      "-nP",
      "-iTCP",
      "-sTCP:LISTEN",
      "-F",
      "pcn",
    ]);
    if (error) throw new Error("lsof scan failed");
    const ports = parseLsofListeningOutput(stdout);
    const metadata = await loadDarwinProcessMetadata(
      new Set(ports.flatMap((p) => (p.pid ? [p.pid] : []))),
    );
    return {
      ports: ports.map((port) => ({ ...metadata.get(port.pid ?? -1), ...port })),
      metadataAvailable: true,
    };
  }
  if (process.platform === "linux") {
    const { readFile } = await import("node:fs/promises");
    const readProcNet = async (filePath: string) => {
      try {
        return await readFile(filePath, "utf-8");
      } catch {
        return "";
      }
    };
    const sockets = [
      await readProcNet("/proc/net/tcp"),
      await readProcNet("/proc/net/tcp6"),
    ].flatMap(parseProcNetTcp);
    const inodeToPid = await mapLinuxInodesToPids(
      new Set(sockets.map((socket) => socket.inode)),
    );
    const metadata = new Map<number, ProcessMetadata>();
    const rawPorts: RawListeningPort[] = [];
    for (const socket of sockets) {
      const pid = inodeToPid.get(socket.inode);
      if (pid != null && !metadata.has(pid)) {
        metadata.set(pid, await loadLinuxProcessMetadata(pid));
      }
      rawPorts.push({
        host: socket.host,
        port: socket.port,
        pid,
        ...metadata.get(pid ?? -1),
      });
    }
    return { ports: dedupeRawPorts(rawPorts), metadataAvailable: true };
  }
  throw new Error(`Port scanning is not supported on ${process.platform}`);
}

/** Parses /proc/net/tcp{,6} listener rows (state 0A) into host/port/inode. */
export function parseProcNetTcp(
  content: string,
): { host: string; port: number; inode: number }[] {
  const results: { host: string; port: number; inode: number }[] = [];
  const lines = content.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i].trim().split(/\s+/);
    if (fields.length < 10 || fields[3] !== "0A") {
      continue;
    }
    const parsed = parseProcAddress(fields[1] ?? "");
    const inode = Number.parseInt(fields[9] ?? "", 10);
    if (!parsed || !Number.isFinite(inode) || inode === 0) {
      continue;
    }
    results.push({ ...parsed, inode });
  }
  return results;
}

function parseProcAddress(hexAddress: string): { host: string; port: number } | null {
  const [addrHex, portHex] = hexAddress.split(":");
  const port = Number.parseInt(portHex ?? "", 16);
  if (!Number.isFinite(port) || port === 0) {
    return null;
  }
  if (addrHex?.length === 8) {
    const bytes = [6, 4, 2, 0].map((index) =>
      Number.parseInt(addrHex.slice(index, index + 2), 16),
    );
    return { host: bytes.join("."), port };
  }
  return null;
}

// --- Attribution (verbatim logic from the source) -------------------------

type NormalizedWorkspacePortProbe = {
  probe: WorkspacePortProbe;
  normalizedPath: string;
};

export function normalizeWorkspacePortProbes(
  worktrees: readonly WorkspacePortProbe[],
): NormalizedWorkspacePortProbe[] {
  return worktrees.map((probe) => ({
    probe,
    normalizedPath: normalizeComparablePath(probe.path),
  }));
}

export function attributePortToWorkspace(
  port: Pick<RawListeningPort, "cwd" | "commandLine">,
  worktrees: readonly WorkspacePortProbe[],
): WorkspacePortOwner | undefined {
  return attributePortToNormalizedWorkspaces(
    port,
    normalizeWorkspacePortProbes(worktrees),
  );
}

function attributePortToNormalizedWorkspaces(
  port: Pick<RawListeningPort, "cwd" | "commandLine">,
  worktrees: readonly NormalizedWorkspacePortProbe[],
): WorkspacePortOwner | undefined {
  const cwd = port.cwd ? normalizeComparablePath(port.cwd) : null;
  const commandLine = port.commandLine
    ? normalizeComparableText(port.commandLine)
    : null;

  const cwdMatch = cwd
    ? pickDeepestMatching(worktrees, ({ normalizedPath }) =>
        isSameOrDescendant(cwd, normalizedPath),
      )
    : undefined;
  if (cwdMatch) {
    return toOwner(cwdMatch.probe, "cwd");
  }

  if (!commandLine) {
    return undefined;
  }

  const commandMatch = pickDeepestMatching(worktrees, ({ normalizedPath }) =>
    includesPathBoundary(commandLine, normalizedPath),
  );
  return commandMatch ? toOwner(commandMatch.probe, "command") : undefined;
}

function toOwner(
  probe: WorkspacePortProbe,
  confidence: WorkspacePortOwner["confidence"],
): WorkspacePortOwner {
  return { workspaceId: probe.id, confidence };
}

function pickDeepestMatching<T extends { normalizedPath: string }>(
  candidates: readonly T[],
  predicate: (candidate: T) => boolean,
): T | undefined {
  let best: T | undefined;
  for (const candidate of candidates) {
    if (!predicate(candidate)) {
      continue;
    }
    if (!best || candidate.normalizedPath.length > best.normalizedPath.length) {
      best = candidate;
    }
  }
  return best;
}

function isSameOrDescendant(candidate: string, parent: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}/`);
}

function includesPathBoundary(
  commandLine: string,
  normalizedPath: string,
): boolean {
  let index = commandLine.indexOf(normalizedPath);
  while (index !== -1) {
    const before = index === 0 ? "" : commandLine[index - 1];
    const after = commandLine[index + normalizedPath.length] ?? "";
    const startsOnBoundary = before === "" || /\s|["'=]/.test(before);
    const endsOnBoundary = after === "" || /[\s"'/:]/.test(after);
    if (startsOnBoundary && endsOnBoundary) {
      return true;
    }
    index = commandLine.indexOf(normalizedPath, index + normalizedPath.length);
  }
  return false;
}

function normalizeComparablePath(input: string): string {
  if (input.startsWith("/")) {
    return normalizeComparableText(path.posix.resolve(input));
  }
  return normalizeComparableText(path.resolve(input));
}

function normalizeComparableText(input: string): string {
  const normalized = input.replace(/\\/g, "/").replace(/\/+/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
