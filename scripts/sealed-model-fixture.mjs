// Deterministic, loopback-only OpenAI-compatible model fixture for sealed
// acceptance (R16-BB follow-up): every journey that used to talk to the
// real team-local model server (http://100.85.64.21:9292/v1) now talks to
// a test-owned HTTP server started and closed by the acceptance harness
// itself. This fixture answers ONLY the fixed set of prompts
// probe-sealed-journeys.mjs actually sends -- the marker-echo instruction
// used by the Automations/Bots manual-run journeys, and the literal J1
// counting prompt -- and fails closed on anything else. It never makes an
// outgoing network call, never reads or requires credentials, and never
// writes outside the caller's own process (no global config).
//
// The real product still executes end to end: the real Pi agent binary,
// the real daemon/session/automation/bot RPCs, real persistence, real UI
// transitions. Only the external model provider's response is controlled.
//
// Coordinator review (fail-closed lifecycle corrections): close() must
// never hang on an in-flight stream and must never throw -- it returns a
// structured { verdict, forced } result (the same shape
// packaged-fixture-daemon.mjs's stop() reports) so a caller can preserve
// both an original test failure AND a cleanup failure instead of losing
// one to a bare .catch(() => {}). Health identity is pinned per-instance
// (instanceId), not just the fixture's type string, so a stale/foreign
// process can never be mistaken for the one this run started.

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

export const FIXTURE_IDENTITY = "drogon-sealed-model-fixture/1";
export const HEALTH_PATH = "/__fixture__/health";
export const CHAT_COMPLETIONS_PATH_SUFFIX = "/chat/completions";

// Exact prompt shapes probe-sealed-journeys.mjs sends today. Any other
// prompt is a real, honest failure -- never a guessed/plausible reply.
export const MARKER_PROMPT_PATTERN =
  /Reply with exactly this acceptance marker and nothing else:\s*(\S+)/;
export const COUNTING_PROMPT =
  "Count from 1 to 200 separated by commas. Reply with only the numbers.";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

const DEFAULT_STREAM_CHUNK_SIZE = 12;
const DEFAULT_STREAM_INTERVAL_MS = 150;
const DEFAULT_CLOSE_DEADLINE_MS = 5000;

/** Refuses any non-loopback bind host: this fixture must never listen
 *  where a real network client could reach it. */
export function assertLoopbackHost(host) {
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `sealed-model-fixture: refusing a non-loopback bind host ${JSON.stringify(host)}`,
    );
  }
}

/** The deterministic counting reply: "1, 2, 3, ..., 200". Pure/exported so
 *  probes and tests can assert against it without re-deriving the string. */
export function countingReplyText() {
  return Array.from({ length: 200 }, (_, index) => index + 1).join(", ");
}

/**
 * Extracts the plain text a user message actually carries, from either
 * legitimate OpenAI-compatible content shape: a plain string, or a
 * content-part array (`[{type:"text",text:"..."},...]`, interleaved with
 * non-text parts such as `image_url`). This is the REAL wire shape the
 * installed Pi package (`@earendil-works/pi-coding-agent`) sends -- headless
 * (`pi -p`, the automation/bot-run route) content arrives as the array
 * form (confirmed both by reading its openai-completions transport source
 * and by a bounded real loopback reproduction: `pi -p` against a private
 * capture server), while this repo's own interactive-typed-prompt journey
 * (J1) happens to arrive as a plain string. Concatenates every text part
 * in order (never reordering/synthesizing text); returns null for
 * anything that carries no recognizable text at all (content that is
 * neither a string nor an array, or an array with zero text parts) --
 * the caller still fails closed on that, exactly as before.
 */
function textFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("");
    return text.length > 0 ? text : null;
  }
  return null;
}

/** The last message with role "user" and recognizable text content --
 *  the shape every OpenAI-compatible chat request carries the live turn's
 *  prompt in, regardless of how many system/assistant messages precede
 *  it, and regardless of which of the two legitimate content shapes
 *  (string or text-part array) that specific transport call used. */
export function lastUserContent(messages) {
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const text = textFromContent(message.content);
    if (text !== null) return text;
  }
  return null;
}

/** Classifies one incoming prompt against the fixed acceptance shapes.
 *  Returns null for anything unrecognized -- the caller must fail closed,
 *  never invent a plausible-sounding reply. */
export function classifyPrompt(content) {
  if (typeof content !== "string") return null;
  const markerMatch = content.match(MARKER_PROMPT_PATTERN);
  if (markerMatch) return { kind: "marker", marker: markerMatch[1] };
  if (content.includes(COUNTING_PROMPT)) return { kind: "counting" };
  return null;
}

/** The health/identity URL derived from a fixture baseUrl (".../v1"): the
 *  origin plus HEALTH_PATH, never nested under the OpenAI-shaped /v1
 *  namespace so it can never collide with a real provider route. */
export function healthUrlFor(baseUrl) {
  const url = new URL(baseUrl);
  return `${url.protocol}//${url.host}${HEALTH_PATH}`;
}

/**
 * True only when a health payload is genuinely this exact fixture: the
 * type identity always, and the specific running instance whenever the
 * caller knows which instance it started (pinned ownership, the same
 * capture/recapture discipline packaged-fixture-daemon.mjs uses -- a
 * second, unrelated fixture process must never be accepted as "ready").
 */
export function isOwnedFixtureHealth(body, expectedInstanceId) {
  if (!body || typeof body !== "object") return false;
  if (body.fixture !== FIXTURE_IDENTITY) return false;
  if (typeof expectedInstanceId !== "string" || !expectedInstanceId || body.instanceId !== expectedInstanceId) {
    return false;
  }
  return true;
}

function sseChunk(id, delta) {
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta, finish_reason: null }],
  })}\n\n`;
}

function sseFinal(id) {
  const stop = `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  })}\n\n`;
  return `${stop}data: [DONE]\n\n`;
}

function safeWrite(res, chunk) {
  if (res.writableEnded || res.destroyed) return false;
  try {
    res.write(chunk);
    return true;
  } catch {
    return false;
  }
}

function safeEnd(res) {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.end();
  } catch {
    // socket already gone: nothing left to flush
  }
}

/**
 * Streams the deterministic reply as real, separately-timed SSE chunks
 * (genuine incremental transport, not one buffered write dressed up as a
 * stream). `signal` is this stream's own abort handle, registered with the
 * fixture's activeStreams set so close() can cut every in-flight stream
 * short immediately instead of waiting out its pacing.
 */
async function streamReply(res, id, text, { chunkSize, intervalMs, signal }) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  let index = 0;
  for (let offset = 0; offset < text.length; offset += chunkSize) {
    if (signal.aborted) break;
    const piece = text.slice(offset, offset + chunkSize);
    const delta = index === 0 ? { role: "assistant", content: piece } : { content: piece };
    if (!safeWrite(res, sseChunk(id, delta))) return;
    index += 1;
    if (offset + chunkSize < text.length) {
      try {
        await delay(intervalMs, undefined, { signal });
      } catch {
        break; // aborted mid-pace: stop pacing, fall through to close the stream
      }
    }
  }
  if (!signal.aborted) safeWrite(res, sseFinal(id));
  safeEnd(res);
}

function jsonReply(res, id, text) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      id,
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }),
  );
}

function fixtureError(res, status, message) {
  if (res.headersSent) {
    safeEnd(res);
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({ error: { message, type: "sealed_fixture_rejected" } }),
  );
}

async function readJsonBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("request body exceeded the fixture's size bound");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length > 0 ? JSON.parse(raw) : {};
}

/**
 * Starts the fixture on an OS-assigned loopback port and returns:
 *  - baseUrl: an OpenAI-compatible "http://host:port/v1"
 *  - instanceId: this exact running instance's identity (see
 *    isOwnedFixtureHealth) -- pin against it wherever a caller can.
 *  - receipt(): sanitized counts and rejected paths only, never raw
 *    prompt/message content.
 *  - close(): bounded, structured, owned teardown (see below) -- never
 *    throws.
 */
export async function startSealedModelFixture({
  host = "127.0.0.1",
  streamChunkSize = DEFAULT_STREAM_CHUNK_SIZE,
  streamIntervalMs = DEFAULT_STREAM_INTERVAL_MS,
  maxBodyBytes = 1_000_000,
  closeDeadlineMs = DEFAULT_CLOSE_DEADLINE_MS,
} = {}) {
  assertLoopbackHost(host);
  for (const value of [streamChunkSize, maxBodyBytes, closeDeadlineMs]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error("invalid fixture bound");
  }
  if (!Number.isFinite(streamIntervalMs) || streamIntervalMs < 0) throw new Error("invalid fixture pacing");
  const instanceId = randomUUID();
  const receipt = {
    totalRequests: 0,
    byKind: { marker: 0, counting: 0, health: 0 },
    rejected: 0,
    rejectedPaths: [],
  };
  let nextId = 0;
  const sockets = new Set();
  const activeStreams = new Set();
  const handlers = new Set();
  let closing = false;

  async function handle(req, res) {
    receipt.totalRequests += 1;
    const pathname = new URL(req.url ?? "/", "http://sealed-fixture").pathname;
    if (req.method === "GET" && pathname === HEALTH_PATH) {
      receipt.byKind.health += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ fixture: FIXTURE_IDENTITY, instanceId, ok: true }));
      return;
    }
    if (req.method === "POST" && pathname.endsWith(CHAT_COMPLETIONS_PATH_SUFFIX)) {
      let body;
      try {
        body = await readJsonBody(req, maxBodyBytes);
      } catch (error) {
        receipt.rejected += 1;
        receipt.rejectedPaths.push(pathname);
        fixtureError(res, 400, `sealed fixture: malformed request body: ${error.message}`);
        return;
      }
      const classification = classifyPrompt(lastUserContent(body?.messages));
      if (!classification) {
        receipt.rejected += 1;
        receipt.rejectedPaths.push(pathname);
        fixtureError(
          res,
          422,
          "sealed fixture: unrecognized prompt -- this fixture answers only the fixed acceptance prompts probe-sealed-journeys.mjs sends, never arbitrary model behavior.",
        );
        return;
      }
      receipt.byKind[classification.kind] += 1;
      const id = `sealed-fixture-${nextId}`;
      nextId += 1;
      const text = classification.kind === "marker" ? classification.marker : countingReplyText();
      if (body?.stream === true) {
        const controller = new AbortController();
        activeStreams.add(controller);
        try {
          await streamReply(res, id, text, {
            chunkSize: streamChunkSize,
            intervalMs: streamIntervalMs,
            signal: controller.signal,
          });
        } finally {
          activeStreams.delete(controller);
        }
      } else {
        jsonReply(res, id, text);
      }
      return;
    }
    receipt.rejected += 1;
    receipt.rejectedPaths.push(pathname);
    fixtureError(res, 404, `sealed fixture: no route for ${req.method} ${pathname}`);
  }

  const server = createServer((req, res) => {
    if (closing) { res.destroy(); return; }
    const task = handle(req, res).catch((error) => {
      receipt.rejected += 1;
      fixtureError(res, 500, `sealed fixture internal error: ${error.message}`);
    }).finally(() => handlers.delete(task));
    handlers.add(task);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    if (closing) socket.destroy();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  const numericHost = address.address.includes(":") ? `[${address.address}]` : address.address;
  const baseUrl = `http://${numericHost}:${address.port}/v1`;

  /**
   * Bounded, structured, never-throwing teardown: aborts every in-flight
   * stream immediately (no waiting out its own pacing), then closes the
   * listener. If sockets are still open past a short flush instant,
   * force-destroys them and gives close() one bounded window to settle.
   *
   * Returns { verdict: "stopped" | "unverifiable", forced,
   * outstandingStreams, outstandingSockets, error? } -- the same
   * verdict/forced shape packaged-fixture-daemon.mjs's stop() reports,
   * plus explicit counts so a caller can decide for itself that ANY
   * outstanding stream or socket (not just a bad verdict) is a real
   * problem worth failing on: by the time a real acceptance run's final
   * cleanup reaches this close(), every client that could hold one open
   * (the app/Pi) has already been torn down, so a nonzero count here is
   * genuine leaked-work evidence, never a normal keep-alive artifact.
   * Never throws, so a caller can always combine this result with an
   * earlier functional failure instead of needing to swallow it with a
   * bare .catch(() => {}).
   */
  let closePromise;
  function close() {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = (async () => {
      const abortedStreams = activeStreams.size;
      const forced = sockets.size > 0;
      // Stop admission before sweeping connections, including late accept events.
      const listenerClosed = new Promise((resolve) => server.close(() => resolve()));
      const socketClosures = [...sockets].map((socket) => new Promise((resolve) => {
        socket.once("close", resolve);
        socket.destroy();
      }));
      for (const controller of activeStreams) controller.abort();
      let timer;
      let settled;
      try {
        settled = await Promise.race([
          Promise.all([listenerClosed, ...socketClosures, ...handlers]).then(() => true),
          new Promise((resolve) => { timer = setTimeout(() => resolve(false), closeDeadlineMs); }),
        ]);
      } finally { clearTimeout(timer); }
      const outstandingStreams = activeStreams.size;
      const outstandingSockets = sockets.size;
      const stopped = settled && !server.listening && outstandingStreams === 0 && outstandingSockets === 0 && handlers.size === 0;
      return { verdict: stopped ? "stopped" : "unverifiable", forced,
        abortedStreams, outstandingStreams, outstandingSockets,
        ...(stopped ? {} : { error: "fixture resources did not settle within the close deadline" }) };
    })();
    return closePromise;
  }

  return {
    baseUrl,
    instanceId,
    receipt: () => ({
      totalRequests: receipt.totalRequests,
      byKind: { ...receipt.byKind },
      rejected: receipt.rejected,
      rejectedPaths: [...receipt.rejectedPaths],
    }),
    close,
  };
}
