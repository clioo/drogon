// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/store/slices/tabs/tabs-create-actions.ts (new
//   terminals are labeled `Terminal ${existingTabs.length + 1}`).
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { defaultTerminalTabTitle } from "./tab-title";

describe("defaultTerminalTabTitle", () => {
  it("numbers terminal tabs from 1 like the fork", () => {
    assert.equal(defaultTerminalTabTitle(1), "Terminal 1");
    assert.equal(defaultTerminalTabTitle(2), "Terminal 2");
    assert.equal(defaultTerminalTabTitle(12), "Terminal 12");
  });
});
