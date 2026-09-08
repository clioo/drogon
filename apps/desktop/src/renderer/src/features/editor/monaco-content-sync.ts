// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/editor/monaco-content-sync.ts
// (normalizeToModelEol, replaceModelContent, syncContentUpdate). Dropped:
// the read-only-live-tail mode (model.applyEdits without undo) and the
// live-append fast path (prefix-preserving end-insert) — this rewrite has
// no live-tail surface (oversized files fall back to a read-only
// textarea), so every programmatic sync is a full-range undoable replace.
// The mount path (syncContentOnMount) is also dropped: this app remounts
// the editor per file (key={path}) with defaultValue set from the current
// draft, so there is no retained-model staleness to reconcile at mount.
import type { editor } from "monaco-editor";

function normalizeToModelEol(
  content: string,
  model: editor.ITextModel,
): string {
  const eol = model.getEOL();
  // Why: Monaco normalizes model line endings, while filesystem content keeps
  // its raw EOLs. Compare the representation Monaco can actually retain.
  if (eol === "\n" && !content.includes("\r")) {
    return content;
  }
  return content.replace(/\r\n|\r|\n/g, eol);
}

/**
 * Push a prop-driven content change into the live model. Called from a
 * layout effect only when the prop drifted from the last synced content
 * (see MonacoFileEditor) — the emitted-content short-circuit lives at the
 * call site, never here.
 *
 * Why real edit ops with undo stops instead of setValue: the adoption stays
 * on the user's undo stack, so Cmd+Z reverts an external update instead of
 * doing nothing, and viewport/selection/fold state survives the replace.
 */
export function syncContentUpdate(
  editorInstance: editor.IStandaloneCodeEditor,
  content: string,
): void {
  const model = editorInstance.getModel();
  if (!model) {
    return;
  }
  const currentContent = model.getValue();
  const normalizedContent = normalizeToModelEol(content, model);
  if (currentContent === normalizedContent) {
    return;
  }
  const fullRange = model.getFullModelRange();
  editorInstance.pushUndoStop();
  model.pushEditOperations([], [{ range: fullRange, text: normalizedContent }], () => null);
  editorInstance.pushUndoStop();
}
