// MIT Copyright (c) 2026 Lovecast Inc. Adapted from Orca's
// src/renderer/src/components/editor/editor-cmd-save-target.ts. The source
// rule picks a fileId out of a multi-tab/floating-panel model that this
// rewrite does not have (one EditorPane, one open path at a time). Here the
// Cmd/Ctrl+S command is registered directly on the focused Monaco editor
// instance (Monaco only fires it while that editor owns focus), so the only
// remaining question is whether THIS pane's current admission state allows
// a save right now — the same `canSave` gate already used to enable the
// Save button.

/**
 * The path Cmd/Ctrl+S should save when pressed inside this editor, or null
 * if the pane is not in an admissible state to save (no file open, no dirty
 * draft, a save already in flight, or an unread file without new-file
 * intent — the exact same admission the Save button uses).
 */
export function getEditorCmdSaveTarget(path: string | null, canSave: boolean): string | null {
  return path !== null && canSave ? path : null;
}
