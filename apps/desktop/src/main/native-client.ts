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
 * PERF-02 multiplexed transport, PERF-02b pooled: a small bounded pool of
 * long-lived connections per main process instead of one `realpath` + token
 * read + `createConnection` + destroy per request.
 *
 * One shared connection proved to serialize the hot path: the daemon's
 * `connection_loop` serves one frame at a time per connection (read ->
 * dispatch -> write -> loop) while the accept path spawns a thread per
 * connection, so one connection is one serialized queue — a slow
 * `session.list` delayed every fast call behind it, and an oversized
 * response (over `MAX_FRAME_BYTES`) closed the socket for every flight at
 * once. The pool keeps the per-request dial/token-read elimination and
 * demuxes by `requestId`, but concurrent calls land on different
 * connections (least-busy assignment, lazy growth to the cap), so one slow
 * call occupies at most its own connection, and one dead connection replays
 * or settles only its own flights. The push long-poll
 * (`session.events.poll` in `session-state-bridge.ts`) deliberately stays
 * off the pool entirely: that RPC holds its dispatch for up to 20 s, which
 * would head-of-line-block every short call sharing its connection.
 *
 * Pool size 4: the daemon pays a thread per connection, and this process's
 * steady-state concurrency is ~3 (the notifications poll fans out to two
 * parallel calls; awake-auto and the terminal read poll interleave) — four
 * absorbs that plus one burst caller while keeping daemon threads and fds
 * tiny against one-per-request. Bigger bursts share least-busy connections;
 * only many simultaneous *slow* calls would still queue, and no client-side
 * cap fixes that without spending daemon threads to match.
 *
 * Held calls (`session.output` per-pane holds, `session.events.poll`) never
 * ride the pool: the daemon serves one frame at a time per connection, so a
 * hold would head-of-line-block every short call sharing its entry (and a
 * second hold on the same socket would not even be read until the first
 * answers). They use `callNativeHold` below: one dedicated one-shot
 * connection per outstanding hold, destroyed on settle.
 */
export const NATIVE_POOL_MAX_CONNECTIONS = 4;

type PooledConnection = {
  endpoint: string;
  /** The live socket from dial time (pre-connect it is dialing, not ready). */
  socket: Socket | null;
  /** True once the daemon accepted the dial; every flight awaits this. */
  connected: boolean;
  ready: Promise<Socket>;
  rejectReady: (error: Error) => void;
  receiveBytes: Buffer;
};

type PendingCall = {
  method: string;
  params: object;
  requestId: string;
  /** The credential bytes actually written on the wire for this flight. */
  auth: string;
  resolve: (result: Result<unknown>) => void;
  reject: (error: Error) => void;
  deadline: ReturnType<typeof setTimeout>;
  deadlineAt: number;
  signal?: AbortSignal;
  onAbort?: () => void;
  /** Mid-flight socket death replays the frame once, same `requestId`, fresh auth. */
  replayed: boolean;
  /**
   * An `unauthorized` answer refreshes the credential file once, same
   * `requestId`. Independent of the transport replay above: one call can
   * survive both a dead socket and a restarted daemon.
   */
  authRetried: boolean;
  /** The pool entry carrying this flight; reassigned on replay. */
  conn: PooledConnection;
};

type CachedCredentials = {
  key: string;
  auth: string;
  endpoint: string;
};

let cachedCredentials: CachedCredentials | null = null;
/**
 * The key the pool was dialed for. Unlike the secret above this survives a
 * socket death: a death only forces a credential *reload*, and a reload for
 * the same directory must never disturb surviving entries — only an actual
 * endpoint move (tests swapping `DROGON_DATA_DIR`) evicts the pool.
 */
let credentialKey: string | null = null;
let pool: PooledConnection[] = [];
const pending = new Map<string, PendingCall>();
let connectionAttempts = 0;
/**
 * PERF-02c endpoint health: an established unix-domain connection survives
 * the socket path going away (rename/unlink) — the daemon keeps answering
 * it — so a warm pool can mask a transport loss no entry ever dies from.
 * Every renderer call keeps succeeding on pre-loss entries, the strip tab
 * never flips to `unverifiable`, and recovery waits hang. A dial failure
 * and this watchdog are the only signals that test the path itself.
 */
const POOL_WATCHDOG_MS = 2_000;
const POOL_WATCHDOG_PROBE_MS = 1_500;
/** The endpoint may be undialable: prefer a fresh dial over idle reuse. */
let endpointSuspect = false;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let healthCheckInFlight = false;
/**
 * Outstanding dedicated `session.output` holds. The singleton
 * `session.events.poll` loop bypasses the cap (grandfathered at exactly
 * one); every per-pane output hold counts. Socket budget against the
 * daemon's 64-connection cap (`DEFAULT_MAX_CONCURRENT_CONNECTIONS`):
 * pool (4) + events poll (1) + output holds (<= MAX below) stays <= 21,
 * with headroom for CLI and direct-socket users. Daemon threads are the
 * tighter bound — one thread per held connection — which is why the cap
 * counts holds, not bytes, and why a pane never starts a hold while
 * hidden (the renderer's channel selection pins that).
 */
let activeSessionOutputHolds = 0;

export type NativeTransport = {
  createConnection: (endpoint: string) => Socket;
};

let transportOverride: NativeTransport | null = null;

/** Test seam: count of `createConnection` dials from `callNative` (the probe stays separate). */
export function getNativeConnectionStats(): { connections: number } {
  return { connections: connectionAttempts };
}

/** Test seam: reset the dial counter without dropping pooled sockets. */
export function resetNativeConnectionStatsForTests(): void {
  connectionAttempts = 0;
}

/** Test seam: inject a fake socket factory (interleave/replay tests). */
export function setNativeTransportForTests(
  transport: NativeTransport | null,
): void {
  transportOverride = transport;
}

/** Every flight assigned to this entry, whatever its state. */
function flightsOf(conn: PooledConnection): PendingCall[] {
  const out: PendingCall[] = [];
  for (const call of pending.values())
    if (call.conn === conn) out.push(call);
  return out;
}

function removeFromPool(conn: PooledConnection): boolean {
  const index = pool.indexOf(conn);
  if (index < 0) return false;
  pool.splice(index, 1);
  return true;
}

/**
 * Drop every connected entry carrying no flight. Entries with genuine
 * in-flight answers are left alone — their answers are real daemon answers,
 * never a mask — but once they drain, the next pick revalidates rather
 * than coasting on a pre-loss entry. Never dials, so it cannot fail.
 */
function evictIdleEntries(): void {
  for (const conn of [...pool]) {
    if (conn.connected && flightsOf(conn).length === 0) {
      removeFromPool(conn);
      try {
        conn.socket?.destroy();
      } catch {
        // Already half-closed; the eviction itself is the outcome.
      }
      conn.receiveBytes = Buffer.alloc(0);
    }
  }
}

/**
 * The endpoint may have gone away (failed dial or failed watchdog probe):
 * stop coasting on pre-loss entries so the next call tests the path and
 * surfaces `unverifiable` within one round instead of hanging a recovery
 * wait. In-flight entries keep serving their genuine answers.
 */
function markEndpointSuspect(): void {
  endpointSuspect = true;
  evictIdleEntries();
}

async function checkEndpointHealth(): Promise<boolean> {
  if (healthCheckInFlight) return !endpointSuspect;
  if (transportOverride) return !endpointSuspect;
  // An empty unsuspected pool needs no probe: the next call dials fresh
  // anyway. A suspect flag with an empty pool still probes, so a restored
  // path clears before the next call instead of crying wolf.
  if (pool.length === 0 && !endpointSuspect) return true;
  healthCheckInFlight = true;
  try {
    // The spawn gate's own classifier, reused as the watchdog probe:
    // connect-only, no token read, no pool entry. `absent` (nothing
    // listening) marks the endpoint; `present` clears; `ambiguous`
    // (unsupported platform, timeout, odd errno) changes nothing — a
    // verdict the probe cannot prove must not throttle healthy reuse.
    const observation = await observeLocalEndpoint(
      dataDirectory(),
      process.platform,
      POOL_WATCHDOG_PROBE_MS,
    );
    if (observation.kind === "present") endpointSuspect = false;
    else if (observation.kind === "absent") markEndpointSuspect();
    return !endpointSuspect;
  } finally {
    healthCheckInFlight = false;
  }
}

function ensurePoolWatchdog(): void {
  if (watchdogTimer || transportOverride) return;
  watchdogTimer = setInterval(() => {
    void checkEndpointHealth();
  }, POOL_WATCHDOG_MS);
  // A liveness signal must never keep the app alive past its windows.
  try {
    watchdogTimer.unref?.();
  } catch {
    // A host without `unref` still gets the checks; exit owns lifetime.
  }
}

function stopPoolWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  healthCheckInFlight = false;
  endpointSuspect = false;
}

/**
 * Test seam: run one endpoint-health check on demand and report the
 * verdict. The background interval stays production-only; deterministic
 * tests poke instead of waiting out the wall clock.
 */
export function runNativePoolHealthCheckForTests(): Promise<boolean> {
  return checkEndpointHealth();
}

/** Test seam: drop every pooled socket, fail nothing silently (every flight rejects), clear all module state. */
export function resetNativeClientForTests(): void {
  transportOverride = null;
  connectionAttempts = 0;
  cachedCredentials = null;
  stopPoolWatchdog();
  credentialKey = null;
  lastKnownHostId = null;
  activeSessionOutputHolds = 0;
  const stale = pool;
  pool = [];
  for (const conn of stale) {
    // Wake any flight still awaiting the dial: it re-checks its mapping and
    // stands down (the reject loop below owns its outcome), instead of
    // dangling on a promise that can never settle. Settling an already
    // settled dial is a no-op.
    conn.rejectReady(new Error("native client reset for tests"));
    if (conn.socket) {
      try {
        conn.socket.destroy();
      } catch {
        // A half-open socket must never break test teardown.
      }
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
  /**
   * Bypass the cache and re-read the token file. The daemon mints a fresh
   * `auth.token` on every start (`ensure_token` in crates/drogond), so a
   * call answered `unauthorized` must re-read before concluding anything:
   * the cached token may predate a restart, while the file already carries
   * the new boot's token. Callers that did not observe `unauthorized` keep
   * the cached hot path (a missing file under a warm cache still
   * authenticates, as before).
   */
  reload = false,
): Promise<CachedCredentials> {
  // `DROGON_DATA_DIR` never moves under a running app; the key only guards
  // tests that swap it between isolated cases.
  const key = `${process.platform}:${process.env.DROGON_DATA_DIR ?? ""}`;
  if (!reload && cachedCredentials && cachedCredentials.key === key)
    return cachedCredentials;
  // The endpoint actually moved: sockets bound to the stale one must never
  // serve new flights. A routine reload after a socket death (same key)
  // skips this entirely — surviving entries stay up with their flights.
  // A flight still awaiting an evicted dial settles cannot-reach from its
  // dial catch (nothing it sent hit the wire — the same verdict as a failed
  // dial); a flight whose frame already went out on an evicted socket keeps
  // its absolute deadline, exactly as the single-socket client left it.
  // Either way this only happens when tests swap directories mid-flight.
  if (credentialKey !== null && credentialKey !== key && pool.length > 0) {
    // A new endpoint gets a fresh health verdict: suspicion attached to
    // the old path must never throttle dials to the new one.
    endpointSuspect = false;
    const stale = pool;
    pool = [];
    for (const conn of stale) {
      conn.rejectReady(new Error("stale endpoint"));
      if (conn.socket) {
        try {
          conn.socket.destroy();
        } catch {
          // Destroying a half-open socket must never mask the credential load.
        }
      }
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
  credentialKey = key;
  return cachedCredentials;
}

/**
 * Mid-flight socket death, scoped to the entry that died: only its flights
 * replay exactly once over a surviving or fresh connection (same
 * `requestId`, re-authed frame, original absolute deadline), so the
 * daemon's idempotency ledger dedupes a request it had already applied. A
 * second death is definitive — reported with the same verdict a one-shot
 * socket would have given, never as an exit proof. Flights on every other
 * entry are untouched: one call's transport death never punishes unrelated
 * calls.
 */
function onSocketDeath(conn: PooledConnection, reasonMessage: string | null): void {
  if (!removeFromPool(conn)) return;
  try {
    conn.socket?.destroy();
  } catch {
    // Already half-closed; the replay below owns the outcome.
  }
  conn.receiveBytes = Buffer.alloc(0);
  // Re-auth on reconnect: the token may have rotated under us.
  cachedCredentials = null;
  const flights = flightsOf(conn);
  if (flights.length === 0) return;
  for (const flight of flights) pending.delete(flight.requestId);
  for (const flight of flights) {
    detach(flight);
    if (!flight.replayed) {
      flight.replayed = true;
      void redeliver(flight);
    } else {
      settleReplayExhausted(flight, reasonMessage);
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
  if (!registerForResend(call)) return;
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
  call.auth = creds.auth;
  await transmit(call, creds);
}

/**
 * An `unauthorized` answer to a cleanly framed call, retried once with a
 * freshly re-read token when the file actually moved (a daemon restart
 * mints a new `auth.token` on every boot; the cache is keyed only by data
 * dir and can never notice on its own). Same `requestId`, so the daemon's
 * idempotency ledger still dedupes — and the rejected attempt never
 * touched the ledger anyway (auth resolves before any ledger/effect
 * touch). At most one file re-read per unauthorized answer, and no resend
 * when the file did not move: a genuinely rejected credential settles as
 * observed, never as a reload loop. The call's original absolute deadline
 * still bounds the retry; contact loss stays `unverifiable`, never exit.
 */
async function refreshAuthAndRedeliver(
  call: PendingCall,
  unauthorized: Result<unknown>,
): Promise<void> {
  pending.delete(call.requestId);
  detach(call);
  if (call.signal?.aborted) {
    cancel(call, new Error("Request aborted"));
    return;
  }
  if (!registerForResend(call)) return;
  let fresh: CachedCredentials;
  try {
    fresh = await loadCredentials(call.signal, true);
  } catch {
    // The file cannot be re-read: report the daemon's own verdict rather
    // than a transport guess about it.
    pending.set(call.requestId, call);
    settle(call, unauthorized);
    return;
  }
  if (call.signal?.aborted) {
    cancel(call, new Error("Request aborted"));
    return;
  }
  if (fresh.auth === call.auth) {
    // No rotation: resending the same bytes would fail identically.
    pending.set(call.requestId, call);
    settle(call, unauthorized);
    return;
  }
  call.auth = fresh.auth;
  await transmit(call, fresh);
}

/**
 * Remaining absolute budget, re-registration, deadline and abort wiring
 * for a (re)delivery. False when the original deadline already lapsed (the
 * timeout verdict is settled); the caller returns without sending.
 */
function registerForResend(call: PendingCall): boolean {
  const remaining = call.deadlineAt - Date.now();
  if (remaining <= 0) {
    pending.set(call.requestId, call);
    settle(call, unreachable("Service request timed out"));
    return false;
  }
  pending.set(call.requestId, call);
  call.deadline = setTimeout(() => {
    settle(call, unreachable("Service request timed out"));
  }, remaining);
  if (call.signal && call.onAbort)
    call.signal.addEventListener("abort", call.onAbort, { once: true });
  return true;
}

/**
 * Shared send tail for a (re)delivery: least-busy assignment and write.
 * The caller owns credential selection (`redeliver` uses the cache,
 * `refreshAuthAndRedeliver` a forced re-read), records `call.auth`, and
 * ran `registerForResend` before entering.
 */
async function transmit(
  call: PendingCall,
  creds: CachedCredentials,
): Promise<void> {
  // Reassignment, not affinity: the replay lands on whatever entry is
  // least busy now (often a survivor), never back on the dead one — the
  // dead entry left the pool before this ran.
  const conn = pickConnection(creds.endpoint);
  call.conn = conn;
  try {
    const socket = await conn.ready;
    if (pending.get(call.requestId) !== call) return;
    if (!pool.includes(conn) || call.conn !== conn) {
      // Evicted while dialing (reset or stale endpoint in tests): nothing
      // hit the wire, so cannot-reach is the honest verdict.
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
    // The dial failed; `failDialFlights` already settled every flight that
    // was still assigned to it. Anything still mapped here was reassigned
    // away and is owned elsewhere — but a stale-endpoint eviction rejects
    // the dial without settling, so settle that case here.
    if (pending.get(call.requestId) !== call) return;
    if (call.conn !== conn || pool.includes(conn)) return;
    pending.delete(call.requestId);
    detach(call);
    call.resolve(unreachable());
  }
}

/**
 * Total silence on one entry: flights aboard keep the old per-socket idle
 * verdict; an empty entry simply retires (the pool grows lazily, so idle
 * entries are dropped rather than held). Either way only this entry's
 * flights are touched.
 */
function onSocketIdle(conn: PooledConnection): void {
  if (!removeFromPool(conn)) return;
  const socket = conn.socket;
  conn.socket = null;
  try {
    socket?.destroy();
  } catch {
    // Already half-closed; the settle below owns the outcome.
  }
  const flights = flightsOf(conn);
  if (flights.length === 0) return;
  for (const call of flights) pending.delete(call.requestId);
  for (const call of flights) {
    detach(call);
    call.resolve(unreachable("Service timed out"));
  }
}

function routeLine(conn: PooledConnection, line: string): void {
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
  // must never mutate `lastKnownHostId` or resolve/reject again. A frame
  // arriving on an entry that does not carry the flight is likewise dropped:
  // the daemon only answers on the connection that received the frame.
  if (!call || call.conn !== conn) return;
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
  if (!parsed.ok && parsed.error.code === "unauthorized" && !call.authRetried) {
    // A restarted daemon mints a fresh token while this client's cache
    // still holds the old boot's: re-read once and resend the same
    // `requestId` when the file moved, instead of wedging every later
    // call on a stale credential. A second `unauthorized` (or an unmoved
    // file) settles as observed — contact loss stays `unverifiable`.
    call.authRetried = true;
    void refreshAuthAndRedeliver(call, parsed);
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

function onSocketData(conn: PooledConnection, chunk: Buffer): void {
  if (!pool.includes(conn)) return;
  if (conn.receiveBytes.length + chunk.length > MAX_FRAME_BYTES) {
    // An over-limit stream is contained to its entry: only its flights fail
    // contract validation (never replayed — the bytes cannot be attributed
    // to one flight, and replaying an oversized answer would fail again),
    // while every other entry's flights proceed untouched. This is the
    // oversized-`session.list` case: the daemon closes that connection with
    // no error frame, and the pool keeps the blast radius to the call that
    // asked for it.
    const flights = flightsOf(conn);
    for (const flight of flights) pending.delete(flight.requestId);
    removeFromPool(conn);
    const socket = conn.socket;
    conn.socket = null;
    try {
      socket?.destroy();
    } catch {
      // Already half-closed; the settle below owns the outcome.
    }
    conn.receiveBytes = Buffer.alloc(0);
    for (const flight of flights) {
      detach(flight);
      flight.resolve(malformed("Service response is too large."));
    }
    return;
  }
  conn.receiveBytes = Buffer.concat([conn.receiveBytes, chunk]);
  let newline: number;
  while ((newline = conn.receiveBytes.indexOf(10)) >= 0) {
    const line = conn.receiveBytes.subarray(0, newline).toString("utf8");
    conn.receiveBytes = conn.receiveBytes.subarray(newline + 1);
    routeLine(conn, line);
  }
}

function attachSocket(conn: PooledConnection): void {
  const socket = conn.socket;
  if (!socket) return;
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
  socket.on("data", (chunk: Buffer) => onSocketData(conn, chunk));
  socket.on("error", () => onSocketDeath(conn, null));
  socket.on("end", () => onSocketDeath(conn, "Service disconnected"));
  socket.on("close", () => onSocketDeath(conn, "Service disconnected"));
  socket.on("timeout", () => onSocketIdle(conn));
}

/**
 * A dial that never reached the daemon: nothing hit the wire, so every
 * flight assigned to it reports cannot-reach with no replay — the same
 * verdict a one-shot socket's failed dial always gave. Scoped to the dead
 * entry like every other transport failure.
 */
function failDialFlights(conn: PooledConnection): void {
  const flights = flightsOf(conn);
  for (const call of flights) pending.delete(call.requestId);
  for (const call of flights) {
    detach(call);
    call.resolve(unreachable());
  }
}

/**
 * Least-busy assignment over the pool. An idle established entry wins;
 * otherwise the pool grows lazily (one dial per entry, counted while
 * dialing so a burst shares the new entries instead of stampeding one);
 * at the cap the least-busy entry shares. Pick-and-register is synchronous
 * in the caller, so two concurrent `callNative` invocations never pick the
 * same idle entry.
 */
function pickConnection(endpoint: string): PooledConnection {
  // A suspect endpoint revalidates instead of coasting: evict the idle
  // pre-loss entries so this call tests the path (fail-fast surfacing) —
  // a restored path dials cleanly and clears the suspicion on connect.
  if (endpointSuspect) evictIdleEntries();
  for (const conn of pool) {
    if (conn.connected && conn.endpoint === endpoint && flightsOf(conn).length === 0)
      return conn;
  }
  if (pool.length < NATIVE_POOL_MAX_CONNECTIONS) return startDial(endpoint);
  let best = pool[0]!;
  let bestLoad = flightsOf(best).length;
  for (const conn of pool.slice(1)) {
    const load = flightsOf(conn).length;
    if (load < bestLoad) {
      best = conn;
      bestLoad = load;
    }
  }
  return best;
}

function startDial(endpoint: string): PooledConnection {
  const conn: PooledConnection = {
    endpoint,
    socket: null,
    connected: false,
    // Placeholder until the dial promise below is constructed (a pending
    // promise, never a rejected one, so construction itself is unobservable).
    ready: new Promise<Socket>(() => {}),
    rejectReady: () => {},
    receiveBytes: Buffer.alloc(0),
  };
  pool.push(conn);
  ensurePoolWatchdog();
  conn.ready = new Promise<Socket>((resolve, reject) => {
    conn.rejectReady = reject;
    let socket: Socket;
    try {
      connectionAttempts += 1;
      socket = (transportOverride?.createConnection ?? createConnection)(
        endpoint,
      );
    } catch {
      // A stillborn dial never lingers: leave the pool before settling, so
      // the death path cannot see it.
      removeFromPool(conn);
      failDialFlights(conn);
      // Nothing is listening: pre-loss idle entries must not mask this.
      markEndpointSuspect();
      reject(new Error("connect-failed"));
      return;
    }
    conn.socket = socket;
    const onConnectError = () => {
      removeFromPool(conn);
      conn.socket = null;
      try {
        socket.destroy();
      } catch {
        // A failed dial has nothing to clean up beyond itself.
      }
      failDialFlights(conn);
      // Nothing answered the dial: pre-loss idle entries must not mask this.
      markEndpointSuspect();
      reject(new Error("connect-failed"));
    };
    try {
      socket.once("error", onConnectError);
      socket.on("connect", () => {
        if (!pool.includes(conn)) {
          // Evicted while dialing (reset or stale endpoint): the socket is
          // torn down, the dial rejects, and awaiting flights stand down via
          // their dial catch.
          try {
            socket.destroy();
          } catch {
            // Already half-closed; nothing owns this socket anymore.
          }
          reject(new Error("evicted"));
          return;
        }
        socket.removeListener("error", onConnectError);
        conn.connected = true;
        // A completed dial proves the path: lift any earlier suspicion so
        // later calls reuse entries again instead of redialing forever.
        endpointSuspect = false;
        attachSocket(conn);
        resolve(socket);
      });
    } catch {
      onConnectError();
    }
  });
  // A flight can abort or settle between assignment and its first await; a
  // rejection with no awaiter yet must never surface as unhandled.
  conn.ready.catch(() => {});
  return conn;
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
   * Multiplexing note: aborting one call settles only that call now; every
   * other flight's connection stays up.
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
    // Assignment and registration are one synchronous step: a concurrent
    // `callNative` picking right after this sees this flight's load, so two
    // concurrent calls never share an idle entry.
    const conn = pickConnection(creds.endpoint);
    const call: PendingCall = {
      method,
      params,
      requestId,
      auth: creds.auth,
      resolve,
      reject,
      deadline: undefined as unknown as ReturnType<typeof setTimeout>,
      deadlineAt: Date.now() + REQUEST_DEADLINE_MS,
      signal,
      replayed: false,
      authRetried: false,
      conn,
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
        const socket = await conn.ready;
        if (pending.get(requestId) !== call) return;
        if (!pool.includes(conn) || call.conn !== conn) {
          // Evicted while dialing (reset or stale endpoint in tests):
          // nothing hit the wire, so cannot-reach is the honest verdict.
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
        // The dial failed; `failDialFlights` already settled every flight
        // still assigned to it, and an evicted-while-dialing flight is
        // settled above — unless the eviction rejected the dial without
        // settling (stale endpoint), which settles here.
        if (pending.get(requestId) !== call) return;
        if (call.conn !== conn || pool.includes(conn)) return;
        pending.delete(requestId);
        detach(call);
        // The dial itself failed: cannot reach the service.
        call.resolve(unreachable());
      }
    })();
  });
}

/**
 * Hard cap on simultaneous per-pane `session.output` holds (see the
 * `activeSessionOutputHolds` budget above). Past it the caller gets a
 * retryable `hold_cap` refusal and answers the round over the old poll
 * instead — degradation, never deadlock, never daemon exhaustion.
 */
export const MAX_SESSION_OUTPUT_HOLDS = 16;

/**
 * Dedicated long-hold call for methods the daemon answers late by design
 * (`session.output` per-pane output holds, `session.events.poll` state
 * holds). Lifted from `session-state-bridge.ts`'s `callSessionDaemon`
 * (same one-shot framing, same envelope validation, same `unverifiable`
 * verdict family) onto the pool's cached credentials, with two changes
 * the pool's shape requires: one dedicated one-shot connection per call
 * — a hold must share a connection with NOTHING, not even another hold,
 * because the daemon serves one frame at a time per connection — and a
 * hard cap on simultaneous output holds.
 *
 * Deliberately NOT result-schema validation: like the bridge dial it
 * replaces, this settles the envelope and each caller validates its own
 * payload (`session.events.poll` keeps its zod contract,
 * `drogon:readOutput` reuses `resultSchemas["session.output"]`), so this
 * primitive cannot drift either contract.
 *
 * Lifetime notes: the socket is destroyed on settle (answer, error, end
 * or absolute deadline) and `unref`'d, so a hold never keeps the app
 * alive and never lingers past its answer — reclamation is the settle
 * itself, plus the renderer's rule that a hidden pane starts no new
 * hold. Early client-side cancel cannot free the daemon side (the held
 * dispatch sleeps its whole wait regardless), so there is no cancel
 * path: the absolute `timeoutMs` (which must cover the requested hold)
 * is the only bound, and a hold that ends by timeout reports
 * `unverifiable`, never exit.
 */
export async function callNativeHold(
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
  countAgainstCap: boolean,
  requestId: string = randomUUID(),
): Promise<Result<unknown>> {
  if (countAgainstCap) {
    if (activeSessionOutputHolds >= MAX_SESSION_OUTPUT_HOLDS) {
      return {
        ok: false,
        error: {
          code: "hold_cap",
          message:
            "Too many simultaneous terminal output holds; retry over the poll.",
          retryable: true,
        },
      };
    }
    activeSessionOutputHolds += 1;
  }
  try {
    let creds: CachedCredentials;
    try {
      // Cached like every pooled call: the first hold warms it, later
      // holds never re-read the directory or token on the hot path.
      creds = await loadCredentials();
    } catch {
      return unreachable();
    }
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
    return await new Promise<Result<unknown>>((resolve) => {
      let settled = false;
      let socket: Socket | undefined;
      // Set once an `unauthorized` answer has triggered the single
      // credential-refresh retry below; a second `unauthorized` settles as
      // observed instead of redialing forever.
      let authRetried = false;
      const finish = (result: Result<unknown>) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        try {
          socket?.destroy();
        } catch {
          // Destroying a half-open socket must never mask the result.
        }
        resolve(result);
      };
      const deadline = setTimeout(
        () => finish(unreachable("Service request timed out")),
        timeoutMs,
      );
      let bytes = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        if (settled) return;
        if (bytes.length + chunk.length > MAX_FRAME_BYTES) {
          finish(malformed("Service response is too large."));
          return;
        }
        bytes = Buffer.concat([bytes, chunk]);
        const newline = bytes.indexOf(10);
        if (newline < 0) return;
        let parsed: Result<unknown>;
        try {
          parsed = validateEnvelope(
            JSON.parse(bytes.subarray(0, newline).toString("utf8")),
            requestId,
          );
        } catch {
          finish(
            malformed(
              "The service response does not match the expected contract.",
            ),
          );
          return;
        }
        if (
          !authRetried &&
          !parsed.ok &&
          parsed.error.code === "unauthorized"
        ) {
          authRetried = true;
          void refreshAuthAndResend(parsed);
          return;
        }
        finish(parsed);
      };
      const dial = (auth: string, endpoint: string) => {
        let dialed: Socket;
        try {
          dialed = (transportOverride?.createConnection ?? createConnection)(
            endpoint,
          );
        } catch {
          finish(unreachable());
          return;
        }
        socket = dialed;
        try {
          // A hold must never keep the app alive past its windows (same
          // posture as pooled entries); the absolute deadline above — not
          // an idle timer, since silence IS the hold — owns the lifetime.
          socket.unref?.();
        } catch {
          // A fake transport without `unref` still works.
        }
        const dialFrame =
          JSON.stringify({
            protocol: 1,
            requestId,
            auth,
            method,
            params,
          }) + "\n";
        socket.on("connect", () => {
          try {
            socket?.write(dialFrame);
          } catch {
            finish(unreachable());
          }
        });
        socket.on("error", () => finish(unreachable()));
        socket.on("end", () => finish(unreachable("Service disconnected")));
        socket.on("data", onData);
      };
      /**
       * The daemon answered `unauthorized` to a cleanly framed call, which
       * after a restart means the cached token predates the new boot (the
       * daemon mints a fresh `auth.token` on every start): drop the stale
       * connection, re-read the file once, and resend the same `requestId`
       * when the file actually moved. The rejected attempt never touched
       * the daemon's idempotency ledger (auth resolves before any
       * ledger/effect touch), so the same id cannot double-apply. Anything
       * else — an unreadable file, an unmoved token, a dead redial —
       * settles with the most specific verdict observed, never as exit
       * proof. The absolute deadline above still bounds the whole call,
       * including this retry.
       */
      const refreshAuthAndResend = async (
        unauthorized: Result<unknown>,
      ): Promise<void> => {
        try {
          socket?.destroy();
        } catch {
          // Already half-closed; the resend below owns the outcome.
        }
        socket = undefined;
        bytes = Buffer.alloc(0);
        let fresh: CachedCredentials;
        try {
          fresh = await loadCredentials(undefined, true);
        } catch {
          // The file cannot be re-read: report the daemon's own verdict
          // rather than a transport guess about it.
          finish(unauthorized);
          return;
        }
        if (settled) return;
        if (fresh.auth === creds.auth) {
          // No rotation: the credential is genuinely rejected, and
          // resending it would fail identically — settle as observed.
          finish(unauthorized);
          return;
        }
        creds = fresh;
        dial(creds.auth, creds.endpoint);
      };
      dial(creds.auth, creds.endpoint);
    });
  } finally {
    if (countAgainstCap) activeSessionOutputHolds -= 1;
  }
}
