/* MIT Copyright (c) 2026 Lovecast Inc.
 * Fuzzy file ranking ported from the read-only reference
 * `src/shared/quick-open-path-search.ts` (`rankQuickOpenFiles`,
 * `prepareQuickOpenFiles`, `QuickOpenPathRanker`): lower score wins —
 * gap penalties with boundary (`/`, `.`, `-`) and full-filename
 * bonuses, filename-aware tiebreak, bounded top-N retention. Adapted
 * standalone (no clipboard-text dependency; the byte cap is checked by
 * the caller). Plus the row helpers quick open needs: dir/name split
 * for path dimming and recent-first ordering.
 */

export const QUICK_OPEN_RESULT_LIMIT = 50;
export const QUICK_OPEN_QUERY_MAX_BYTES = 2 * 1024;

export interface QuickOpenIndexedFile {
  path: string;
  lowerPath: string;
  lowerFilename: string;
  inputIndex: number;
}

export interface QuickOpenSearchResult {
  path: string;
  score: number;
}

export function prepareQuickOpenFiles(files: readonly string[]): QuickOpenIndexedFile[] {
  return files.map((path, inputIndex) => prepareQuickOpenFile(path, inputIndex));
}

const preparedQuickOpenFiles = new WeakMap<readonly string[], QuickOpenIndexedFile[]>();

export function getPreparedQuickOpenFiles(
  files: readonly string[],
): readonly QuickOpenIndexedFile[] {
  const cached = preparedQuickOpenFiles.get(files);
  if (cached) return cached;
  const prepared = prepareQuickOpenFiles(files);
  preparedQuickOpenFiles.set(files, prepared);
  return prepared;
}

export function isQuickOpenQueryTooLarge(
  query: string,
  maxBytes = QUICK_OPEN_QUERY_MAX_BYTES,
): boolean {
  return new TextEncoder().encode(query).length > maxBytes;
}

export function normalizeQuickOpenQuery(query: string): string {
  return query.trim().replace(/\\/g, "/").toLowerCase();
}

function prepareQuickOpenFile(path: string, inputIndex: number): QuickOpenIndexedFile {
  const searchPath = path.replace(/\\/g, "/");
  const lastSlash = searchPath.lastIndexOf("/");
  return {
    path,
    lowerPath: searchPath.toLowerCase(),
    lowerFilename: searchPath.slice(lastSlash + 1).toLowerCase(),
    inputIndex,
  };
}

function fuzzyMatchIndexedFile(query: string, file: QuickOpenIndexedFile): number {
  let qi = 0;
  let score = 0;
  let lastMatchIdx = -1;
  for (let ti = 0; ti < file.lowerPath.length && qi < query.length; ti++) {
    if (file.lowerPath[ti] !== query[qi]) continue;
    const gap = lastMatchIdx === -1 ? 0 : ti - lastMatchIdx - 1;
    score += gap;
    if (
      ti > 0 &&
      (file.lowerPath[ti - 1] === "/" ||
        file.lowerPath[ti - 1] === "." ||
        file.lowerPath[ti - 1] === "-")
    ) {
      score -= 5;
    }
    lastMatchIdx = ti;
    qi++;
  }
  if (qi < query.length) return -1;
  if (file.lowerFilename.includes(query)) score -= 100;
  return score;
}

type RankedResult = QuickOpenSearchResult & { inputIndex: number };

function compareRankedResult(a: RankedResult, b: RankedResult): number {
  return (
    a.score - b.score ||
    compareFileNames(a.path, b.path) ||
    a.inputIndex - b.inputIndex
  );
}

/**
 * Filename-aware tiebreak (mirrors the reference `file-name-sort` natural
 * ordering: numbered names sort 9, 99, 100 — plain `localeCompare` would
 * put 100 first).
 */
function compareFileNames(a: string, b: string): number {
  const base = (path: string) => {
    const normalized = path.replace(/\\/g, "/");
    return normalized.slice(normalized.lastIndexOf("/") + 1);
  };
  const options = { sensitivity: "base", numeric: true } as const;
  return (
    base(a).localeCompare(base(b), undefined, options) ||
    a.localeCompare(b, undefined, options)
  );
}

function retainTopResult(
  heap: RankedResult[],
  candidate: RankedResult,
  limit: number,
): void {
  if (heap.length === limit && compareRankedResult(candidate, heap[0]) >= 0) return;
  if (heap.length < limit) {
    heap.push(candidate);
    siftUp(heap, heap.length - 1);
    return;
  }
  heap[0] = candidate;
  siftDown(heap);
}

function siftUp(heap: RankedResult[], startIndex: number): void {
  let index = startIndex;
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    if (compareRankedResult(heap[index], heap[parentIndex]) <= 0) return;
    [heap[index], heap[parentIndex]] = [heap[parentIndex], heap[index]];
    index = parentIndex;
  }
}

function siftDown(heap: RankedResult[]): void {
  let index = 0;
  for (;;) {
    const leftIndex = index * 2 + 1;
    if (leftIndex >= heap.length) return;
    const rightIndex = leftIndex + 1;
    const worseChildIndex =
      rightIndex < heap.length &&
      compareRankedResult(heap[rightIndex], heap[leftIndex]) > 0
        ? rightIndex
        : leftIndex;
    if (compareRankedResult(heap[worseChildIndex], heap[index]) <= 0) return;
    [heap[index], heap[worseChildIndex]] = [heap[worseChildIndex], heap[index]];
    index = worseChildIndex;
  }
}

/**
 * Ranks files against a query (lower score first). Empty query returns
 * the first `limit` paths in natural filename order with score 0 (source
 * parity); oversized queries match nothing.
 */
export function rankQuickOpenFiles(
  query: string,
  files: readonly QuickOpenIndexedFile[],
  limit = QUICK_OPEN_RESULT_LIMIT,
): QuickOpenSearchResult[] {
  if (limit <= 0 || isQuickOpenQueryTooLarge(query)) return [];
  const normalizedQuery = normalizeQuickOpenQuery(query);
  const retained: RankedResult[] = [];
  for (const file of files) {
    const score = normalizedQuery ? fuzzyMatchIndexedFile(normalizedQuery, file) : 0;
    if (score !== -1) {
      retainTopResult(
        retained,
        { path: file.path, score, inputIndex: file.inputIndex },
        limit,
      );
    }
  }
  return retained
    .sort(compareRankedResult)
    .map(({ path, score }) => ({ path, score }));
}

/** Splits a candidate path for dimmed-dir / emphasized-name rendering. */
export function splitQuickOpenPath(path: string): { dir: string; name: string } {
  const normalized = path.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) return { dir: "", name: path };
  return { dir: normalized.slice(0, slash + 1), name: normalized.slice(slash + 1) };
}

/**
 * Recent-first ordering for the empty-query list: paths the user opened
 * recently (most recent first) lead, the rest keep walk order. Ranked
 * queries keep fuzzy order instead — recency only breaks full ties there
 * via the stable input order the caller prepared.
 */
export function applyQuickOpenRecency(
  paths: readonly string[],
  recentPaths: readonly string[],
): string[] {
  if (recentPaths.length === 0) return [...paths];
  const remaining = new Set(paths);
  const ordered: string[] = [];
  for (const recent of recentPaths) {
    if (remaining.delete(recent)) ordered.push(recent);
  }
  for (const path of paths) {
    if (remaining.has(path)) {
      remaining.delete(path);
      ordered.push(path);
    }
  }
  return ordered;
}

const RECENT_FILES_KEY_PREFIX = "drogon.quick-open.recent:";
export const MAX_QUICK_OPEN_RECENT_FILES = 20;

export function quickOpenRecentKey(workspaceId: string): string {
  return `${RECENT_FILES_KEY_PREFIX}${workspaceId}`;
}

export function loadQuickOpenRecentFiles(
  storage: Pick<Storage, "getItem">,
  workspaceId: string,
): string[] {
  try {
    const raw = storage.getItem(quickOpenRecentKey(workspaceId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is string => typeof entry === "string" && entry !== "",
    ).slice(0, MAX_QUICK_OPEN_RECENT_FILES);
  } catch {
    return [];
  }
}

export function recordQuickOpenRecentFile(
  storage: Pick<Storage, "getItem" | "setItem">,
  workspaceId: string,
  path: string,
): string[] {
  const next = [
    path,
    ...loadQuickOpenRecentFiles(storage, workspaceId).filter((entry) => entry !== path),
  ].slice(0, MAX_QUICK_OPEN_RECENT_FILES);
  try {
    storage.setItem(quickOpenRecentKey(workspaceId), JSON.stringify(next));
  } catch {
    // A full or unavailable store must never break opening the file.
  }
  return next;
}
