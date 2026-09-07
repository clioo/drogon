// Local process-tree memory and listening-port probes. Read-only (ps/lsof
// snapshots); never writes anything and resolves fail-closed `unavailable`
// instead of inventing numbers.
import { execFile } from "node:child_process";
import type { MemorySnapshot, PortsSnapshot, PortInfo } from "../../shared/usage-contract";

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

type PsRow = { pid: number; ppid: number; rssKb: number };

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
    rows.push({ pid, ppid, rssKb });
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

export async function readMemory(rootPid: number = process.pid): Promise<MemorySnapshot> {
  if (process.platform === "win32") {
    return { rssBytes: null, processCount: null, unavailableReason: "Memory probe needs macOS or Linux." };
  }
  const { stdout, error } = await exec("ps", ["-eo", "pid,ppid,rss,comm"]);
  if (error) {
    return { rssBytes: null, processCount: null, unavailableReason: "Process list unavailable." };
  }
  const rows = parsePsOutput(stdout);
  const total = sumProcessTreeRss(rows, rootPid);
  if (total === null) {
    return { rssBytes: null, processCount: null, unavailableReason: "Process list unavailable." };
  }
  const byPpid = new Map<number, number>();
  for (const row of rows) byPpid.set(row.ppid, (byPpid.get(row.ppid) ?? 0) + 1);
  let count = 0;
  const stack = [rootPid];
  const seen = new Set([rootPid]);
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
  return { rssBytes: total, processCount: count, unavailableReason: null };
}

/**
 * Parses `lsof -iTCP -sTCP:LISTEN -P -n` output. Keeps one entry per port
 * (first process wins); unparseable lines are dropped, never counted.
 */
export function parseLsofOutput(stdout: string): PortInfo[] {
  const byPort = new Map<number, PortInfo>();
  for (const line of stdout.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9) continue;
    const processName = parts[0] ?? "";
    if (!processName || processName === "COMMAND") continue;
    // The NAME column is "*:3000 (LISTEN)": the address and the state are
    // separate whitespace tokens, so match the port across the whole line.
    const portMatch = /:(\d+)\s+\(LISTEN\)/.exec(line);
    if (!portMatch) continue;
    const port = Number(portMatch[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    if (!byPort.has(port)) byPort.set(port, { port, process: processName.slice(0, 128) });
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}

export async function readPorts(): Promise<PortsSnapshot> {
  if (process.platform === "win32") {
    return { listening: [], unavailableReason: "Port scan needs macOS or Linux." };
  }
  const { stdout, error } = await exec("lsof", ["-iTCP", "-sTCP:LISTEN", "-P", "-n"]);
  if (error) {
    return { listening: [], unavailableReason: "Port scan unavailable." };
  }
  return { listening: parseLsofOutput(stdout), unavailableReason: null };
}
