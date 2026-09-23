import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";

const { execCalls } = vi.hoisted(() => ({ execCalls: [] as unknown[][] }));

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    execCalls.push(args);
    const callback = args[args.length - 1] as (error: Error, stdout: string) => void;
    callback(new Error("lsof unavailable in tests"), "");
  },
}));

// Worker-reuse hermeticity (docs/reference/desktop-test-isolation.md): the
// desktop suite shares one module registry per worker, so a statically
// imported scanner would stay bound to whichever `node:child_process` won
// the import race — the real one, which runs a live `lsof` and leaves this
// file's `execCalls` empty (observed as rotating failures). Rebinding after
// a registry reset keeps the mocked spawn deterministic.
let connectHostForBindHost: typeof import("./workspace-ports").connectHostForBindHost;
let dedupeRawPorts: typeof import("./workspace-ports").dedupeRawPorts;
let loadDarwinProcessMetadata: typeof import("./workspace-ports").loadDarwinProcessMetadata;
let normalizeWorkspacePortProbes: typeof import("./workspace-ports").normalizeWorkspacePortProbes;
let parseAddressWithPort: typeof import("./workspace-ports").parseAddressWithPort;
let parseLsofListeningOutput: typeof import("./workspace-ports").parseLsofListeningOutput;
let parseProcNetTcp: typeof import("./workspace-ports").parseProcNetTcp;
let scanPlatformListeningPorts: typeof import("./workspace-ports").scanPlatformListeningPorts;

beforeAll(async () => {
  vi.resetModules();
  ({
    connectHostForBindHost,
    dedupeRawPorts,
    loadDarwinProcessMetadata,
    normalizeWorkspacePortProbes,
    parseAddressWithPort,
    parseLsofListeningOutput,
    parseProcNetTcp,
    scanPlatformListeningPorts,
  } = await import("./workspace-ports"));
});

afterAll(() => {
  vi.resetModules();
});

describe("proc/net tcp parsing (listener boundaries)", () => {
  const header = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode";
  function row(local: string, st: string, inode: string): string {
    return `   0: ${local} 00000000:0000 ${st} 00000000:00000000 00:00000000 00000000  1000        0 ${inode}`;
  }
  test("only state-0A rows with a live inode and a valid address count", () => {
    const content = [
      header,
      row("0100007F:1F90", "0A", "12345"),
      row("0100007F:1F91", "06", "12346"),
      row("0100007F:0000", "0A", "12347"),
      row("0100007F:1F92", "0A", "0"),
      "short line",
    ].join("\n");
    expect(parseProcNetTcp(content)).toEqual([
      { host: "127.0.0.1", port: 8080, inode: 12345 },
    ]);
  });
  test("non-IPv4 proc addresses are dropped, never misread", () => {
    const content = [
      header,
      row("00000000000000000000000001000000:1F90", "0A", "999"),
    ].join("\n");
    expect(parseProcNetTcp(content)).toEqual([]);
  });
});

describe("address helpers", () => {
  test("wildcards map to localhost, concrete hosts pass through", () => {
    expect(connectHostForBindHost("*")).toBe("localhost");
    expect(connectHostForBindHost("0.0.0.0")).toBe("localhost");
    expect(connectHostForBindHost("::")).toBe("localhost");
    expect(connectHostForBindHost("127.0.0.1")).toBe("127.0.0.1");
    expect(connectHostForBindHost("::1")).toBe("::1");
  });
  test("dedupe folds wildcard bind families, keeping distinct pids apart", () => {
    const rows = dedupeRawPorts([
      { host: "*", port: 3000, pid: 1 },
      { host: "0.0.0.0", port: 3000, pid: 1 },
      { host: "127.0.0.1", port: 3000, pid: 2 },
    ]);
    expect(rows).toHaveLength(2);
  });
  test("bracketed addresses need a real port in range", () => {
    expect(parseAddressWithPort("[::1]")).toBeNull();
    expect(parseAddressWithPort("*:65535")).toEqual({ host: "*", port: 65535 });
    expect(parseAddressWithPort("*:65536")).toBeNull();
    expect(parseAddressWithPort("[::1]:8080 (LISTEN)")).toEqual({ host: "::1", port: 8080 });
  });
  test("lsof records without a pid still parse, keyed unknown", () => {
    const ports = parseLsofListeningOutput(["cnode", "n*:3000"].join("\n"));
    expect(ports).toEqual([{ host: "*", port: 3000, pid: undefined, processName: "node" }]);
  });
  test("probe normalization collapses redundant separators", () => {
    expect(normalizeWorkspacePortProbes([{ id: "w1", path: "/repo//a" }])).toEqual([
      { probe: { id: "w1", path: "/repo//a" }, normalizedPath: "/repo/a" },
    ]);
  });
});

describe("darwin metadata probe", () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
    execCalls.length = 0;
  });

  test("an empty pid set returns empty without spawning", async () => {
    const result = await loadDarwinProcessMetadata(new Set());
    expect(result).toEqual(new Map());
    expect(execCalls).toHaveLength(0);
  });
  // Spawn sequencing is observed through the node:child_process mock, which
  // records zero spawns on windows-2022 runners; the fail-closed result below
  // is still asserted on win32.
  test.skipIf(process.platform === "win32")(
    "a failed lsof skips the ps follow-up and yields no metadata",
    async () => {
      const result = await loadDarwinProcessMetadata(new Set([4242]));
      expect(result).toEqual(new Map());
      expect(execCalls).toHaveLength(1);
      expect(execCalls[0][0]).toBe("lsof");
    },
  );
  test("a failed lsof yields no metadata on every platform, win32 included", async () => {
    // lsof/ps do not exist on win32, so the probe is fail-closed empty
    // whether the spawn is observed through the mock or fails for real.
    const result = await loadDarwinProcessMetadata(new Set([4242]));
    expect(result).toEqual(new Map());
  });
  test("platform port scanning is fail-closed unavailable on win32", async () => {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });
    await expect(scanPlatformListeningPorts()).rejects.toThrow(
      /not supported on win32/,
    );
  });
});
