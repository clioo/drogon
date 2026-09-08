// #167: the create-menu chords resolve through the shared keybinding
// table — these pins fail if the table or the menu model drift.
import { describe, expect, test } from "vitest";
import {
  bindingsForPlatform,
  formatKeybindingList,
  getKeybindingDefinition,
  resolveKeybindingPlatform,
} from "../../../../shared/keybindings";
import {
  TAB_CREATE_MENU_CHORD_IDS,
  tabCreateMenuChord,
  type TabCreateMenuChordId,
} from "./TabCreateMenuChords";

function tableChord(id: TabCreateMenuChordId, platform: "darwin" | "other"): string {
  const definition = getKeybindingDefinition(id);
  if (!definition) throw new Error(`missing keybinding definition: ${id}`);
  const keybindingPlatform = resolveKeybindingPlatform(platform);
  return formatKeybindingList(
    bindingsForPlatform(definition, keybindingPlatform),
    keybindingPlatform,
  );
}

describe("tabCreateMenuChord", () => {
  test("covers exactly the static rows with a chord hint", () => {
    expect([...TAB_CREATE_MENU_CHORD_IDS]).toEqual([
      "tab.newTerminal",
      "tab.newBrowser",
      "tab.newMarkdown",
    ]);
  });

  test.each([["tab.newTerminal"], ["tab.newBrowser"], ["tab.newMarkdown"]] as const)(
    "matches the shared table on %s (darwin and other)",
    (id) => {
      expect(tabCreateMenuChord(id, "darwin")).toBe(tableChord(id, "darwin"));
      expect(tabCreateMenuChord(id, "other")).toBe(tableChord(id, "other"));
    },
  );

  test("renders the fork chords on macOS", () => {
    expect(tabCreateMenuChord("tab.newTerminal", "darwin")).toBe("⌘T");
    expect(tabCreateMenuChord("tab.newBrowser", "darwin")).toBe("⌘⇧B");
    expect(tabCreateMenuChord("tab.newMarkdown", "darwin")).toBe("⌘⇧M");
  });
});
