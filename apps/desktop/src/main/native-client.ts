import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import type { Result } from "../shared/session-contract";
import { resultSchemas } from "../shared/result-validation";

export const MAX_FRAME_BYTES = 1024 * 1024;
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

export async function callNative(
  method: string,
  params: object,
): Promise<Result<unknown>> {
  try {
    const directory = await realpath(dataDirectory());
    const auth = (
      await readFile(path.join(directory, "auth.token"), "utf8")
    ).trim();
    const endpoint =
      process.platform === "win32"
        ? `\\\\.\\pipe\\drogon-v1-${createHash("sha256").update(directory).digest("hex").slice(0, 24)}`
        : path.join(directory, "runtime-v1.sock");
    const requestId = randomUUID();
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
      const finish = (error?: Error, result?: Result<unknown>) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error);
        else resolve(result!);
      };
      socket.setTimeout(10_000, () => finish(new Error("Service timed out")));
      socket.on("connect", () => socket.write(frame));
      socket.on("error", (error) => finish(error));
      socket.on("end", () => finish(new Error("Service disconnected")));
      socket.on("data", (chunk) => {
        if (bytes.length + chunk.length > MAX_FRAME_BYTES)
          return finish(new Error("Service response too large"));
        bytes = Buffer.concat([bytes, chunk]);
        const newline = bytes.indexOf(10);
        if (newline < 0) return;
        try {
          const result = validateEnvelope(
            JSON.parse(bytes.subarray(0, newline).toString("utf8")),
            requestId,
          );
          if (result.ok)
            result.result = resultSchemas[method].parse(result.result);
          finish(undefined, result);
        } catch {
          finish(new Error("Invalid service response"));
        }
      });
    });
  } catch {
    return {
      ok: false,
      error: {
        code: "unverifiable",
        message:
          "Cannot reach the Drogon service. Check that drogond is running, then retry. Existing sessions have not been marked as exited.",
        retryable: true,
      },
    };
  }
}
