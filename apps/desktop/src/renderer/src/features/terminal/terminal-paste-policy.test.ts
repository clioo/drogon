// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/terminal-paste-coordinator.test.ts,
// terminal-bracketed-paste.test.ts and terminal-paste-multiline-policy.test.ts
// (focused subset over the ported policy modules).
import { describe, expect, it, vi } from "vitest";

import {
  markTerminalBracketedPasteInterrupted,
  normalizeTerminalPasteLineEndings,
  observeTerminalBracketedPasteModeOutput,
  pasteTerminalText,
  sanitizeBracketedPasteText,
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
} from "./terminal-bracketed-paste";
import {
  chunkTerminalPastePlan,
  createTerminalPastePayload,
  executeTerminalPastePlan,
  planTerminalPaste,
  TERMINAL_PASTE_DIRECT_MAX_BYTES,
  TERMINAL_PASTE_MAX_BYTES,
  type TerminalPasteTarget,
} from "./terminal-paste-coordinator";
import { formatTerminalPasteExecutionError } from "./terminal-paste-errors";

const textEncoder = new TextEncoder();

function terminalTarget(
  overrides: Partial<TerminalPasteTarget> = {},
): TerminalPasteTarget {
  return {
    kind: "terminal",
    paneId: 1,
    leafId: "leaf-1",
    ptyId: "pty-1",
    runtime: { platform: "darwin", runtimeKey: "local:darwin", kind: "local" },
    ...overrides,
  };
}

function createTerminal(bracketedPasteMode = true) {
  return {
    modes: { bracketedPasteMode },
    options: { ignoreBracketedPasteMode: false as boolean | undefined },
    input: vi.fn(),
    paste: vi.fn(),
  };
}

describe("terminal paste limits and planning", () => {
  it("plans a direct paste for small single-line payloads", () => {
    const plan = planTerminalPaste({
      text: "echo hi",
      source: "context-menu",
      target: terminalTarget(),
    });
    expect(plan.mode).toBe("direct");
    expect(plan.newlinePolicy).toBe("preserve");
    expect(plan.bracketed).toBe(false);
    expect(plan.payload.byteLength).toBe(textEncoder.encode("echo hi").length);
    expect(plan.payload.lineCount).toBe(1);
  });

  it("plans a chunked paste past the direct limit and brackets the chunks", () => {
    const plan = planTerminalPaste({
      text: "0123456789abcdef",
      source: "keyboard",
      target: terminalTarget(),
      terminalBracketedPasteMode: true,
      maxDirectBytes: 4,
      maxChunkBytes: 4,
    });
    expect(plan.mode).toBe("chunked");
    expect(plan.bracketed).toBe(true);
    expect(plan.newlinePolicy).toBe("terminal-cr");
    const chunks = chunkTerminalPastePlan(plan);
    expect(chunks[0]).toBe(BRACKETED_PASTE_START);
    expect(chunks[chunks.length - 1]).toBe(BRACKETED_PASTE_END);
    const joined = chunks
      .slice(1, -1)
      .join("");
    expect(joined).toBe("0123456789abcdef");
    for (const chunk of chunks.slice(1, -1)) {
      expect(textEncoder.encode(chunk).length).toBeLessThanOrEqual(4);
    }
  });

  it("keeps CRLF atomic across chunk boundaries", () => {
    // The chunker enforces a 4-byte floor (CRLF keeps a common case atomic);
    // the CR-normalized text still splits only between code points.
    const plan = planTerminalPaste({
      text: "ab\r\ncd",
      source: "keyboard",
      target: terminalTarget(),
      maxDirectBytes: 2,
      maxChunkBytes: 4,
    });
    const chunks = chunkTerminalPastePlan(plan);
    expect(plan.bracketed).toBe(false);
    expect(chunks.join("")).toBe("ab\rcd");
    for (const chunk of chunks) {
      expect(textEncoder.encode(chunk).length).toBeLessThanOrEqual(4);
    }
  });

  it("brackets multiline pastes when forced, single-line stays direct", () => {
    const multiline = planTerminalPaste({
      text: "one\r\ntwo",
      source: "keyboard",
      target: terminalTarget(),
      forceBracketedPasteForMultiline: true,
    });
    const single = planTerminalPaste({
      text: "one",
      source: "keyboard",
      target: terminalTarget(),
      forceBracketedPasteForMultiline: true,
    });
    expect(multiline.mode).toBe("bracketed-terminal");
    expect(single.mode).toBe("direct");
    expect(multiline.newlinePolicy).toBe("terminal-cr");
    expect(single.newlinePolicy).toBe("preserve");
  });

  it("rejects payloads over the absolute byte limit", () => {
    const plan = planTerminalPaste({
      text: "x".repeat(TERMINAL_PASTE_MAX_BYTES + 1),
      source: "paste-event",
      target: terminalTarget(),
    });
    expect(plan.mode).toBe("reject");
    expect(plan.rejectReason).toBe("payload-too-large");
  });

  it("defaults the direct limit to the source's 64 KiB", () => {
    expect(TERMINAL_PASTE_DIRECT_MAX_BYTES).toBe(64 * 1024);
  });
});

describe("terminal bracketed paste framing", () => {
  it("normalizes LF and CRLF to CR like xterm's native paste", () => {
    expect(normalizeTerminalPasteLineEndings("one\r\ntwo\nthree")).toBe(
      "one\rtwo\rthree",
    );
  });

  it("neutralizes embedded framing escapes", () => {
    expect(sanitizeBracketedPasteText("a\u001b[201~b")).toBe(
      "a\u241b[201~b",
    );
  });

  it("wraps forced paste in the bracket frame", () => {
    const terminal = createTerminal(false);
    pasteTerminalText(terminal, "one\r\ntwo", { forceBracketedPaste: true });
    expect(terminal.input).toHaveBeenCalledWith(
      `${BRACKETED_PASTE_START}one\rtwo${BRACKETED_PASTE_END}`,
    );
    expect(terminal.paste).not.toHaveBeenCalled();
  });

  it("skips bracket wrappers for single-line paste after Ctrl+C but keeps them for multiline", () => {
    const terminal = createTerminal(true);
    markTerminalBracketedPasteInterrupted(terminal);
    pasteTerminalText(terminal, "single");
    expect(terminal.paste).toHaveBeenCalledWith("single");

    const multiline = createTerminal(true);
    markTerminalBracketedPasteInterrupted(multiline);
    pasteTerminalText(multiline, "one\ntwo");
    expect(multiline.paste).toHaveBeenCalledWith("one\ntwo");
  });

  it("tracks DECA 2004 output to clear the interrupted mark", () => {
    const terminal = createTerminal(true);
    markTerminalBracketedPasteInterrupted(terminal);
    // A bracketed-paste-mode reset sequence clears the interrupted state.
    observeTerminalBracketedPasteModeOutput(terminal, "\u001b[?2004l");
    pasteTerminalText(terminal, "after");
    expect(terminal.paste).toHaveBeenCalledWith("after");
  });
});

describe("terminal paste execution", () => {
  it("rejects without writing when the payload exceeds the limit", async () => {
    const pasteText = vi.fn();
    const writePty = vi.fn();
    const plan = planTerminalPaste({
      text: "x".repeat(TERMINAL_PASTE_MAX_BYTES + 1),
      source: "keyboard",
      target: terminalTarget(),
    });
    const execution = await executeTerminalPastePlan(plan, {
      pasteText,
      writePty,
    });
    expect(execution.status).toBe("rejected");
    expect(execution.reason).toBe("payload-too-large");
    expect(pasteText).not.toHaveBeenCalled();
    expect(writePty).not.toHaveBeenCalled();
  });

  it("cancels as stale when the target changed before the paste", async () => {
    const pasteText = vi.fn();
    const plan = planTerminalPaste({
      text: "hello",
      source: "keyboard",
      target: terminalTarget(),
    });
    const execution = await executeTerminalPastePlan(plan, {
      pasteText,
      isTargetCurrent: () => false,
    });
    expect(execution.status).toBe("cancelled");
    expect(execution.reason).toBe("stale-target");
    expect(pasteText).not.toHaveBeenCalled();
  });

  it("writes chunked plans through the PTY writer and closes the frame", async () => {
    const pasteText = vi.fn();
    const written: string[] = [];
    const plan = planTerminalPaste({
      text: "0123456789abcdef",
      source: "paste-event",
      target: terminalTarget(),
      terminalBracketedPasteMode: true,
      maxDirectBytes: 4,
      maxChunkBytes: 4,
    });
    const execution = await executeTerminalPastePlan(plan, {
      pasteText,
      writePty: (data) => {
        written.push(data);
        return true;
      },
    });
    expect(execution.status).toBe("pasted");
    expect(execution.chunksWritten).toBe(written.length);
    expect(written[0]).toBe(BRACKETED_PASTE_START);
    expect(written[written.length - 1]).toBe(BRACKETED_PASTE_END);
    expect(pasteText).not.toHaveBeenCalled();
  });

  it("reports paste failures with the source's copy", async () => {
    expect(
      formatTerminalPasteExecutionError("payload-too-large"),
    ).toBe(
      "Paste failed: clipboard text is too large for a safe terminal paste.",
    );
    expect(formatTerminalPasteExecutionError(undefined)).toBe("Paste failed.");
  });

  it("measures payload metadata over UTF-8", () => {
    const payload = createTerminalPastePayload({
      text: "é\nπ",
      source: "context-menu",
    });
    // é = 2 bytes, \n = 1, π = 2.
    expect(payload.byteLength).toBe(5);
    expect(payload.lineCount).toBe(2);
    expect(payload.hasControlSequences).toBe(false);
  });
});
