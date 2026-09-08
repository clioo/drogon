import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  FileExplorer,
  depthOf,
  subscribeWorkspaceFilesChanged,
  type ExplorerNode,
  type FileExplorerDataSource,
} from "../file-explorer";
import {
  type WorkspaceExplorerDataSource,
  type WorkspaceFileNode,
} from "./WorkspaceExplorer";
import { requestTerminalFileOpen } from "../terminal/terminal-file-link";
import {
  FILES_CAPABILITY,
  MAX_DIRECTORY_ENTRIES,
  type FileBridge,
  type WorkspaceFileEntry,
} from "../../../../shared/file-contract";
import type { Result, Session, Status, Workspace } from "../../../../shared/session-contract";

/**
 * FILES_ROUTE_ID — the route id this factory registers under. Intentionally
 * the plain string form: V2 mints the branded RouteId at registration.
 */
export const FILES_ROUTE_ID = "files.explorer";

/*
 * FilesPanelProps / FilesPanelDescriptor are INTENTIONALLY SHAPE-IDENTICAL
 * to V2's PanelProps / PanelDescriptor in
 *   commit 625544e — apps/desktop/src/renderer/src/route-panel-contract.ts
 * (read-only reference; that file is NOT in this worktree and must not be
 * imported or copied). Differences are deliberate and type-level only:
 * `routeId`/`id`/focus callback ids are plain `string` here (V2's RouteId
 * is a branded string, a subtype, so V2 consumers remain compatible), and
 * V2 verifies the structural match at mount since this tree cannot import
 * the contract. Do not add fields here without mirroring them in V2.
 */
export interface FilesPanelProps {
  routeId: string;
  /** Null when no terminal session backs this mount; files never need one. */
  session: Session | null;
  workspace: Workspace;
  status: Status;
  restoreState?: unknown;
  focusTarget: HTMLElement | null;
}

export interface FilesPanelDescriptor {
  id: string;
  title: string;
  component: (props: FilesPanelProps) => ReactNode;
  /** Service capability gate (Status.capabilities). */
  capability: string;
  restoreState?: unknown;
  onFocus?: (routeId: string) => void;
  onCleanup?: (routeId: string) => void;
}

/** Pure capability gate: does the service expose the files contract? */
export function isFilesAvailable(capabilities: readonly string[]): boolean {
  return capabilities.includes(FILES_CAPABILITY);
}

/**
 * A row model for the files panel: the explorer's node plus a symlink
 * marker. WorkspaceExplorer (committed, outside this task's edit scope)
 * renders no symlink badge of its own, so the factory preserves the
 * distinction here — the marker travels with the node object through the
 * explorer's state and `onSelect`, and the panel renders the distinct
 * symlink badge for the selected row. It is never silently flattened into
 * a plain file.
 */
export type FilesExplorerRow = WorkspaceFileNode & { readonly symlink?: true };

/** Workspace-root listings are addressed as "." on the wire. */
export function joinEntryPath(parentPath: string, name: string): string {
  if (parentPath === "" || parentPath === ".") return name;
  return parentPath.endsWith("/") ? parentPath + name : `${parentPath}/${name}`;
}

/** Map a service entry onto the explorer's row model; symlinks keep their marker. */
export function entryToNode(
  entry: WorkspaceFileEntry,
  parentPath: string,
): FilesExplorerRow {
  const path = joinEntryPath(parentPath, entry.name);
  if (entry.kind === "directory") {
    return { name: entry.name, path, kind: "directory" };
  }
  return entry.kind === "symlink"
    ? { name: entry.name, path, kind: "file", symlink: true }
    : { name: entry.name, path, kind: "file" };
}

/**
 * Quick-open reveal request from the command palette: the workspace file
 * to open plus a nonce so re-opening the same path still applies. The
 * workspaceId gates application — a request for another workspace is
 * inert here, never opened under the wrong scope.
 */
export interface FileOpenRequest {
  workspaceId: string;
  path: string;
  nonce: number;
}

/**
 * Stable mutable cell carrying the latest reveal request. A cell (not a
 * prop value) because the panel descriptor is registered once per mount
 * lifetime: re-registering on every quick-open would remount the panel
 * (dropping its tree expansion/scroll state). App bumps its own state to
 * re-render after writing the cell; the panel applies the newest nonce.
 */
export interface FileOpenRequestCell {
  current: FileOpenRequest | null;
}

/** True when the request targets this workspace and was not applied yet. */
export function shouldApplyOpenRequest(
  request: FileOpenRequest | null,
  workspaceId: string,
  appliedNonce: number | null,
): boolean {
  return (
    request !== null &&
    request.workspaceId === workspaceId &&
    request.nonce !== appliedNonce
  );
}

/** The open file, stamped with the scope it was opened under. */
export interface FilesOpenEntry {
  scopeKey: string;
  path: string;
}

/** Frame-safe: a selection from another scope never renders, not even one frame. */
export function activeSelection<T extends { scopeKey: string }>(
  selection: T | null,
  scopeKey: string,
): T | null {
  return selection !== null && selection.scopeKey === scopeKey ? selection : null;
}

/** Frame-safe: an open path from another scope is inert in the new scope. */
export function activeOpenPath(
  open: FilesOpenEntry | null,
  scopeKey: string,
): string | null {
  return open !== null && open.scopeKey === scopeKey ? open.path : null;
}

export interface FilesListingInfo {
  /** Directory the listing belongs to ("." = workspace root). */
  path: string;
  truncated: boolean;
  /** Number of entries actually returned. */
  count: number;
}

/** Explicit notice text for a truncated listing — truncation is never silent. */
export function truncationNoticeText(path: string, count: number): string {
  return `Directory listing for ${path === "." ? "the workspace root" : path} was truncated at ${count} entries (service limit reached); entries may be missing.`;
}

/**
 * The explorer data source over the injected bridge, scoped to one
 * host+workspace. A new scope produces a NEW source identity, which is
 * what resets the explorer's per-scope cache (stale-cache fix). Listings
 * always carry the service's MAX_DIRECTORY_ENTRIES cap, and truncation is
 * reported through `onListing` instead of being silently dropped.
 */
export function createFilesSource(
  bridge: FileBridge,
  scope: { hostId: string; workspaceId: string },
  onListing?: (info: FilesListingInfo) => void,
): WorkspaceExplorerDataSource {
  return {
    listDir: (dirPath) =>
      bridge
        .fileList({
          ...scope,
          path: dirPath === "" ? "." : dirPath,
          limitEntries: MAX_DIRECTORY_ENTRIES,
        })
        .then((result): Result<WorkspaceFileNode[]> => {
          if (!result.ok) return result;
          const parentPath = result.result.path;
          onListing?.({
            path: parentPath,
            truncated: result.result.truncated,
            count: result.result.entries.length,
          });
          return {
            ok: true,
            result: result.result.entries.map((entry) =>
              entryToNode(entry, parentPath),
            ),
          };
        }),
  };
}

/**
 * The explorer data source over the injected bridge: listings map onto the
 * explorer's row model (symlinks keep file kind with a link marker, exactly
 * like `entryToNode`), truncation reports through `onListing`, and the
 * mutations fail closed when the bridge predates the daemon's
 * files.create/rename/delete dispatch (the explorer disables the UI in
 * that case; this is the second gate, never a local fallback).
 */
export function createExplorerSource(
  bridge: FileBridge,
  scope: { hostId: string; workspaceId: string },
  onListing?: (info: FilesListingInfo) => void,
): FileExplorerDataSource {
  // Mutations stay INTERACTIVE even when the bridge predates the
  // daemon's files.create/rename/delete dispatch: the call below fails
  // closed with an explicit `unsupported_capability` error that the
  // explorer surfaces (inline status / delete dialog), never a local
  // fallback and never a silent no-op. There is deliberately no
  // method-sniffing here — the UI shape is stable with old and new
  // daemons alike.
  const unsupported = (method: string) =>
    Promise.resolve({
      ok: false as const,
      error: {
        code: "unsupported_capability",
        message: `File changes need a newer daemon with ${method} support.`,
        retryable: false,
      },
    });
  return {
    listDir: (dirPath, includeHidden) =>
      bridge
        .fileList({
          ...scope,
          path: dirPath === "" ? "." : dirPath,
          limitEntries: MAX_DIRECTORY_ENTRIES,
          includeHidden,
        })
        .then((result): Result<ExplorerNode[]> => {
          if (!result.ok) return result;
          const parentPath = result.result.path;
          onListing?.({
            path: parentPath,
            truncated: result.result.truncated,
            count: result.result.entries.length,
          });
          return {
            ok: true,
            result: result.result.entries.map((entry) => {
              const path = joinEntryPath(parentPath, entry.name);
              return {
                name: entry.name,
                path,
                isDirectory: entry.kind === "directory",
                ...(entry.kind === "symlink" ? { isSymlink: true as const } : {}),
                depth: depthOf(path),
              };
            }),
          };
        }),
    create: (parentDir, name, kind) =>
      bridge.fileCreate
        ? bridge
            .fileCreate({ ...scope, path: joinEntryPath(parentDir, name), kind })
            .then((result): Result<null> => (result.ok ? { ok: true, result: null } : result))
        : unsupported("files.create"),
    rename: (from, to) =>
      bridge.fileRename
        ? bridge
            .fileRename({ ...scope, from, to })
            .then((result): Result<null> => (result.ok ? { ok: true, result: null } : result))
        : unsupported("files.rename"),
    remove: (paths) =>
      bridge.fileDelete
        ? bridge
            .fileDelete({ ...scope, paths })
            .then((result): Result<null> => (result.ok ? { ok: true, result: null } : result))
        : unsupported("files.delete"),
    // Live external ticks (R16-L #157): the explorer reloads its loaded
    // directories on each tick and defers while an inline edit is open.
    subscribeFilesChanged: (listener) =>
      subscribeWorkspaceFilesChanged(scope.workspaceId, listener),
  };
}

/** True when the open editor path survived a deletion batch. */
export function openPathSurvivesDeletion(openPath: string | null, deleted: readonly string[]): boolean {
  if (openPath === null) return true;
  return !deleted.some(
    (removed) => openPath === removed || openPath.startsWith(`${removed}/`),
  );
}

function UnavailableFallback({ capability }: { capability: string }) {
  return (
    <div className="files-panel files-panel-unavailable" role="alert">
      <h1>Files unavailable</h1>
      <p>
        This service does not expose the <code>{capability}</code>{" "}
        capability, so file browsing is unavailable here. Nothing was opened
        locally.
      </p>
    </div>
  );
}

function FilesPanel({
  bridge,
  openRequestCell,
  ...props
}: FilesPanelProps & {
  bridge: FileBridge;
  openRequestCell?: FileOpenRequestCell;
}) {
  const { workspace, status } = props;
  // Files panels never need a terminal session: `session` is deliberately
  // ignored (fully supported as null) and never gates any call here.
  const available = isFilesAvailable(status.capabilities);
  const hostId = workspace.hostId || status.hostId;
  const workspaceId = workspace.id;
  const scope = useMemo(
    () => ({ hostId, workspaceId }),
    [hostId, workspaceId],
  );
  // Scope identity precedes state: the open-state seed below stamps it.
  const scopeKey = `${scope.hostId}/${scope.workspaceId}`;
  // `open`/`selection` are TREE-ONLY concerns here (R16-A): they drive the
  // explorer's active-row highlight and the symlink badge. The actual file
  // content/editor now lives in the main tab group's EditorHost
  // (features/editor/EditorHost.tsx); this panel never reads or writes
  // file content.
  //
  // Quick-open reveal seeds the same state: a request already in the cell
  // at mount opens immediately (SSR-safe: no effects needed), later ones
  // apply through the effect below. Requests for another workspace are
  // never seeded here.
  const [open, setOpen] = useState<FilesOpenEntry | null>(() => {
    const pending = openRequestCell?.current;
    if (
      pending &&
      pending.workspaceId === workspaceId &&
      pending.path.trim() !== ""
    )
      return { scopeKey, path: pending.path };
    return null;
  });
  const [appliedNonce, setAppliedNonce] = useState<number | null>(
    () => openRequestCell?.current?.nonce ?? null,
  );
  const [selection, setSelection] = useState<{
    node: FilesExplorerRow;
    scopeKey: string;
  } | null>(null);
  const [truncation, setTruncation] = useState<
    (FilesListingInfo & { scopeKey: string }) | null
  >(null);
  // New scope (host/workspace change) => new source identity => the
  // explorer resets its cached children/expansion/selection. Truncation
  // reports are stamped with the scope so a stale notice can never render
  // after a scope switch. (`createFilesSource` stays exported for the
  // legacy WorkspaceExplorer contract and its tests; the mounted tree
  // below reads only the richer explorer source.)
  const explorerSource = useMemo(
    () =>
      available
        ? createExplorerSource(bridge, scope, (info) =>
            setTruncation({ ...info, scopeKey }),
          )
        : null,
    [available, bridge, scope, scopeKey],
  );

  // Scope-gated selection/open: on a scope switch the previous workspace's
  // selection is dropped outright (the render-time gates below already make
  // it inert for the transitional frame).
  useEffect(() => {
    setOpen((current) => (current !== null && current.scopeKey !== scopeKey ? null : current));
    setSelection((current) => (current !== null && current.scopeKey !== scopeKey ? null : current));
  }, [scopeKey]);

  // Quick-open reveal: applies the newest cell request for THIS workspace
  // (nonce-keyed so repeats apply, scope-gated so foreign requests never
  // open here). Selection mirrors the open so the explorer highlights it.
  useEffect(() => {
    if (!available) return;
    const pending = openRequestCell?.current ?? null;
    if (!shouldApplyOpenRequest(pending, workspaceId, appliedNonce)) return;
    const request = pending as FileOpenRequest;
    if (request.path.trim() === "") return;
    setAppliedNonce(request.nonce);
    setOpen({ scopeKey, path: request.path });
    const name = request.path.split("/").pop() ?? request.path;
    setSelection({
      node: { name, path: request.path, kind: "file" },
      scopeKey,
    });
  }, [available, workspaceId, scopeKey, appliedNonce, openRequestCell]);

  if (!available) {
    // No capability, no panel: never a local fallback, never a silent empty.
    return <UnavailableFallback capability={FILES_CAPABILITY} />;
  }

  const openEntry = (node: ExplorerNode) => {
    // The explorer calls back for files only; the row keeps the symlink
    // marker so the panel can still render its distinct badge.
    const row: FilesExplorerRow = {
      name: node.name,
      path: node.path,
      kind: node.isDirectory ? "directory" : "file",
      ...(node.isSymlink ? { symlink: true as const } : {}),
    };
    setSelection({ node: row, scopeKey });
    setOpen({ scopeKey, path: node.path });
    if (node.isDirectory) return;
    // Routes through the same window event the terminal file-link popover
    // and quick-open use (App owns tab routing, not this panel): the shell
    // opens/reuses a main tab-group editor tab for this path (#133).
    requestTerminalFileOpen({
      path: node.path,
      line: null,
      column: null,
      workspaceId,
      openWithSystemDefault: false,
    });
  };
  // A confirmed deletion clears the tree's highlighted/selected row when
  // its file (or folder) is gone; the App-owned editor tab for a deleted
  // path is closed by App's own deletion handling, not here.
  const closeDeletedPaths = (deleted: readonly string[]) => {
    setOpen((current) => {
      if (current === null || current.scopeKey !== scopeKey) return current;
      return openPathSurvivesDeletion(current.path, deleted) ? current : null;
    });
    setSelection((current) => {
      if (current === null || current.scopeKey !== scopeKey) return current;
      return openPathSurvivesDeletion(current.node.path, deleted) ? current : null;
    });
  };
  // Open in Terminal goes through the existing session bridge: session
  // start spans a shell at the workspace root (it takes no cwd), so the
  // row's directory is noted in the call site only for future routing.
  const openTerminalAt = (_cwd: string) => {
    void window.drogon
      .start(workspaceId)
      .catch(() => undefined);
  };
  // Frame-safe derived values: a selection/open path from another scope is
  // inert in this scope, so it can never render or be written here.
  const effectiveOpenPath = activeOpenPath(open, scopeKey);
  const activeSelected = activeSelection(selection, scopeKey);
  const selectedIsSymlink = activeSelected?.node.symlink === true;
  const activeTruncation =
    truncation !== null && truncation.scopeKey === scopeKey && truncation.truncated
      ? truncation
      : null;
  // Why a plain div, not a labelled section: the source explorer panel is
  // flat (no wrapping region), and the route host already announces the
  // "Files" region — a second "Workspace files" region nests regions the
  // source does not have (R16-D #137). The editor region below stays
  // R16-A's to move.
  return (
    <div className="files-panel">
      <FileExplorer
        workspaceId={workspaceId}
        workspaceName={workspace.name}
        source={explorerSource}
        activePath={effectiveOpenPath}
        onSelect={openEntry}
        onOpenTerminal={openTerminalAt}
        onDeleted={closeDeletedPaths}
      />
      {activeTruncation && (
        <p className="files-panel-truncated" role="status">
          {truncationNoticeText(activeTruncation.path, activeTruncation.count)}
        </p>
      )}
      {selectedIsSymlink && (
        <p className="files-panel-selection" role="status">
          <span className="files-panel-symlink-badge" data-badge="symlink">
            symlink
          </span>{" "}
          {activeSelected?.node.path}
        </p>
      )}
    </div>
  );
}

/**
 * Factory for the files.explorer panel descriptor: the tree only (R16-A;
 * the embedded editor moved to the main tab group's EditorHost, whose
 * drafts/request-id stores are owned by that host instead). The bridge is
 * injected once here and every render path (list/mutate) goes through it —
 * no Node/Electron APIs, no local fallbacks.
 */
export function createFilesPanelDescriptor(deps: {
  bridge: FileBridge;
  openRequestCell?: FileOpenRequestCell;
}): FilesPanelDescriptor {
  return {
    id: FILES_ROUTE_ID,
    title: "Files",
    component: (props: FilesPanelProps) => (
      <FilesPanel
        {...props}
        bridge={deps.bridge}
        openRequestCell={deps.openRequestCell}
      />
    ),
    capability: FILES_CAPABILITY,
  };
}
