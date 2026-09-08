// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/editor/diff-editor-whitespace-options.ts
// (verbatim; `diffShowWhitespace` has no Settings-owned toggle in this
// task's scope, so the caller always passes `undefined`, i.e. Monaco's
// default of hiding whitespace-only diffs is overridden to show them).
import type { editor } from "monaco-editor";

export function buildDiffEditorWhitespaceOptions(
  diffShowWhitespace: boolean | undefined,
): Pick<editor.IStandaloneDiffEditorConstructionOptions, "ignoreTrimWhitespace"> {
  return {
    // Why: Monaco defaults this to true, which hides indentation-only diffs.
    ignoreTrimWhitespace: diffShowWhitespace !== true,
  };
}
