// MIT Copyright (c) 2026 Lovecast Inc. Adapted from Orca's
// src/renderer/src/components/editor/MonacoEditor.tsx. Dropped: markdown
// annotations, gutter context menu, contextual copy setup, conflict
// decorations, reveal-line scheduling, auto-height, and the app-settings-
// driven word-wrap/minimap knobs — none apply to this rewrite (no
// markdown review surface, no Settings-owned word-wrap knob in this task's
// scope). Kept in spirit: `defaultValue` (uncontrolled; this component owns
// post-mount content the same way, via `onChange`), locally bundled Monaco
// via `./monaco-setup`, and per-scheme built-in theme selection.
//
// Deviation from the source, called out in the PR: the source keeps ONE
// persistent Monaco instance alive across file switches and swaps its
// model in place (`use-monaco-content-sync-bridge.ts`), preserving Monaco's
// own undo history and scroll position per file across switches. This app
// has no multi-tab surface to preserve that for, so the parent remounts
// this component (`key={path}`) on every file switch instead — simpler,
// and irrelevant to autosave/save-queue/dirty-state fidelity, at the cost
// of not retaining Monaco's per-file undo stack across a switch.
// R14-E: `fontFamily` option ported from the same source file
// (resolveEditorFontFamily in src/renderer/src/lib/editor-font-zoom.ts:
// empty editor font follows the terminal font); envelope fallback so no
// App-level prop thread is needed.
import { useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import "./monaco-setup";
import { monacoLanguageForPath } from "./editor-language-by-extension";
import { monacoThemeForScheme, type EditorScheme } from "./editor-theme";
import {
  registerEditorDebugHandle,
  unregisterEditorDebugHandle,
} from "./editor-debug-registry";
import {
  readTerminalTypography,
  SETTINGS_DEFAULTS,
} from "../../settings-store";
import { resolveEditorFontFamily } from "../settings/terminal-typography";

export interface MonacoFileEditorProps {
  path: string;
  content: string;
  scheme: EditorScheme;
  readOnly?: boolean;
  onChange(value: string): void;
  /** Cmd/Ctrl+S while this editor holds focus. */
  onRequestSave(): void;
  /**
   * Source editor font (global-settings-types.ts editorFontFamily: empty
   * follows the terminal font). Optional: when omitted the persisted
   * envelope is read at render (same pattern as TerminalPane), so no
   * App-level prop thread is needed.
   */
  fontFamily?: string;
}

/** Source resolveEditorFontFamily: empty editor font keeps following the terminal font. */
function resolveMonacoFontFamily(explicit?: string): string {
  if (explicit !== undefined) return resolveEditorFontFamily({ editorFontFamily: explicit });
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const persisted = readTerminalTypography(window.localStorage);
      return resolveEditorFontFamily(persisted);
    }
  } catch {
    // Storage unavailable: fall through to the built-in defaults.
  }
  return resolveEditorFontFamily({
    editorFontFamily: SETTINGS_DEFAULTS.editorFontFamily,
    terminalFontFamily: SETTINGS_DEFAULTS.terminalFontFamily,
  });
}

export function MonacoFileEditor({
  path,
  content,
  scheme,
  readOnly = false,
  onChange,
  onRequestSave,
  fontFamily,
}: MonacoFileEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onRequestSaveRef = useRef(onRequestSave);
  onRequestSaveRef.current = onRequestSave;

  const handleMount: OnMount = (instance, monacoInstance) => {
    registerEditorDebugHandle(path, instance);
    instance.onDidDispose(() => unregisterEditorDebugHandle(path, instance));
    instance.addCommand(
      monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS,
      () => {
        onRequestSaveRef.current();
      },
    );
  };

  // Belt-and-suspenders unregister: @monaco-editor/react disposes the
  // editor on unmount, which already fires `onDidDispose` above, but a
  // component-level cleanup guards against a future change to that
  // library's disposal timing leaving a stale registry entry behind.
  useEffect(() => {
    return () => {
      const registry =
        typeof window !== "undefined" ? window.__drogonEditors : undefined;
      registry?.delete(path);
    };
  }, [path]);

  return (
    <Editor
      height="100%"
      language={monacoLanguageForPath(path)}
      defaultValue={content}
      theme={monacoThemeForScheme(scheme)}
      onMount={handleMount}
      onChange={(value) => onChangeRef.current(value ?? "")}
      path={path}
      options={{
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        fontSize: 13,
        fontFamily: resolveMonacoFontFamily(fontFamily),
        tabSize: 2,
        readOnly,
        padding: { top: 0 },
      }}
    />
  );
}
