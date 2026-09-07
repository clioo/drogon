import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { EditorPane, scopedFileKey, type EditorScope } from "../editor/EditorPane";
import {
  WorkspaceExplorer,
  type WorkspaceExplorerDataSource,
  type WorkspaceFileNode,
} from "./WorkspaceExplorer";
import {
  FILES_CAPABILITY,
  MAX_DIRECTORY_ENTRIES,
  MAX_FILE_BYTES,
  type FileBridge,
  type FileScope,
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

/** What the panel should read right now: nothing while unavailable or closed. */
export function filesReadTarget(
  available: boolean,
  openPath: string | null,
): string | null {
  return available && openPath !== null ? openPath : null;
}

/** identity of one read for staleness gating. */
export interface FilesReadState {
  /** Scoped key this read belongs to; null = no read in effect. */
  key: string | null;
  phase: "idle" | "loading" | "ready" | "error";
  content: string | null;
  message: string;
}

/**
 * Content is only ever surfaced for an EXACT scope+path match: a read
 * keyed to a previous file (or scope) is null here, so a stale ready
 * result can never render as another file's content, not even for one
 * frame between the prop change and the read effect.
 */
export function readContentFor(
  read: FilesReadState,
  scope: EditorScope,
  path: string | null,
): string | null {
  if (path === null || read.key === null) return null;
  return read.key === scopedFileKey(scope, path) && read.phase === "ready"
    ? read.content
    : null;
}

/** Same identity gate for read failures. */
export function readErrorFor(
  read: FilesReadState,
  scope: EditorScope,
  path: string | null,
): string | null {
  if (path === null || read.key === null) return null;
  return read.key === scopedFileKey(scope, path) && read.phase === "error"
    ? read.message || "The file could not be read."
    : null;
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

/** Read pipeline with the same generation-fencing shape as the explorer's runLoad. */
export function runFilesRead(input: {
  bridge: FileBridge;
  scope: { hostId: string; workspaceId: string; path: string };
  maxBytes?: number;
  generation: number;
  isCurrent: () => boolean;
  onDone: (
    outcome: { ok: true; content: string } | { ok: false; message: string },
  ) => void;
}): Promise<void> {
  const { bridge, scope, maxBytes, generation, isCurrent, onDone } = input;
  return bridge.fileRead({ ...scope, maxBytes }).then(
    (result) => {
      if (!isCurrent()) return;
      if (result.ok) onDone({ ok: true, content: result.result.content });
      else onDone({ ok: false, message: result.error.message });
    },
    (failure: unknown) => {
      if (!isCurrent()) return;
      onDone({
        ok: false,
        message:
          failure instanceof Error
            ? failure.message
            : "The file could not be read.",
      });
    },
  );
}

/**
 * Per-mount request-id source for write requestId values. A NEW logical
 * save (different file or different payload) gets a fresh
 * crypto.randomUUID(); retrying an EXACT payload for the same file reuses
 * that payload's id, so the service can deduplicate the retry — tracked
 * per (scoped key, draft) pair, not just the last request, because a save
 * of another file in between must not orphan an earlier retry identity.
 * One instance per mounted panel — distinct mounts never share ids.
 */
export function createRequestIdSource(): {
  next(key: string, draft: string): string;
} {
  const issued = new Map<string, string>();
  return {
    next(key: string, draft: string): string {
      const existing = issued.get(`${key}\u0000${draft}`);
      if (existing !== undefined) return existing;
      const id = crypto.randomUUID();
      issued.set(`${key}\u0000${draft}`, id);
      return id;
    },
  };
}

/**
 * The save path: bridges fileWrite's Result onto the editor's Result<null>
 * and stamps every write with a requestId from the panel's per-mount
 * source (fresh per logical save, stable per retry of the same payload).
 * The editor wraps this in its fenced runSave (scoped key + generation),
 * so a stale completion can never mark the wrong file saved.
 */
export function makeFileSaver(
  bridge: FileBridge,
  scope: FileScope,
  nextRequestId: (draft: string) => string,
): (content: string) => Promise<Result<null>> {
  return async (content) => {
    const result = await bridge.fileWrite({
      ...scope,
      content,
      requestId: nextRequestId(content),
    });
    return result.ok ? { ok: true, result: null } : result;
  };
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

function FilesPanel({ bridge, ...props }: FilesPanelProps & { bridge: FileBridge }) {
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
  // Per-mount request-id identity: distinct mounts never share write ids.
  const requestIds = useMemo(() => createRequestIdSource(), []);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [selectedNode, setSelectedNode] = useState<FilesExplorerRow | null>(null);
  const [read, setRead] = useState<FilesReadState>({
    key: null,
    phase: "idle",
    content: null,
    message: "",
  });
  const [truncation, setTruncation] = useState<
    (FilesListingInfo & { scopeKey: string }) | null
  >(null);
  const readGeneration = useRef(0);
  // New scope (host/workspace change) => new source identity => the
  // explorer resets its cached children/expansion/selection. Truncation
  // reports are stamped with the scope so a stale notice can never render
  // after a scope switch.
  const scopeKey = `${scope.hostId}/${scope.workspaceId}`;
  const source = useMemo(
    () =>
      available
        ? createFilesSource(bridge, scope, (info) =>
            setTruncation({ ...info, scopeKey }),
          )
        : null,
    [available, bridge, scope, scopeKey],
  );

  useEffect(() => {
    // Cleanup runs on unmount AND on every scope/path/reload/availability
    // change: the bumped generation fences any in-flight read so a late
    // reply can never land after its read was superseded.
    const invalidate = () => {
      readGeneration.current += 1;
    };
    const target = filesReadTarget(available, openPath);
    if (target === null) {
      // Unavailable (or nothing open): no bridge.fileRead, ever.
      setRead({ key: null, phase: "idle", content: null, message: "" });
      return invalidate;
    }
    const generation = ++readGeneration.current;
    const key = scopedFileKey(scope, target);
    setRead({ key, phase: "loading", content: null, message: "" });
    void runFilesRead({
      bridge,
      scope: { ...scope, path: target },
      maxBytes: MAX_FILE_BYTES,
      generation,
      isCurrent: () => readGeneration.current === generation,
      onDone: (outcome) =>
        setRead(
          outcome.ok
            ? { key, phase: "ready", content: outcome.content, message: "" }
            : { key, phase: "error", content: null, message: outcome.message },
        ),
    });
    return invalidate;
  }, [available, bridge, scope, openPath, reloadTick]);

  if (!available) {
    // No capability, no panel: never a local fallback, never a silent empty.
    return <UnavailableFallback capability={FILES_CAPABILITY} />;
  }

  const openEntry = (node: WorkspaceFileNode) => {
    setSelectedNode(node as FilesExplorerRow);
    setOpenPath(node.path);
  };
  const reload = () => setReloadTick((tick) => tick + 1);
  const saveDraft = makeFileSaver(
    bridge,
    { ...scope, path: openPath ?? "" },
    (draft) => requestIds.next(scopedFileKey(scope, openPath ?? ""), draft),
  );

  const selectedIsSymlink = selectedNode?.symlink === true;
  const activeTruncation =
    truncation !== null && truncation.scopeKey === scopeKey && truncation.truncated
      ? truncation
      : null;
  return (
    <section className="files-panel" aria-label="Workspace files">
      <WorkspaceExplorer
        workspaceId={workspaceId}
        source={source}
        selectedPath={openPath ?? undefined}
        onSelect={openEntry}
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
          {selectedNode?.path}
        </p>
      )}
      <EditorPane
        scope={scope}
        path={openPath}
        content={readContentFor(read, scope, openPath)}
        readError={readErrorFor(read, scope, openPath)}
        onReload={reload}
        onSave={(content) => saveDraft(content)}
      />
    </section>
  );
}

/**
 * Factory for the files.explorer panel descriptor. The bridge is injected
 * once here and every render path (list/read/write) goes through it —
 * no Node/Electron APIs, no local fallbacks.
 */
export function createFilesPanelDescriptor(deps: {
  bridge: FileBridge;
}): FilesPanelDescriptor {
  return {
    id: FILES_ROUTE_ID,
    title: "Files",
    component: (props: FilesPanelProps) => (
      <FilesPanel {...props} bridge={deps.bridge} />
    ),
    capability: FILES_CAPABILITY,
  };
}
