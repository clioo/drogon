// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/panel/panel-content.tsx
// (scrolling surface composition), panel/commit-surface.tsx (commit surface
// placement), listing/uncommitted-sections, commit/commit-area,
// commit/discard-dialog, sync/compare-summary, sync/use-status-refresh and
// sync/use-upstream-status-fetch.
// Adapter: Orca's zustand store becomes local state over the existing
// git.* bridge; review/AI/notes/submodules/history-graph have no MVP
// backend and are not ported. R12-A: selecting a file now opens the
// source's Monaco DiffViewer (see diff/DiffViewer.tsx) instead of the
// plain-text unified-diff viewer; unified-diff.ts's parser stays as the
// SSR/Node-safe fallback (see `hasDom` below) since Monaco cannot run
// there.
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { X, ChevronDown, ChevronUp, Columns2, Rows2 } from "lucide-react";
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
import { getDiscardFailureToastCopy } from "./discard-failure-toast";
import { toGitDisplayError, toPrCreateDisplayError } from "./git-error-copy";
import { resolveCreatePrToolbarAction } from "./create-pr-action";
import { parseUnifiedDiff } from "./unified-diff";
import { cn } from "../../lib/utils";
import { reconstructDiffContent } from "./diff/diff-hunk-reconstruction";
import { DiffNavigationProvider, useDiffNavigation } from "./diff/diff-navigation-context";
import { useEditorScheme } from "../editor/editor-theme";

// Why lazy: `monaco-editor` assumes a browser global environment; ChangesPanel
// has no test today that renders it via `renderToString`, but this mirrors
// the same guard EditorPane.tsx uses so neither surface can accidentally
// evaluate Monaco under a non-browser test environment.
const DiffViewer = lazy(() =>
  import("./diff/DiffViewer").then((mod) => ({ default: mod.DiffViewer })),
);

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
      // #176: remote names from the daemon (`git remote`, never URLs).
      // Null means unknown (older daemon): the panel falls back to the
      // upstream-only states and never claims "No remote" it cannot prove.
      remotes: string[] | null;
    }
  | { phase: "error"; message: string };

type DiffLoad =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; diff: string; truncated: boolean }
  | { phase: "error"; message: string };

function errorMessage(value: Result<unknown>, fallback: string): string {
  if (value.ok) return "";
  // Raw daemon text (command echoes, exit-status wrappers) never reaches
  // the UI: it is logged inside toGitDisplayError (see #136).
  return toGitDisplayError(
    value.error.message || `Request failed (${value.error.code}).`,
    fallback,
  );
}

const mono: React.CSSProperties = { fontFamily: "var(--font-mono)" };
// Why a hoisted constant: a fresh `[]` per render re-armed the line-counts
// effect every pass — its `setCounts(new Map())` then re-rendered with a
// new Map, looping forever while the status load is not ready (or the
// bridge lacks gitLineCounts). A module-level empty array keeps the effect
// deps stable.
const EMPTY_STATUS_ENTRIES: GitStatusEntry[] = [];

function errorNotice(message: string): string {
  return message.startsWith("Error") ? message : `Error: ${message}`;
}

/** Diff header controls: change count + prev/next (Monaco's own diff nav) and the side-by-side toggle. Renders inside DiffNavigationProvider. */
function DiffNavToolbar({
  sideBySide,
  onToggleSideBySide,
}: {
  sideBySide: boolean;
  onToggleSideBySide: () => void;
}) {
  const { goToPreviousDiff, goToNextDiff, changeCount } = useDiffNavigation();
  return (
    <span className="shrink-0 flex items-center gap-1">
      {changeCount > 0 && (
        <>
          <span className="tabular-nums text-[10px] text-muted-foreground">
            {changeCount} {changeCount === 1 ? "change" : "changes"}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Previous change"
            onClick={goToPreviousDiff}
          >
            <ChevronUp className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Next change"
            onClick={goToNextDiff}
          >
            <ChevronDown className="size-3.5" />
          </Button>
        </>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6"
        aria-label={sideBySide ? "Switch to inline diff" : "Switch to side-by-side diff"}
        onClick={onToggleSideBySide}
      >
        {sideBySide ? <Rows2 className="size-3.5" /> : <Columns2 className="size-3.5" />}
      </Button>
    </span>
  );
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
  const [sideBySide, setSideBySide] = useState(true);
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
        setLoad({
          phase: "error",
          message: errorMessage(result, "Unable to load source control status."),
        });
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
        remotes: result.result.branch.remotes ?? null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, scope, revision]);

  const protocolEntries = load.phase === "ready" ? load.entries : EMPTY_STATUS_ENTRIES;

  useEffect(() => {
    if (!lineCountsAvailable || protocolEntries.length === 0) {
      // Why the size guard: setting a fresh Map on every pass changed state
      // identity each render and re-armed this effect — an infinite loop
      // (seen as a wedged panel with a daemon that has no line counts).
      setCounts((current) => (current.size === 0 ? current : new Map()));
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
      ? {
          head: load.head,
          upstream: load.upstream,
          ahead: load.ahead,
          behind: load.behind,
          oid: load.oid,
          remotes: load.remotes,
        }
      : { head: null, upstream: null, ahead: null, behind: null, oid: null, remotes: null };
  // #176: null (unknown daemon) never counts as no-remote.
  const hasRemote = branch.remotes === null ? null : branch.remotes.length > 0;

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
          setDiff({ phase: "error", message: errorMessage(result, "Unable to load the diff.") });
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
    async (
      kind: string,
      run: () => Promise<Result<unknown>>,
      failureToastTitle?: string,
      failureFallback = "Stage operation failed.",
    ) => {
      setBusy(kind);
      setNotice(null);
      try {
        const result = await run();
        if (!result.ok) {
          const message = errorMessage(result, failureFallback);
          setNotice(errorNotice(message));
          if (failureToastTitle) toast.error(failureToastTitle, { description: message });
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
    (paths: readonly string[], failureToastTitle?: string) =>
      mutate(
        "stage",
        () => bridge.gitStage({ ...scope, paths: [...paths] }),
        failureToastTitle,
        "Staging failed.",
      ),
    [bridge, mutate, scope],
  );
  const unstagePaths = useCallback(
    (paths: readonly string[], failureToastTitle?: string) =>
      mutate(
        "unstage",
        () => bridge.gitUnstage({ ...scope, paths: [...paths] }),
        failureToastTitle,
        "Unstaging failed.",
      ),
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
      let firstFailureMessage: string | undefined;
      try {
        const result = await runDiscardAllForArea(paths, untracked, {
          discardOne: async (path, isUntracked) => {
            const response = await bridge.gitDiscard!({
              ...scope,
              paths: [path],
              untracked: isUntracked,
            });
            if (!response.ok) throw new Error(errorMessage(response, "Discard failed."));
          },
          onError: (path, error) => {
            if (firstFailureMessage === undefined)
              firstFailureMessage =
                error instanceof Error ? error.message : undefined;
            setNotice((prev) =>
              prev
                ? prev
                : errorNotice(
                    error instanceof Error ? `${path}: ${error.message}` : `${path}: discard failed`,
                  ),
            );
          },
        });
        if (result.failed.length > 0) {
          const copy = getDiscardFailureToastCopy(result.failed, firstFailureMessage);
          toast.error(copy.title, { description: copy.description });
        }
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
          setNotice(errorNotice(errorMessage(fresh, "Unable to load source control status.")));
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
        setCommitError(errorMessage(result, "Commit failed."));
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
        setCommitError(errorMessage(result, "Commit failed."));
        return;
      }
      setCommitMessage("");
      setAmend(false);
      setSyncBusy("push");
      try {
        const push = await bridge.gitPush(scope);
        if (!push.ok) setRemoteError(errorMessage(push, "Push failed."));
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
      if (!result.ok) setRemoteError(errorMessage(result, "Push failed."));
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
      if (!result.ok) setRemoteError(errorMessage(result, "Pull failed."));
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
      if (!result.ok) setRemoteError(errorMessage(result, "Fetch failed."));
    } finally {
      setSyncBusy(null);
      setRevision((value) => value + 1);
    }
  }, [bridge, scope]);

  const doPrCreate = useCallback(async () => {
    // #176: without a remote `gh pr create` cannot succeed — the button is
    // disabled with the reason, and this guard keeps any other caller from
    // running gh anyway.
    if (hasRemote === false) return;
    setSyncBusy("pr");
    setPrNotice(null);
    try {
      const title =
        commitMessage.trim() ||
        (selection ? `Update ${selection.path}` : "Update");
      const result = await bridge.gitPrCreate({ ...scope, title });
      if (!result.ok) {
        // Raw `gh` stderr (argv echoes, exit-status wrappers) never reaches
        // the UI: it is logged inside toPrCreateDisplayError (see #176),
        // which keeps the fork's short copy while the raw text stays in
        // the console log (main's errorMessage only strips git internals).
        const message = toPrCreateDisplayError(
          result.error.message || `Request failed (${result.error.code}).`,
        );
        setPrNotice({ message: errorNotice(message), tone: "destructive" });
        return;
      }
      setPrUrl(result.result.url);
      setPrNotice({ message: `PR created: ${result.result.url}`, tone: "muted" });
    } finally {
      setSyncBusy(null);
      setRevision((value) => value + 1);
    }
  }, [bridge, commitMessage, hasRemote, scope, selection]);

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

  const createPrAction = useMemo(
    () =>
      resolveCreatePrToolbarAction({
        busy: busy !== null || syncBusy !== null,
        upstream: branch.upstream,
        ahead: branch.ahead,
        hasUncommitted: rows.length > 0,
        // #176: without a remote the action resolves disabled with the
        // no-remote reason, so `gh` never runs from the toolbar either.
        hasRemote,
      }),
    [busy, syncBusy, branch.upstream, branch.ahead, rows.length, hasRemote],
  );

  const openReviewPage = useCallback(() => {
    if (!prUrl || typeof window === "undefined") return;
    const shell = (
      window as unknown as {
        drogon?: { shell?: { openExternal?: (url: string) => unknown } };
      }
    ).drogon?.shell;
    if (typeof shell?.openExternal === "function") void shell.openExternal(prUrl);
  }, [prUrl]);

  const hasUncommitted = rows.length > 0;
  const showEmpty = !hasUncommitted && !filterState.normalizedFilter && !filterState.tooLarge;
  const noFilterMatch =
    hasUncommitted &&
    !filterState.tooLarge &&
    filterState.normalizedFilter !== "" &&
    displaySections.length === 0;

  const parsed = diff.phase === "ready" ? parseUnifiedDiff(diff.diff) : { hunks: [], truncated: false };
  const reconstructed =
    diff.phase === "ready"
      ? reconstructDiffContent(diff.diff)
      : { original: "", modified: "", hasContent: false, truncated: false };
  const hasDom = typeof document !== "undefined";
  const scheme = useEditorScheme();

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
        createPrAction={createPrAction}
        isCreatingPr={syncBusy === "pr"}
        onCreatePr={() => void doPrCreate()}
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
        reviewUrl={prUrl}
        onOpenReviewPage={openReviewPage}
      />
      <SyncRow
        upstream={branch.upstream}
        ahead={branch.ahead}
        behind={branch.behind}
        busyKind={syncBusy}
        actionsAvailable={{ pull: pullAvailable, fetch: fetchAvailable }}
        hasRemote={hasRemote}
        onPush={() => void doPush()}
        onPull={() => void doPull()}
        onFetch={() => void doFetch()}
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
            supportingText={`This workspace is clean and this branch has no changes ahead of ${branch.upstream ?? "base"}`}
          />
        )}
        {showEmpty && prNotice && (
          // Why here: the commit area (which owns prNotice) only renders with
          // uncommitted changes, so a failed Create PR from a clean branch —
          // the normal state for a fresh push — would fail silently (#176).
          <div
            role={prNotice.tone === "destructive" ? "alert" : "status"}
            aria-live="polite"
            className={cn(
              "px-3 pb-2 text-[11px]",
              prNotice.tone === "destructive" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            <span className="block break-words leading-4 [overflow-wrap:anywhere]">
              {prNotice.message}
            </span>
          </div>
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
          handleStageAllPaths={(paths) =>
            stagePaths(paths, "Bulk stage/unstage failed").then(() => {})
          }
          handleUnstagePaths={(paths) =>
            unstagePaths(paths, "Bulk stage/unstage failed").then(() => {})
          }
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
          <DiffNavigationProvider>
          <div
            aria-label="Unified diff"
            className="flex flex-col p-3 text-xs"
            style={{ ...mono, height: selection ? 420 : "auto" }}
          >
            {!selection && <p className="text-muted-foreground">Select a file to view its diff.</p>}
            {selection && (
              <div className="mb-2 flex shrink-0 items-center gap-2">
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
                {diff.phase === "ready" && reconstructed.hasContent && hasDom && (
                  <DiffNavToolbar
                    sideBySide={sideBySide}
                    onToggleSideBySide={() => setSideBySide((value) => !value)}
                  />
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
            {diff.phase === "ready" && !reconstructed.hasContent && (
              <p className="text-muted-foreground">
                No diff for this file (untracked files show no diff).
              </p>
            )}
            {diff.phase === "ready" && reconstructed.hasContent && (
              <div className="min-h-0 flex-1 overflow-hidden">
                {hasDom ? (
                  <Suspense
                    fallback={<div className="text-muted-foreground">Loading diff editor…</div>}
                  >
                    <DiffViewer
                      // Why a key: forces a remount per selected file so
                      // `onMount` re-registers with diff-navigation-context
                      // under the new file, mirroring EditorPane's Monaco
                      // remount-per-path (see MonacoFileEditor.tsx).
                      key={`${selection?.path}:${selection?.area}`}
                      path={selection?.path ?? ""}
                      original={reconstructed.original}
                      modified={reconstructed.modified}
                      scheme={scheme}
                      sideBySide={sideBySide}
                    />
                  </Suspense>
                ) : (
                  <div className="h-full overflow-auto">
                    {parsed.hunks.map((hunk, index) => (
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
                  </div>
                )}
              </div>
            )}
            {diff.phase === "ready" && (parsed.truncated || diff.truncated) && (
              <p role="status" className="shrink-0 text-muted-foreground">
                Diff truncated to the display budget.
              </p>
            )}
          </div>
          </DiffNavigationProvider>
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
