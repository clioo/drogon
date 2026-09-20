// @vitest-environment jsdom
// #605 wiring, proved against the real TerminalPane rather than the planner
// alone: the pane must change xterm's grid at the byte the pty changed it,
// and nowhere else.
//
// The pane is driven through a scripted `session.read`, so these tests need
// no layout — they assert on the buffer the agent's own escape sequences
// produce, which is exactly what the reporter photographed.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Terminal } from "@xterm/xterm";
import type { Session } from "../../../../shared/session-contract";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { TerminalPane } from "./TerminalPane";
import { TooltipProvider } from "../../components/ui/tooltip";

installRadixJsdomStubs();


const ESC = "\x1b";
const PTY_COLS = 100;
// Deliberately not 80: that is xterm's default, so a wait on it would be
// satisfied before the pane had adopted anything at all.
const PANE_COLS = 72;
const ROWS = 24;
const draft = (n: number) => `> draft ${n} `.padEnd(90, ".");
const frame = (n: number) => [draft(n), `  hint ${n}`];
const rowsFor = (line: string, cols: number) => Math.max(1, Math.ceil(line.length / cols));

/** One input-zone repaint, sized for the grid the pty told the agent about. */
function repaint(lines: string[], previous: string[], cols: number): string {
  const previousRows = previous.reduce((rows, line) => rows + rowsFor(line, cols), 0);
  const head = previousRows > 0 ? `${ESC}[${previousRows}A\r${ESC}[J` : "";
  return head + lines.map((line) => `${line}\r\n`).join("");
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-605",
    workspaceId: "workspace-605",
    hostId: "host-605",
    incarnation: "incarnation-1",
    command: "/bin/zsh",
    args: [],
    cols: PTY_COLS,
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

/** A page the fake daemon will answer with, in order. */
type Page = {
  bytes: Uint8Array;
  cols: number;
  gridCursor: number;
  gridChanges?: { cursor: number; cols: number; rows: number }[];
};

function liveTerminal(): Terminal {
  const registry = (window as unknown as { __drogonTerminals?: Map<string, Terminal> })
    .__drogonTerminals;
  const terminal = registry ? [...registry.values()][0] : undefined;
  if (!terminal) throw new Error("TerminalPane registered no live terminal");
  return terminal;
}

function visibleLines(terminal: Terminal): string[] {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let row = 0; row < buffer.length; row += 1) {
    lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
  }
  return lines.filter((line) => line.trim().length > 0);
}

const strandedDrafts = (terminal: Terminal, live: number) =>
  visibleLines(terminal).filter(
    (line) => line.includes("> draft ") && !line.includes(`> draft ${live} `),
  );

describe("TerminalPane grid handover (#605)", () => {
  let resizeCalls: { cols: number; rows: number }[] = [];
  let pages: Page[] = [];
  let served = 0;

  beforeEach(() => {
    resizeCalls = [];
    pages = [];
    served = 0;
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    });
    let cursor = 0;
    (window as unknown as { drogon: unknown }).drogon = {
      // No push capability: the pane stays on the `read` poll, which answers
      // the same page shape and keeps this test about the grid, not the
      // transport.
      status: async () => ({ ok: true, result: { capabilities: [] } }),
      read: async () => {
        const page = pages[served];
        if (!page) {
          // Live edge: an empty page still carries the session, which is how
          // an idle resize still reaches the pane.
          const last = pages[pages.length - 1];
          return {
            ok: true,
            result: {
              session: session({
                cols: last?.cols ?? PTY_COLS,
                gridCursor: last?.gridCursor ?? 0,
              }),
              dataBase64: "",
              startCursor: cursor,
              nextCursor: cursor,
              truncated: false,
            },
          };
        }
        served += 1;
        const startCursor = cursor;
        cursor += page.bytes.length;
        return {
          ok: true,
          result: {
            session: session({ cols: page.cols, gridCursor: page.gridCursor }),
            dataBase64: toBase64(page.bytes),
            startCursor,
            nextCursor: cursor,
            truncated: false,
            ...(page.gridChanges ? { gridChanges: page.gridChanges } : {}),
          },
        };
      },
      write: async () => ({ ok: true, result: { acceptedBytes: 0 } }),
      resize: async (input: { cols: number; rows: number }) => {
        resizeCalls.push({ cols: input.cols, rows: input.rows });
        return { ok: true, result: session() };
      },
      workspaces: async () => ({ ok: true, result: { workspaces: [] } }),
    };
  });

  afterEach(() => {
    cleanup();
    delete (window as Partial<Window & { drogon: unknown }>).drogon;
    delete (window as Partial<Window & { matchMedia: unknown }>).matchMedia;
  });

  function mount(value: Session = session()) {
    return render(
      <TooltipProvider>
        <TerminalPane
          session={value}
          fontSize={12}
          onError={() => {}}
          onSession={() => {}}
          onFocus={() => {}}
        />
      </TooltipProvider>,
    );
  }

  /** Waits until the pane has drained the scripted pages onto the buffer. */
  async function settle(terminal: Terminal, predicate: () => boolean) {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (served >= pages.length && predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(
      `pane never settled (served=${served}/${pages.length}, cols=${terminal.cols}, lines=${JSON.stringify(visibleLines(terminal))})`,
    );
  }

  it("changes grid at gridCursor, leaving no superseded frame on screen", async () => {
    // Frames 0-2 are composed at the pty's 100 columns; the pty then drops to
    // 80 and frames 3-5 are composed for that. The cut is the byte between.
    let text = "transcript uno\r\ntranscript dos\r\n";
    let previous: string[] = [];
    for (const n of [0, 1, 2]) {
      text += repaint(frame(n), previous, PTY_COLS);
      previous = frame(n);
    }
    const before = encoder.encode(text);
    let after = "";
    for (const n of [3, 4, 5]) {
      after += repaint(frame(n), previous, PANE_COLS);
      previous = frame(n);
    }
    pages = [
      { bytes: before, cols: PTY_COLS, gridCursor: 0 },
      // One page straddles the cut: the first half predates the resize.
      {
        bytes: encoder.encode(after),
        cols: PANE_COLS,
        gridCursor: before.length,
      },
    ];
    mount();
    const terminal = liveTerminal();
    // Both conditions: the grid has to have moved AND the last frame has to
    // have been written, or this asserts on a half-drained chain.
    await settle(
      terminal,
      () =>
        terminal.cols === PANE_COLS &&
        visibleLines(terminal).some((line) => line.includes("> draft 5 ")),
    );
    expect(terminal.cols).toBe(PANE_COLS);
    expect(strandedDrafts(terminal, 5)).toEqual([]);
    expect(visibleLines(terminal).some((l) => l.includes("> draft 5 "))).toBe(true);
    expect(visibleLines(terminal)[0]).toContain("transcript uno");
  });

  it("does not adopt a grid the stream has not reached yet", async () => {
    // Page 0 ends the mount's seek and settles the pane on the pty's grid.
    // Page 1 reports a resize whose cut is far past its own bytes: those
    // bytes were composed at the old grid and must be parsed at it, with the
    // new grid waiting for the page that actually carries the cut.
    const settled = encoder.encode("caught-up\r\n");
    const body = encoder.encode("still-old-grid\r\n");
    pages = [
      { bytes: settled, cols: PTY_COLS, gridCursor: 0 },
      {
        bytes: body,
        cols: PANE_COLS,
        gridCursor: settled.length + body.length + 500,
      },
    ];
    mount();
    const terminal = liveTerminal();
    await settle(terminal, () =>
      visibleLines(terminal).some((line) => line.includes("still-old-grid")),
    );
    expect(terminal.cols).toBe(PTY_COLS);
  });

  it("never sends the pty back a grid it just reported", async () => {
    // Adopting the pty's report fires xterm's own resize event. Echoing that
    // back as a request would fight whatever the user has since measured.
    // The reported grid must differ from xterm's 80-column default, or no
    // resize happens and the guard is never exercised.
    const body = encoder.encode("hello\r\n");
    pages = [{ bytes: body, cols: 132, gridCursor: 0 }];
    mount();
    const terminal = liveTerminal();
    await settle(terminal, () => terminal.cols === 132);
    expect(terminal.cols).toBe(132);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(resizeCalls).toEqual([]);
  });

  it("applies every grid a page spans, not just the newest", async () => {
    // Adversarial finding F1: two resizes inside one read page. Reported as
    // a single newest grid, the bytes composed at the middle one are parsed
    // at the wrong width and stranded for good.
    const settled = encoder.encode("caught-up\r\n");
    const spanning = encoder.encode("AAAABBBBCCCC");
    pages = [
      { bytes: settled, cols: PTY_COLS, gridCursor: 0 },
      {
        bytes: spanning,
        cols: 96,
        gridCursor: settled.length + 8,
        gridChanges: [
          { cursor: settled.length, cols: PTY_COLS, rows: ROWS },
          { cursor: settled.length + 4, cols: 132, rows: ROWS },
          { cursor: settled.length + 8, cols: 96, rows: ROWS },
        ],
      },
    ];
    mount();
    const terminal = liveTerminal();
    const seen: number[] = [];
    terminal.onResize(({ cols }) => seen.push(cols));
    await settle(terminal, () => terminal.cols === 96);
    // The middle grid was held, not skipped over.
    expect(seen).toContain(132);
    expect(terminal.cols).toBe(96);
  });

  it("still fits itself when there is no live pty to follow", async () => {
    // Nothing is drawing into an exited pane, so there is nothing to strand
    // and the pane owns its own grid again.
    pages = [];
    const view = mount(session({ verdict: "exited", exitCode: 0, cols: 132 }));
    const terminal = liveTerminal();
    await new Promise((resolve) => setTimeout(resolve, 120));
    // jsdom reports zero-sized cells, so `proposeDimensions` yields nothing
    // and the pane cannot measure: what this pins is that it never asked the
    // dead pty to resize either.
    expect(resizeCalls).toEqual([]);
    view.unmount();
    expect(terminal).toBeTruthy();
  });

  it("adopts the live grid before replaying a truncated tail", async () => {
    // A remount replays the retained tail, whose newest bytes are the agent's
    // live input zone: they belong to the grid the daemon reports now.
    const body = encoder.encode("replayed tail\r\n");
    pages = [{ bytes: body, cols: PANE_COLS, gridCursor: 0 }];
    mount(session({ cols: PANE_COLS }));
    const terminal = liveTerminal();
    await settle(terminal, () =>
      visibleLines(terminal).some((line) => line.includes("replayed tail")),
    );
    expect(terminal.cols).toBe(PANE_COLS);
  });
});
