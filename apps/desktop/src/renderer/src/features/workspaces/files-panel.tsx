import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { EditorPane, scopedFileKey, type EditorScope } from "../editor/EditorPane";
import {
  WorkspaceExplorer,
  type WorkspaceExplorerDataSource,
  type WorkspaceFileNode,
} from "./WorkspaceExplorer";
import {
  createFilesDraftStore,
  type FilesDraftStore,
} from "./files-draft-store";
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
 * lifetime: re-registering on every quick-open would remount every panel
 * and drop descriptor-lifetime draft stores. App bumps its own state to
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

/** identity of one read for staleness gating. */
export interface FilesReadState {
  /** Scoped key this read belongs to; null = no read in effect. */
  key: string | null;
  phase: "idle" | "loading" | "ready" | "error";
  content: string | null;
  message: string;
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

/** Bounded retained-retry memory PER FILE for a mounted panel. */
export const MAX_RETAINED_REQUEST_IDS = 64;

/** Fail-closed signal: the cap was hit while an unresolved retry was retained. */
export class FilesRequestIdCapError extends Error {
  override readonly name = "FilesRequestIdCapError";
  constructor(readonly cap: number) {
    super(
      `Unresolved retry ids for this file reached the retained cap of ${cap}; refusing to mint a new logical attempt id (fail-closed, never silent).`,
    );
  }
}

export interface RequestIdSource {
  /** The id for this (file, payload): retained while unresolved and unsuperseded. */
  next(key: string, draft: string): string;
  /** Retire ids after a CONFIRMED success of this payload — and supersede every older attempt for the file. */
  settle(key: string, draft: string): void;
}

/**
 * Per-mount request-id source with PER-FILE GENERATION RETIRE, per LOGICAL
 * ATTEMPT:
 * - An unresolved attempt keeps its id so an exact-payload retry reuses it
 *   — but ONLY while no intervening write to that file was confirmed
 *   successful. Once ANY later payload for the same file succeeds, every
 *   attempt minted before that success is superseded: A-after-B mints a
 *   FRESH id (a new logical write against the disk B just changed).
 * - Attempts minted AFTER a success are retryable until the next success.
 * - Distinct files keep fully independent retries (per-file success
 *   sequence).
 * - Retention is bounded PER FILE and fails CLOSED: at the cap, a valid
 *   unresolved retry is still returned, but a genuinely new attempt throws
 *   FilesRequestIdCapError instead of silently minting or evicting. One
 *   instance per mounted panel — distinct mounts never share ids.
 */
export function createRequestIdSource(options?: {
  maxRetained?: number;
}): RequestIdSource {
  const cap = options?.maxRetained ?? MAX_RETAINED_REQUEST_IDS;
  let sequence = 0;
  const files = new Map<
    string,
    { byDraft: Map<string, { id: string; seq: number }>; successSeq: number }
  >();
  const fileFor = (key: string) => {
    let file = files.get(key);
    if (file === undefined) {
      file = { byDraft: new Map(), successSeq: 0 };
      files.set(key, file);
    }
    return file;
  };
  return {
    next(key: string, draft: string): string {
      const file = fileFor(key);
      const existing = file.byDraft.get(draft);
      // Valid unresolved retry: minted after the file's last confirmed write.
      if (existing !== undefined && existing.seq > file.successSeq) {
        return existing.id;
      }
      // A new (or superseded) attempt: replacing a superseded entry is 1:1,
      // so only genuinely new drafts can hit the cap — and then we refuse.
      if (existing !== undefined) file.byDraft.delete(draft);
      if (file.byDraft.size >= cap) {
        throw new FilesRequestIdCapError(cap);
      }
      const id = crypto.randomUUID();
      file.byDraft.set(draft, { id, seq: ++sequence });
      return id;
    },
    settle(key: string, draft: string): void {
      const file = files.get(key);
      if (file === undefined) return;
      file.byDraft.delete(draft);
      // This confirmed write supersedes every attempt minted before it.
      file.successSeq = sequence;
      // SAFE PRUNE: drop only superseded-now-safe attempts (minted before
      // this success); a valid retry minted AFTER the previous success is
      // never pruned, so the cap cannot stay full after a success.
      for (const [payload, attempt] of file.byDraft) {
        if (attempt.seq <= file.successSeq) file.byDraft.delete(payload);
      }
      if (file.byDraft.size === 0) files.delete(key);
    },
  };
}

/**
 * The save path: bridges fileWrite's Result onto the editor's Result<null>.
 * The requestId comes from the panel's per-mount source (stable while the
 * attempt is unresolved, retired on confirmed success); a success SETTLES
 * the id. The editor wraps this in its fenced runSave (scoped key +
 * generation), so a stale completion can never mark the wrong file saved.
 */
export function makeFileSaver(
  bridge: FileBridge,
  scope: FileScope,
  ids: RequestIdSource,
  fileKey: string,
): (content: string) => Promise<Result<null>> {
  return async (content) => {
    const requestId = ids.next(fileKey, content);
    const result = await bridge.fileWrite({
      ...scope,
      content,
      requestId,
    });
    if (result.ok) ids.settle(fileKey, content);
    return result.ok ? { ok: true, result: null } : result;
  };
}

// Absorbs the derived promise's rejection so it never becomes unhandled;
// the ORIGINAL promise still delivers the failure to runSave.
export function observeSaveResult(
  result: Promise<Result<null>>,
  drafts: FilesDraftStore,
  scope: EditorScope,
  path: string,
  content: string,
): void {
  void result.then(
    (outcome) => {
      if (outcome.ok) drafts.markSaved(scope, path, content);
    },
    () => {
      // Rejection observed and handled: the failure is reported by
      // runSave; nothing to mark saved.
    },
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
  drafts,
  requestIds,
  openRequestCell,
  ...props
}: FilesPanelProps & {
  bridge: FileBridge;
  drafts: FilesDraftStore;
  requestIds: RequestIdSource;
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
  // Request-id identity lives at DESCRIPTOR lifetime (injected from the
  // factory), not per mount: an unresolved retry keeps its id across
  // unmount/remount while the draft store claims persistence.
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
  const [reloadTick, setReloadTick] = useState(0);
  const [selection, setSelection] = useState<{
    node: FilesExplorerRow;
    scopeKey: string;
  } | null>(null);
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
  const source = useMemo(
    () =>
      available
        ? createFilesSource(bridge, scope, (info) =>
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

  useEffect(() => {
    // Cleanup runs on unmount AND on every scope/path/reload/availability
    // change: the bumped generation fences any in-flight read so a late
    // reply can never land after its read was superseded.
    const invalidate = () => {
      readGeneration.current += 1;
    };
    const target = filesReadTarget(available, activeOpenPath(open, scopeKey));
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
      onDone: (outcome) => {
        setRead(
          outcome.ok
            ? { key, phase: "ready", content: outcome.content, message: "" }
            : { key, phase: "error", content: null, message: outcome.message },
        );
        // Consult-on-mount: a confirmed read seeds the store's saved
        // baseline; the editor reducer keeps any dirty retained draft.
        if (outcome.ok) drafts.confirmRead(scope, target, outcome.content);
      },
    });
    return invalidate;
  }, [available, bridge, scope, open, reloadTick, drafts]);

  if (!available) {
    // No capability, no panel: never a local fallback, never a silent empty.
    return <UnavailableFallback capability={FILES_CAPABILITY} />;
  }

  const openEntry = (node: WorkspaceFileNode) => {
    setSelection({ node: node as FilesExplorerRow, scopeKey });
    setOpen({ scopeKey, path: node.path });
  };
  const reload = () => setReloadTick((tick) => tick + 1);
  // Frame-safe derived values: a selection/open path from another scope is
  // inert in this scope, so it can never render or be written here.
  const effectiveOpenPath = activeOpenPath(open, scopeKey);
  const activeSelected = activeSelection(selection, scopeKey);
  const saveDraft = makeFileSaver(
    bridge,
    { ...scope, path: effectiveOpenPath ?? "" },
    requestIds,
    scopedFileKey(scope, effectiveOpenPath ?? ""),
  );

  const selectedIsSymlink = activeSelected?.node.symlink === true;
  // Draft-prop truthfulness: a dirty retained draft is handed to the editor
  // as an explicit restoredDraft (draft + its retained lastSaved), so it
  // presents DIRTY from the first paint; the content prop meanwhile carries
  // the best-known SAVED baseline (store-confirmed, else the service read) —
  // never the draft masquerading as saved. The service stays saved-truth.
  const openDirty =
    effectiveOpenPath !== null && drafts.isDirty(scope, effectiveOpenPath);
  const restoredDraft =
    effectiveOpenPath !== null && openDirty
      ? {
          draft: drafts.draftOf(scope, effectiveOpenPath) ?? "",
          lastSaved: drafts.savedContentOf(scope, effectiveOpenPath),
        }
      : null;
  const baselineContent =
    openDirty && effectiveOpenPath !== null
      ? drafts.savedContentOf(scope, effectiveOpenPath)
      : readContentFor(read, scope, effectiveOpenPath);
  // Update-on-edit (at save-attempt granularity): the attempted draft is
  // recorded in the store before the write, and a service-confirmed write
  // marks the payload saved — the store caches drafts, the service stays
  // saved-truth.
  const onSave = (content: string): Promise<Result<null>> => {
    const result = saveDraft(content);
    if (effectiveOpenPath !== null) {
      drafts.recordDraft(scope, effectiveOpenPath, content);
      observeSaveResult(result, drafts, scope, effectiveOpenPath, content);
    }
    return result;
  };
  const activeTruncation =
    truncation !== null && truncation.scopeKey === scopeKey && truncation.truncated
      ? truncation
      : null;
  return (
    <section className="files-panel" aria-label="Workspace files">
      <WorkspaceExplorer
        workspaceId={workspaceId}
        source={source}
        selectedPath={effectiveOpenPath ?? undefined}
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
          {activeSelected?.node.path}
        </p>
      )}
      <EditorPane
        scope={scope}
        path={effectiveOpenPath}
        restoredDraft={restoredDraft}
        content={baselineContent}
        readError={readErrorFor(read, scope, effectiveOpenPath)}
        onReload={reload}
        onSave={onSave}
        onDraftChange={(draft) => {
          // Per-edit recording: every keystroke lands in the descriptor-
          // owned store for the open scope+path, so type-without-save
          // survives unmount/remount.
          if (effectiveOpenPath !== null) {
            drafts.recordDraft(scope, effectiveOpenPath, draft);
          }
        }}
      />
    </section>
  );
}

/**
 * Factory for the files.explorer panel descriptor. The bridge is injected
 * once here and every render path (list/read/write) goes through it —
 * no Node/Electron APIs, no local fallbacks. The factory also owns BOTH
 * descriptor-lifetime stores — the draft store AND the request-id source —
 * because V2 unmounts the panel on navigation: drafts and unresolved
 * retry identities live HERE (not in component state) so they survive
 * unmount/remount. `deps.drafts`/`deps.requestIds` are optional test/
 * alt-host injections; the public `createFilesPanelDescriptor({ bridge })`
 * call is unchanged.
 */
export function createFilesPanelDescriptor(deps: {
  bridge: FileBridge;
  drafts?: FilesDraftStore;
  requestIds?: RequestIdSource;
  openRequestCell?: FileOpenRequestCell;
}): FilesPanelDescriptor {
  const drafts = deps.drafts ?? createFilesDraftStore();
  const requestIds = deps.requestIds ?? createRequestIdSource();
  return {
    id: FILES_ROUTE_ID,
    title: "Files",
    component: (props: FilesPanelProps) => (
      <FilesPanel
        {...props}
        bridge={deps.bridge}
        drafts={drafts}
        requestIds={requestIds}
        openRequestCell={deps.openRequestCell}
      />
    ),
    capability: FILES_CAPABILITY,
  };
}
