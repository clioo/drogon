// V5 acceptance binding test: locks Windows-transport acceptance to the REAL
// V1-owned `./native-client` exports instead of mirrors. This file imports
// the production module read-only and never edits it. The wire frame
// builder/precheck is not exported standalone (it lives inside `callNative`,
// which reads the auth token), so the oversize-refusal path is bound through
// the real `callNative` export with a fixture data directory — the oversize
// refusal fires before any socket is created, so no daemon or harness runs
// here. POSIX probe cases use a test-owned socket; the win32 case asserts the
// documented short-circuit as the CURRENT gate state, never as proof of real
// Windows behavior.
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  MAX_FRAME_BYTES,
  callNative,
  observeLocalEndpoint,
  resolveEndpointPath,
  validateEnvelope,
} from "./native-client";

describe("real win32 pipe-name contract (resolveEndpointPath)", () => {
  test("matches the deterministic sha256-slice formula", () => {
    for (const directory of [
      "/home/tester/.local/share/drogon",
      "C:\\Users\\tester\\AppData\\Roaming\\Drogon",
      "/tmp/with spaces/ünïcode",
    ]) {
      const expected =
        `\\\\.\\pipe\\drogon-v1-` +
        createHash("sha256").update(directory).digest("hex").slice(0, 24);
      expect(resolveEndpointPath(directory, "win32")).toBe(expected);
    }
  });
  test("is deterministic and distinguishing per data directory", () => {
    const first = resolveEndpointPath("/data/one", "win32");
    expect(resolveEndpointPath("/data/one", "win32")).toBe(first);
    expect(resolveEndpointPath("/data/two", "win32")).not.toBe(first);
  });
  test("POSIX branch stays the in-directory socket path", () => {
    expect(resolveEndpointPath("/data/one", "darwin")).toBe(
      path.join("/data/one", "runtime-v1.sock"),
    );
  });
});

describe("real envelope validation (validateEnvelope)", () => {
  const requestId = "binding-request-id";
  test("accepts the ok and error shapes the wire contract defines", () => {
    expect(
      validateEnvelope(
        { protocol: 1, requestId, ok: true, result: { hostId: "h1" } },
        requestId,
      ),
    ).toEqual({ ok: true, result: { hostId: "h1" } });
    expect(
      validateEnvelope(
        {
          protocol: 1,
          requestId,
          ok: false,
          error: { code: "stale_incarnation", message: "gone", retryable: false },
        },
        requestId,
      ),
    ).toEqual({
      ok: false,
      error: { code: "stale_incarnation", message: "gone", retryable: false },
    });
    expect(
      validateEnvelope(
        { protocol: 1, requestId, ok: true, result: {}, futureField: 1 },
        requestId,
      ).ok,
    ).toBe(true);
  });
  test("rejects every malformed shape", () => {
    const valid = { protocol: 1, requestId, ok: true, result: {} };
    for (const value of [
      null,
      "envelope",
      7,
      { ...valid, protocol: 2 },
      { ...valid, protocol: "1" },
      { ...valid, requestId: "other" },
      { ...valid, ok: "true" },
      { ...valid, error: null },
      { ...valid, result: {}, error: {} },
      { protocol: 1, requestId, ok: true },
      {
        protocol: 1,
        requestId,
        ok: false,
        result: {},
        error: { code: "x", message: "y", retryable: false },
      },
      { protocol: 1, requestId, ok: false },
      {
        protocol: 1,
        requestId,
        ok: false,
        error: { code: "x", message: "y" },
      },
      {
        protocol: 1,
        requestId,
        ok: false,
        error: { code: 3, message: "y", retryable: false },
      },
    ]) {
      expect(() => validateEnvelope(value, requestId)).toThrow();
    }
  });
});

describe("real frame bound (MAX_FRAME_BYTES)", () => {
  test("is the documented 1 MiB wire bound", () => {
    expect(MAX_FRAME_BYTES).toBe(1024 * 1024);
  });
});

describe("real oversize-frame refusal values (through callNative)", () => {
  let fixture: string;
  const originalDataDir = process.env.DROGON_DATA_DIR;

  beforeEach(async () => {
    fixture = await mkdtemp(path.join(tmpdir(), "dg-frame-"));
    await writeFile(path.join(fixture, "auth.token"), "test-token\n");
    process.env.DROGON_DATA_DIR = fixture;
  });
  afterEach(async () => {
    if (originalDataDir === undefined) delete process.env.DROGON_DATA_DIR;
    else process.env.DROGON_DATA_DIR = originalDataDir;
    await rm(fixture, { recursive: true, force: true });
  });

  test("over the bound refuses invalid_argument before any connection", async () => {
    const result = await callNative(
      "status",
      { padding: "x".repeat(MAX_FRAME_BYTES) },
      "oversize-request-id",
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_argument",
        message: "Request is too large.",
        retryable: false,
      },
    });
  });

  test.skipIf(process.platform === "win32")(
    "exactly at the bound passes the precheck and fails transport, not size",
    async () => {
      const requestId = "boundary-request-id";
      const base = JSON.stringify({
        protocol: 1,
        requestId,
        auth: "test-token",
        method: "status",
        params: { padding: "" },
      });
      const pad = MAX_FRAME_BYTES - 1 - Buffer.byteLength(base, "utf8");
      expect(pad).toBeGreaterThan(0);
      const frame =
        JSON.stringify({
          protocol: 1,
          requestId,
          auth: "test-token",
          method: "status",
          params: { padding: "x".repeat(pad) },
        }) + "\n";
      expect(Buffer.byteLength(frame, "utf8")).toBe(MAX_FRAME_BYTES);
      // No listener exists in the fixture directory, so the real transport
      // path is entered and classifies the absent endpoint as unverifiable —
      // proving the size gate passed rather than short-circuiting.
      await expect(
        callNative("status", { padding: "x".repeat(pad) }, requestId),
      ).resolves.toEqual({
        ok: false,
        error: {
          code: "unverifiable",
          message:
            "Cannot reach the Drogon service. Check that drogond is running, then retry. Existing sessions have not been marked as exited.",
          retryable: true,
        },
      });
    },
  );
});

describe("real local endpoint observation (observeLocalEndpoint)", () => {
  test("win32 short-circuits to the documented ambiguous gate", async () => {
    // Current-gate state only: this asserts today's unsupported-platform
    // branch, NOT real Windows named-pipe behavior.
    await expect(
      observeLocalEndpoint("/unused-fixture", "win32", 1000),
    ).resolves.toEqual({ kind: "ambiguous", reason: "unsupported-platform" });
  });

  test.skipIf(process.platform === "win32")(
    "classifies a live listener as present (POSIX)",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "dg-probe-"));
      const endpoint = resolveEndpointPath(dir, process.platform);
      const server = createServer();
      await new Promise<void>((resolve) => server.listen(endpoint, resolve));
      try {
        await expect(
          observeLocalEndpoint(dir, process.platform, 2000),
        ).resolves.toEqual({ kind: "present" });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(endpoint, { force: true });
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  test.skipIf(process.platform === "win32")(
    "classifies an endpoint with no listener as absent (POSIX)",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "dg-probe-"));
      try {
        await expect(
          observeLocalEndpoint(dir, process.platform, 2000),
        ).resolves.toEqual({ kind: "absent" });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
