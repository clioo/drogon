// MIT Copyright (c) 2026 Lovecast Inc.
// Tests for the two shell actions the Meetings page offers beside the folder
// line. They are pure functions over a shell-shaped object, so a fake proves
// what the page would ask for and what it would say when the shell refuses.
import { describe, expect, it, vi } from "vitest";
import { openWriteThatDown, revealNotesFolder, type MeetingsShell } from "./meetings-tool-actions";

function shell(overrides: Partial<MeetingsShell> = {}): MeetingsShell {
  return {
    openPath: vi.fn(async () => ({ ok: true as const, result: { opened: true } })),
    showItemInFolder: vi.fn(async () => ({ ok: true as const, result: { shown: true } })),
    ...overrides,
  };
}

describe("meetings tool actions", () => {
  it("opens exactly the bundle the daemon resolved", async () => {
    const fake = shell();
    await expect(openWriteThatDown("/Applications/WriteThatDown.app", fake)).resolves.toBeNull();
    expect(fake.openPath).toHaveBeenCalledWith({ path: "/Applications/WriteThatDown.app" });
  });

  it("says so instead of guessing when no bundle was found", async () => {
    const fake = shell();
    await expect(openWriteThatDown(null, fake)).resolves.toContain("No Write That Down bundle");
    expect(fake.openPath).not.toHaveBeenCalled();
    await expect(openWriteThatDown("", fake)).resolves.toContain("No Write That Down bundle");
  });

  it("reports the shell's own refusal rather than pretending it opened", async () => {
    const fake = shell({
      openPath: vi.fn(async () => ({
        ok: false as const,
        error: { code: "io_error", message: "no application knows how to open", retryable: false },
      })),
    });
    await expect(openWriteThatDown("/Applications/WriteThatDown.app", fake)).resolves.toBe(
      "no application knows how to open",
    );
  });

  it("reports an exception and a missing shell honestly", async () => {
    const throwing = shell({
      openPath: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    await expect(openWriteThatDown("/Applications/WriteThatDown.app", throwing)).resolves.toBe(
      "Write That Down could not be opened.",
    );
    await expect(openWriteThatDown("/Applications/WriteThatDown.app", null)).resolves.toContain(
      "cannot open another app",
    );
  });

  it("reveals the resolved notes folder and never writes to it", async () => {
    const fake = shell();
    await expect(revealNotesFolder("/home/carlos/Transcripts", fake)).resolves.toBeNull();
    expect(fake.showItemInFolder).toHaveBeenCalledWith({ path: "/home/carlos/Transcripts" });
    // There is no write method on the shape at all: read-only is structural.
    expect(Object.keys(fake)).toEqual(["openPath", "showItemInFolder"]);
  });

  it("says why it cannot reveal a folder", async () => {
    await expect(revealNotesFolder(null, shell())).resolves.toContain("has not resolved");
    await expect(revealNotesFolder("/home/carlos/Transcripts", null)).resolves.toContain(
      "cannot reveal a folder",
    );
  });
});
