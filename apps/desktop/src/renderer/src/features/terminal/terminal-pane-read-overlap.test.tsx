// @vitest-environment jsdom
// The pane's read loop against a daemon that holds `session.output` the way
// the real one does: a hold answers every byte from its cursor to the ring's
// end, and nothing stops two holds on one session from both answering.
//
// An agent TUI redraws differentially — it writes only the cells it believes
// changed since its last frame. If the same page reaches xterm twice, the
// replayed cursor moves and partial repaints land on top of the newer frame
// and every cell the agent later skips as "unchanged" keeps stale text. In
// Claude Code's fullscreen mode each wheel tick is a mouse report, i.e.
// terminal input, so scrolling was the fastest way to hit it.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Terminal } from "@xterm/xterm";
import type { Session } from "../../../../shared/session-contract";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { TooltipProvider } from "../../components/ui/tooltip";
import { OUTPUT_PUSH_CAPABILITY } from "./terminal-output-push";
import { TerminalPane } from "./TerminalPane";

installRadixJsdomStubs();

const COLS = 80;
const ROWS = 24;

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-overlap",
    workspaceId: "workspace-overlap",
    hostId: "host-overlap",
    incarnation: "incarnation-1",
    command: "/bin/zsh",
    args: [],
    cols: COLS,
    rows: ROWS,
    gridCursor: 0,
    verdict: "live",
    exitCode: null,
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

const encoder = new TextEncoder();
const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

function liveTerminal(): Terminal {
  const registry = (window as unknown as { __drogonTerminals?: Map<string, Terminal> })
    .__drogonTerminals;
  const terminal = registry ? [...registry.values()][0] : undefined;
  if (!terminal) throw new Error("TerminalPane registered no live terminal");
  return terminal;
}

function bufferText(terminal: Terminal): string {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let row = 0; row < buffer.length; row += 1) {
    lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
  }
  return lines.join("\n");
}

const occurrences = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate: () => boolean, describe: () => string) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (predicate()) return;
    await tick();
  }
  throw new Error(`never settled: ${describe()}`);
}

describe("TerminalPane read loop: one outstanding read per pane", () => {
  let ring = new Uint8Array(0);
  let waiters: (() => void)[] = [];
  let openHolds = 0;
  let maxOpenHolds = 0;
  let holdsAnswered = 0;

  const append = (text: string) => {
    const bytes = encoder.encode(text);
    const next = new Uint8Array(ring.length + bytes.length);
    next.set(ring);
    next.set(bytes, ring.length);
    ring = next;
    const wake = waiters;
    waiters = [];
    for (const resolve of wake) resolve();
  };

  const page = (cursor: number) => ({
    ok: true,
    result: {
      session: session(),
      dataBase64: toBase64(ring.subarray(cursor)),
      startCursor: cursor,
      nextCursor: ring.length,
      truncated: false,
    },
  });

  beforeEach(() => {
    ring = new Uint8Array(0);
    waiters = [];
    openHolds = 0;
    maxOpenHolds = 0;
    holdsAnswered = 0;
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    });
    (window as unknown as { drogon: unknown }).drogon = {
      status: async () => ({
        ok: true,
        result: { capabilities: [OUTPUT_PUSH_CAPABILITY] },
      }),
      // Seek phase: the ring is empty, so the first short page ends it.
      read: async ({ cursor }: { cursor: number }) => page(cursor),
      // The daemon's `read_long_poll`: park until bytes exist past the
      // cursor, then answer all of them. Each hold is independent.
      readOutput: async ({ cursor }: { cursor: number }) => {
        openHolds += 1;
        maxOpenHolds = Math.max(maxOpenHolds, openHolds);
        try {
          while (ring.length <= cursor) {
            await new Promise<void>((resolve) => waiters.push(resolve));
          }
          holdsAnswered += 1;
          return page(cursor);
        } finally {
          openHolds -= 1;
        }
      },
      write: async (input: { dataBase64?: string }) => ({
        ok: true,
        result: { acceptedBytes: input.dataBase64 ? atob(input.dataBase64).length : 0 },
      }),
      resize: async () => ({ ok: true, result: session() }),
      workspaces: async () => ({ ok: true, result: { workspaces: [] } }),
    };
  });

  afterEach(() => {
    cleanup();
    // Release any hold still parked so no promise outlives the test.
    const wake = waiters;
    waiters = [];
    for (const resolve of wake) resolve();
    delete (window as Partial<Window & { drogon: unknown }>).drogon;
    delete (window as Partial<Window & { matchMedia: unknown }>).matchMedia;
  });

  function mount() {
    return render(
      <TooltipProvider>
        <TerminalPane
          session={session()}
          fontSize={12}
          onError={() => {}}
          onSession={() => {}}
          onFocus={() => {}}
        />
      </TooltipProvider>,
    );
  }

  it("writes a page once when input arrives while the next hold is parked", async () => {
    mount();
    const terminal = liveTerminal();
    // The push channel is armed: one hold is parked at the live edge.
    await until(() => openHolds === 1, () => `openHolds=${openHolds}`);

    // A frame lands; its write settles after the pane has already parked
    // the next hold (PERF-01b overlaps the two on purpose).
    append("frame one\r\n");
    await until(
      () => holdsAnswered === 1 && openHolds === 1 && bufferText(terminal).includes("frame one"),
      () => `answered=${holdsAnswered} open=${openHolds}`,
    );
    await tick(50);

    // Wheel ticks in a mouse-tracking TUI are input. Each one used to find
    // `readInFlight` cleared by the previous read's `finally` and park a
    // second hold at the same cursor.
    for (let wheel = 0; wheel < 5; wheel += 1) {
      terminal.input("\x1b[<65;10;10M", true);
      await tick(30);
    }

    append("frame two\r\n");
    await until(
      () => bufferText(terminal).includes("frame two"),
      () => bufferText(terminal),
    );
    await tick(100);

    const text = bufferText(terminal);
    expect(occurrences(text, "frame one")).toBe(1);
    expect(occurrences(text, "frame two")).toBe(1);
    expect(maxOpenHolds).toBe(1);
  });
});
