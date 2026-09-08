/**
 * Read/save pipeline for one open file, shared by whatever hosts the
 * EditorPane. Relocated out of features/workspaces/files-panel.ts (R16-A):
 * the embedded sidebar editor is gone, but the read-fencing, per-file
 * request-id and save-observer semantics it used are unchanged and now
 * back the main-tab-group EditorHost instead. Behavior and comments here
 * are carried over verbatim from that module.
 */
import type { Result } from "../../../../shared/session-contract";
import type { FileBridge, FileScope } from "../../../../shared/file-contract";
import { scopedFileKey, type EditorScope } from "./EditorPane";
import type { FilesDraftStore } from "../workspaces/files-draft-store";

/** identity of one read for staleness gating. */
export interface FilesReadState {
  /** Scoped key this read belongs to; null = no read in effect. */
  key: string | null;
  phase: "idle" | "loading" | "ready" | "error";
  content: string | null;
  message: string;
}

/** What the panel should read right now: nothing while unavailable or closed. */
export function filesReadTarget(
  available: boolean,
  openPath: string | null,
): string | null {
  return available && openPath !== null ? openPath : null;
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
