import { describe, expect, test } from "vitest";
import { parsePsOutput, projectWorkspacePorts, sumProcessTreeRss } from "./system";

describe("ps parsing (malformed and hostile rows)", () => {
  test("drops rows with non-safe integers, keeps commands with spaces", () => {
    const rows = parsePsOutput(
      "  PID  PPID   RSS COMMAND\n    1     0  1234 launchd\n    2     1   100 Electron Helper (Renderer)\n 9007199254740994     1   100 overflow-pid\n    3     1   notanumber bad-rss\n",
    );
    expect(rows).toEqual([
      { pid: 1, ppid: 0, rssKb: 1234, comm: "launchd" },
      { pid: 2, ppid: 1, rssKb: 100, comm: "Electron Helper (Renderer)" },
    ]);
  });
  test("a pid cycle terminates and counts each process once", () => {
    const rows = [
      { pid: 2, ppid: 3, rssKb: 100, comm: "a" },
      { pid: 3, ppid: 2, rssKb: 200, comm: "b" },
    ];
    expect(sumProcessTreeRss(rows, 2)).toBe(300 * 1024);
  });
});

describe("workspace-owned port projection (count honesty)", () => {
  const workspaces = [{ id: "w1", path: "/repo/main" }];
  test("long process names are cut to the contract limit", () => {
    const ports = [
      { host: "*", port: 3000, pid: 1, processName: `node ${"x".repeat(300)}`, cwd: "/repo/main" },
    ];
    const [row] = projectWorkspacePorts(ports, workspaces);
    expect(row.process).toHaveLength(128);
  });
  test("a missing process name counts as unknown, never empty", () => {
    const ports = [{ host: "*", port: 3000, pid: 1, cwd: "/repo/main" }];
    expect(projectWorkspacePorts(ports, workspaces)).toEqual([
      { port: 3000, process: "unknown" },
    ]);
  });
  test("rows sort numerically and the first attribution wins a shared port", () => {
    const ports = [
      { host: "*", port: 8080, pid: 1, processName: "b", cwd: "/repo/main" },
      { host: "*", port: 3000, pid: 2, processName: "a", cwd: "/repo/main" },
      { host: "127.0.0.1", port: 3000, pid: 3, processName: "c", cwd: "/repo/main" },
    ];
    expect(projectWorkspacePorts(ports, workspaces)).toEqual([
      { port: 3000, process: "a" },
      { port: 8080, process: "b" },
    ]);
  });
});
