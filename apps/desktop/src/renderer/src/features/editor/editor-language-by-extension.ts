// MIT Copyright (c) 2026 Lovecast Inc. Not a direct port (the source
// resolves language from `monaco-editor`'s own `getLanguages()` registry
// plus a few extension overrides scattered across its editor-content
// pipeline); this is a standalone, dependency-free extension map covering
// the languages this rewrite's Monaco setup actually registers workers/
// grammars for, so `EditorPane` can pick a language before Monaco has
// loaded.
const EXTENSION_LANGUAGE: Readonly<Record<string, string>> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  xml: "xml",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  py: "python",
  rs: "rust",
  go: "go",
  rb: "ruby",
  php: "php",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  dockerfile: "dockerfile",
  ini: "ini",
  cfg: "ini",
  lua: "lua",
  swift: "swift",
  proto: "proto",
};

/** File extensions this map routes to a table view instead of Monaco text. */
export const CSV_EXTENSIONS = new Set(["csv", "tsv"]);

function extensionOf(path: string): string {
  const name = path.split("/").pop() ?? path;
  if (name.toLowerCase() === "dockerfile") return "dockerfile";
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/** The Monaco language id for `path`'s extension, or `"plaintext"` when unknown. */
export function monacoLanguageForPath(path: string): string {
  return EXTENSION_LANGUAGE[extensionOf(path)] ?? "plaintext";
}

/** Whether `path` should open in the CSV/TSV table viewer instead of plain Monaco text. */
export function isCsvPath(path: string): boolean {
  return CSV_EXTENSIONS.has(extensionOf(path));
}
