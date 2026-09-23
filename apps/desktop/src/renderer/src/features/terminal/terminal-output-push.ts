// PERF-01 + PERF-01b: terminal output push channel and single-pass decode.
//
// PERF-01: terminal output used to arrive by polling `session.read` on a
// 24/120 ms cadence (terminal-read-pacing.ts), so typing echo landed up to
// a full poll late and a visible pane made ~41 daemon round trips/s while
// active. The daemon now holds a `session.output` long-poll until bytes
// exist (crates/drogon-core/src/session.rs `read_long_poll`, advertised via
// `OUTPUT_PUSH_CAPABILITY`); this module is the renderer's half — channel
// selection with a capability-absent fallback that keeps the old poll as
// the reconciliation path, exactly as the 2 s `session.list` poll stays
// the fallback for session state.
//
// PERF-01b: every chunk used to run `Uint8Array.from(atob(...), charCodeAt)`
// (an intermediate 64 KiB string plus a per-character callback) on the
// renderer main thread before the xterm write, and the next read was only
// scheduled after xterm finished parsing. `decodeBase64ToBytes` decodes in
// one pass straight into the final buffer, and the pane schedules the next
// read before awaiting the write settle; `createOrderedTerminalWriter`
// keeps xterm writes strictly ordered across that overlap.

/**
 * Capability a daemon with the `session.output` long-poll advertises
 * (`CAPABILITIES` in crates/drogon-core/src/lib.rs). A daemon predating
 * this string answers the method with `method_not_found`.
 */
export const OUTPUT_PUSH_CAPABILITY = "session.output-push.v1";

/**
 * Held long-poll per round trip. Under main's 10 s idle socket timeout
 * (`IDLE_TIMEOUT_MS` in main/native-client.ts, which is not ours to
 * change) with headroom for a loaded host; the daemon clamps to 30 s.
 */
export const OUTPUT_PUSH_WAIT_MS = 8_000;

/** True when the attached daemon advertises the push channel. */
export function isOutputPushAvailable(
  capabilities: readonly string[] | undefined | null,
): boolean {
  return !!capabilities && capabilities.includes(OUTPUT_PUSH_CAPABILITY);
}

/**
 * A `hold_cap` refusal from `drogon:readOutput` is transient main-side
 * capacity (too many simultaneous holds), not a version gap: the pane
 * answers the round over `read` and keeps push armed. Any other code
 * keeps its existing meaning (`method_not_found` latches the old poll).
 */
export function isTransientHoldRefusal(code: string | undefined): boolean {
  return code === "hold_cap";
}

export type OutputChannelKind = "push" | "poll";

/**
 * Which read path the pane uses for its next request. `push` is one held
 * `session.output` long-poll per visible pane, re-armed on answer;
 * `poll` is the existing 24/120 ms `session.read` cadence, which REMAINS
 * the path whenever push is unavailable (old daemon, missing bridge,
 * latched fallback), while hidden (no held request for a pane with no
 * viewport — the hidden cadence covers it) and while seeking (the seek
 * must drain retained pages at full speed and end on a short page, not
 * stall 8 s at the live edge waiting out a hold).
 */
export function resolveOutputChannel(args: {
  capabilities: readonly string[] | undefined | null;
  pushLatchedOff: boolean;
  readOutputAvailable: boolean;
  visible: boolean;
  seeking: boolean;
}): OutputChannelKind {
  if (args.pushLatchedOff) return "poll";
  if (!args.readOutputAvailable) return "poll";
  if (!isOutputPushAvailable(args.capabilities)) return "poll";
  if (!args.visible) return "poll";
  if (args.seeking) return "poll";
  return "push";
}

const BASE64_REVERSE: Int8Array = (() => {
  const table = new Int8Array(256).fill(-1);
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < chars.length; i++) table[chars.charCodeAt(i)] = i;
  table["=".charCodeAt(0)] = -2;
  return table;
})();

/** Table lookup that rejects non-Latin1 codes (out-of-table reads yield
 *  `undefined`, which every numeric comparison below would silently
 *  pass — a corrupt chunk must throw, never decode to zeros). */
function sextet(code: number): number {
  if (code > 255) throw new Error("Invalid base64 data.");
  return BASE64_REVERSE[code]!;
}

/**
 * Single-pass base64 → bytes with no intermediate string and no
 * per-character callback: one lookup per quantum straight into the final
 * buffer. Accepts exactly the canonical form the daemon emits (padded to
 * a multiple of 4, `=` only as the final quantum's tail); anything else
 * throws, and the pane treats that like a failed read (retry) rather than
 * writing corrupt bytes.
 */
export function decodeBase64ToBytes(input: string): Uint8Array {
  if (input.length === 0) return new Uint8Array(0);
  if (input.length % 4 !== 0)
    throw new Error("Invalid base64 length.");
  let padding = 0;
  if (input.charCodeAt(input.length - 1) === 61 /* = */) {
    padding = 1;
    if (input.charCodeAt(input.length - 2) === 61) padding = 2;
  }
  const out = new Uint8Array((input.length / 4) * 3 - padding);
  let offset = 0;
  for (let i = 0; i < input.length; i += 4) {
    const last = i + 4 === input.length;
    const a = sextet(input.charCodeAt(i));
    const b = sextet(input.charCodeAt(i + 1));
    let c = sextet(input.charCodeAt(i + 2));
    let d = sextet(input.charCodeAt(i + 3));
    if (a < 0 || b < 0 || c === -1 || d === -1 || (!last && (c === -2 || d === -2)))
      throw new Error("Invalid base64 data.");
    if (last) {
      if (padding === 2 && (b & 15) !== 0) throw new Error("Invalid base64 padding.");
      if (padding === 1 && (d !== -2 || (c & 3) !== 0)) throw new Error("Invalid base64 padding.");
      if (padding === 0 && (c === -2 || d === -2)) throw new Error("Invalid base64 padding.");
      if (c === -2) c = 0;
      if (d === -2) d = 0;
    }
    out[offset++] = (a << 2) | (b >> 4);
    if (offset < out.length) out[offset++] = ((b & 15) << 4) | (c >> 2);
    if (offset < out.length) out[offset++] = ((c & 3) << 6) | d;
  }
  return out;
}

export type TerminalWriteFn = (bytes: Uint8Array) => Promise<void>;

/**
 * Serializes xterm writes so bytes land strictly ordered per pane even
 * when the pane schedules its next read before the previous write
 * settles (PERF-01b): the overlap is between the network wait and xterm
 * parsing, never between two writes. A failed write never wedges the
 * chain — the caller still sees its own rejection — so one bad chunk
 * cannot stall the pane behind it.
 */
/**
 * An ordered writer, plus `run` for work that must land *between* two
 * writes. The terminal's own grid change is the case that needs it (#605):
 * it has to take effect after every byte the pty produced at the old grid
 * and before the first byte it produced at the new one, and the pane arms
 * its next read before the previous write settles, so anything done outside
 * this chain can slip past a page that is still queued.
 */
export type OrderedTerminalWriter = TerminalWriteFn & {
  run: <T>(action: () => T | Promise<T>) => Promise<T>;
};

export function createOrderedTerminalWriter(
  write: TerminalWriteFn,
): OrderedTerminalWriter {
  let tail: Promise<void> = Promise.resolve();
  const enqueue = <T>(step: () => T | Promise<T>): Promise<T> => {
    const queued = tail.then(step);
    tail = queued.then(
      () => {},
      () => {},
    );
    return queued;
  };
  const writer = ((bytes) => enqueue(() => write(bytes))) as OrderedTerminalWriter;
  writer.run = (action) => enqueue(action);
  return writer;
}
