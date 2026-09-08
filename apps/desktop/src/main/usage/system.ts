// Local process-tree memory and workspace-owned listening-port probes.
// Read-only (ps/lsof snapshots); never writes anything and resolves
// fail-closed `unavailable` instead of inventing numbers. Ports are counted
// the way the source's PortsStatusSegment reader does: only listeners
// attributable to a workspace path (session cwd/command line), never every
// port on the machine.
import { execFile } from "node:child_process";
import type { MemorySnapshot, PortsSnapshot, PortInfo } from "../../shared/usage-contract";
import {
  attributePortToWorkspace,
  scanPlatformListeningPorts,
  type RawListeningPort,
  type WorkspacePortProbe,
} from "./workspace-ports";

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

type PsRow = { pid: number; ppid: number; rssKb: number; comm: string };

/** Parses `ps -eo pid,ppid,rss,comm` rows; header and malformed lines are dropped. */
export function parsePsOutput(stdout: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*\S)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const rssKb = Number(match[3]);
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(ppid) || !Number.isSafeInteger(rssKb)) {
      continue;
    }
    rows.push({ pid, ppid, rssKb, comm: match[4] ?? "" });
  }
  return rows;
}

/** Sums RSS over pid + all descendants; null when pid is absent from the table. */
export function sumProcessTreeRss(rows: PsRow[], rootPid: number): number | null {
  const byPpid = new Map<number, PsRow[]>();
  const byPid = new Map<number, PsRow>();
  for (const row of rows) {
    byPid.set(row.pid, row);
    const siblings = byPpid.get(row.ppid) ?? [];
    siblings.push(row);
    byPpid.set(row.ppid, siblings);
  }
  if (!byPid.has(rootPid)) return null;
  let totalKb = 0;
  let count = 0;
  const stack = [rootPid];
  const seen = new Set<number>([rootPid]);
  while (stack.length > 0) {
    const pid = stack.pop() as number;
    const row = byPid.get(pid);
    if (row) {
      totalKb += row.rssKb;
      count += 1;
    }
    for (const child of byPpid.get(pid) ?? []) {
      if (!seen.has(child.pid)) {
        seen.add(child.pid);
        stack.push(child.pid);
      }
    }
  }
  return count === 0 ? null : totalKb * 1024;
}

/** Sums RSS over every process with the given command name; zero when none. */
export function sumNamedProcessRss(rows: PsRow[], comm: string): number {
  let totalKb = 0;
  for (const row of rows) {
    if (row.comm === comm) totalKb += row.rssKb;
  }
  return totalKb * 1024;
}

/**
 * Memory like the source's resource snapshot: the desktop's own process tree
 * (renderer included, via the pid tree) plus the drogond daemon process.
 * The daemon is spawned detached, so the tree walk cannot see it; the ps
 * command name is the honest join we have.
 */
export async function readMemory(rootPid: number = process.pid): Promise<MemorySnapshot> {
  if (process.platform === "win32") {
    return { rssBytes: null, processCount: null, unavailableReason: "Memory probe needs macOS or Linux." };
  }
  const { stdout, error } = await exec("ps", ["-eo", "pid,ppid,rss,comm"]);
  if (error) {
    return { rssBytes: null, processCount: null, unavailableReason: "Process list unavailable." };
  }
  const rows = parsePsOutput(stdout);
  const tree = sumProcessTreeRss(rows, rootPid);
  if (tree === null) {
    return { rssBytes: null, processCount: null, unavailableReason: "Process list unavailable." };
  }
  const daemonRss = sumNamedProcessRss(rows, "drogond");
  return {
    rssBytes: tree + daemonRss,
    processCount: countProcessTree(rows, rootPid),
    unavailableReason: null,
  };
}

function countProcessTree(rows: PsRow[], rootPid: number): number {
  let count = 0;
  const stack = [rootPid];
  const seen = new Set<number>([rootPid]);
  while (stack.length > 0) {
    const pid = stack.pop() as number;
    count += 1;
    for (const row of rows) {
      if (row.ppid === pid && !seen.has(row.pid)) {
        seen.add(row.pid);
        stack.push(row.pid);
      }
    }
  }
  return count;
}

/**
 * Pure projection: workspace-owned listeners only, one row per port, sorted.
 * A listener counts when its process cwd sits inside a workspace path or its
 * command line names one (the source's cwd/command attribution), so an
 * unrelated machine-wide listener never inflates the segment.
 */
export function projectWorkspacePorts(
  ports: readonly RawListeningPort[],
  workspaces: readonly WorkspacePortProbe[],
): PortInfo[] {
  const byPort = new Map<number, PortInfo>();
  for (const port of ports) {
    const owner = attributePortToWorkspace(port, workspaces);
    if (!owner || byPort.has(port.port)) continue;
    byPort.set(port.port, {
      port: port.port,
      process: (port.processName ?? "unknown").slice(0, 128),
    });
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}

export async function readWorkspacePorts(
  workspaces: readonly WorkspacePortProbe[],
): Promise<PortsSnapshot> {
  if (process.platform === "win32") {
    return { listening: [], unavailableReason: "Port scan needs macOS or Linux." };
  }
  let scan;
  try {
    scan = await scanPlatformListeningPorts();
  } catch {
    return { listening: [], unavailableReason: "Port scan unavailable." };
  }
  if (!scan.metadataAvailable) {
    return {
      listening: [],
      unavailableReason: "Port scan could not read process metadata.",
    };
  }
  return { listening: projectWorkspacePorts(scan.ports, workspaces), unavailableReason: null };
}
