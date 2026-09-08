/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/right-sidebar/use-file-explorer-ignored-paths.ts
   (debounced visible-row query, stale-scope answers dropped) and
   file-explorer-ignored-paths scoping. Adapter: the source queries the
   runtime git client per worktree; this repo asks the daemon's
   `files.ignored` through the explorer data source, so the only inputs are
   a scope key and a query function. A missing query (older daemon) means
   no row is ever decorated, never a crash. */
import { useEffect, useState } from "react";

export const FILE_EXPLORER_IGNORED_QUERY_DEBOUNCE_MS = 300;

/** Scope-keyed ignored answer: only the current scope's rows may render it. */
export function getEffectiveFileExplorerIgnoredPaths({
  scopeKey,
  answerScopeKey,
  ignored,
}: {
  scopeKey: string | null;
  answerScopeKey: string | null;
  ignored: ReadonlySet<string>;
}): ReadonlySet<string> {
  if (scopeKey === null || answerScopeKey !== scopeKey) return EMPTY_IGNORED;
  return ignored;
}

const EMPTY_IGNORED: ReadonlySet<string> = new Set();

/**
 * Queries which visible workspace-relative rows git ignores (debounced like
 * the source so filter keystrokes never launch uncancellable query chains).
 * Failures resolve to an empty set: decoration is best-effort, the tree
 * never errors for it.
 */
export function useFileExplorerIgnoredPaths({
  scopeKey,
  relativePaths,
  shouldDebounce,
  queryIgnored,
}: {
  /** hostId/workspaceId identity; a change drops every in-flight answer. */
  scopeKey: string | null;
  /** Visible workspace-relative row paths to classify. */
  relativePaths: readonly string[];
  /** True while the name filter is typing (debounce the query). */
  shouldDebounce: boolean;
  /** Daemon query; null until the bridge exposes `files.ignored`. */
  queryIgnored: ((paths: readonly string[]) => Promise<ReadonlySet<string>>) | null;
}): ReadonlySet<string> {
  const [answer, setAnswer] = useState<{
    scopeKey: string | null;
    ignored: ReadonlySet<string>;
  }>({ scopeKey: null, ignored: EMPTY_IGNORED });

  useEffect(() => {
    if (scopeKey === null || queryIgnored === null || relativePaths.length === 0) {
      setAnswer({ scopeKey: null, ignored: EMPTY_IGNORED });
      return;
    }
    let canceled = false;
    const refresh = (): void => {
      void queryIgnored(relativePaths).then(
        (ignored) => {
          if (!canceled) setAnswer({ scopeKey, ignored });
        },
        () => {
          if (!canceled) setAnswer({ scopeKey, ignored: EMPTY_IGNORED });
        },
      );
    };
    // Why: every filter keystroke changes relativePaths. Waiting for a
    // short quiet window prevents obsolete queries from piling up while
    // the visible name projection stays immediate.
    const timer = shouldDebounce
      ? window.setTimeout(refresh, FILE_EXPLORER_IGNORED_QUERY_DEBOUNCE_MS)
      : null;
    if (timer === null) refresh();
    return () => {
      canceled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [scopeKey, relativePaths, shouldDebounce, queryIgnored]);

  return getEffectiveFileExplorerIgnoredPaths({
    scopeKey,
    answerScopeKey: answer.scopeKey,
    ignored: answer.ignored,
  });
}
