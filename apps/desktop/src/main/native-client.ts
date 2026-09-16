import { randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Result } from "../shared/session-contract";
import { resultSchemas } from "../shared/result-validation";

export const MAX_FRAME_BYTES = 1024 * 1024;
// Node's `socket.setTimeout` is an *inactivity* timer — it resets on every
// byte received, so a service that dribbles data forever would never trip
// it. `REQUEST_DEADLINE_MS` is a separate timer bounding total elapsed time
// for one call regardless of activity, cleared as soon as the call settles.
const REQUEST_DEADLINE_MS = 15_000;
const IDLE_TIMEOUT_MS = 10_000;

export function dataDirectory(): string {
  if (process.env.DROGON_DATA_DIR)
    return path.resolve(process.env.DROGON_DATA_DIR);
  if (process.platform === "darwin")
    return path.join(homedir(), "Library", "Application Support", "Drogon");
  if (process.platform === "win32") {
    if (!process.env.APPDATA) throw new Error("APPDATA is unavailable");
    return path.join(process.env.APPDATA, "Drogon");
  }
  return path.join(
    process.env.XDG_DATA_HOME || path.join(homedir(), ".local", "share"),
    "drogon",
  );
}

export function validateEnvelope(
  value: unknown,
  requestId: string,
): Result<unknown> {
  if (!value || typeof value !== "object")
    throw new Error("Invalid service response");
  const v = value as Record<string, unknown>;
  if (
    v.protocol !== 1 ||
    v.requestId !== requestId ||
    typeof v.ok !== "boolean"
  )
    throw new Error("Incompatible service response");
  if (v.ok && "result" in v && !("error" in v))
    return { ok: true, result: v.result };
  if (!v.ok && !("result" in v) && v.error && typeof v.error === "object") {
    const error = v.error as Record<string, unknown>;
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

/** Same construction the wire client and the local-only probe both need, kept in one place so they can never diverge. */
export function resolveEndpointPath(
  directory: string,
  platform: NodeJS.Platform,
): string {
  return platform === "win32"
    ? `\\\\.\\pipe\\drogon-v1-${createHash("sha256").update(directory).digest("hex").slice(0, 24)}`
    : path.join(directory, "runtime-v1.sock");
}

/**
 * A local-only classification of "is anything listening at this endpoint",
 * deliberately narrower than a full `callNative` round-trip: it never reads
 * or sends the auth token, so it can tell "present" from "absent" even when
 * the token file itself is missing or unreadable — which a full status call
 * cannot, since it fails the same `unverifiable` way for both. Used only to
 * decide whether *this process* may attempt one candidate spawn; it is not
 * new wire vocabulary and never substitutes for the daemon's own endpoint
 * lock as the actual ownership arbiter.
 */
export type LocalEndpointObservation =
  | { kind: "absent" }
  | { kind: "present" }
  | { kind: "ambiguous"; reason: string };

/**
 * Connects (and immediately disconnects, sending nothing) to classify
 * `ENOENT`/`ECONNREFUSED` as `"absent"` — the only case that authorizes a
 * spawn attempt elsewhere. Every other outcome (permission denied, some
 * other connect error, a successful connect, or this probe's own timeout)
 * is `"present"` or `"ambiguous"`: something might already own this
 * endpoint, or the cause of failure isn't known well enough to say it
 * doesn't, so neither ever authorizes a spawn.
 */
export function observeLocalEndpoint(
  directory: string,
  platform: NodeJS.Platform,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<LocalEndpointObservation> {
  if (platform === "win32")
    return Promise.resolve({
      kind: "ambiguous",
      reason: "unsupported-platform",
    });
  if (signal?.aborted)
    return Promise.resolve({ kind: "ambiguous", reason: "cancelled" });
  const endpoint = resolveEndpointPath(directory, platform);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (observation: LocalEndpointObservation) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      resolve(observation);
    };
    const onAbort = () => finish({ kind: "ambiguous", reason: "cancelled" });
    const socket = createConnection(endpoint);
    const timer = setTimeout(
      () => finish({ kind: "ambiguous", reason: "connect-timed-out" }),
      timeoutMs,
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.on("connect", () => finish({ kind: "present" }));
    socket.on("error", (error: NodeJS.ErrnoException) =>
      finish(
        error.code === "ENOENT" || error.code === "ECONNREFUSED"
          ? { kind: "absent" }
          : { kind: "ambiguous", reason: error.code ?? "connect-error" },
      ),
    );
  });
}

function unreachable(message?: string): Result<never> {
  return {
    ok: false,
    error: {
      code: "unverifiable",
      message:
        message ??
        "Cannot reach the Drogon service. Check that drogond is running, then retry. Existing sessions have not been marked as exited.",
      retryable: true,
    },
  };
}

// Distinct from `unreachable`: the connection worked and something answered,
// but the answer itself does not honor the contract. Collapsing this into
// "cannot reach" would hide a real service defect behind a transport-sounding
// message a caller would reasonably retry without changing anything.
function malformed(message: string): Result<never> {
  return {
    ok: false,
    error: { code: "internal_error", message, retryable: false },
  };
}

let lastKnownHostId: string | null = null;

type SessionIdentity = {
  id?: unknown;
  incarnation?: unknown;
  workspaceId?: unknown;
  hostId?: unknown;
};

type ExpectedIdentity = {
  sessionId?: string;
  incarnation?: string;
  workspaceId?: string;
};

/** One session result must match every identity the caller actually asserted; absent expectations are not checked. */
function checkSession(
  session: SessionIdentity,
  expected: ExpectedIdentity,
  knownHostId: string | null,
): Result<never> | null {
  if (expected.sessionId !== undefined && session.id !== expected.sessionId)
    return malformed(
      "The service returned a different session id than requested.",
    );
  if (
    expected.incarnation !== undefined &&
    session.incarnation !== expected.incarnation
  )
    return malformed(
      "The service returned a session with a different incarnation than requested.",
    );
  if (
    expected.workspaceId !== undefined &&
    session.workspaceId !== expected.workspaceId
  )
    return malformed(
      "The service returned a session for a different workspace than requested.",
    );
  if (knownHostId && session.hostId !== knownHostId)
    return malformed(
      "The service returned a session for a different execution host than the one this client is connected to.",
    );
  return null;
}

/**
 * Every method that returns a `Session` (directly, nested under `session`,
 * or as a `sessions[]`/`harnesses` list) must return one that actually
 * matches the identity the caller asserted — its requested session id,
 * incarnation, workspace, and this client's own known execution host.
 * Wire-shape validation alone cannot catch this: a structurally valid
 * `Session` for the *wrong* session is still a valid `Session`. Exported as
 * a pure function (host identity passed in, not read from module state) so
 * it is directly unit-testable.
 */
export function identityMismatch(
  method: string,
  params: object,
  result: unknown,
  knownHostId: string | null,
): Result<never> | null {
  const p = params as {
    workspaceId?: unknown;
    sessionId?: unknown;
    incarnation?: unknown;
  };
  const workspaceId =
    typeof p.workspaceId === "string" ? p.workspaceId : undefined;
  const sessionId = typeof p.sessionId === "string" ? p.sessionId : undefined;
  const incarnation =
    typeof p.incarnation === "string" ? p.incarnation : undefined;

  switch (method) {
    case "session.start":
    case "harness.start":
      return checkSession(
        result as SessionIdentity,
        { workspaceId },
        knownHostId,
      );
    case "session.resize":
    case "session.stop":
    case "session.close":
    case "session.forget":
      return checkSession(
        result as SessionIdentity,
        { sessionId, incarnation },
        knownHostId,
      );
    case "session.read": {
      const read = result as { session?: SessionIdentity };
      return checkSession(
        read.session ?? {},
        { sessionId, incarnation },
        knownHostId,
      );
    }
    case "session.list": {
      const list = result as { sessions?: SessionIdentity[] };
      for (const session of list.sessions ?? []) {
        const mismatch = checkSession(session, { workspaceId }, knownHostId);
        if (mismatch) return mismatch;
      }
      return null;
    }
    case "harness.list": {
      const catalog = result as { hostId?: unknown };
      if (knownHostId && catalog.hostId !== knownHostId)
        return malformed(
          "The service returned a harness catalog for a different execution host than the one this client is connected to.",
        );
      return null;
    }
    case "harness.models": {
      const models = result as { hostId?: unknown };
      if (knownHostId && models.hostId !== knownHostId)
        return malformed(
          "The service returned a model catalog for a different execution host than the one this client is connected to.",
        );
      return null;
    }
    default:
      return null;
  }
}

/**
 * PERF-02 multiplexed transport: one long-lived connection per main process
 * instead of one `realpath` + token read + `createConnection` + destroy per
 * request. Concurrent `callNative` invocations share the socket and demux by
 * `requestId` (the daemon's `connection_loop` serves every frame on the
 * connection, so pipelined frames are answered in turn). The push long-poll
 * (`session.events.poll` in `session-state-bridge.ts`) deliberately stays
 * off this socket: that RPC holds its dispatch for up to 20 s, which would
 * head-of-line-block every short call behind it on the daemon's sequential
 * per-connection loop.
 */

type PendingCall = {
  method: string;
  params: object;
  requestId: string;
  resolve: (result: Result<unknown>) => void;
  reject: (error: Error) => void;
  deadline: ReturnType<typeof setTimeout>;
  deadlineAt: number;
  signal?: AbortSignal;
  onAbort?: () => void;
  /** Mid-flight socket death replays the frame once, same `requestId`, fresh auth. */
  replayed: boolean;
};

type CachedCredentials = {
  key: string;
  auth: string;
  endpoint: string;
};

let cachedCredentials: CachedCredentials | null = null;
let sharedSocket: Socket | null = null;
let connectPromise: Promise<Socket> | null = null;
let receiveBytes = Buffer.alloc(0);
const pending = new Map<string, PendingCall>();
let connectionAttempts = 0;

export type NativeTransport = {
  createConnection: (endpoint: string) => Socket;
};

let transportOverride: NativeTransport | null = null;

/** Test seam: count of `createConnection` dials from `callNative` (the probe stays separate). */
export function getNativeConnectionStats(): { connections: number } {
  return { connections: connectionAttempts };
}

/** Test seam: reset the dial counter without dropping the shared socket. */
export function resetNativeConnectionStatsForTests(): void {
  connectionAttempts = 0;
}

/** Test seam: inject a fake socket factory (interleave/replay tests). */
export function setNativeTransportForTests(
  transport: NativeTransport | null,
): void {
  transportOverride = transport;
}

/** Test seam: drop the shared socket, fail nothing silently (every flight rejects), clear all module state. */
export function resetNativeClientForTests(): void {
  transportOverride = null;
  connectionAttempts = 0;
  connectPromise = null;
  cachedCredentials = null;
  lastKnownHostId = null;
  receiveBytes = Buffer.alloc(0);
  if (sharedSocket) {
    const stale = sharedSocket;
    sharedSocket = null;
    try {
      stale.destroy();
    } catch {
      // A half-open socket must never break test teardown.
    }
  }
  const doomed = [...pending.values()];
  pending.clear();
  for (const call of doomed) {
    clearTimeout(call.deadline);
    if (call.signal && call.onAbort)
      call.signal.removeEventListener("abort", call.onAbort);
    call.reject(new Error("native client reset for tests"));
  }
}

function detach(call: PendingCall): void {
  clearTimeout(call.deadline);
  if (call.signal && call.onAbort)
    call.signal.removeEventListener("abort", call.onAbort);
}

/** Settle exactly the mapped flight; a response racing a settle/abort/timeout is dropped, never double-applied. */
function settle(call: PendingCall, result: Result<unknown>): void {
  if (pending.get(call.requestId) !== call) {
    detach(call);
    return;
  }
  pending.delete(call.requestId);
  detach(call);
  call.resolve(result);
}

function cancel(call: PendingCall, error: Error): void {
  if (pending.get(call.requestId) !== call) return;
  pending.delete(call.requestId);
  detach(call);
  call.reject(error);
}

async function loadCredentials(
  signal?: AbortSignal,
): Promise<CachedCredentials> {
  // `DROGON_DATA_DIR` never moves under a running app; the key only guards
  // tests that swap it between isolated cases.
  const key = `${process.platform}:${process.env.DROGON_DATA_DIR ?? ""}`;
  if (cachedCredentials && cachedCredentials.key === key)
    return cachedCredentials;
  // A socket bound to a stale endpoint must never serve new flights.
  if (sharedSocket) {
    const stale = sharedSocket;
    sharedSocket = null;
    receiveBytes = Buffer.alloc(0);
    try {
      stale.destroy();
    } catch {
      // Destroying a half-open socket must never mask the credential load.
    }
  }
  // `realpath` itself takes no `signal` (unsupported by the fs API);
  // the caller re-checks abort immediately after, as before.
  const directory = await realpath(dataDirectory());
  if (signal?.aborted) throw new Error("Request aborted");
  const auth = (
    await readFile(path.join(directory, "auth.token"), {
      encoding: "utf8",
      signal,
    })
  ).trim();
  const endpoint = resolveEndpointPath(directory, process.platform);
  cachedCredentials = { key, auth, endpoint };
  return cachedCredentials;
}

function destroyCurrentSocket(): void {
  if (sharedSocket) {
    const stale = sharedSocket;
    sharedSocket = null;
    try {
      stale.destroy();
    } catch {
      // Already half-closed; the death handler below owns the outcome.
    }
  }
}

/**
 * Mid-flight socket death: every flight replays exactly once over a fresh
 * connection (same `requestId`, re-authed frame, original absolute
 * deadline), so the daemon's idempotency ledger dedupes a request it had
 * already applied. A second death is definitive — reported with the same
 * verdict a one-shot socket would have given, never as an exit proof.
 */
function onSocketDeath(socket: Socket, reasonMessage: string | null): void {
  if (socket !== sharedSocket) return;
  destroyCurrentSocket();
  receiveBytes = Buffer.alloc(0);
  connectPromise = null;
  // Re-auth on reconnect: the token may have rotated under us.
  cachedCredentials = null;
  if (pending.size === 0) return;
  const flights = [...pending.values()];
  pending.clear();
  for (const call of flights) {
    detach(call);
    if (!call.replayed) {
      call.replayed = true;
      void redeliver(call);
    } else {
      settleReplayExhausted(call, reasonMessage);
    }
  }
}

function settleReplayExhausted(
  call: PendingCall,
  reasonMessage: string | null,
): void {
  // The replay budget is spent: report with the verdict the death carries.
  // An `end` (server half-close) reads as disconnected; anything else —
  // refused/reset transport — reads as cannot-reach. Both stay
  // `unverifiable`: loss of contact never proves exit.
  const result =
    reasonMessage === null ? unreachable() : unreachable(reasonMessage);
  // `settle` needs the mapping; re-map briefly for the single settle path.
  pending.set(call.requestId, call);
  settle(call, result);
}

async function redeliver(call: PendingCall): Promise<void> {
  if (call.signal?.aborted) {
    cancel(call, new Error("Request aborted"));
    return;
  }
  const remaining = call.deadlineAt - Date.now();
  if (remaining <= 0) {
    pending.set(call.requestId, call);
    settle(call, unreachable("Service request timed out"));
    return;
  }
  pending.set(call.requestId, call);
  call.deadline = setTimeout(() => {
    settle(call, unreachable("Service request timed out"));
  }, remaining);
  if (call.signal && call.onAbort)
    call.signal.addEventListener("abort", call.onAbort, { once: true });
  let creds: CachedCredentials;
  try {
    creds = await loadCredentials(call.signal);
  } catch (error) {
    if (call.signal?.aborted) {
      cancel(
        call,
        error instanceof Error ? error : new Error("Request aborted"),
      );
      return;
    }
    // No connection to replay over: cannot reach the service.
    pending.set(call.requestId, call);
    settle(call, unreachable());
    return;
  }
  if (call.signal?.aborted) {
    cancel(call, new Error("Request aborted"));
    return;
  }
  try {
    const socket = await openConnection(creds.endpoint);
    if (pending.get(call.requestId) !== call) return;
    if (socket !== sharedSocket) {
      pending.delete(call.requestId);
      detach(call);
      call.resolve(unreachable());
      return;
    }
    try {
      socket.write(
        JSON.stringify({
          protocol: 1,
          requestId: call.requestId,
          auth: creds.auth,
          method: call.method,
          params: call.params,
        }) + "\n",
      );
    } catch {
      // The socket died between dial and write; its death handler already
      // replayed or settled this flight — never settle twice here.
    }
  } catch {
    if (pending.get(call.requestId) !== call) return;
    pending.delete(call.requestId);
    detach(call);
    call.resolve(unreachable());
  }
}

/** Total socket silence with flights aboard: the old per-socket idle verdict, applied to every flight. */
function onSocketIdle(socket: Socket): void {
  if (socket !== sharedSocket) return;
  if (pending.size === 0) {
    destroyCurrentSocket();
    receiveBytes = Buffer.alloc(0);
    return;
  }
  const flights = [...pending.values()];
  pending.clear();
  destroyCurrentSocket();
  receiveBytes = Buffer.alloc(0);
  for (const call of flights) {
    detach(call);
    call.resolve(unreachable("Service timed out"));
  }
}

function routeLine(line: string): void {
  let envelope: unknown;
  try {
    envelope = JSON.parse(line);
  } catch {
    // Unattributable bytes: no `requestId` to answer against. The daemon
    // only emits framed envelopes, so this never fires on a real wire.
    return;
  }
  const requestId = (envelope as { requestId?: unknown }).requestId;
  if (typeof requestId !== "string") return;
  const call = pending.get(requestId);
  // Already settled (including via abort) — a response racing in after that
  // must never mutate `lastKnownHostId` or resolve/reject again.
  if (!call) return;
  let parsed: Result<unknown>;
  try {
    const checked = validateEnvelope(envelope, requestId);
    parsed = checked.ok
      ? {
        ok: true,
        result: resultSchemas[call.method].parse(checked.result),
      }
      : checked;
  } catch {
    settle(
      call,
      malformed(
        "The service response does not match the expected contract.",
      ),
    );
    return;
  }
  if (parsed.ok) {
    if (call.method === "status")
      lastKnownHostId = (parsed.result as { hostId: string }).hostId;
    const mismatch = identityMismatch(
      call.method,
      call.params,
      parsed.result,
      lastKnownHostId,
    );
    if (mismatch) {
      settle(call, mismatch);
      return;
    }
  }
  settle(call, parsed);
}

function onSocketData(socket: Socket, chunk: Buffer): void {
  if (socket !== sharedSocket) return;
  if (receiveBytes.length + chunk.length > MAX_FRAME_BYTES) {
    // An over-limit stream cannot be attributed to one flight: every flight
    // fails contract validation (never replayed) and the socket recycles.
    const flights = [...pending.values()];
    pending.clear();
    destroyCurrentSocket();
    receiveBytes = Buffer.alloc(0);
    for (const flight of flights) {
      detach(flight);
      flight.resolve(malformed("Service response is too large."));
    }
    return;
  }
  receiveBytes = Buffer.concat([receiveBytes, chunk]);
  let newline: number;
  while ((newline = receiveBytes.indexOf(10)) >= 0) {
    const line = receiveBytes.subarray(0, newline).toString("utf8");
    receiveBytes = receiveBytes.subarray(newline + 1);
    routeLine(line);
  }
}

function attachSocket(socket: Socket): void {
  // An idle persistent connection must never keep the app alive past its windows.
  try {
    socket.unref?.();
  } catch {
    // A fake transport without `unref` still works; teardown owns lifetime.
  }
  try {
    socket.setTimeout(IDLE_TIMEOUT_MS);
  } catch {
    // Same posture: a transport without an idle timer degrades to the
    // per-call request deadline, which always still applies.
  }
  socket.on("data", (chunk: Buffer) => onSocketData(socket, chunk));
  socket.on("error", () => onSocketDeath(socket, null));
  socket.on("end", () => onSocketDeath(socket, "Service disconnected"));
  socket.on("close", () => onSocketDeath(socket, "Service disconnected"));
  socket.on("timeout", () => onSocketIdle(socket));
}

function openConnection(endpoint: string): Promise<Socket> {
  if (sharedSocket) return Promise.resolve(sharedSocket);
  if (connectPromise) return connectPromise;
  connectPromise = new Promise<Socket>((resolve, reject) => {
    let socket: Socket;
    try {
      connectionAttempts += 1;
      socket = (transportOverride?.createConnection ?? createConnection)(
        endpoint,
      );
    } catch {
      connectPromise = null;
      reject(new Error("connect-failed"));
      return;
    }
    const onConnectError = () => {
      connectPromise = null;
      try {
        socket.destroy();
      } catch {
        // A failed dial has nothing to clean up beyond itself.
      }
      reject(new Error("connect-failed"));
    };
    socket.once("error", onConnectError);
    socket.on("connect", () => {
      socket.removeListener("error", onConnectError);
      attachSocket(socket);
      sharedSocket = socket;
      connectPromise = null;
      resolve(socket);
    });
  });
  return connectPromise;
}

/**
 * `requestId` defaults to a fresh one per call, matching every existing
 * call site's one-shot behavior. A caller that specifically needs retry
 * safety for an ambiguous outcome (see `startHarness` in `index.ts`) passes
 * the *same* id across attempts with byte-identical params, letting the
 * service's own idempotency ledger dedupe a genuine retry instead of this
 * client blindly minting a new identity that could double a real side
 * effect.
 */
export async function callNative(
  method: string,
  params: object,
  requestId: string = randomUUID(),
  /**
   * Optional and cooperative only: honored solely so a caller that bounds
   * its own overall deadline (the bootstrap loop) can abandon a stuck
   * request and free its socket instead of it lingering unbounded. Absent,
   * behavior is byte-for-byte identical to before — every existing caller
   * that never passed a fourth argument sees no change.
   *
   * Multiplexing note: aborting one call settles only that call now; the
   * shared socket stays up for every other flight.
   */
  signal?: AbortSignal,
): Promise<Result<unknown>> {
  if (signal?.aborted) throw new Error("Request aborted");
  let creds: CachedCredentials;
  try {
    creds = await loadCredentials(signal);
    // `realpath`/`readFile` are the only gap between the top-of-function
    // check and socket use, and an abort landing in that gap must never
    // fall through to registering a listener on a signal whose "abort"
    // event already fired (which would never replay).
    if (signal?.aborted) throw new Error("Request aborted");
  } catch (error) {
    // An abort during either await must propagate as a cancellation, not
    // read as "couldn't reach the directory/token" — those are different
    // callers (one gave up waiting, the other never got an answer).
    if (signal?.aborted)
      throw error instanceof Error ? error : new Error("Request aborted");
    return unreachable();
  }
  // Re-check once more, right before queueing the flight: an abort landing
  // after the awaits must never register on an already-fired signal.
  if (signal?.aborted) throw new Error("Request aborted");
  const frame =
    JSON.stringify({
      protocol: 1,
      requestId,
      auth: creds.auth,
      method,
      params,
    }) + "\n";
  if (Buffer.byteLength(frame) > MAX_FRAME_BYTES)
    return {
      ok: false,
      error: {
        code: "invalid_argument",
        message: "Request is too large.",
        retryable: false,
      },
    };
  return await new Promise<Result<unknown>>((resolve, reject) => {
    const call: PendingCall = {
      method,
      params,
      requestId,
      resolve,
      reject,
      deadline: undefined as unknown as ReturnType<typeof setTimeout>,
      deadlineAt: Date.now() + REQUEST_DEADLINE_MS,
      signal,
      replayed: false,
    };
    const onDeadline = () => {
      settle(call, unreachable("Service request timed out"));
    };
    call.deadline = setTimeout(onDeadline, REQUEST_DEADLINE_MS);
    const onAbort = () => {
      cancel(call, new Error("Request aborted"));
    };
    call.onAbort = onAbort;
    signal?.addEventListener("abort", onAbort, { once: true });
    // A duplicate `requestId` while its flight is still mapped (practically
    // impossible outside a concurrent same-id retry) last-wins; the
    // superseded flight still settles via its own absolute deadline.
    pending.set(requestId, call);
    void (async () => {
      try {
        const socket = await openConnection(creds.endpoint);
        if (pending.get(requestId) !== call) return;
        if (socket !== sharedSocket) {
          pending.delete(requestId);
          detach(call);
          call.resolve(unreachable());
          return;
        }
        try {
          socket.write(frame);
        } catch {
          // The socket died between dial and write; its death handler owns
          // this flight's replay-or-settle — never settle twice here.
        }
      } catch {
        if (pending.get(requestId) !== call) return;
        pending.delete(requestId);
        detach(call);
        // The dial itself failed: cannot reach the service.
        call.resolve(unreachable());
      }
    })();
  });
}
