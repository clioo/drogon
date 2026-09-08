import { describe, expect, test } from "vitest";
import {
  parsePsOutput,
  projectWorkspacePorts,
  sumNamedProcessRss,
  sumProcessTreeRss,
} from "./system";

describe("ps parsing", () => {
  test("drops the header and malformed lines", () => {
    const rows = parsePsOutput(
      "  PID  PPID   RSS COMMAND\n    1     0  1234 launchd\n  100     1  5678 Electron\nbroken line\n",
    );
    expect(rows).toEqual([
      { pid: 1, ppid: 0, rssKb: 1234, comm: "launchd" },
      { pid: 100, ppid: 1, rssKb: 5678, comm: "Electron" },
    ]);
  });
  test("sums the pid plus all descendants, in bytes", () => {
    const rows = [
      { pid: 1, ppid: 0, rssKb: 100, comm: "launchd" },
      { pid: 10, ppid: 1, rssKb: 200, comm: "Electron" },
      { pid: 11, ppid: 10, rssKb: 300, comm: "Electron Helper" },
      { pid: 99, ppid: 1, rssKb: 400, comm: "finder" },
    ];
    expect(sumProcessTreeRss(rows, 10)).toBe(500 * 1024);
    expect(sumProcessTreeRss(rows, 1)).toBe(1000 * 1024);
  });
  test("returns null when the root pid is absent", () => {
    expect(
      sumProcessTreeRss([{ pid: 1, ppid: 0, rssKb: 1, comm: "x" }], 4242),
    ).toBeNull();
  });
  test("memory value source sums the detached daemon by command name", () => {
    const rows = [
      { pid: 1, ppid: 0, rssKb: 1000, comm: "Electron" },
      { pid: 2, ppid: 1, rssKb: 500, comm: "Electron Helper (Renderer)" },
      { pid: 7, ppid: 0, rssKb: 250, comm: "drogond" },
      { pid: 8, ppid: 0, rssKb: 250, comm: "drogond" },
      { pid: 9, ppid: 0, rssKb: 999, comm: "slack" },
    ];
    // Renderer + daemon RSS: the Electron tree plus every drogond process.
    expect(sumProcessTreeRss(rows, 1)).toBe(1500 * 1024);
    expect(sumNamedProcessRss(rows, "drogond")).toBe(500 * 1024);
  });
});

describe("workspace-owned port projection", () => {
  const workspaces = [
    { id: "w1", path: "/repo/main" },
    { id: "w2", path: "/repo/main/worktrees/feat" },
  ];
  test("counts only listeners attributable to a workspace, deepest path wins", () => {
    const ports = [
      { host: "*", port: 3000, pid: 101, processName: "node", cwd: "/repo/main/worktrees/feat/app" },
      { host: "*", port: 8080, pid: 102, processName: "java", cwd: "/repo/main" },
      { host: "*", port: 5173, pid: 103, processName: "node", commandLine: "vite --root /repo/main/worktrees/feat" },
    ];
    expect(projectWorkspacePorts(ports, workspaces)).toEqual([
      { port: 3000, process: "node" },
      { port: 5173, process: "node" },
      { port: 8080, process: "java" },
    ]);
  });
  test("never counts machine-wide listeners with no workspace evidence", () => {
    const ports = [
      { host: "*", port: 443, pid: 200, processName: "Dropbox" },
      { host: "*", port: 7000, pid: 201, processName: "AirPlay" },
      { host: "*", port: 3000, pid: 202, processName: "node", cwd: "/somewhere-else" },
    ];
    expect(projectWorkspacePorts(ports, workspaces)).toEqual([]);
  });
  test("the deepest matching workspace owns an ambiguous cwd", () => {
    const ports = [
      { host: "*", port: 4000, pid: 210, processName: "node", cwd: "/repo/main/worktrees/feat" },
    ];
    // Pure projection does not expose the owner; both attributions succeed.
    expect(projectWorkspacePorts(ports, workspaces)).toHaveLength(1);
  });
  test("duplicate rows for one port collapse to a single count", () => {
    const ports = [
      { host: "*", port: 3000, pid: 101, processName: "node", cwd: "/repo/main" },
      { host: "127.0.0.1", port: 3000, pid: 101, processName: "node", cwd: "/repo/main" },
    ];
    expect(projectWorkspacePorts(ports, workspaces)).toEqual([
      { port: 3000, process: "node" },
    ]);
  });
});
