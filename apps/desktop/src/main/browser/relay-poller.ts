// Desktop side of the daemon-mediated browser command relay
// (`browser.relay.v1`, journeys J3/J4). After the native client connects,
// this long-polls `desktop.commands.poll`, dispatches each command to the
// browser host, and reports `desktop.commands.complete`.
//
// Transport note: this uses its own minimal framed-JSON socket client
// instead of `callNative` because `callNative` validates every result
// against the shared `resultSchemas` map, which this task may not extend.
// Relay shapes are validated here with the additive zod schemas from
// `shared/browser-contract.ts`.

import { randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createConnection } from "node:net";
import {
  browserNavigateSchema,
  browserRelayClickParamsSchema,
  browserRelayFillParamsSchema,
  browserRelayOpenParamsSchema,
  browserRelayTabParamsSchema,
  browserRelayTabsParamsSchema,
  relayCommandSchema,
  relayPollResultSchema,
  type BrowserSnapshot,
  type BrowserTabState,
  type RelayCommand,
} from "../../shared/browser-contract";
import { mentuRelayOpenParamsSchema } from "../../shared/mentu-contract";
import type { Result } from "../../shared/session-contract";
import { dataDirectory, resolveEndpointPath } from "../native-client";

const MAX_FRAME_BYTES = 1024 * 1024;
const POLL_WAIT_MS = 8_000;
const POLL_CALL_TIMEOUT_MS = 12_000;
const COMPLETE_CALL_TIMEOUT_MS = 10_000;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 15_000;

/** Structural host surface the relay needs; `BrowserHost` satisfies it. */
export type RelayBrowserHost = {
  createTab(
    workspaceId: string,
    url?: string,
  ): BrowserTabState | { blocked: string };
  navigate(tabId: string, url: string): BrowserTabState | { blocked: string };
  snapshot(tabId: string): Promise<BrowserSnapshot | { blocked: string }>;
  click(
    tabId: string,
    selector: string,
  ): Promise<BrowserTabState | { blocked: string; code?: string }>;
  fill(
    tabId: string,
    selector: string,
    text: string,
  ): Promise<BrowserTabState | { blocked: string; code?: string }>;
  tabsForWorkspace(workspaceId: string): BrowserTabState[];
};

export type RelayOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string } };

export type RelayDaemonCall = (
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
) => Promise<Result<unknown>>;

function unreachable(message: string): Result<never> {
  return {
    ok: false,
    error: { code: "unverifiable", message, retryable: true },
  };
}

/** One framed-JSON round trip to the local daemon, independent of `callNative`. */
export function callRelayDaemon(
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
  requestId: string = randomUUID(),
): Promise<Result<unknown>> {
  return new Promise((resolve) => {
    let settled = false;
    let socket: ReturnType<typeof createConnection> | undefined;
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
      () => finish(unreachable("Browser relay request timed out.")),
      timeoutMs,
    );
    const start = async () => {
      let directory: string;
      let auth: string;
      try {
        directory = await realpath(dataDirectory());
        auth = (await readFile(`${directory}/auth.token`, "utf8")).trim();
      } catch {
        finish(unreachable("Browser relay cannot reach the Drogon service."));
        return;
      }
      const endpoint = resolveEndpointPath(directory, process.platform);
      const connected = createConnection(endpoint);
      socket = connected;
      const frame =
        JSON.stringify({ protocol: 1, requestId, auth, method, params }) + "\n";
      let bytes = Buffer.alloc(0);
      connected.on("connect", () => connected.write(frame));
      connected.on("error", () =>
        finish(unreachable("Browser relay cannot reach the Drogon service.")),
      );
      connected.on("end", () =>
        finish(unreachable("Browser relay lost the Drogon service.")),
      );
      connected.on("data", (chunk: Buffer) => {
        if (settled) return;
        if (bytes.length + chunk.length > MAX_FRAME_BYTES) {
          finish({
            ok: false,
            error: {
              code: "internal_error",
              message: "Browser relay response is too large.",
              retryable: false,
            },
          });
          return;
        }
        bytes = Buffer.concat([bytes, chunk]);
        const newline = bytes.indexOf(10);
        if (newline < 0) return;
        try {
          const envelope = JSON.parse(bytes.subarray(0, newline).toString("utf8")) as Record<
            string,
            unknown
          >;
          if (
            envelope.protocol !== 1 ||
            envelope.requestId !== requestId ||
            typeof envelope.ok !== "boolean"
          )
            throw new Error("bad envelope");
          if (envelope.ok) {
            finish({ ok: true, result: envelope.result });
          } else {
            const error = envelope.error as Record<string, unknown>;
            if (
              !error ||
              typeof error.code !== "string" ||
              typeof error.message !== "string" ||
              typeof error.retryable !== "boolean"
            )
              throw new Error("bad error");
            finish({
              ok: false,
              error: {
                code: error.code,
                message: error.message,
                retryable: error.retryable,
              },
            });
          }
        } catch {
          finish({
            ok: false,
            error: {
              code: "internal_error",
              message: "Browser relay response does not match the contract.",
              retryable: false,
            },
          });
        }
      });
    };
    void start();
  });
}

function blockedCode(blocked: { blocked: string; code?: string }): {
  code: string;
  message: string;
} {
  if (blocked.code) return { code: blocked.code, message: blocked.blocked };
  if (blocked.blocked === "Tab is not open.")
    return { code: "browser_no_tab", message: blocked.blocked };
  if (blocked.blocked === "Browser window is not ready.")
    return { code: "browser_unavailable", message: blocked.blocked };
  return { code: "browser_blocked", message: blocked.blocked };
}

/** One Mentu open request handler; injectable so the poller dispatch is
 *  unit-testable without Electron, and so the electron-free browser relay
 *  module never has to import the main-process Mentu relay. `index.ts`
 *  wires the real one.
 */
export type MentuRelayOpener = (
  workspaceId: string,
  recipeId?: string,
) => Promise<RelayOutcome>;

/**
 * Executes one relay command against the browser host. Never throws: every
 * failure (bad params, missing tab, blocked navigation, refused script)
 * becomes an `ok:false` outcome the poller reports back, so the CLI always
 * gets an answer inside its own timeout. `mentu.open` is answered by the
 * renderer (see `main/mentu-open-relay.ts`) instead of the browser host —
 * same back-pressure, different owner; with no opener wired the command
 * completes as a typed refusal rather than pretending the tab opened.
 */
export async function dispatchRelayCommand(
  host: RelayBrowserHost,
  command: RelayCommand,
  mentuOpener?: MentuRelayOpener,
): Promise<RelayOutcome> {
  const invalid = (message: string): RelayOutcome => ({
    ok: false,
    error: { code: "invalid_argument", message },
  });
  switch (command.kind) {
    case "browser.open": {
      const parsed = browserRelayOpenParamsSchema.safeParse(command.params);
      if (!parsed.success) return invalid("Invalid browser.open params.");
      const created = host.createTab(parsed.data.workspaceId, parsed.data.url);
      if ("blocked" in created) return { ok: false, error: blockedCode(created) };
      return { ok: true, result: created };
    }
    case "browser.navigate": {
      const parsed = browserNavigateSchema.safeParse(command.params);
      if (!parsed.success) return invalid("Invalid browser.navigate params.");
      const moved = host.navigate(parsed.data.tabId, parsed.data.url);
      if ("blocked" in moved) return { ok: false, error: blockedCode(moved) };
      return { ok: true, result: moved };
    }
    case "browser.snapshot": {
      const parsed = browserRelayTabParamsSchema.safeParse(command.params);
      if (!parsed.success) return invalid("Invalid browser.snapshot params.");
      const snapshot = await host.snapshot(parsed.data.tabId);
      if ("blocked" in snapshot) return { ok: false, error: blockedCode(snapshot) };
      return { ok: true, result: snapshot };
    }
    case "browser.click": {
      const parsed = browserRelayClickParamsSchema.safeParse(command.params);
      if (!parsed.success) return invalid("Invalid browser.click params.");
      const clicked = await host.click(parsed.data.tabId, parsed.data.selector);
      if ("blocked" in clicked) return { ok: false, error: blockedCode(clicked) };
      return { ok: true, result: clicked };
    }
    case "browser.fill": {
      const parsed = browserRelayFillParamsSchema.safeParse(command.params);
      if (!parsed.success) return invalid("Invalid browser.fill params.");
      const filled = await host.fill(
        parsed.data.tabId,
        parsed.data.selector,
        parsed.data.text,
      );
      if ("blocked" in filled) return { ok: false, error: blockedCode(filled) };
      return { ok: true, result: filled };
    }
    case "browser.tabs": {
      const parsed = browserRelayTabsParamsSchema.safeParse(command.params);
      if (!parsed.success) return invalid("Invalid browser.tabs params.");
      return { ok: true, result: { tabs: host.tabsForWorkspace(parsed.data.workspaceId) } };
    }
    case "mentu.open": {
      const parsed = mentuRelayOpenParamsSchema.safeParse(command.params);
      if (!parsed.success) return invalid("Invalid mentu.open params.");
      if (!mentuOpener) {
        return {
          ok: false,
          error: {
            code: "mentu_open_unsupported",
            message: "This Drogon build has no Mentu tab relay wired.",
          },
        };
      }
      return mentuOpener(parsed.data.workspaceId, parsed.data.recipeId);
    }
    default:
      return invalid("Unknown relay command kind.");
  }
}

/** One poll → dispatch → complete cycle. Throws only on transport loss. */
export async function runRelayCycle(
  host: RelayBrowserHost,
  call: RelayDaemonCall,
  clientId: string,
  mentuOpener?: MentuRelayOpener,
): Promise<void> {
  const polled = await call(
    "desktop.commands.poll",
    { clientId, waitMs: POLL_WAIT_MS },
    POLL_CALL_TIMEOUT_MS,
  );
  if (!polled.ok) {
    if (polled.error.code === "unverifiable") throw new Error(polled.error.message);
    console.error(`[drogon] browser-relay poll refused: ${polled.error.code}`);
    return;
  }
  const parsed = relayPollResultSchema.safeParse(polled.result);
  if (!parsed.success) {
    console.error("[drogon] browser-relay poll answer does not match the contract.");
    return;
  }
  for (const raw of parsed.data.commands) {
    const command = relayCommandSchema.parse(raw);
    const outcome = await dispatchRelayCommand(host, command, mentuOpener);
    const completed = outcome.ok
      ? { commandId: command.commandId, ok: true, result: outcome.result }
      : {
          commandId: command.commandId,
          ok: false,
          error: { code: outcome.error.code, message: outcome.error.message },
        };
    try {
      await call("desktop.commands.complete", completed, COMPLETE_CALL_TIMEOUT_MS);
    } catch (error) {
      console.error(
        `[drogon] browser-relay complete lost for ${command.commandId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/** Exponential reconnect backoff, capped; exported so tests pin the curve. */
export function nextBackoff(currentMs: number): number {
  return Math.min(currentMs * 2, MAX_BACKOFF_MS);
}

export function baseBackoffMs(): number {
  return BASE_BACKOFF_MS;
}

let active = false;

/**
 * Starts the single app-wide relay poller. Returns a stop function for
 * tests; the app itself never stops it. A second call while one poller runs
 * is a no-op returning a no-op stop.
 */
export function startBrowserRelay(
  host: RelayBrowserHost,
  mentuOpener?: MentuRelayOpener,
): () => void {
  if (active) return () => {};
  active = true;
  let stopped = false;
  const clientId = randomUUID();
  const call: RelayDaemonCall = (method, params, timeoutMs) =>
    callRelayDaemon(method, params, timeoutMs);
  void (async () => {
    let backoff = BASE_BACKOFF_MS;
    while (!stopped) {
      try {
        await runRelayCycle(host, call, clientId, mentuOpener);
        backoff = BASE_BACKOFF_MS;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, backoff));
        backoff = nextBackoff(backoff);
      }
    }
    active = false;
  })();
  return () => {
    stopped = true;
  };
}
