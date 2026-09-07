#!/usr/bin/env node
// Isolated Node named-pipe acceptance probe for the Windows transport seam
// documented in docs/migration/verticals/V5/windows-transport-seam-plan.md
// (§2 "bounded contract request", §3 "no runner exists" table, §4 gaps 2 and
// 5). Today the only Windows-labeled CI job (`windows-compilation` in
// .github/workflows/foundation.yml) runs `cargo check` only — no TypeScript,
// no `node:net`, no real named pipe. This script is that missing runner's
// acceptance probe: it classifies "present / absent / ambiguous" and refuses
// bad auth/frames against a real `node:net` named pipe it mints and owns for
// the run, never a fixed or shared name.
//
// IMPORTANT — what this file is NOT: every "fixture" below (`startFixtureDaemon`
// and the auth/frame results it produces) is fixture-local scaffolding pinned
// against real vectors from native-client.ts, not the real `drogond` service
// and not product proof. A fixture accepting a token or refusing an oversize
// frame demonstrates that *this scaffolding* implements the mirrored logic
// correctly; it is never evidence that the real Windows `drogond` admission
// path (which does not exist on this branch yet) behaves the same way.
//
// Scope boundary: this is a leaf-D file, not a V1 edit. It deliberately does
// NOT import apps/desktop/src/main/native-client.ts (out of this task's file
// ownership, and that file's own extensionless relative import of
// `../shared/result-validation` does not resolve under a bare `node --test`
// runner without a loader this task is not authorized to add). Instead it
// mirrors, verbatim in behavior, exactly the functions this task was told to
// reuse rather than reinvent:
//   - `resolveEndpointPath`'s win32 branch (native-client.ts:69-76): the same
//     `\\.\pipe\drogon-v1-{sha256(dir).slice(0,24)}` formula, applied here to
//     a fresh per-run temp directory instead of the real data directory, so
//     the resulting pipe name is unique per run and never fixed.
//   - `validateEnvelope` (native-client.ts:33-66): identical protocol /
//     requestId / ok / result / error-shape checks.
//   - `callNative`'s oversize-frame precheck (native-client.ts:339-347) and
//     its `MAX_FRAME_BYTES` constant (native-client.ts:10).
//   - `observeLocalEndpoint`'s absent/present/ambiguous three-way
//     classification (native-client.ts:102-141), including "every non-ENOENT/
//     ECONNREFUSED connect error, and the probe's own timeout, is ambiguous,
//     never collapsed to absent."
// Any behavioral divergence from those four would be exactly the "parallel
// product logic" this task was told not to invent.

import { createHash, randomUUID } from "node:crypto";
import { createServer, createConnection } from "node:net";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

/** Default bound for {@link sendRaw}: no wait, including on a hung/silent peer, may exceed this. */
export const SEND_RAW_TIMEOUT_MS = 5000;

export const MAX_FRAME_BYTES = 1024 * 1024; // native-client.ts:10

/** Verbatim mirror of native-client.ts `resolveEndpointPath`'s win32 branch (native-client.ts:69-76). */
export function resolveOwnedPipePath(directory) {
  return `\\\\.\\pipe\\drogon-v1-${createHash("sha256").update(directory).digest("hex").slice(0, 24)}`;
}

/** Verbatim mirror of native-client.ts `validateEnvelope` (native-client.ts:33-66). */
export function validateEnvelopeMirror(value, requestId) {
  if (!value || typeof value !== "object")
    throw new Error("Invalid service response");
  const v = value;
  if (
    v.protocol !== 1 ||
    v.requestId !== requestId ||
    typeof v.ok !== "boolean"
  )
    throw new Error("Incompatible service response");
  if (v.ok && "result" in v && !("error" in v))
    return { ok: true, result: v.result };
  if (!v.ok && !("result" in v) && v.error && typeof v.error === "object") {
    const error = v.error;
    if (
      typeof error.code === "string" &&
      typeof error.message === "string" &&
      typeof error.retryable === "boolean"
    ) {
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        },
      };
    }
  }
  throw new Error("Invalid service result");
}

/** Mirrors the exact frame the real client writes (native-client.ts:337-338). */
export function buildFrame(requestId, auth, method, params) {
  return JSON.stringify({ protocol: 1, requestId, auth, method, params }) + "\n";
}

/** Verbatim mirror of `callNative`'s oversize precheck (native-client.ts:339-347): a caller must never even attempt to write an oversize frame to the wire. */
export function precheckFrameSize(frame) {
  if (Buffer.byteLength(frame) > MAX_FRAME_BYTES)
    return {
      ok: false,
      error: {
        code: "invalid_argument",
        message: "Request is too large.",
        retryable: false,
      },
    };
  return { ok: true };
}

/**
 * Mints a pipe path that is never reused across runs or cases: a fresh temp
 * directory (guaranteed-unique by `mkdtemp`) feeds the same hash formula
 * production uses, so uniqueness comes from the input, not a different
 * naming scheme.
 */
export async function mintOwnedPipe(root) {
  const directory = await mkdtemp(path.join(root, "dnt-case-"));
  return { directory, pipePath: resolveOwnedPipePath(directory) };
}

/**
 * Mints a platform-appropriate owned IPC endpoint for cases that exercise
 * bounded-wait / explicit-socket-tracking logic that is not itself Windows-
 * named-pipe-specific: a real win32 named pipe on win32 (a bare filesystem
 * path is not a valid pipe address there, so this reuses {@link mintOwnedPipe}'s
 * hash formula), and a plain owned socket file under `root` on POSIX. Using
 * this instead of a hardcoded `path.join(tmpdir(), "*.sock")` is what lets a
 * generic cleanup case run unskipped on both platforms.
 */
export async function mintOwnedEndpoint(root, name) {
  if (process.platform === "win32") {
    const { directory, pipePath } = await mintOwnedPipe(root);
    return {
      endpointPath: pipePath,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  }
  return {
    endpointPath: path.join(root, name),
    cleanup: async () => {},
  };
}

/**
 * Attempts `server.listen(endpointPath)` and resolves with a bounded
 * verdict: `"listening"`, the `"error"` Node raised, or `"timeout"` if
 * neither fires within `timeoutMs`. Used by the double-listen probes so a
 * peer that neither errors nor starts listening can never hang the suite.
 */
export function attemptListen(server, endpointPath, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);
    server.once("error", (error) => finish({ kind: "error", error }));
    server.once("listening", () => finish({ kind: "listening" }));
    server.listen(endpointPath);
  });
}

/**
 * Mirrors `observeLocalEndpoint`'s absent/present/ambiguous classification
 * (native-client.ts:102-141) with the win32 hardcode removed, since proving
 * that hardcode obsolete on a real pipe is this probe's entire purpose. The
 * optional `connect` override exists only for the timer-path unit case below
 * (`ambiguousConnectTimedOut`), where a real OS-level connect hang cannot be
 * forced deterministically and portably; every other case connects for real.
 */
export function classifyOwnedEndpoint(
  pipePath,
  timeoutMs,
  { signal, connect = createConnection } = {},
) {
  if (signal?.aborted)
    return Promise.resolve({ kind: "ambiguous", reason: "cancelled" });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (observation) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      resolve(observation);
    };
    const onAbort = () => finish({ kind: "ambiguous", reason: "cancelled" });
    const socket = connect(pipePath);
    const timer = setTimeout(
      () => finish({ kind: "ambiguous", reason: "connect-timed-out" }),
      timeoutMs,
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.on("connect", () => finish({ kind: "present" }));
    socket.on("error", (error) =>
      finish(
        error.code === "ENOENT" || error.code === "ECONNREFUSED"
          ? { kind: "absent" }
          : { kind: "ambiguous", reason: error.code ?? "connect-error" },
      ),
    );
  });
}

/**
 * A minimal owned fixture standing in for the not-yet-implemented Windows
 * `drogond` admission path (`runtime-rpc-request-admission.ts` in the
 * read-only source reference; no Rust/TS equivalent exists on this branch
 * yet, which is exactly the gap docs/migration/verticals/V5/
 * windows-transport-seam-plan.md §4 items 1 and 5 flag). It applies the same
 * newline-delimited-JSON, 1 MiB max framing the real wire protocol uses, and
 * responds using the same envelope shape `validateEnvelopeMirror` accepts —
 * never a shape the real client's parser would reject as `Invalid service
 * response`. It never accepts a request whose `auth` does not match the
 * token it was started with.
 *
 * Every auth/frame verdict this fixture produces is fixture behavior only —
 * it proves this scaffolding enforces the mirrored rules, never that the
 * real (not-yet-implemented) `drogond` does.
 *
 * Cleanup note: `server.closeAllConnections` is an `http.Server` method, not
 * part of the `net.Server` API this fixture is built on (`createServer` is
 * imported from `node:net`) — calling it here would silently no-op and
 * leave any still-open socket connected. `close()` below instead tracks
 * every socket this server ever accepted and destroys each one explicitly
 * before closing the server, so cleanup never depends on a client
 * eventually ending the connection on its own.
 */
export function startFixtureDaemon(pipePath, { token }) {
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    let bytes = Buffer.alloc(0);
    let handled = false;
    socket.on("data", (chunk) => {
      if (handled) return;
      if (bytes.length + chunk.length > MAX_FRAME_BYTES) {
        handled = true;
        socket.destroy();
        return;
      }
      bytes = Buffer.concat([bytes, chunk]);
      const newline = bytes.indexOf(10);
      if (newline < 0) return;
      handled = true;
      let request;
      try {
        request = JSON.parse(bytes.subarray(0, newline).toString("utf8"));
      } catch {
        socket.destroy();
        return;
      }
      if (
        !request ||
        typeof request !== "object" ||
        typeof request.requestId !== "string" ||
        request.protocol !== 1
      ) {
        socket.destroy();
        return;
      }
      if (request.auth !== token) {
        socket.end(
          JSON.stringify({
            protocol: 1,
            requestId: request.requestId,
            ok: false,
            error: {
              code: "unauthenticated",
              message: "Wrong auth token.",
              retryable: false,
            },
          }) + "\n",
        );
        return;
      }
      socket.end(
        JSON.stringify({
          protocol: 1,
          requestId: request.requestId,
          ok: true,
          result: { method: request.method },
        }) + "\n",
      );
    });
    socket.on("error", () => {});
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(pipePath, () => {
      server.removeListener("error", reject);
      resolve({
        close: () =>
          new Promise((res) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => res());
          }),
      });
    });
  });
}

/**
 * Connects, writes a raw (possibly non-JSON) string, and collects the
 * response until `close`. Bounded by `timeoutMs`: a peer that never
 * responds and never closes (a silent fixture, a mid-flight server
 * destroy, or a real hung Windows CI peer) must never hang this wait
 * indefinitely — the timeout destroys the socket and resolves instead.
 */
function sendRaw(pipePath, raw, { timeoutMs = SEND_RAW_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const socket = createConnection(pipePath);
    let bytes = Buffer.alloc(0);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ kind: "timeout", bytes }), timeoutMs);
    socket.on("connect", () => socket.write(raw));
    socket.on("data", (chunk) => {
      bytes = Buffer.concat([bytes, chunk]);
    });
    socket.on("error", () => finish({ kind: "error", bytes }));
    socket.on("close", () => finish({ kind: "closed", bytes }));
  });
}

/** Sends a well-formed request to the fixture and parses its response through the mirrored envelope validator (fixture behavior, not drogond proof). */
async function callFixture(pipePath, { requestId, auth, method, params }) {
  const frame = buildFrame(requestId, auth, method, params ?? {});
  const outcome = await sendRaw(pipePath, frame);
  if (outcome.bytes.length === 0)
    return { kind: "no-response" };
  const newline = outcome.bytes.indexOf(10);
  const text = (newline >= 0 ? outcome.bytes.subarray(0, newline) : outcome.bytes).toString("utf8");
  return { kind: "response", envelope: validateEnvelopeMirror(JSON.parse(text), requestId) };
}

function activeResourceCounts() {
  const counts = new Map();
  for (const label of process.getActiveResourcesInfo())
    counts.set(label, (counts.get(label) ?? 0) + 1);
  return counts;
}

/** Real leaked-handle check: no resource type may have *more* live instances after cleanup than before the probe started. */
async function assertNoLeakedHandles(before) {
  await delay(10); // let close/'end' callbacks and their handle teardown settle
  const after = activeResourceCounts();
  const grown = [];
  for (const [label, count] of after)
    if (count > (before.get(label) ?? 0)) grown.push(`${label}: ${before.get(label) ?? 0} -> ${count}`);
  if (grown.length > 0)
    throw new Error(`Leaked handles after cleanup: ${grown.join(", ")}`);
}

const CASES = [
  {
    name: "present: owned server answers",
    async run(root) {
      const { directory, pipePath } = await mintOwnedPipe(root);
      const server = createServer(() => {});
      try {
        await new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(pipePath, resolve);
        });
        const observation = await classifyOwnedEndpoint(pipePath, 2000);
        if (observation.kind !== "present")
          throw new Error(`expected present, got ${JSON.stringify(observation)}`);
      } finally {
        await new Promise((resolve) => server.close(resolve));
        await rm(directory, { recursive: true, force: true });
      }
    },
  },
  {
    name: "absent: nothing listening",
    async run(root) {
      const { directory, pipePath } = await mintOwnedPipe(root);
      try {
        const observation = await classifyOwnedEndpoint(pipePath, 2000);
        if (observation.kind !== "absent")
          throw new Error(`expected absent, got ${JSON.stringify(observation)}`);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  },
  {
    name: "ambiguous: cancelled before connecting",
    async run(root) {
      const { directory, pipePath } = await mintOwnedPipe(root);
      try {
        const controller = new AbortController();
        controller.abort();
        const observation = await classifyOwnedEndpoint(pipePath, 2000, {
          signal: controller.signal,
        });
        if (observation.kind !== "ambiguous" || observation.reason !== "cancelled")
          throw new Error(`expected ambiguous/cancelled, got ${JSON.stringify(observation)}`);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  },
  {
    name: "ambiguous: connect timed out (real pipe, tight deadline)",
    async run(root) {
      const { directory, pipePath } = await mintOwnedPipe(root);
      try {
        // Nothing ever listens at this path (deliberately absent); a 0ms
        // deadline races the real ENOENT/ECONNREFUSED error and must never
        // be misreported as `absent` by fiat — only a genuine connect
        // outcome is allowed to produce `absent`.
        const observation = await classifyOwnedEndpoint(pipePath, 0);
        if (observation.kind !== "ambiguous" && observation.kind !== "absent")
          throw new Error(`expected ambiguous or absent, got ${JSON.stringify(observation)}`);
        if (observation.kind === "ambiguous" && observation.reason !== "connect-timed-out")
          throw new Error(`expected connect-timed-out, got ${JSON.stringify(observation)}`);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  },
  {
    // Fixture behavior, not drogond proof: this proves the fixture enforces
    // its own auth check correctly, not that the real (not-yet-implemented)
    // Windows drogond admission path rejects a wrong token the same way.
    name: "auth rejection: fixture refuses a wrong token (fixture behavior, not drogond proof)",
    async run(root) {
      const { directory, pipePath } = await mintOwnedPipe(root);
      const fixture = await startFixtureDaemon(pipePath, { token: "correct-token" });
      try {
        const wrong = await callFixture(pipePath, {
          requestId: randomUUID(),
          auth: "wrong-token",
          method: "status",
        });
        if (wrong.kind !== "response" || wrong.envelope.ok !== false)
          throw new Error(`expected a refused envelope, got ${JSON.stringify(wrong)}`);
        if (wrong.envelope.error.code !== "unauthenticated")
          throw new Error(`expected unauthenticated, got ${wrong.envelope.error.code}`);
        const right = await callFixture(pipePath, {
          requestId: randomUUID(),
          auth: "correct-token",
          method: "status",
        });
        if (right.kind !== "response" || right.envelope.ok !== true)
          throw new Error(`expected the correct token to be accepted, got ${JSON.stringify(right)}`);
      } finally {
        await fixture.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  },
  {
    // Fixture behavior, not drogond proof: this proves the client-side
    // precheck and this fixture's server-side framing guard both refuse
    // bad frames; it says nothing about the real drogond framing path.
    name: "frame rejection: malformed and oversize refused (fixture behavior, not drogond proof)",
    async run(root) {
      const { directory, pipePath } = await mintOwnedPipe(root);
      const fixture = await startFixtureDaemon(pipePath, { token: "correct-token" });
      try {
        // Client-side: the real precheck must refuse before ever writing to
        // the wire (native-client.ts:339-347) — proven here without any
        // socket at all.
        const oversizeFrame = buildFrame(
          randomUUID(),
          "correct-token",
          "status",
          { padding: "x".repeat(MAX_FRAME_BYTES) },
        );
        const precheck = precheckFrameSize(oversizeFrame);
        if (precheck.ok !== false || precheck.error.code !== "invalid_argument")
          throw new Error(`expected the client precheck to refuse an oversize frame, got ${JSON.stringify(precheck)}`);

        // Server-side defense in depth: a non-compliant sender that bypasses
        // the client precheck and writes an oversize frame directly must
        // still be refused by the fixture, never accepted.
        const oversizeOutcome = await sendRaw(pipePath, oversizeFrame);
        if (oversizeOutcome.bytes.length !== 0)
          throw new Error(`expected no response to an oversize frame, got ${oversizeOutcome.bytes.length} bytes`);

        // Malformed JSON must also be refused, never silently accepted.
        const malformedOutcome = await sendRaw(pipePath, "not-json\n");
        if (malformedOutcome.bytes.length !== 0)
          throw new Error(`expected no response to a malformed frame, got ${malformedOutcome.bytes.length} bytes`);
      } finally {
        await fixture.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  },
  {
    name: "double-listen: a second server on the same owned pipe path fails EADDRINUSE",
    async run(root) {
      const { directory, pipePath } = await mintOwnedPipe(root);
      const first = createServer(() => {});
      const second = createServer(() => {});
      try {
        await new Promise((resolve, reject) => {
          first.once("error", reject);
          first.listen(pipePath, resolve);
        });
        const outcome = await attemptListen(second, pipePath, 2000);
        if (outcome.kind === "listening")
          throw new Error(
            "expected the second listen to fail with EADDRINUSE, but it unexpectedly succeeded",
          );
        if (outcome.kind === "timeout")
          throw new Error(
            "expected a bounded EADDRINUSE verdict, but the second listen neither errored nor succeeded within the deadline",
          );
        if (outcome.error.code !== "EADDRINUSE")
          throw new Error(`expected EADDRINUSE, got ${outcome.error.code ?? outcome.error}`);
      } finally {
        // Close both unconditionally: `second` may be listening (the
        // unexpected-success branch above) or never bound (the ordinary
        // EADDRINUSE branch) — `server.close()` is safe either way.
        await new Promise((resolve) => first.close(resolve));
        await new Promise((resolve) => second.close(resolve));
        await rm(directory, { recursive: true, force: true });
      }
    },
  },
  {
    name: "server destroyed mid-flight: an in-flight connection observes a close, never a hang",
    async run(root) {
      const { directory, pipePath } = await mintOwnedPipe(root);
      const sockets = new Set();
      const server = createServer((socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
        // Deliberately never respond: the point of this case is that the
        // server itself is destroyed mid-flight, not that it answers.
      });
      try {
        await new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(pipePath, resolve);
        });
        const pending = sendRaw(pipePath, "irrelevant\n", { timeoutMs: 2000 });
        await delay(50); // let the connection actually establish before destroying it
        for (const socket of sockets) socket.destroy();
        server.close();
        const outcome = await pending;
        if (outcome.kind !== "closed" && outcome.kind !== "error")
          throw new Error(`expected a close or error, not a hang, got ${JSON.stringify(outcome)}`);
      } finally {
        for (const socket of sockets) socket.destroy();
        await rm(directory, { recursive: true, force: true });
      }
    },
  },
];

/**
 * Runs every case for real. Only meaningful on win32 — see the module
 * header. Returns a report; never throws for an individual case failure so
 * every case gets a verdict instead of the run aborting at the first one.
 */
export async function runAcceptanceProbe() {
  if (process.platform !== "win32") {
    return {
      platform: process.platform,
      verdict: "unverified",
      reason:
        "windows-native-transport probe requires a real win32 named-pipe host; " +
        `this run is on ${process.platform}, so every case is honestly skipped, never claimed as passing.`,
      cases: [],
    };
  }
  const before = activeResourceCounts();
  const root = await mkdtemp(path.join(tmpdir(), "dnt-run-"));
  const cases = [];
  try {
    for (const item of CASES) {
      try {
        await item.run(root);
        cases.push({ name: item.name, ok: true });
      } catch (error) {
        cases.push({ name: item.name, ok: false, detail: String(error?.message ?? error) });
      }
    }
  } finally {
    const residue = await readdir(root);
    await rm(root, { recursive: true, force: true });
    if (residue.length > 0)
      cases.push({
        name: "exact cleanup: no tmp residue",
        ok: false,
        detail: `left behind: ${residue.join(", ")}`,
      });
    else cases.push({ name: "exact cleanup: no tmp residue", ok: true });
    try {
      await assertNoLeakedHandles(before);
      cases.push({ name: "exact cleanup: no leaked handles", ok: true });
    } catch (error) {
      cases.push({
        name: "exact cleanup: no leaked handles",
        ok: false,
        detail: String(error?.message ?? error),
      });
    }
  }
  const allOk = cases.every((c) => c.ok);
  return {
    platform: process.platform,
    verdict: allOk ? "pass" : "fail",
    cases,
  };
}

/**
 * Whether this module was invoked directly as the CLI entry point (as
 * opposed to imported by the test file). The naive `` `file://${argvPath}` ``
 * string comparison this replaces never matches on Windows: a Windows
 * argv path uses backslashes and an unencoded drive letter
 * (`C:\Users\ci\windows-native-transport.mjs`), while `import.meta.url` is
 * always a properly percent-encoded, forward-slashed `file:///C:/...` URL —
 * so the old comparison was always false on win32, and the CLI runner would
 * silently exit 0 without ever calling `runAcceptanceProbe`. Converting the
 * argv path through `path.resolve` and `pathToFileURL` (Node's own
 * platform-correct URL conversion) before comparing fixes that on a real
 * Windows host. `resolvePath`/`toFileUrl` are injectable so this can be
 * pinned against Windows-shaped paths in pure unit tests without requiring
 * an actual win32 host.
 */
export function isMainModule(
  argvPath,
  moduleUrl,
  { resolvePath = path.resolve, toFileUrl = pathToFileURL } = {},
) {
  if (!argvPath) return false;
  return moduleUrl === toFileUrl(resolvePath(argvPath)).href;
}

const isMain = isMainModule(process.argv[1], import.meta.url);
if (isMain) {
  const report = await runAcceptanceProbe();
  console.log(JSON.stringify(report, null, 2));
  if (report.verdict === "fail") process.exit(1);
  process.exit(0);
}

export { activeResourceCounts, assertNoLeakedHandles, callFixture, sendRaw };
