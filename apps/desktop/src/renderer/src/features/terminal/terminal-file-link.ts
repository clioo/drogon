// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/terminal-file-link-actions.ts.
// Adapted: Orca's file-open stack (worktree roots, WSL mapping, remote
// download, action popover) does not exist in Drogon. This module keeps the
// source's activation contract — direct (⌘/Ctrl+click) opens, ⇧ forces the
// system-default app — and routes through a window CustomEvent the App shell
// wires to the Files panel (`openFileInFiles`); TerminalPane cannot touch
// App-owned routing. Plain clicks are ignored (the source opens an action
// popover there; a popover is an explicit remainder).

export type ParsedTerminalFileLink = {
  path: string;
  line: number | null;
  column: number | null;
  startIndex: number;
  endIndex: number;
};

/** Dispatched on window; App wires it to the Files panel / editor. */
export const TERMINAL_FILE_OPEN_EVENT = "drogon:open-file";

export type TerminalFileOpenDetail = {
  path: string;
  line: number | null;
  column: number | null;
  workspaceId: string;
  /** ⇧ held: prefer the system-default app over the in-app editor. */
  openWithSystemDefault: boolean;
};

const TRAILING_PUNCT = /[.,;:!?)\]}'"]+$/;

// A path token: absolute (/…), home (~/…), explicit relative (./… or ../…),
// or a bare relative token containing a slash (src/app.ts). Optional
// :line and :line:column suffixes. http(s) URLs are excluded (the http link
// provider owns them).
const FILE_TOKEN_RE =
  /(^|[\s"'([])((?:~\/|\.{1,2}\/|\/)(?:[^\s:()[\]{}"'`|&;<>*?!\n\\]+)(?::\d+)?(?::\d+)?|(?:[\w@.~+-]+(?:\/[\w@.~+-]+)+)(?::\d+)?(?::\d+)?)/g;

export function extractTerminalFileLinks(
  lineText: string,
): ParsedTerminalFileLink[] {
  const links: ParsedTerminalFileLink[] = [];
  FILE_TOKEN_RE.lastIndex = 0;
  for (;;) {
    const match = FILE_TOKEN_RE.exec(lineText);
    if (!match) break;
    const raw = match[2];
    if (/^https?:\/\//.test(raw)) continue;
    const token = raw.replace(TRAILING_PUNCT, "");
    if (!token) continue;
    const parsed = parseFileToken(token);
    if (!parsed) continue;
    const startIndex = match.index + match[1].length;
    links.push({ ...parsed, startIndex, endIndex: startIndex + token.length });
  }
  return links;
}

function parseFileToken(token: string): {
  path: string;
  line: number | null;
  column: number | null;
} | null {
  // Split trailing :line[:column] suffixes (all digits).
  const suffix = /:(\d+)(?::(\d+))?$/.exec(token);
  let path = token;
  let line: number | null = null;
  let column: number | null = null;
  if (suffix) {
    path = token.slice(0, suffix.index);
    line = Number.parseInt(suffix[1], 10);
    if (suffix[2] !== undefined) column = Number.parseInt(suffix[2], 10);
  }
  path = path.replace(TRAILING_PUNCT, "");
  if (!path || path === "~" || path === "." || path === "..") return null;
  // Bare tokens must look like paths: contain a slash or start with . ~ /.
  if (
    !path.includes("/") &&
    !path.startsWith(".") &&
    !path.startsWith("~")
  ) {
    return null;
  }
  return { path, line, column };
}

export function requestTerminalFileOpen(detail: TerminalFileOpenDetail): void {
  window.dispatchEvent(new CustomEvent(TERMINAL_FILE_OPEN_EVENT, { detail }));
}

/**
 * Source-shaped file-link handler: direct activation (⌘/Ctrl+click) opens
 * the path; ⇧ routes to the system-default app. Returns true when handled.
 */
export function handleTerminalFileLink(
  filePath: string,
  line: number | null,
  column: number | null,
  event: Pick<MouseEvent, "shiftKey"> | undefined,
  deps: { workspaceId: string },
): boolean {
  requestTerminalFileOpen({
    path: filePath,
    line,
    column,
    workspaceId: deps.workspaceId,
    openWithSystemDefault: Boolean(event?.shiftKey),
  });
  return true;
}
