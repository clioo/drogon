import { describe, expect, test } from "vitest";
import {
  cliCandidates,
  probeCliStatus,
  type CliProbeRunner,
} from "./settings-bridge";
import { cliStatusResultSchema } from "../shared/settings-contract";

const okRun = (
  stdout: string,
  exitCode = 0,
): Extract<Awaited<ReturnType<CliProbeRunner>>, { ok: true }> => ({
  ok: true,
  stdout,
  stderr: "",
  exitCode,
});

const isExecutableOnly =
  (present: readonly string[]) => async (filePath: string) =>
    present.includes(filePath);

describe("cliCandidates", () => {
  test("prefers the data-dir shims over PATH entries", () => {
    const candidates = cliCandidates("/data", "/usr/bin:/bin", ":");
    expect(candidates.slice(0, 2).map((c) => c.commandPath)).toEqual([
      "/data/bin/drogon-cli",
      "/data/bin/drogon",
    ]);
    expect(candidates[2]).toMatchObject({
      commandName: "drogon-cli",
      commandPath: "/usr/bin/drogon-cli",
      fromPath: true,
    });
  });
});

describe("probeCliStatus", () => {
  test("reports the shim with its --version first line", async () => {
    const run: CliProbeRunner = async () => okRun("drogon-cli 0.3.1\n");
    const result = await probeCliStatus({
      dataDir: "/data",
      pathEnv: "",
      isExecutable: isExecutableOnly(["/data/bin/drogon-cli"]),
      run,
    });
    expect(result).toEqual({
      ok: true,
      result: {
        available: true,
        commandName: "drogon-cli",
        commandPath: "/data/bin/drogon-cli",
        version: "drogon-cli 0.3.1",
        detail: "Available at /data/bin/drogon-cli.",
      },
    });
  });

  test("falls through to the drogon alias and then PATH", async () => {
    const run: CliProbeRunner = async () => okRun("drogon 0.3.1\n");
    const result = await probeCliStatus({
      dataDir: "/data",
      pathEnv: "/usr/local/bin",
      isExecutable: isExecutableOnly(["/usr/local/bin/drogon"]),
      run,
    });
    expect(result.ok && result.result.commandPath).toBe(
      "/usr/local/bin/drogon",
    );
    if (result.ok) expect(result.result.commandName).toBe("drogon");
  });

  test("no candidate is unavailable with an honest reason, never a version", async () => {
    const run: CliProbeRunner = async () => okRun("unreachable\n");
    const result = await probeCliStatus({
      dataDir: "/data",
      pathEnv: "",
      isExecutable: isExecutableOnly([]),
      run,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.available).toBe(false);
      expect(result.result.commandPath).toBeNull();
      expect(result.result.version).toBeNull();
      expect(cliStatusResultSchema.safeParse(result.result).success).toBe(
        true,
      );
    }
  });

  test("a present shim with a failing --version stays available, version null", async () => {
    const run: CliProbeRunner = async () => okRun("boom", 1);
    const result = await probeCliStatus({
      dataDir: "/data",
      pathEnv: "",
      isExecutable: isExecutableOnly(["/data/bin/drogon-cli"]),
      run,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.available).toBe(true);
      expect(result.result.version).toBeNull();
    }
  });

  test("a timed-out --version stays available with an honest detail", async () => {
    const run: CliProbeRunner = async () => ({
      ok: false,
      reason: "timed-out",
    });
    const result = await probeCliStatus({
      dataDir: "/data",
      pathEnv: "",
      isExecutable: isExecutableOnly(["/data/bin/drogon-cli"]),
      run,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.available).toBe(true);
      expect(result.result.detail).toContain("timed out");
    }
  });
});
