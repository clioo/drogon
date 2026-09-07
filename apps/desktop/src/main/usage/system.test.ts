import { describe, expect, test } from "vitest";
import { parseLsofOutput, parsePsOutput, sumProcessTreeRss } from "./system";

describe("ps parsing", () => {
  test("drops the header and malformed lines", () => {
    const rows = parsePsOutput(
      "  PID  PPID   RSS COMMAND\n    1     0  1234 launchd\n  100     1  5678 Electron\nbroken line\n",
    );
    expect(rows).toEqual([
      { pid: 1, ppid: 0, rssKb: 1234 },
      { pid: 100, ppid: 1, rssKb: 5678 },
    ]);
  });
  test("sums the pid plus all descendants, in bytes", () => {
    const rows = [
      { pid: 1, ppid: 0, rssKb: 100 },
      { pid: 10, ppid: 1, rssKb: 200 },
      { pid: 11, ppid: 10, rssKb: 300 },
      { pid: 99, ppid: 1, rssKb: 400 },
    ];
    expect(sumProcessTreeRss(rows, 10)).toBe(500 * 1024);
    expect(sumProcessTreeRss(rows, 1)).toBe(1000 * 1024);
  });
  test("returns null when the root pid is absent", () => {
    expect(sumProcessTreeRss([{ pid: 1, ppid: 0, rssKb: 1 }], 4242)).toBeNull();
  });
});

describe("lsof parsing", () => {
  const sample = [
    "COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
    "Electron  123 carlos  10u  IPv4 0xabc      0t0  TCP *:3000 (LISTEN)",
    "node      456 carlos  20u  IPv6 0xdef      0t0  TCP [::1]:3000 (LISTEN)",
    "drogond   789 carlos  21u  IPv4 0xghi      0t0  TCP 127.0.0.1:8080 (LISTEN)",
    "garbage line without enough columns",
  ].join("\n");
  test("dedupes by port and keeps the first process", () => {
    expect(parseLsofOutput(sample)).toEqual([
      { port: 3000, process: "Electron" },
      { port: 8080, process: "drogond" },
    ]);
  });
  test("empty output scans to zero ports, never unavailable-by-parse", () => {
    expect(parseLsofOutput("")).toEqual([]);
  });
});
