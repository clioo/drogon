// MIT Copyright (c) 2026 Lovecast Inc. Ported from the Orca reference
// (read-only /Users/carlos/Documents/Drogon-orca):
//   src/main/window/editable-context-menu.ts (buildEditableContextMenuTemplate,
//     editableContextPasteItem sharing renderer ownership with keyboard and
//     app-menu paste).
// Adapted: Drogon has no rich-markdown composer surface, so the markdown
// Format/Paragraph/Insert/table sections are omitted — plain editable
// controls (dialog inputs, settings fields) get Cut/Copy/Paste/Select All.
// Paste sends `ui:appMenuPaste` instead of the `paste` role so the renderer's
// single ownership path (text-control-paste.ts, terminal pipeline excluded)
// handles menu, accelerator, and context-menu paste identically.
import type { MenuItemConstructorOptions } from "electron";
import { menuIpcChannels } from "../../shared/menu-contract";

export type EditableContextMenuWebContents = Pick<
  Electron.WebContents,
  "send" | "replaceMisspelling" | "session"
>;

export type EditableContextMenuParams = Pick<
  Electron.ContextMenuParams,
  "isEditable" | "editFlags" | "misspelledWord" | "dictionarySuggestions"
>;

/**
 * Native edit menu for a right-click on an editable control. Empty when the
 * click is not on an editable (terminal panes, tab strips, Monaco, and page
 * chrome keep their own menus or none, exactly as before).
 */
export function buildEditableContextMenuTemplate(
  params: EditableContextMenuParams,
  webContents: EditableContextMenuWebContents,
): MenuItemConstructorOptions[] {
  if (!params.isEditable) return [];
  const template: MenuItemConstructorOptions[] = [];
  // Why (source buildEditableContextMenuTemplate): prose inputs (commit
  // message, task titles) keep spellcheck on, so a misspelled word offers
  // up to five replacements plus Add to dictionary ahead of the edit items.
  const suggestions = (params.dictionarySuggestions ?? []).slice(0, 5);
  for (const suggestion of suggestions) {
    template.push({
      label: suggestion,
      click: () => webContents.replaceMisspelling(suggestion),
    });
  }
  if (params.misspelledWord) {
    if (template.length > 0) template.push({ type: "separator" });
    const misspelledWord = params.misspelledWord;
    template.push({
      label: "Add to dictionary",
      click: () => {
        webContents.session.addWordToSpellCheckerDictionary(misspelledWord);
      },
    });
  }
  if (template.length > 0) template.push({ type: "separator" });
  const canPaste = params.editFlags?.canPaste ?? true;
  template.push(
    { role: "cut" },
    { role: "copy" },
    {
      label: "Paste",
      enabled: canPaste,
      click: () => {
        // Why: context-menu paste must share renderer ownership with
        // keyboard and app-menu paste so dialog inputs paste through
        // text-control-paste.ts and terminals keep their own pipeline.
        webContents.send(menuIpcChannels.appMenuPaste);
      },
    },
    { role: "selectAll" },
  );
  return template;
}
