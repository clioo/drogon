// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/editor/diff-editor-word-wrap-options.ts
// (verbatim).
import type { editor } from "monaco-editor";

export function buildDiffEditorWordWrapOptions(
  diffWordWrap: boolean | undefined,
): Pick<editor.IStandaloneDiffEditorConstructionOptions, "wordWrap"> {
  return {
    wordWrap: diffWordWrap === true ? "on" : "off",
  };
}
