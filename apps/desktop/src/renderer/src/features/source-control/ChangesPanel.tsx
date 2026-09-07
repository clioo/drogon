// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/panel/panel-content.tsx
// (scrolling surface composition), panel/commit-surface.tsx (commit surface
// placement), listing/uncommitted-sections, commit/commit-area,
// commit/discard-dialog, sync/compare-summary, sync/use-status-refresh and
// sync/use-upstream-status-fetch.
// Adapter: Orca's zustand store becomes local state over the existing
// git.* bridge; review/AI/notes/submodules/history-graph have no MVP
// backend and are not ported. Selecting a file keeps this repo's existing
// unified-diff viewer (see unified-diff.ts).
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import {
  GIT_CAPABILITY,
  type GitBridge,
  type GitLineCount,
  type GitStatusEntry,
} from "../../../../shared/git-contract";
import type {
  Result,
  Session,
  Status,
  Workspace,
} from "../../../../shared/session-contract";
import { Button } from "../../components/ui/button";
import { SourceControlHeaderToolbar } from "./header-toolbar";
import { SourceControlUncommittedSections } from "./uncommitted-sections";
import { SourceControlBranchLineTotalChip } from "./branch-line-total-chip";
import { CommitArea } from "./commit-area";
import {
  SourceControlDiscardDialog,
  type PendingDiscardConfirmation,
} from "./discard-dialog";
import { EmptyState } from "./empty-state";
import { TooManyChangesBanner } from "./too-many-changes-banner";
import { SyncRow, type SyncBusyKind } from "./sync-row";
import {
  filterSourceControlGroupedPathEntries,
  getSourceControlFileFilterState,
} from "./file-filter";
import {
  buildSourceControlDisplaySections,
  groupSourceControlEntries,
} from "./section-order";
import type { SourceControlDisplaySectionId } from "./section-order";
import {
  canCommitEntries,
  rowKey,
  rowsForEntry,
  type SourceControlEntry,
} from "./source-control-entry";
import type { SourceControlViewMode } from "./section-file-list";
import { handleSourceControlCommitShortcut } from "./commit-shortcut";
import { getDiscardAllPaths, runDiscardAllForArea } from "./discard-sequence";
import { parseUnifiedDiff } from "./unified-diff";

export const CHANGES_ROUTE_ID = "changes";
export const CHANGES_TITLE = "Changes";

/** Pure capability gate: does the service expose the git contract? */
export function isChangesAvailable(capabilities: readonly string[]): boolean {
  return capabilities.includes(GIT_CAPABILITY);
}

export type ChangesPanelProps = {
  routeId: string;
  session: Session | null;
  workspace: Workspace;
  status: Status;
  restoreState?: unknown;
  focusTarget: HTMLElement | null;
};

export type ChangesPanelDescriptor = {
  id: string;
  title: string;
  component: (props: ChangesPanelProps) => ReactNode;
  capability: string;
};

type Selection = { area: "staged" | "unstaged" | "untracked"; path: string };

type StatusLoad =
  | { phase: "loading" }
  | {
      phase: "ready";
      entries: GitStatusEntry[];
      truncated: boolean;
      head: string | null;
      upstream: string | null;
      ahead: number | null;
      behind: number | null;
      oid: string | null;
    }
  | { phase: "error"; message: string };

type DiffLoad =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; diff: string; truncated: boolean }
  | { phase: "error"; message: string };

function errorMessage(value: Result<unknown>): string {
  if (value.ok) return "";
  return value.error.message || `Request failed (${value.error.code}).`;
}

const mono: React.CSSProperties = { fontFamily: "var(--font-mono)" };

function errorNotice(message: string): string {
  return message.startsWith("Error") ? message : `Error: ${message}`;
}

/** Effectful container: loads status/counts/diff through the injected GitBridge. */
export function ChangesPanel({
  workspace,
  status,
  bridge,
}: ChangesPanelProps & { bridge: GitBridge }) {
  const scope = useMemo(
    () => ({ hostId: status.hostId, workspaceId: workspace.id }),
    [status.hostId, workspace.id],
  );
  const discardAvailable = typeof bridge.gitDiscard === "function";
  const lineCountsAvailable = typeof bridge.gitLineCounts === "function";
  const pullAvailable = typeof bridge.gitPull === "function";
  const fetchAvailable = typeof bridge.gitFetch === "function";

  const [load, setLoad] = useState<StatusLoad>({ phase: "loading" });
  const [counts, setCounts] = useState<Map<string, GitLineCount>>(new Map());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set());
  const [diff, setDiff] = useState<DiffLoad>({ phase: "idle" });
  const [commitMessage, setCommitMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState<SyncBusyKind>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [prNotice, setPrNotice] = useState<{ message: string; tone: "muted" | "destructive" } | null>(
    null,
  );
  const [revision, setRevision] = useState(0);
  const [pendingDiscard, setPendingDiscard] = useState<PendingDiscardConfirmation | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<SourceControlViewMode>(() =>
    typeof window !== "undefined" && window.localStorage.getItem("drogon.sc.view") === "tree"
      ? "tree"
      : "list",
  );
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [collapsedTreeDirs, setCollapsedTreeDirs] = useState<Set<string>>(new Set());

  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoad({ phase: "loading" });
    void bridge.gitStatus(scope).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLoad({ phase: "error", message: errorMessage(result) });
        return;
      }
      setLoad({
        phase: "ready",
        entries: result.result.entries,
        truncated: result.result.truncated,
        head: result.result.branch.head ?? null,
        upstream: result.result.branch.upstream ?? null,
        ahead: result.result.branch.ahead ?? null,
        behind: result.result.branch.behind ?? null,
        oid: result.result.branch.oid ?? null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, scope, revision]);

  const protocolEntries = load.phase === "ready" ? load.entries : [];

  useEffect(() => {
    if (!lineCountsAvailable || protocolEntries.length === 0) {
      setCounts(new Map());
      return;
    }
    let cancelled = false;
    const paths = [...new Set(protocolEntries.map((entry) => entry.path))];
    void bridge
      .gitLineCounts?.({ ...scope, paths })
      .then((result) => {
        if (cancelled || !result || !result.ok) return;
        setCounts(new Map(result.result.counts.map((count) => [count.path, count])));
      })
      .catch(() => {
        if (!cancelled) setCounts(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, lineCountsAvailable, protocolEntries, scope]);

  const rows = useMemo<SourceControlEntry[]>(
    () => protocolEntries.flatMap((entry) => rowsForEntry(entry, counts.get(entry.path))),
    [protocolEntries, counts],
  );

  const filterState = useMemo(() => getSourceControlFileFilterState(filterQuery), [filterQuery]);
  const grouped = useMemo(() => groupSourceControlEntries(rows), [rows]);
  const filteredGrouped = useMemo(
    () => filterSourceControlGroupedPathEntries(grouped, filterState),
    [grouped, filterState],
  );
  const displaySections = useMemo(
    () =>
      buildSourceControlDisplaySections({
        staged: filteredGrouped.staged,
        unstaged: filteredGrouped.unstaged,
        untracked: filteredGrouped.untracked,
      }),
    [filteredGrouped],
  );
  const unfilteredSectionsById = useMemo(() => {
    const full = buildSourceControlDisplaySections(grouped);
    return new Map<SourceControlDisplaySectionId, (typeof full)[number]>(
      full.map((section) => [section.id, section]),
    );
  }, [grouped]);

  const lineTotal = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const row of rows) {
      added += row.added ?? 0;
      removed += row.removed ?? 0;
    }
    return { added, removed };
  }, [rows]);

  const branch =
    load.phase === "ready"
      ? { head: load.head, upstream: load.upstream, ahead: load.ahead, behind: load.behind, oid: load.oid }
      : { head: null, upstream: null, ahead: null, behind: null, oid: null };

  useEffect(() => {
    if (!selection) {
      setDiff({ phase: "idle" });
      return;
    }
    if (selection.area === "untracked") {
      setDiff({ phase: "ready", diff: "", truncated: false });
      return;
    }
    let cancelled = false;
    setDiff({ phase: "loading" });
    void bridge
      .gitDiff({ ...scope, path: selection.path, staged: selection.area === "staged" })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setDiff({ phase: "error", message: errorMessage(result) });
          return;
        }
        setDiff({
          phase: "ready",
          diff: result.result.diff,
          truncated: result.result.truncated,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, scope, selection]);

  const mutate = useCallback(
    async (kind: string, run: () => Promise<Result<unknown>>) => {
      setBusy(kind);
      setNotice(null);
      try {
        const result = await run();
        if (!result.ok) {
          setNotice(errorNotice(errorMessage(result)));
          return false;
        }
        return true;
      } finally {
        setBusy(null);
        setRevision((value) => value + 1);
      }
    },
    [],
  );

  const stagePaths = useCallback(
    (paths: readonly string[]) =>
      mutate("stage", () => bridge.gitStage({ ...scope, paths: [...paths] })),
    [bridge, mutate, scope],
  );
  const unstagePaths = useCallback(
    (paths: readonly string[]) =>
      mutate("unstage", () => bridge.gitUnstage({ ...scope, paths: [...paths] })),
    [bridge, mutate, scope],
  );

  // Best-effort per-file discard behind the confirmation dialog: one
  // stuck path reports instead of blocking the rest of the bulk action.
  const discardPaths = useCallback(
    async (paths: readonly string[], untracked: boolean): Promise<boolean> => {
      if (!bridge.gitDiscard) {
        setNotice("Error: the connected service does not support discard.");
        return false;
      }
      setBusy("discard");
      setNotice(null);
      try {
        const result = await runDiscardAllForArea(paths, untracked, {
          discardOne: async (path, isUntracked) => {
            const response = await bridge.gitDiscard!({
              ...scope,
              paths: [path],
              untracked: isUntracked,
            });
            if (!response.ok) throw new Error(errorMessage(response));
          },
          onError: (path, error) =>
            setNotice((prev) =>
              prev
                ? prev
                : errorNotice(
                    error instanceof Error ? `${path}: ${error.message}` : `${path}: discard failed`,
                  ),
            ),
        });
        setRevision((value) => value + 1);
        return result.failed.length === 0;
      } finally {
        setBusy(null);
      }
    },
    [bridge, scope],
  );

  /** Discards exactly the selected paths: staged work unstages first, then
   * each path restores (tracked) or deletes (untracked) per its fresh kind. */
  const discardSelection = useCallback(
    async (paths: readonly string[], area: "staged" | "unstaged" | "untracked") => {
      if (area === "staged") {
        const unstaged = await unstagePaths(paths);
        if (!unstaged) return false;
        const fresh = await bridge.gitStatus(scope);
        if (!fresh.ok) {
          setNotice(errorNotice(errorMessage(fresh)));
          setRevision((value) => value + 1);
          return false;
        }
        const kindByPath = new Map(
          fresh.result.entries.map((entry) => [entry.path, entry.kind]),
        );
        const wanted = new Set(paths);
        const tracked = [...wanted].filter((path) => kindByPath.get(path) !== "untracked");
        // Newly-added files surface as untracked once unstaged: delete them.
        const untracked = [...wanted].filter((path) => kindByPath.get(path) === "untracked");
        if (tracked.length > 0 && !(await discardPaths(tracked, false))) return false;
        if (untracked.length > 0 && !(await discardPaths(untracked, true))) return false;
        return true;
      }
      return discardPaths(paths, area === "untracked");
    },
    [bridge, discardPaths, scope, unstagePaths],
  );

  const confirmPendingDiscard = useCallback(() => {
    const pending = pendingDiscard;
    setPendingDiscard(null);
    if (!pending) return;
    void (async () => {
      if (pending.kind === "entry") {
        await discardSelection([pending.entry.path], pending.entry.area);
      } else {
        await discardSelection(pending.paths, pending.area);
      }
    })();
  }, [discardSelection, pendingDiscard]);

  const openDiff = useCallback((entry: SourceControlEntry) => {
    setSelection({ area: entry.area, path: entry.path });
  }, []);
  const selectRow = useCallback((key: string) => {
    setSelectedKeys(new Set([key]));
  }, []);

  const toggleSection = useCallback((id: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleTreeDir = useCallback((key: string) => {
    setCollapsedTreeDirs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const toggleViewMode = useCallback(() => {
    setViewMode((mode) => {
      const next = mode === "list" ? "tree" : "list";
      try {
        window.localStorage.setItem("drogon.sc.view", next);
      } catch {
        /* private mode: stay in memory */
      }
      return next;
    });
  }, []);

  const stagedCount = grouped.staged.length;
  const hasMessage = commitMessage.trim().length > 0;
  const canAmend = branch.oid != null;
  const commitReady = hasMessage && (amend ? canAmend : canCommitEntries(rows));
  const isBusy = busy !== null || syncBusy !== null;

  const doCommit = useCallback(async () => {
    if (!commitReady || busy !== null) return;
    setBusy("commit");
    setCommitError(null);
    setNotice(null);
    try {
      const result = await bridge.gitCommit({
        ...scope,
        message: commitMessage.trim(),
        ...(amend ? { amend: true } : null),
      });
      if (!result.ok) {
        setCommitError(errorMessage(result));
        return;
      }
      setCommitMessage("");
      setAmend(false);
    } finally {
      setBusy(null);
      setRevision((value) => value + 1);
    }
  }, [amend, bridge, busy, commitMessage, commitReady, scope]);

  const doCommitAndPush = useCallback(async () => {
    if (!commitReady || busy !== null || syncBusy !== null) return;
    setBusy("commit");
    setCommitError(null);
    setRemoteError(null);
    try {
      const result = await bridge.gitCommit({
        ...scope,
        message: commitMessage.trim(),
        ...(amend ? { amend: true } : null),
      });
      if (!result.ok) {
        setCommitError(errorMessage(result));
        return;
      }
      setCommitMessage("");
      setAmend(false);
      setSyncBusy("push");
      try {
        const push = await bridge.gitPush(scope);
        if (!push.ok) setRemoteError(errorMessage(push));
      } finally {
        setSyncBusy(null);
      }
    } finally {
      setBusy(null);
      setRevision((value) => value + 1);
    }
  }, [amend, bridge, busy, commitMessage, commitReady, scope, syncBusy]);

  const doPush = useCallback(async () => {
    setSyncBusy("push");
    setRemoteError(null);
    try {
      const result = await bridge.gitPush(scope);
      if (!result.ok) setRemoteError(errorMessage(result));
    } finally {
      setSyncBusy(null);
      setRevision((value) => value + 1);
    }
  }, [bridge, scope]);

  const doPull = useCallback(async () => {
    if (!bridge.gitPull) return;
    setSyncBusy("pull");
    setRemoteError(null);
    try {
      const result = await bridge.gitPull(scope);
      if (!result.ok) setRemoteError(errorMessage(result));
    } finally {
      setSyncBusy(null);
      setRevision((value) => value + 1);
    }
  }, [bridge, scope]);

  const doFetch = useCallback(async () => {
    if (!bridge.gitFetch) return;
    setSyncBusy("fetch");
    setRemoteError(null);
    try {
      const result = await bridge.gitFetch(scope);
      if (!result.ok) setRemoteError(errorMessage(result));
    } finally {
      setSyncBusy(null);
      setRevision((value) => value + 1);
    }
  }, [bridge, scope]);

  const doPrCreate = useCallback(async () => {
    setSyncBusy("pr");
    setPrNotice(null);
    try {
      const title =
        commitMessage.trim() ||
        (selection ? `Update ${selection.path}` : "Update");
      const result = await bridge.gitPrCreate({ ...scope, title });
      if (!result.ok) {
        setPrNotice({ message: errorNotice(errorMessage(result)), tone: "destructive" });
        return;
      }
      setPrUrl(result.result.url);
      setPrNotice({ message: `PR created: ${result.result.url}`, tone: "muted" });
    } finally {
      setSyncBusy(null);
      setRevision((value) => value + 1);
    }
  }, [bridge, commitMessage, scope, selection]);

  const requestDiscardAllInArea = useCallback(
    (area: "staged" | "unstaged" | "untracked", paths?: readonly string[]) => {
      if (!discardAvailable) {
        setNotice("Error: the connected service does not support discard.");
        return;
      }
      const resolved = paths ?? getDiscardAllPaths(rows, area);
      if (resolved.length === 0) return;
      setPendingDiscard({ kind: "area", area, paths: resolved });
    },
    [discardAvailable, rows],
  );

  const hasUncommitted = rows.length > 0;
  const showEmpty = !hasUncommitted && !filterState.normalizedFilter && !filterState.tooLarge;
  const noFilterMatch =
    hasUncommitted &&
    !filterState.tooLarge &&
    filterState.normalizedFilter !== "" &&
    displaySections.length === 0;

  const parsed = diff.phase === "ready" ? parseUnifiedDiff(diff.diff) : { hunks: [], truncated: false };

  return (
    <div
      className="flex flex-col flex-1 min-h-0"
      onKeyDown={(event) =>
        handleSourceControlCommitShortcut(
          event,
          {
            disabled: !commitReady || busy !== null,
            kind: amend ? "amend" : "commit",
          },
          () => void doCommit(),
        )
      }
    >
      <SourceControlHeaderToolbar
        filterQuery={filterQuery}
        filterExpanded={filterExpanded}
        onFilterQueryChange={setFilterQuery}
        onFilterExpandedChange={setFilterExpanded}
        sourceControlViewMode={viewMode}
        onToggleViewMode={toggleViewMode}
        onRefresh={refresh}
        refreshDisabled={load.phase === "loading"}
        branchHead={branch.head}
        upstream={branch.upstream}
        ahead={branch.ahead}
        behind={branch.behind}
        lineTotalAdded={lineTotal.added}
        lineTotalRemoved={lineTotal.removed}
      />
      <SyncRow
        upstream={branch.upstream}
        ahead={branch.ahead}
        behind={branch.behind}
        busyKind={syncBusy}
        actionsAvailable={{ pull: pullAvailable, fetch: fetchAvailable }}
        onPush={() => void doPush()}
        onPull={() => void doPull()}
        onFetch={() => void doFetch()}
        onCreatePr={() => void doPrCreate()}
      />
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
        {load.phase === "error" && (
          <div role="alert" className="px-4 py-3 text-xs text-destructive">
            {load.message}{" "}
            <Button type="button" variant="ghost" size="sm" onClick={refresh}>
              Retry
            </Button>
          </div>
        )}
        {load.phase === "ready" && load.truncated && (
          <div className="px-3 pt-2">
            <TooManyChangesBanner
              limit={load.entries.length}
              onRetry={() => {
                refresh();
                return Promise.resolve();
              }}
              onError={(message) => setNotice(errorNotice(message))}
            />
          </div>
        )}
        {showEmpty && (
          <EmptyState
            heading="No changes on this branch"
            supportingText="This workspace is clean. Staged, unstaged and untracked changes will appear here."
          />
        )}
        {filterState.tooLarge && (
          <EmptyState heading="Search text is too large" supportingText="Use a shorter file filter." />
        )}
        {noFilterMatch && (
          <EmptyState
            heading="No matching files"
            supportingText={`No changed files match "${filterQuery}"`}
          />
        )}
        {hasUncommitted && (
          <CommitArea
            commitMessage={commitMessage}
            commitError={commitError}
            remoteActionError={remoteError}
            prNotice={prNotice}
            prUrl={prUrl}
            isCommitting={busy === "commit"}
            isSecondaryBusy={syncBusy !== null && syncBusy !== "pr"}
            stagedCount={stagedCount}
            hasPartiallyStagedChanges={grouped.unstaged.length > 0 && stagedCount > 0}
            isBusy={isBusy}
            amend={amend}
            canAmend={canAmend}
            onCommitMessageChange={setCommitMessage}
            onCommit={() => void doCommit()}
            onCommitAndPush={() => void doCommitAndPush()}
            onToggleAmend={() => setAmend((value) => !value)}
          />
        )}
        {notice && (
          <div role={notice.startsWith("Error") ? "alert" : "status"} className="px-3">
            <p className="py-1 text-[11px] text-destructive">{notice}</p>
          </div>
        )}
        <SourceControlUncommittedSections
          displaySections={displaySections}
          unfilteredDisplaySectionsById={unfilteredSectionsById}
          normalizedFilter={filterState.normalizedFilter}
          collapsedSections={collapsedSections}
          toggleSection={toggleSection}
          isExecutingBulk={busy !== null}
          requestDiscardAllInArea={requestDiscardAllInArea}
          handleStageAllPaths={(paths) => stagePaths(paths).then(() => {})}
          handleUnstagePaths={(paths) => unstagePaths(paths).then(() => {})}
          sourceControlViewMode={viewMode}
          collapsedTreeDirs={collapsedTreeDirs}
          toggleTreeDir={toggleTreeDir}
          requestDiscardPaths={(area, paths) => {
            if (!discardAvailable) {
              setNotice("Error: the connected service does not support discard.");
              return;
            }
            setPendingDiscard({ kind: "area", area, paths });
          }}
          selectedKeySet={selectedKeys}
          activeOpenRowKeys={
            new Set(selection ? [rowKey(selection.area, selection.path)] : [])
          }
          handleSelect={selectRow}
          handleContextMenu={selectRow}
          handleOpenDiff={openDiff}
          handleStage={(path) => stagePaths([path]).then(() => {})}
          handleUnstage={(path) => unstagePaths([path]).then(() => {})}
          requestDiscardEntry={(entry) => {
            if (!discardAvailable) {
              setNotice("Error: the connected service does not support discard.");
              return;
            }
            setPendingDiscard({ kind: "entry", entry });
          }}
        />
        <div aria-label="Diff and commit" className="border-t border-border">
          <div
            aria-label="Unified diff"
            className="overflow-auto p-3 text-xs"
            style={{ ...mono, maxHeight: 320 }}
          >
            {!selection && <p className="text-muted-foreground">Select a file to view its diff.</p>}
            {selection && (
              <div className="mb-2 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{selection.path}</span>
                <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                  {selection.area}
                </span>
                {(selection.area === "staged" || selection.area === "unstaged") && (
                  <span className="shrink-0">
                    <SourceControlBranchLineTotalChip
                      added={
                        selection.area === "staged"
                          ? (counts.get(selection.path)?.stagedAdded ?? 0)
                          : (counts.get(selection.path)?.unstagedAdded ?? 0)
                      }
                      removed={
                        selection.area === "staged"
                          ? (counts.get(selection.path)?.stagedRemoved ?? 0)
                          : (counts.get(selection.path)?.unstagedRemoved ?? 0)
                      }
                    />
                  </span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0"
                  aria-label="Close diff"
                  onClick={() => setSelection(null)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            )}
            {diff.phase === "loading" && <p className="text-muted-foreground">Loading diff…</p>}
            {diff.phase === "error" && <p role="alert">{diff.message}</p>}
            {diff.phase === "ready" && parsed.hunks.length === 0 && (
              <p className="text-muted-foreground">
                No diff for this file (untracked files show no diff).
              </p>
            )}
            {diff.phase === "ready" &&
              parsed.hunks.map((hunk, index) => (
                <div key={index} className="mb-2">
                  {hunk.header && <div className="text-muted-foreground">{hunk.header}</div>}
                  {hunk.lines.map((line, lineIndex) => (
                    <div
                      key={lineIndex}
                      style={
                        line.kind === "add"
                          ? {
                              background:
                                "color-mix(in srgb, var(--foreground) 8%, transparent)",
                            }
                          : line.kind === "del"
                            ? {
                                color: "var(--destructive)",
                                background:
                                  "color-mix(in srgb, var(--destructive) 8%, transparent)",
                              }
                            : line.kind === "hunk" ||
                                line.kind === "file" ||
                                line.kind === "noeol"
                              ? { color: "var(--muted-foreground)" }
                              : undefined
                      }
                    >
                      {line.text === "" ? " " : line.text}
                    </div>
                  ))}
                </div>
              ))}
            {diff.phase === "ready" && (parsed.truncated || diff.truncated) && (
              <p role="status" className="text-muted-foreground">
                Diff truncated to the display budget.
              </p>
            )}
          </div>
        </div>
      </div>
      <SourceControlDiscardDialog
        pendingDiscard={pendingDiscard}
        onCancel={() => setPendingDiscard(null)}
        onConfirm={confirmPendingDiscard}
      />
    </div>
  );
}

export function createChangesPanelDescriptor(deps: {
  bridge: GitBridge;
}): ChangesPanelDescriptor {
  return {
    id: CHANGES_ROUTE_ID,
    title: CHANGES_TITLE,
    component: (props: ChangesPanelProps) => (
      <ChangesPanel {...props} bridge={deps.bridge} />
    ),
    capability: GIT_CAPABILITY,
  };
}
