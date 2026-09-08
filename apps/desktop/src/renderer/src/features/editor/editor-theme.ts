// MIT Copyright (c) 2026 Lovecast Inc. The reference has no custom
// `monaco.editor.defineTheme` module for the file/diff editors — see
// src/renderer/src/components/editor/MonacoEditor.tsx and DiffViewer.tsx,
// both of which pick Monaco's BUILT-IN `'vs-dark'`/`'vs'` theme directly
// from `settings.theme`. This ports that same per-scheme selection, reading
// the effective scheme the same way this app's terminal pane does (App
// toggles the `.dark` class on the document root).
import { useEffect, useState } from "react";

export type EditorScheme = "light" | "dark";

export function readEffectiveSchemeFromRoot(
  root: { classList: { contains(name: string): boolean } } | null | undefined,
): EditorScheme {
  return root?.classList.contains("dark") ? "dark" : "light";
}

/** Monaco's built-in theme id for the given scheme. */
export function monacoThemeForScheme(scheme: EditorScheme): "vs" | "vs-dark" {
  return scheme === "dark" ? "vs-dark" : "vs";
}

/**
 * Live scheme, re-rendering whenever App toggles `.dark` on the document
 * root. Unlike reading the class once at render time (which only reflects
 * whatever the scheme happened to be on the LAST unrelated re-render),
 * this observes the class attribute directly — the same live-update
 * guarantee TerminalPane gets from its own matchMedia subscription, but
 * covering explicit light/dark settings too, not only "system".
 */
export function useEditorScheme(): EditorScheme {
  const [scheme, setScheme] = useState<EditorScheme>(() =>
    typeof document === "undefined"
      ? "light"
      : readEffectiveSchemeFromRoot(document.documentElement),
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setScheme(readEffectiveSchemeFromRoot(root));
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return scheme;
}
