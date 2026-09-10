// MIT Copyright (c) 2026 Lovecast Inc. Unit tests for the sibling
// editable-context-menu.ts (ported from the Orca reference
// src/main/window/editable-context-menu.ts): plain edit menu on editable
// right-clicks, nothing elsewhere, and Paste routed over the shared
// app-menu paste channel.
import { describe, expect, it, vi } from "vitest";
import { buildEditableContextMenuTemplate } from "./editable-context-menu";
import { menuIpcChannels } from "../../shared/menu-contract";

function editableParams(canPaste = true) {
  return {
    isEditable: true,
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

describe("buildEditableContextMenuTemplate", () => {
  it("returns no menu off an editable control", () => {
    const webContents = { send: vi.fn() };
    expect(
      buildEditableContextMenuTemplate(
        { isEditable: false } as Electron.ContextMenuParams,
        webContents,
      ),
    ).toEqual([]);
    expect(webContents.send).not.toHaveBeenCalled();
  });
  it("offers Cut/Copy/Paste/Select All on an editable control", () => {
    const webContents = { send: vi.fn() };
    const template = buildEditableContextMenuTemplate(
      editableParams(),
      webContents,
    );
    const roles = template.map((item) => item.role ?? item.label);
    expect(roles).toEqual(["cut", "copy", "Paste", "selectAll"]);
  });
  it("routes Paste through the shared app-menu paste channel", () => {
    const webContents = { send: vi.fn() };
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
    const webContents = { send: vi.fn() };
    const template = buildEditableContextMenuTemplate(
      editableParams(false),
      webContents,
    );
    expect(template.find((item) => item.label === "Paste")?.enabled).toBe(
      false,
    );
  });
});
