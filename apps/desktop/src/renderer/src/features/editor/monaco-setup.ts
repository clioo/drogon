// MIT Copyright (c) 2026 Lovecast Inc. Adapted from Orca's
// src/renderer/src/lib/monaco-setup.ts. Kept: worker bundling (no CDN),
// `loader.config({ monaco })`, and the TS/JS diagnostics suppression (this
// is a viewer/editor over files on disk, not a project-aware type checker —
// the sandboxed worker cannot resolve imports to sibling files, so semantic
// validation is a long tail of false positives). Dropped: the reference's
// custom language registrations (Vue/Svelte/Astro/Nim/JSONL), delayer-
// cancellation guard, diff-editor-disposal guard, peek-references preview
// options, and IPC-routed context-menu paste — none are named by this
// task and none apply to a repo with no such IPC surface.
//
// Only ever imported from a lazily-loaded module (MonacoFileEditor.tsx /
// DiffViewer.tsx) — never from EditorPane.tsx's top level — so plain-Node
// vitest specs (EditorPane.test.ts uses `react-dom/server` under the
// default "node" test environment) never evaluate `monaco-editor`, which
// assumes a browser global environment.
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { typescript as monacoTS } from "monaco-editor";
import "monaco-editor/min/vs/editor/editor.main.css";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

globalThis.MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case "json":
        return new jsonWorker();
      case "css":
      case "scss":
      case "less":
        return new cssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new htmlWorker();
      case "typescript":
      case "javascript":
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

const diagnosticsOptions = {
  noSemanticValidation: true,
  noSuggestionDiagnostics: true,
  noSyntaxValidation: true,
};
monacoTS.typescriptDefaults.setDiagnosticsOptions(diagnosticsOptions);
monacoTS.javascriptDefaults.setDiagnosticsOptions(diagnosticsOptions);

// Why: .tsx/.jsx share the base 'typescript'/'javascript' language ids in
// Monaco's registry, so without jsx enabled the worker raises TS17004 on
// every JSX tag. Preserve mode parses without forcing an emit transform —
// this is a read-only language service, it never emits.
monacoTS.typescriptDefaults.setCompilerOptions({
  ...monacoTS.typescriptDefaults.getCompilerOptions(),
  jsx: monacoTS.JsxEmit.Preserve,
});
monacoTS.javascriptDefaults.setCompilerOptions({
  ...monacoTS.javascriptDefaults.getCompilerOptions(),
  jsx: monacoTS.JsxEmit.Preserve,
});

// Configure @monaco-editor/react to use the locally bundled editor instead of its CDN loader.
loader.config({ monaco });

export { monaco };
