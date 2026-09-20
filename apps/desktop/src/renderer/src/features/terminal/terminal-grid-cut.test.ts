import { describe, expect, it } from "vitest";
import { planGridCutWrites, type GridCutStep } from "./terminal-grid-cut";

/**
 * Collapses a plan to the single-cut shape these cases were written against.
 * They cover one change per page, which is still the common case; the
 * multi-change cases below assert on the step sequence directly.
 */
function cutPlan(
  page: Parameters<typeof planGridCutWrites>[0],
  reported: Parameters<typeof planGridCutWrites>[1],
  current: Parameters<typeof planGridCutWrites>[2],
) {
  const steps = planGridCutWrites(page, reported, current);
  const at = steps.findIndex((step) => step.kind === "grid");
  const join = (from: number, to: number) => {
    const parts = steps
      .slice(from, to)
      .filter((step): step is Extract<GridCutStep, { kind: "write" }> => step.kind === "write");
    const out = new Uint8Array(parts.reduce((n, part) => n + part.bytes.length, 0));
    let offset = 0;
    for (const part of parts) {
      out.set(part.bytes, offset);
      offset += part.bytes.length;
    }
    return out;
  };
  if (at === -1) return { head: join(0, steps.length), grid: null, tail: new Uint8Array(0) };
  return {
    head: join(0, at),
    grid: (steps[at] as Extract<GridCutStep, { kind: "grid" }>).grid,
    tail: join(at + 1, steps.length),
  };
}

const page = (startCursor: number, text: string) => ({
  startCursor,
  nextCursor: startCursor + text.length,
  bytes: new TextEncoder().encode(text),
});
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const at80 = { cols: 80, rows: 24 };
const at100 = { cols: 100, rows: 24 };

describe("planGridCutWrite", () => {
  it("writes the page untouched while the pty is already at the pane's grid", () => {
    const plan = cutPlan(page(0, "hello"), { ...at80, gridCursor: 0 }, at80);
    expect(plan.grid).toBeNull();
    expect(decode(plan.head)).toBe("hello");
    expect(plan.tail).toHaveLength(0);
  });

  it("splits the page at the byte the pty changed grid", () => {
    // Cursor 10 is byte 4 of a page that starts at 6.
    const plan = cutPlan(page(6, "oldXXnew"), { ...at100, gridCursor: 10 }, at80);
    expect(decode(plan.head)).toBe("oldX");
    expect(plan.grid).toEqual(at100);
    expect(decode(plan.tail)).toBe("Xnew");
  });

  it("applies the grid before a page that begins at the cut", () => {
    const plan = cutPlan(page(10, "new"), { ...at100, gridCursor: 10 }, at80);
    expect(plan.head).toHaveLength(0);
    expect(plan.grid).toEqual(at100);
    expect(decode(plan.tail)).toBe("new");
  });

  it("applies the grid before a page that begins past the cut", () => {
    // Ring truncation can carry the pane's cursor over the cut entirely.
    const plan = cutPlan(page(4_000, "new"), { ...at100, gridCursor: 10 }, at80);
    expect(plan.head).toHaveLength(0);
    expect(plan.grid).toEqual(at100);
    expect(decode(plan.tail)).toBe("new");
  });

  it("leaves the grid alone for bytes that predate the cut", () => {
    // These bytes were composed at the old grid; a later page carries the cut.
    const plan = cutPlan(page(0, "old"), { ...at100, gridCursor: 99 }, at80);
    expect(decode(plan.head)).toBe("old");
    expect(plan.grid).toBeNull();
    expect(plan.tail).toHaveLength(0);
  });

  it("still reaches the new grid when the resize produced no output at all", () => {
    // An idle agent emits nothing after SIGWINCH, so the cut sits exactly at
    // the live edge and the page that reports it is empty. Waiting for a byte
    // that never comes would freeze the pane one grid away from its pty.
    const plan = cutPlan(page(10, ""), { ...at100, gridCursor: 10 }, at80);
    expect(plan.head).toHaveLength(0);
    expect(plan.grid).toEqual(at100);
    expect(plan.tail).toHaveLength(0);
  });

  it("applies the grid after a page whose last byte is the cut", () => {
    const plan = cutPlan(page(6, "old"), { ...at100, gridCursor: 9 }, at80);
    expect(decode(plan.head)).toBe("old");
    expect(plan.grid).toEqual(at100);
    expect(plan.tail).toHaveLength(0);
  });

  it("treats a daemon that reports no cursor as 'always been this grid'", () => {
    // Older service: the field is absent, so the only safe reading is that
    // the reported grid is in force for everything retained.
    const plan = cutPlan(page(500, "text"), at100, at80);
    expect(plan.head).toHaveLength(0);
    expect(plan.grid).toEqual(at100);
    expect(decode(plan.tail)).toBe("text");
  });

  it("never resizes to a grid the protocol cannot mean", () => {
    for (const bad of [
      { cols: 0, rows: 24 },
      { cols: 80, rows: 0 },
      { cols: 80.5, rows: 24 },
      { cols: Number.NaN, rows: 24 },
      { cols: -80, rows: 24 },
    ]) {
      const plan = cutPlan(page(0, "text"), { ...bad, gridCursor: 0 }, at80);
      expect(plan.grid).toBeNull();
      expect(decode(plan.head)).toBe("text");
    }
  });

  it("does not lose or duplicate a byte, wherever the cut lands", () => {
    const text = "abcdefghij";
    for (let cut = 0; cut <= 20; cut += 1) {
      const plan = cutPlan(page(5, text), { ...at100, gridCursor: cut }, at80);
      expect(decode(plan.head) + decode(plan.tail)).toBe(text);
    }
  });
});

// Adversarial finding F1: a page can span more than one resize. A planner
// that only knows the newest grid parses the bytes composed at the middle
// one at the wrong width, and those rows are stranded for good — the same
// failure this whole mechanism exists to prevent, just narrower. A fast
// divider drag against a chatty TUI is how two cuts land in one page.
describe("planGridCutWrites with several cuts in one page", () => {
  const encode = (text: string) => new TextEncoder().encode(text);
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  const at132 = { cols: 132, rows: 24 };

  it("applies every grid the page spans, at its own byte", () => {
    // "AAAA" at 80, "BBBB" at 132, "CCCC" back at 80.
    const steps = planGridCutWrites(
      page(0, "AAAABBBBCCCC"),
      {
        ...at80,
        gridCursor: 8,
        gridChanges: [
          { cursor: 0, ...at80 },
          { cursor: 4, ...at132 },
          { cursor: 8, ...at80 },
        ],
      },
      at80,
    );
    expect(
      steps.map((step) =>
        step.kind === "grid" ? `grid:${step.grid.cols}` : decode(step.bytes),
      ),
    ).toEqual(["AAAA", "grid:132", "BBBB", "grid:80", "CCCC"]);
  });

  it("does not lose or duplicate a byte across several cuts", () => {
    const text = "0123456789abcdef";
    const steps = planGridCutWrites(
      page(100, text),
      {
        ...at80,
        gridChanges: [
          { cursor: 100, ...at80 },
          { cursor: 103, ...at132 },
          { cursor: 107, ...at80 },
          { cursor: 112, ...at132 },
        ],
      },
      at80,
    );
    const written = steps
      .filter((step) => step.kind === "write")
      .map((step) => decode((step as { bytes: Uint8Array }).bytes))
      .join("");
    expect(written).toBe(text);
    expect(steps.filter((step) => step.kind === "grid")).toHaveLength(3);
  });

  it("skips a change to the grid the emulator already holds", () => {
    // Resizing to the current size reflows the buffer for nothing.
    const steps = planGridCutWrites(
      page(0, "abcd"),
      { ...at80, gridChanges: [{ cursor: 0, ...at80 }, { cursor: 2, ...at80 }] },
      at80,
    );
    expect(steps.filter((step) => step.kind === "grid")).toEqual([]);
    expect(decode((steps[0] as { bytes: Uint8Array }).bytes)).toBe("abcd");
  });

  it("orders cuts the daemon reported out of order, and drops ones past the page", () => {
    const steps = planGridCutWrites(
      page(0, "abcdef"),
      {
        ...at80,
        gridChanges: [
          { cursor: 4, ...at80 },
          { cursor: 2, ...at132 },
          { cursor: 900, cols: 40, rows: 10 },
        ],
      },
      at80,
    );
    expect(
      steps.map((step) =>
        step.kind === "grid" ? `grid:${step.grid.cols}` : decode(step.bytes),
      ),
    ).toEqual(["ab", "grid:132", "cd", "grid:80", "ef"]);
  });

  it("falls back to the single cut when a daemon reports no changes array", () => {
    const steps = planGridCutWrites(page(0, "abcd"), { ...at132, gridCursor: 2 }, at80);
    expect(
      steps.map((step) =>
        step.kind === "grid" ? `grid:${step.grid.cols}` : decode(step.bytes),
      ),
    ).toEqual(["ab", "grid:132", "cd"]);
  });
});
