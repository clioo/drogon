import { describe, expect, it } from "vitest";
import { getCloseBusyTerminalDialogCopy } from "./close-busy-terminal-dialog-copy";

describe("close-busy-terminal dialog copy", () => {
  it("asks about the agent for harness sessions", () => {
    expect(getCloseBusyTerminalDialogCopy(true).title).toBe(
      "Stop this agent?",
    );
  });

  it("asks about the running command for plain shells", () => {
    expect(getCloseBusyTerminalDialogCopy(false).title).toBe(
      "Stop running command?",
    );
  });
});
