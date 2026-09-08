// MIT Copyright (c) 2026 Lovecast Inc. Adapted from Orca's
// src/renderer/src/components/editor/DiffViewer.tsx. Dropped entirely (no
// equivalent product surface in this rewrite): inline review comments
// (DiffCommentPopover/useDiffCommentDecorator), Monaco view-state LRU
// persistence across tabs, the large-diff render-limit fallback (this
// repo's `git.diff` RPC already caps text at MAX_GIT_DIFF_CHARS server-
// side), contextual copy setup, and editable-diff saving.
//
// Editable-diff saving is INTENTIONALLY omitted, not just unported: the
// "original"/"modified" text here is RECONSTRUCTED from unified-diff hunks
// (see diff-hunk-reconstruction.ts), not full file content — there is no
// "read file at ref" RPC in this repo's contract. Writing that reconstructed
// text back to disk would truncate the real file to just the hunk excerpt,
// so both Monaco panes are always read-only.
import { useCallback, useEffect, useRef } from "react";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import "../../editor/monaco-setup";
import { monacoLanguageForPath } from "../../editor/editor-language-by-extension";
import {
  monacoThemeForScheme,
  type EditorScheme,
} from "../../editor/editor-theme";
import { applyDiffEditorLineNumberOptions } from "./diff-editor-line-number-options";
import { diffEditorScrollbarOptions } from "./diff-editor-scrollbar-options";
import { buildDiffEditorWhitespaceOptions } from "./diff-editor-whitespace-options";
import { buildDiffEditorWordWrapOptions } from "./diff-editor-word-wrap-options";
import { useDiffEditorRegistration } from "./diff-navigation-context";

export interface DiffViewerProps {
  path: string;
  original: string;
  modified: string;
  scheme: EditorScheme;
  sideBySide: boolean;
  /**
   * Optional wrap/whitespace overrides for the editor's Changes surface
   * (R16-X2): absent preserves the historical fixed behavior (wrap off,
   * trim-only diffs hidden), so the Changes panel renders exactly as
   * before without passing them.
   */
  wordWrap?: boolean;
  showWhitespace?: boolean;
}

export function DiffViewer({
  path,
  original,
  modified,
  scheme,
  sideBySide,
  wordWrap,
  showWhitespace,
}: DiffViewerProps) {
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const lineNumberOptionsSubRef = useRef<{ dispose: () => void } | null>(null);
  const { registerDiffEditor, unregisterDiffEditor } =
    useDiffEditorRegistration();

  const handleMount: DiffOnMount = useCallback(
    (diffEditor) => {
      diffEditorRef.current = diffEditor;
      registerDiffEditor(diffEditor);
      lineNumberOptionsSubRef.current?.dispose();
      lineNumberOptionsSubRef.current = applyDiffEditorLineNumberOptions(
        diffEditor,
        sideBySide,
      );
      diffEditor.onDidDispose(() => {
        lineNumberOptionsSubRef.current?.dispose();
        lineNumberOptionsSubRef.current = null;
        diffEditorRef.current = null;
        unregisterDiffEditor(diffEditor);
      });
    },
    [registerDiffEditor, sideBySide, unregisterDiffEditor],
  );

  useEffect(() => {
    const diffEditor = diffEditorRef.current;
    if (!diffEditor) return;
    lineNumberOptionsSubRef.current?.dispose();
    lineNumberOptionsSubRef.current = applyDiffEditorLineNumberOptions(
      diffEditor,
      sideBySide,
    );
    return () => {
      lineNumberOptionsSubRef.current?.dispose();
      lineNumberOptionsSubRef.current = null;
    };
  }, [sideBySide]);

  return (
    <DiffEditor
      height="100%"
      language={monacoLanguageForPath(path)}
      original={original}
      modified={modified}
      theme={monacoThemeForScheme(scheme)}
      onMount={handleMount}
      options={{
        readOnly: true,
        originalEditable: false,
        renderSideBySide: sideBySide,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: 13,
        lineNumbers: "on",
        ...buildDiffEditorWordWrapOptions(wordWrap),
        ...buildDiffEditorWhitespaceOptions(showWhitespace),
        automaticLayout: true,
        renderOverviewRuler: true,
        scrollbar: diffEditorScrollbarOptions,
        padding: { top: 0 },
      }}
    />
  );
}
