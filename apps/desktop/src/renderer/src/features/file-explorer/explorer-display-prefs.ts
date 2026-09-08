/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/right-sidebar/FileExplorer.tsx display
   preferences: `showDotfilesByWorktree` (per-worktree, default true) and
   `settings.showGitIgnoredFiles` (global, default true, see
   useFileExplorerVisibleRowProjection.ts). Adapter: the source keeps both
   in its persisted zustand store; this repo keeps them in localStorage,
   dotfiles keyed per workspace, ignored visibility global. */

const DOTFILES_KEY_PREFIX = "drogon:file-explorer:dotfiles:";
const GIT_IGNORED_KEY = "drogon:file-explorer:show-git-ignored";

function readFlag(
  storage: Pick<Storage, "getItem"> | undefined,
  key: string,
): boolean | null {
  try {
    const raw = storage?.getItem(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    return null;
  }
}

function writeFlag(
  storage: Pick<Storage, "setItem"> | undefined,
  key: string,
  value: boolean,
): void {
  try {
    storage?.setItem(key, value ? "1" : "0");
  } catch {
    // No durability promise; in-memory state stays authoritative.
  }
}

/** Per-worktree dotfile visibility; nothing stored means the source default true. */
/**
 * The shell's localStorage when one exists. Server-render tests (the
 * files-panel mount checks) run without a window, so the bare global is a
 * ReferenceError there; undefined storage falls back to the defaults.
 */
export function defaultPrefsStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadShowDotfiles(
  storage: Pick<Storage, "getItem"> | undefined,
  workspaceId: string,
): boolean {
  return readFlag(storage, `${DOTFILES_KEY_PREFIX}${workspaceId}`) ?? true;
}

export function saveShowDotfiles(
  storage: Pick<Storage, "setItem"> | undefined,
  workspaceId: string,
  value: boolean,
): void {
  writeFlag(storage, `${DOTFILES_KEY_PREFIX}${workspaceId}`, value);
}

/** Global git-ignored-row visibility; nothing stored means the source default true. */
export function loadShowGitIgnoredFiles(
  storage: Pick<Storage, "getItem"> | undefined,
): boolean {
  return readFlag(storage, GIT_IGNORED_KEY) ?? true;
}

export function saveShowGitIgnoredFiles(
  storage: Pick<Storage, "setItem"> | undefined,
  value: boolean,
): void {
  writeFlag(storage, GIT_IGNORED_KEY, value);
}
