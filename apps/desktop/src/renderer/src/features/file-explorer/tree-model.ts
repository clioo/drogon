/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/right-sidebar/path-tree.ts
   (splitPathSegments), file-explorer-types.ts (TreeNode),
   file-explorer-row-projection.ts (flat visible projection),
   file-explorer-name-filter-projection.ts (filter tokens, matching and the
   synthetic ancestor projection) and file-explorer-selection.ts
   (clipboard path formatting). Adapted: single local-workspace root, so
   `path` doubles as the relative path and there is no worktree prefix;
   git-ignored and dotfile visibility stay caller-owned flags. */

import type { WorkspaceFileNode } from "../workspaces/WorkspaceExplorer";

/** One row of the explorer tree. `path` is workspace-relative (`/`-joined). */
export interface ExplorerNode {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink?: boolean;
  depth: number;
  gitStatus?: WorkspaceFileNode["gitStatus"];
}

/** Split a workspace-relative path into its segments. */
export function splitPathSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

/** Depth of a workspace-relative path: top-level entries sit at depth 0. */
export function depthOf(path: string): number {
  return splitPathSegments(path).length - 1;
}

/** Map a lazy listing entry onto the explorer's row model. */
export function toExplorerNode(
  entry: WorkspaceFileNode,
  path: string,
): ExplorerNode {
  return {
    name: entry.name,
    path,
    isDirectory: entry.kind === "directory",
    depth: depthOf(path),
    ...(entry.gitStatus ? { gitStatus: entry.gitStatus } : {}),
  };
}

/** Parent chain of a path, nearest-first: `a/b/c` yields `a/b`, then `a`. */
export function ancestorPaths(path: string): string[] {
  const segments = splitPathSegments(path);
  const ancestors: string[] = [];
  for (let index = segments.length - 1; index >= 1; index -= 1) {
    ancestors.push(segments.slice(0, index).join("/"));
  }
  return ancestors;
}

/**
 * Port of the source status-display.ts isPathIgnored: a row counts as
 * git-ignored when it or any ancestor directory is in the ignored set
 * (children of an ignored directory render and hide with it).
 */
export function isPathIgnored(
  ignored: ReadonlySet<string>,
  relativePath: string,
): boolean {
  if (ignored.size === 0) return false;
  if (ignored.has(relativePath)) return true;
  for (const ancestor of ancestorPaths(relativePath)) {
    if (ignored.has(ancestor)) return true;
  }
  return false;
}

/**
 * Depth-first projection of the rows the user can currently see: every
 * loaded child of an expanded directory, in listing order. Mirrors the
 * source's flat visible-row projection over the lazy per-directory cache.
 */
export function buildVisibleRows(
  children: Readonly<Record<string, readonly ExplorerNode[]>>,
  expanded: ReadonlySet<string>,
  dirPath = "",
): ExplorerNode[] {
  const rows: ExplorerNode[] = [];
  for (const node of children[dirPath] ?? []) {
    rows.push(node);
    if (node.isDirectory && expanded.has(node.path)) {
      rows.push(...buildVisibleRows(children, expanded, node.path));
    }
  }
  return rows;
}

/** Index of a path in the visible order, or null when not visible. */
export function indexOfPath(
  rows: readonly ExplorerNode[],
  path: string,
): number | null {
  const index = rows.findIndex((row) => row.path === path);
  return index === -1 ? null : index;
}

/** Parent row index in visible order (nearest shallower row above). */
export function parentIndexOf(
  rows: readonly ExplorerNode[],
  index: number,
): number | null {
  const current = rows[index];
  if (!current || current.depth <= 0) return null;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (rows[cursor].depth < current.depth) return cursor;
  }
  return null;
}

/** First-child row index when the row is an expanded directory. */
export function firstChildIndexOf(
  rows: readonly ExplorerNode[],
  index: number,
): number | null {
  const current = rows[index];
  if (!current || !current.isDirectory) return null;
  const next = rows[index + 1];
  return next && next.depth === current.depth + 1 ? index + 1 : null;
}

/** Queries past 2 KiB never match: fail-closed, never a full-tree scan. */
export const NAME_FILTER_QUERY_MAX_BYTES = 2 * 1024;

export function isNameFilterQueryTooLarge(
  query: string | undefined,
  maxBytes = NAME_FILTER_QUERY_MAX_BYTES,
): boolean {
  const value = query ?? "";
  return new TextEncoder().encode(value).length > maxBytes;
}

/** Lowercase whitespace-separated tokens of a filter query. */
export function getNameFilterTokens(query: string | undefined): string[] {
  if (isNameFilterQueryTooLarge(query)) return [];
  return splitNameFilterTokens(query ?? "");
}

function splitNameFilterTokens(query: string): string[] {
  const tokens: string[] = [];
  let tokenStart = -1;
  for (let index = 0; index <= query.length; index += 1) {
    const isEnd = index === query.length;
    if (!isEnd && !isNameFilterWhitespace(query.charCodeAt(index))) {
      if (tokenStart === -1) tokenStart = index;
      continue;
    }
    if (tokenStart !== -1) {
      tokens.push(query.slice(tokenStart, index).toLocaleLowerCase());
      tokenStart = -1;
    }
  }
  return tokens;
}

function isNameFilterWhitespace(code: number): boolean {
  return (
    code === 32 ||
    (code >= 9 && code <= 13) ||
    code === 160 ||
    code === 5760 ||
    (code >= 8192 && code <= 8202) ||
    code === 8232 ||
    code === 8233 ||
    code === 8239 ||
    code === 8287 ||
    code === 12288 ||
    code === 65279
  );
}

/** Every token must appear somewhere in the (already-normalized) path. */
export function pathMatchesNameFilter(
  relativePath: string,
  tokens: readonly string[],
): boolean {
  if (tokens.length === 0) return true;
  const haystack = relativePath.toLocaleLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function isDotfilePath(relativePath: string): boolean {
  return splitPathSegments(relativePath).some((segment) =>
    segment.startsWith("."),
  );
}

/**
 * Filtered projection over a fully loaded node list: matching files plus
 * their ancestor directories (synthesized when an ancestor itself was never
 * listed), in path order. Mirrors the source's synthetic ancestor
 * projection; collapsed-path overrides stay caller-owned.
 */
export function projectNameFilter(
  allNodes: readonly ExplorerNode[],
  query: string,
  options?: { showDotfiles?: boolean },
): ExplorerNode[] {
  const tokens = getNameFilterTokens(query);
  if (tokens.length === 0) return [];
  const showDotfiles = options?.showDotfiles ?? true;
  const byPath = new Map<string, ExplorerNode>();
  for (const node of allNodes) byPath.set(node.path, node);
  const included = new Map<string, ExplorerNode>();
  const matches = allNodes.filter(
    (node) =>
      (showDotfiles || !isDotfilePath(node.path)) &&
      pathMatchesNameFilter(node.path, tokens),
  );
  for (const node of matches) {
    // Ancestors first so parents always precede their children.
    for (const ancestor of [...ancestorPaths(node.path)].reverse()) {
      if (!included.has(ancestor)) {
        included.set(
          ancestor,
          byPath.get(ancestor) ?? {
            name: ancestor.split("/").at(-1) ?? ancestor,
            path: ancestor,
            isDirectory: true,
            depth: depthOf(ancestor),
          },
        );
      }
    }
    included.set(node.path, node);
  }
  return [...included.values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}

/** Collect every loaded node of the lazy cache into one flat list. */
export function collectLoadedNodes(
  children: Readonly<Record<string, readonly ExplorerNode[]>>,
): ExplorerNode[] {
  return Object.values(children).flat();
}

/**
 * Clipboard text for Copy Path / Copy Relative Path: workspace-relative
 * paths here ARE the relative form; the absolute form prefixes the
 * workspace root the caller passes in.
 */
export function formatPathsForClipboard(
  nodes: readonly ExplorerNode[],
  pathKind: "absolute" | "relative",
  workspaceRoot?: string,
): string {
  return nodes
    .map((node) =>
      pathKind === "absolute" && workspaceRoot
        ? `${workspaceRoot.replace(/\/+$/, "")}/${node.path}`
        : node.path,
    )
    .join("\n");
}
