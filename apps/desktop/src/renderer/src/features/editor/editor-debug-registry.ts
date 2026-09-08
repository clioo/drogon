// MIT Copyright (c) 2026 Lovecast Inc. Mirrors this app's own
// `window.__drogonTerminals` debug registry (TerminalPane.tsx) so
// scripts/probe-rendered-files.mjs and scripts/accept-desktop.mjs can read
// and drive the Monaco model directly instead of a textarea's DOM value.
//
// Keyed by the workspace-relative path (not the full host/workspace/path
// scoped key): unlike terminals, this app never mounts more than one file
// editor at a time, so the path is the natural externally-visible identity —
// exactly what the probe scripts already know about the file they opened.
//
// `import type` only: this file never evaluates `monaco-editor` at runtime,
// so importing it from EditorPane.tsx's top level is safe under plain-Node
// vitest specs.
import type { editor } from "monaco-editor";

export type EditorDebugRegistry = Map<string, editor.IStandaloneCodeEditor>;

declare global {
  interface Window {
    __drogonEditors?: EditorDebugRegistry;
  }
}

export function registerEditorDebugHandle(path: string, instance: editor.IStandaloneCodeEditor): void {
  if (typeof window === "undefined") return;
  const registry = (window.__drogonEditors ??= new Map());
  registry.set(path, instance);
}

export function unregisterEditorDebugHandle(
  path: string,
  instance: editor.IStandaloneCodeEditor,
): void {
  if (typeof window === "undefined") return;
  const registry = window.__drogonEditors;
  if (registry?.get(path) === instance) registry.delete(path);
}
