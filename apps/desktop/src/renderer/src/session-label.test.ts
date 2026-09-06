import { describe, expect, it } from "vitest";
import type { Harness, Session } from "../../shared/session-contract";
import { sessionLabel } from "./session-label";

const session = { command: "/opt/pi/cli.js" } as Session;
const pi: Harness = {
  harnessId: "pi",
  displayName: "Pi",
  availability: "available",
  executable: session.command,
};

describe("session label", () => {
  it("uses an exact executable catalog match after reload", () => {
    expect(sessionLabel(session, [pi])).toBe("Pi");
  });
  it("does not infer a harness from a common launcher basename", () => {
    expect(sessionLabel({ ...session, command: "/other/cli.js" }, [pi])).toBe(
      "cli.js",
    );
  });
  it("falls back for missing or ambiguous catalog entries", () => {
    expect(sessionLabel(session, [{ ...pi, availability: "missing" }])).toBe(
      "cli.js",
    );
    expect(sessionLabel(session, [pi, { ...pi, harnessId: "claude" }])).toBe(
      "cli.js",
    );
    expect(
      sessionLabel({ ...session, command: "C:\\tools\\shell.exe" }, []),
    ).toBe("shell.exe");
  });
});
