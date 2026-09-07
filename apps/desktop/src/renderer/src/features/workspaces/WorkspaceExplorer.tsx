import { useEffect, useReducer, useRef } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import type { Result } from "../../../../shared/session-contract";

/**
 * A workspace file entry as projected by the injected data source. `path`
 * is workspace-relative with "/" separators; `gitStatus` is the optional
 * git decoration badge (absent/null on folder rows, which show a folder
 * affordance instead).
 */
export interface WorkspaceFileNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  gitStatus?:
    | "modified"
    | "added"
    | "deleted"
    | "renamed"
    | "untracked"
    | "copied"
    | "ignored"
    | null;
}

/** The only backend surface the explorer may touch — injected, never imported. */
export interface WorkspaceExplorerDataSource {
  listDir(path: string): Promise<Result<WorkspaceFileNode[]>>;
}

export interface WorkspaceExplorerProps {
  /** The open workspace id; "" means no workspace is open (empty state). */
  workspaceId: string;
  source: WorkspaceExplorerDataSource | null;
  /** Controlled selection; omit to let the explorer track it internally. */
  selectedPath?: string;
  onSelect?(node: WorkspaceFileNode): void;
}

export interface ExplorerState {
  status: "idle" | "loading" | "ready" | "error";
  errorMessage: string;
  /** Loaded children per directory path; the root listing lives at "". */
  children: Readonly<Record<string, readonly WorkspaceFileNode[]>>;
  expanded: ReadonlySet<string>;
  selectedPath: string;
  /** Directories whose lazy listing is in flight. */
  pendingDirs: ReadonlySet<string>;
}

export type ExplorerAction =
  | { type: "workspace-changed" }
  | { type: "load-started" }
  | { type: "load-succeeded"; path: string; nodes: WorkspaceFileNode[] }
  | { type: "load-failed"; message: string }
  | { type: "dir-load-started"; path: string }
  | { type: "toggled"; path: string; isDirectory: boolean }
  | { type: "selected"; path: string };

export function initialExplorerState(): ExplorerState {
  return {
    status: "idle",
    errorMessage: "",
    children: {},
    expanded: new Set(),
    selectedPath: "",
    pendingDirs: new Set(),
  };
}

/** Pure expand/collapse over a set — the reducer delegates here. */
export function toggleExpanded(
  expanded: ReadonlySet<string>,
  path: string,
): Set<string> {
  const next = new Set(expanded);
  if (next.has(path)) {
    next.delete(path);
  } else {
    next.add(path);
  }
  return next;
}

/**
 * Cached state (children, expansion, selection) is per-workspace-scope:
 * a workspace/source switch resets ALL of it, because an identical
 * subdirectory path in a different workspace must never expose the
 * previous workspace's cached listing.
 */
export function applyExplorerAction(
  state: ExplorerState,
  action: ExplorerAction,
): ExplorerState {
  switch (action.type) {
    case "workspace-changed":
      return { ...initialExplorerState(), status: "loading" };
    case "load-started":
      return { ...state, status: "loading", errorMessage: "" };
    case "load-succeeded": {
      const children = { ...state.children, [action.path]: action.nodes };
      const pendingDirs = new Set(state.pendingDirs);
      pendingDirs.delete(action.path);
      return {
        ...state,
        status: action.path === "" ? "ready" : state.status,
        errorMessage: "",
        children,
        pendingDirs,
      };
    }
    case "load-failed":
      return { ...state, status: "error", errorMessage: action.message };
    case "dir-load-started":
      return {
        ...state,
        pendingDirs: new Set(state.pendingDirs).add(action.path),
      };
    case "toggled":
      if (!action.isDirectory) return state;
      return { ...state, expanded: toggleExpanded(state.expanded, action.path) };
    case "selected":
      return { ...state, selectedPath: action.path };
  }
}

/** Depth-first projection of the rows the user can currently see. */
export function visibleRows(
  state: ExplorerState,
  path = "",
): WorkspaceFileNode[] {
  const children = state.children[path] ?? [];
  const rows: WorkspaceFileNode[] = [];
  for (const node of children) {
    rows.push(node);
    if (node.kind === "directory" && state.expanded.has(node.path)) {
      rows.push(...visibleRows(state, node.path));
    }
  }
  return rows;
}

export type ExplorerDispatch = (action: ExplorerAction) => void;

/**
 * One directory-listing pipeline shared by root and lazy loads, exported
 * so tests can drive it with deferred fakes. `isCurrent` is the generation
 * guard: a reply from a superseded load (workspace switch, retry race,
 * unmount) is dropped BEFORE it reaches the reducer, so a late reply can
 * never write another workspace's children into the cache. A rejected
 * listing promise is surfaced as `load-failed` — never an unhandled
 * rejection. The returned promise always resolves.
 */
export function runLoad(
  path: string,
  source: WorkspaceExplorerDataSource,
  isCurrent: () => boolean,
  dispatch: ExplorerDispatch,
): Promise<void> {
  return source.listDir(path).then(
    (result) => {
      if (!isCurrent()) return;
      if (result.ok) {
        dispatch({ type: "load-succeeded", path, nodes: result.result });
      } else {
        dispatch({ type: "load-failed", message: result.error.message });
      }
    },
    (failure: unknown) => {
      if (!isCurrent()) return;
      dispatch({
        type: "load-failed",
        message:
          failure instanceof Error
            ? failure.message
            : "The directory listing could not be read.",
      });
    },
  );
}

const GIT_BADGE_LABELS: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  copied: "C",
  untracked: "U",
  ignored: "!",
};

function depthOf(path: string): number {
  return path.split("/").filter(Boolean).length - 1;
}

function TreeRow({
  node,
  state,
  selected,
  onSelectRow,
  onToggle,
}: {
  node: WorkspaceFileNode;
  state: ExplorerState;
  selected: boolean;
  onSelectRow(node: WorkspaceFileNode): void;
  onToggle(node: WorkspaceFileNode & { kind: "directory" }): void;
}) {
  const expanded = state.expanded.has(node.path);
  const pending = node.kind === "directory" && state.pendingDirs.has(node.path);
  const badge = node.gitStatus ? GIT_BADGE_LABELS[node.gitStatus] : "";
  return (
    <button
      type="button"
      role="treeitem"
      aria-selected={node.kind === "file" ? selected : undefined}
      aria-expanded={node.kind === "directory" ? expanded : undefined}
      aria-level={depthOf(node.path) + 1}
      data-path={node.path}
      data-current={selected || undefined}
      className="workspace-explorer-row"
      style={{ paddingInlineStart: `${depthOf(node.path) * 12 + 8}px` }}
      onClick={() =>
        node.kind === "directory"
          ? onToggle(node as WorkspaceFileNode & { kind: "directory" })
          : onSelectRow(node)
      }
    >
      {node.kind === "directory" ? (
        <>
          {expanded ? (
            <ChevronDown size={14} aria-hidden />
          ) : (
            <ChevronRight size={14} aria-hidden />
          )}
          {expanded ? (
            <FolderOpen size={16} aria-hidden />
          ) : (
            <Folder size={16} aria-hidden />
          )}
        </>
      ) : (
        <>
          <span className="workspace-explorer-chevron-spacer" aria-hidden />
          <File size={16} aria-hidden />
        </>
      )}
      <span className="workspace-explorer-name">{node.name}</span>
      {pending ? (
        <span className="workspace-explorer-badge" aria-label="Loading">
          …
        </span>
      ) : (
        badge && (
          <span
            className="workspace-explorer-badge"
            data-git-status={node.gitStatus}
          >
            {badge}
          </span>
        )
      )}
    </button>
  );
}

export function WorkspaceExplorer({
  workspaceId,
  source,
  selectedPath,
  onSelect,
}: WorkspaceExplorerProps) {
  const [state, dispatch] = useReducer(
    applyExplorerAction,
    undefined,
    initialExplorerState,
  );
  const generation = useRef(0);
  // Every scope entry (workspaceId/source change, retry, unmount) bumps the
  // generation; replies from superseded loads are dropped before dispatch,
  // matching the late-response guard convention used across the app shell.
  const load = (path: string, trackGeneration: boolean) => {
    if (!source) return;
    const current = trackGeneration ? ++generation.current : generation.current;
    void runLoad(path, source, () => generation.current === current, dispatch);
  };
  useEffect(() => {
    generation.current++;
    // Reset cached children/expansion/selection: they belonged to the
    // previous workspace scope and must never leak into this one.
    dispatch({ type: "workspace-changed" });
    if (!workspaceId || !source) {
      dispatch({ type: "load-succeeded", path: "", nodes: [] });
      return () => {
        generation.current++;
      };
    }
    load("", true);
    return () => {
      generation.current++;
    };
  }, [workspaceId, source]);

  const loadDir = (dir: WorkspaceFileNode & { kind: "directory" }) => {
    const expanding = !state.expanded.has(dir.path);
    dispatch({ type: "toggled", path: dir.path, isDirectory: true });
    // The children cache is per-scope (reset on every workspace/source
    // change), so a cache hit here is always this workspace's listing.
    if (!expanding || state.children[dir.path]) return;
    dispatch({ type: "dir-load-started", path: dir.path });
    load(dir.path, false);
  };
  const retry = () => load("", true);

  const effectiveSelected = selectedPath ?? state.selectedPath;
  if (!workspaceId) {
    return (
      <div className="workspace-explorer" role="tree" aria-label="Workspace files">
        <div className="empty-state">
          <Folder size={32} aria-hidden />
          <h1>No workspace open</h1>
          <p>Choose a folder or repository to browse its files.</p>
        </div>
      </div>
    );
  }
  if (state.status !== "ready") {
    if (state.status === "error") {
      return (
        <div className="workspace-explorer" role="tree" aria-label="Workspace files">
          <div className="error-banner" role="alert">
            <span>{state.errorMessage}</span>
            <Button variant="outline" size="sm" onClick={retry}>
              <RefreshCw aria-hidden /> Retry
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div
        className="workspace-explorer"
        role="tree"
        aria-label="Workspace files"
        aria-busy="true"
      >
        <p className="sidebar-empty">Loading workspace files…</p>
      </div>
    );
  }
  const rows = visibleRows(state);
  return (
    <div className="workspace-explorer" role="tree" aria-label="Workspace files">
      {rows.length ? (
        rows.map((node) => (
          <TreeRow
            key={node.path}
            node={node}
            state={state}
            selected={effectiveSelected === node.path}
            onSelectRow={(node_) => {
              dispatch({ type: "selected", path: node_.path });
              onSelect?.(node_);
            }}
            onToggle={loadDir}
          />
        ))
      ) : (
        <p className="sidebar-empty">This workspace has no files.</p>
      )}
    </div>
  );
}
