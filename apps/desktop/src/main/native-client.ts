import { randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createConnection } from "node:net";
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
    default:
      return null;
  }
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
   */
  signal?: AbortSignal,
): Promise<Result<unknown>> {
  if (signal?.aborted) throw new Error("Request aborted");
  let directory: string;
  let auth: string;
  try {
    directory = await realpath(dataDirectory());
    // `realpath` itself takes no `signal` (unsupported by the fs API);
    // re-check immediately after so an abort that landed during it is not
    // missed just because the resolved directory looks fine.
    if (signal?.aborted) throw new Error("Request aborted");
    auth = (
      await readFile(path.join(directory, "auth.token"), {
        encoding: "utf8",
        signal,
      })
    ).trim();
  } catch (error) {
    // An abort during either await must propagate as a cancellation, not
    // read as "couldn't reach the directory/token" — those are different
    // callers (one gave up waiting, the other never got an answer).
    if (signal?.aborted)
      throw error instanceof Error ? error : new Error("Request aborted");
    return unreachable();
  }
  // Re-check once more, right before opening the socket: the two awaits
  // above are the only gap between the top-of-function check and socket
  // creation, and an abort landing in that gap must never fall through to
  // registering a listener on a signal whose "abort" event already fired
  // (which would never replay, leaving the socket to open regardless).
  if (signal?.aborted) throw new Error("Request aborted");
  const endpoint = resolveEndpointPath(directory, process.platform);
  const frame =
    JSON.stringify({ protocol: 1, requestId, auth, method, params }) + "\n";
  if (Buffer.byteLength(frame) > MAX_FRAME_BYTES)
    return {
      ok: false,
      error: {
        code: "invalid_argument",
        message: "Request is too large.",
        retryable: false,
      },
    };
  return await new Promise((resolve, reject) => {
    const socket = createConnection(endpoint);
    let bytes = Buffer.alloc(0);
    let settled = false;
    const cleanup = () => {
      clearTimeout(deadline);
      signal?.removeEventListener("abort", abort);
    };
    const finish = (result: Result<unknown>) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      resolve(result);
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(new Error("Request aborted"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    const deadline = setTimeout(
      () => finish(unreachable("Service request timed out")),
      REQUEST_DEADLINE_MS,
    );
    socket.setTimeout(IDLE_TIMEOUT_MS, () =>
      finish(unreachable("Service timed out")),
    );
    socket.on("connect", () => socket.write(frame));
    socket.on("error", () => finish(unreachable()));
    socket.on("end", () => finish(unreachable("Service disconnected")));
    socket.on("data", (chunk) => {
      // Already settled (including via abort) — a response racing in after
      // that must never mutate `lastKnownHostId` or resolve/reject again.
      if (settled) return;
      if (bytes.length + chunk.length > MAX_FRAME_BYTES)
        return finish(malformed("Service response is too large."));
      bytes = Buffer.concat([bytes, chunk]);
      const newline = bytes.indexOf(10);
      if (newline < 0) return;
      let parsed: Result<unknown>;
      try {
        const envelope = validateEnvelope(
          JSON.parse(bytes.subarray(0, newline).toString("utf8")),
          requestId,
        );
        parsed = envelope.ok
          ? { ok: true, result: resultSchemas[method].parse(envelope.result) }
          : envelope;
      } catch {
        finish(
          malformed(
            "The service response does not match the expected contract.",
          ),
        );
        return;
      }
      if (parsed.ok) {
        if (method === "status")
          lastKnownHostId = (parsed.result as { hostId: string }).hostId;
        const mismatch = identityMismatch(
          method,
          params,
          parsed.result,
          lastKnownHostId,
        );
        if (mismatch) {
          finish(mismatch);
          return;
        }
      }
      finish(parsed);
    });
  });
}
