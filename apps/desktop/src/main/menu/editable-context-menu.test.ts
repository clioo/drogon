// MIT Copyright (c) 2026 Lovecast Inc. Unit tests for the sibling
// editable-context-menu.ts (ported from the Orca reference
// src/main/window/editable-context-menu.ts): plain edit menu on editable
// right-clicks, nothing elsewhere, and Paste routed over the shared
// app-menu paste channel.
import { describe, expect, it, vi } from "vitest";
import {
  buildEditableContextMenuTemplate,
  type EditableContextMenuWebContents,
} from "./editable-context-menu";
import { menuIpcChannels } from "../../shared/menu-contract";
function editableParams(canPaste = true) {
  return {
    isEditable: true,
    misspelledWord: "",
    dictionarySuggestions: [] as string[],
    editFlags: {
      canUndo: true,
      canRedo: false,
      canCut: true,
      canCopy: true,
      canPaste,
      canDelete: true,
      canSelectAll: true,
      canEditRichly: false,
    },
  } as Electron.ContextMenuParams;
}

function stubWebContents(): EditableContextMenuWebContents {
  return {
    send: vi.fn(),
    replaceMisspelling: vi.fn(),
    session: { addWordToSpellCheckerDictionary: vi.fn() },
  } as unknown as EditableContextMenuWebContents;
}
describe("buildEditableContextMenuTemplate", () => {
  it("returns no menu off an editable control", () => {
    const webContents = stubWebContents();
    expect(
      buildEditableContextMenuTemplate(
        { isEditable: false } as Electron.ContextMenuParams,
        webContents,
      ),
    ).toEqual([]);
    expect(webContents.send).not.toHaveBeenCalled();
  });
  it("offers Cut/Copy/Paste/Select All on an editable control", () => {
    const webContents = stubWebContents();
    const template = buildEditableContextMenuTemplate(
      editableParams(),
      webContents,
    );
    const roles = template.map((item) => item.role ?? item.label);
    expect(roles).toEqual(["cut", "copy", "Paste", "selectAll"]);
  });
  it("routes Paste through the shared app-menu paste channel", () => {
    const webContents = stubWebContents();
    const template = buildEditableContextMenuTemplate(
      editableParams(),
      webContents,
    );
    const paste = template.find((item) => item.label === "Paste");
    expect(paste?.enabled).toBe(true);
    paste?.click?.({} as never, {} as never, {} as never);
    expect(webContents.send).toHaveBeenCalledWith(
      menuIpcChannels.appMenuPaste,
    );
  });
  it("disables Paste when the control cannot take it", () => {
    const webContents = stubWebContents();
    const template = buildEditableContextMenuTemplate(
      editableParams(false),
      webContents,
    );
    expect(template.find((item) => item.label === "Paste")?.enabled).toBe(
      false,
    );
  });
  it("offers spelling suggestions ahead of the edit items", () => {
    const webContents = stubWebContents();
    const template = buildEditableContextMenuTemplate(
      {
        ...editableParams(),
        misspelledWord: "drogno",
        dictionarySuggestions: ["drogon", "dragon", "diagon"],
      } as Electron.ContextMenuParams,
      webContents as never,
    );
    const labels = template.map((item) => item.label ?? item.role ?? item.type);
    expect(labels.slice(0, 5)).toEqual([
      "drogon",
      "dragon",
      "diagon",
      "separator",
      "Add to dictionary",
    ]);
    expect(labels.slice(-4)).toEqual(["cut", "copy", "Paste", "selectAll"]);
    template[0]?.click?.({} as never, {} as never, {} as never);
    expect(webContents.replaceMisspelling).toHaveBeenCalledWith("drogon");
  });
  it("caps suggestions at five and skips the dictionary row when clean", () => {
    const webContents = stubWebContents();
    const template = buildEditableContextMenuTemplate(
      {
        ...editableParams(),
        misspelledWord: "",
        dictionarySuggestions: ["a", "b", "c", "d", "e", "f", "g"],
      } as Electron.ContextMenuParams,
      webContents as never,
    );
    expect(
      template.filter((item) => item.type !== "separator" && !item.role && item.label !== "Paste").length,
    ).toBe(5);
    expect(
      template.some((item) => item.label === "Add to dictionary"),
    ).toBe(false);
  });
});
