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

/**
 * `session.start`/`harness.start` must return a session that is actually for
 * the workspace the caller asked for, on the host this client is actually
 * connected to. Neither check can be done by the wire schema alone (it only
 * knows the shape of a session, not which one was requested). Exported as a
 * pure function (host identity passed in, not read from module state) so it
 * is directly unit-testable.
 */
export function identityMismatch(
  method: string,
  params: object,
  result: unknown,
  knownHostId: string | null,
): Result<never> | null {
  if (method !== "session.start" && method !== "harness.start") return null;
  const session = result as { workspaceId?: unknown; hostId?: unknown };
  const requested = params as { workspaceId?: unknown };
  if (
    typeof requested.workspaceId === "string" &&
    session.workspaceId !== requested.workspaceId
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
): Promise<Result<unknown>> {
  let directory: string;
  let auth: string;
  try {
    directory = await realpath(dataDirectory());
    auth = (await readFile(path.join(directory, "auth.token"), "utf8")).trim();
  } catch {
    return unreachable();
  }
  const endpoint =
    process.platform === "win32"
      ? `\\\\.\\pipe\\drogon-v1-${createHash("sha256").update(directory).digest("hex").slice(0, 24)}`
      : path.join(directory, "runtime-v1.sock");
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
  return await new Promise((resolve) => {
    const socket = createConnection(endpoint);
    let bytes = Buffer.alloc(0);
    let settled = false;
    const finish = (result: Result<unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      resolve(result);
    };
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
