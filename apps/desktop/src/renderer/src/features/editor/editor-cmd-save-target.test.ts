import { describe, expect, it } from "vitest";
import { getEditorCmdSaveTarget } from "./editor-cmd-save-target";

describe("getEditorCmdSaveTarget", () => {
  it("targets the open path when the pane admits a save", () => {
    expect(getEditorCmdSaveTarget("src/index.ts", true)).toBe("src/index.ts");
  });

  it("targets nothing when no file is open", () => {
    expect(getEditorCmdSaveTarget(null, true)).toBeNull();
  });

  it("targets nothing when the pane does not admit a save (clean, mid-save, or unread)", () => {
    expect(getEditorCmdSaveTarget("src/index.ts", false)).toBeNull();
  });
});
