import type { FileBridge } from "../../../../shared/file-contract";
import { MAX_DIRECTORY_ENTRIES } from "../../../../shared/file-contract";

/** One matchable file path for quick open. */
export interface QuickOpenFile {
  path: string;
  name: string;
}

export interface QuickOpenMatch extends QuickOpenFile {
  score: number;
}

/**
 * Subsequence fuzzy score for one file path. The basename carries the most
 * weight; consecutive and boundary (start, after /-._-) matches score higher
 * so `fb` prefers `foo/bar.ts` over `frobnicator/x.ts`. Returns 0 on no match.
 */
export function fuzzyMatchPath(query: string, target: string): number {
  const foldedQuery = query.toLowerCase();
  const foldedTarget = target.toLowerCase();
  if (!foldedQuery) return 0;
  const slash = foldedTarget.lastIndexOf("/");
  const basename = slash >= 0 ? foldedTarget.slice(slash + 1) : foldedTarget;
  const inBasename = fuzzySubsequence(foldedQuery, basename);
  const inFull = fuzzySubsequence(foldedQuery, foldedTarget);
  if (inBasename > 0 && inFull > 0) return inBasename * 2 + inFull;
  if (inBasename > 0) return inBasename * 2;
  return inFull;
}

function isBoundary(char: string): boolean {
  return char === "/" || char === "-" || char === "_" || char === "." || char === " ";
}

function fuzzySubsequence(query: string, target: string): number {
  let score = 0;
  let targetIndex = 0;
  let consecutive = 0;
  for (let qi = 0; qi < query.length; qi += 1) {
    const char = query[qi];
    let found = -1;
    for (let ti = targetIndex; ti < target.length; ti += 1) {
      if (target[ti] === char) {
        found = ti;
        break;
      }
    }
    if (found < 0) return 0;
    if (found === targetIndex) {
      // Consecutive run; a run at the start is the strongest signal.
      consecutive += 1;
      score += 5 + consecutive * 2 + (found === 0 ? 4 : 0);
    } else {
      consecutive = 0;
      score += 2;
      if (found === 0 || isBoundary(target[found - 1])) score += 3;
    }
    targetIndex = found + 1;
  }
  // Shorter candidates win ties: a compact name matched fully beats a long
  // path that merely contains the same letters.
  score += Math.max(0, 24 - target.length) * 0.25;
  return score;
}

/**
 * Ranks files against a query. Empty query returns files in the walk's own
 * (directory) order, uncapped — the caller applies the render cap.
 */
export function rankQuickOpenFiles(
  files: readonly QuickOpenFile[],
  query: string,
): QuickOpenMatch[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return files.map((file) => ({ ...file, score: 0 }));
  const scored = files
    .map((file) => ({ ...file, score: fuzzyMatchPath(trimmed, file.path) }))
    .filter((match) => match.score > 0);
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return scored;
}

export interface QuickOpenScope {
  hostId: string;
  workspaceId: string;
}

export const QUICK_OPEN_MAX_DIRS = 200;
export const QUICK_OPEN_MAX_FILES = 2000;

/**
 * Breadth-first walk of the workspace over the existing files.list bridge.
 * Bounded (dirs/files caps) and fail-open per directory: one unreadable
 * directory is skipped, never aborting the walk. Directories sort before
 * files within each listing so results read in explorer order.
 */
export async function collectWorkspaceFiles(input: {
  bridge: FileBridge;
  scope: QuickOpenScope;
  maxDirs?: number;
  maxFiles?: number;
}): Promise<{ files: QuickOpenFile[]; truncated: boolean }> {
  const maxDirs = input.maxDirs ?? QUICK_OPEN_MAX_DIRS;
  const maxFiles = input.maxFiles ?? QUICK_OPEN_MAX_FILES;
  const files: QuickOpenFile[] = [];
  const queue: string[] = ["."];
  let dirsVisited = 0;
  let truncated = false;
  while (queue.length > 0) {
    if (dirsVisited >= maxDirs || files.length >= maxFiles) {
      truncated = true;
      break;
    }
    const dir = queue.shift() as string;
    dirsVisited += 1;
    let result: Awaited<ReturnType<FileBridge["fileList"]>>;
    try {
      result = await input.bridge.fileList({
        ...input.scope,
        path: dir,
        limitEntries: MAX_DIRECTORY_ENTRIES,
      });
    } catch {
      continue;
    }
    if (!result.ok) continue;
    if (result.result.truncated) truncated = true;
    const parentPath = result.result.path;
    const entries = [...result.result.entries].sort((a, b) => {
      const aDir = a.kind === "directory" ? 0 : 1;
      const bDir = b.kind === "directory" ? 0 : 1;
      if (aDir !== bDir) return aDir - bDir;
      return a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      const path = parentPath === "." ? entry.name : `${parentPath}/${entry.name}`;
      if (entry.kind === "directory") {
        queue.push(path);
      } else {
        if (files.length >= maxFiles) {
          truncated = true;
          break;
        }
        files.push({ path, name: entry.name });
      }
    }
  }
  return { files, truncated };
}
