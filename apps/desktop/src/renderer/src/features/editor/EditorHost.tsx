/**
 * Full-width editor host for the main tab group (R16-A, fixes #133). Mounts
 * ONE EditorPane whose `path` prop is the active editor tab's path — the
 * pane's own per-file reducer state (features/editor/EditorPane.tsx) already
 * retains every previously-opened file's draft across a path switch, so a
 * single instance is enough (this app never shows two file editors at
 * once, matching scripts/acceptance-editor-text.mjs's assumption). This
 * replaces the read/save/draft wiring that used to live inside
 * features/workspaces/files-panel.tsx's embedded `<EditorPane>` — that
 * panel now renders the Explorer tree only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EditorPane,
  scopedFileKey,
  type EditorScope,
} from "./EditorPane";
import type { ChangesLoadResult } from "./EditorChangesView";
import { windowGitBridge } from "../../changes-mount";
import {
  createRequestIdSource,
  makeFileSaver,
  observeSaveResult,
  readContentFor,
  readErrorFor,
  runFilesRead,
  type FilesReadState,
} from "./file-read-write";
import { createFilesDraftStore } from "../workspaces/files-draft-store";
import { subscribeWorkspaceFilesChanged } from "../file-explorer/files-watch";
import type { EditorTabMissingKind } from "../shell/editor-tab";
import { MAX_FILE_BYTES, type FileBridge } from "../../../../shared/file-contract";
import type { Result } from "../../../../shared/session-contract";

export interface EditorHostProps {
  bridge: FileBridge;
  scope: EditorScope;
  /** The active editor tab's path, or null while no editor tab is active. */
  path: string | null;
  /** The active tab's file has vanished from its path (#302, fork
   *  externalMutation): stop the tick-driven re-read so the stale snapshot
   *  stays put (the fork does not reload a deleted file) and suppress the
   *  read-error banner while any content exists to show. */
  missing?: EditorTabMissingKind;
  /** Close affordance in the editor header; wired to the active tab's close. */
  onClose?: () => void;
  /** Fires whenever the open path's dirty state changes, for the tab dot. */
  onDirtyChange?: (path: string, dirty: boolean) => void;
  /** View the pane lands on when the path changes (fork editorViewMode;
   *  a Source Control row click on unstaged markdown opens Changes). */
  initialView?: "changes";
  /** Reports the user's toggle so the tab's stored view mode follows. */
  onViewModeChange?: (view: "edit" | "changes") => void;
}

export function EditorHost({
  bridge,
  scope,
  path,
  missing,
  onClose,
  onDirtyChange,
  initialView,
  onViewModeChange,
}: EditorHostProps) {
  // Descriptor-lifetime stores: one instance for the life of this host (it
  // stays mounted for as long as any editor tab exists), never per path.
  const draftsRef = useRef<ReturnType<typeof createFilesDraftStore> | null>(
    null,
  );
  if (draftsRef.current === null) draftsRef.current = createFilesDraftStore();
  const drafts = draftsRef.current;
  const requestIdsRef = useRef<ReturnType<typeof createRequestIdSource> | null>(
    null,
  );
  if (requestIdsRef.current === null)
    requestIdsRef.current = createRequestIdSource();
  const requestIds = requestIdsRef.current;

  // Scope identity stability: App passes an inline scope literal, so this
  // memo keeps the pane's file-opened effect from refiring on every App
  // render. Without it the effect re-adopts the (stale) read baseline over
  // fresh post-save state on the next render after a save, regressing
  // lastSaved and orphaning the model from the draft (clioo/drogon#144).
  const stableScope = useMemo(
    () => ({ hostId: scope.hostId, workspaceId: scope.workspaceId }),
    [scope.hostId, scope.workspaceId],
  );

  const [reloadTick, setReloadTick] = useState(0);
  const [read, setRead] = useState<FilesReadState>({
    key: null,
    phase: "idle",
    content: null,
    message: "",
  });
  const readGeneration = useRef(0);

  useEffect(() => {
    // Cleanup runs on unmount AND on every path/reload change: the bumped
    // generation fences any in-flight read so a late reply can never land
    // after its read was superseded.
    const invalidate = () => {
      readGeneration.current += 1;
    };
    if (path === null || missing !== undefined) {
      // Missing: the tombstone freezes the surface on its last-confirmed
      // snapshot; re-reading a deleted path would only resurrect the
      // file-not-found banner (#302).
      setRead({ key: null, phase: "idle", content: null, message: "" });
      return invalidate;
    }
    const generation = ++readGeneration.current;
    const key = scopedFileKey(stableScope, path);
    setRead({ key, phase: "loading", content: null, message: "" });
    void runFilesRead({
      bridge,
      scope: { ...stableScope, path },
      maxBytes: MAX_FILE_BYTES,
      generation,
      isCurrent: () => readGeneration.current === generation,
      onDone: (outcome) => {
        setRead(
          outcome.ok
            ? { key, phase: "ready", content: outcome.content, message: "" }
            : { key, phase: "error", content: null, message: outcome.message },
        );
        if (outcome.ok) drafts.confirmRead(stableScope, path, outcome.content);
      },
    });
    return invalidate;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, stableScope.hostId, stableScope.workspaceId, path, reloadTick, drafts, missing]);

  // Seeds the tab dot for a path that already had a dirty retained draft
  // when it becomes active again (e.g. reselecting a tab after typing in
  // another one) — the per-keystroke report below covers the live case.
  useEffect(() => {
    if (path !== null) onDirtyChange?.(path, drafts.isDirty(stableScope, path));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Live external-change detection (fork: useEditorPanelExternalContentEvents
  // over the fs:changed bus; here the Explorer's coarse workspace tick
  // channel): a write from outside the pane re-reads the open file, so the
  // pane's same-spot rules surface it as the changed-on-disk mark (dirty
  // drafts are kept by confirmRead) instead of autosave silently
  // overwriting the newer content. Self-echo is harmless: our own write
  // re-reads identical content and every branch is a no-op.
  useEffect(() => {
    return subscribeWorkspaceFilesChanged(stableScope.workspaceId, () => {
      setReloadTick((tick) => tick + 1);
    });
  }, [stableScope.workspaceId]);

  // Fork parity (EditorViewToggle 'changes'): uncommitted changes come
  // from the same `gitDiff` RPC the Changes panel uses, scoped to this
  // host+workspace plus the requested path. Injected into the pane as a
  // plain loader so EditorPane keeps its backend-through-callbacks
  // contract (the pane never touches `window.drogon` itself).
  const loadChanges = useCallback(
    (loadPath: string): Promise<ChangesLoadResult> => {
      const scope = { ...stableScope, path: loadPath };
      return windowGitBridge()
        .gitDiff(scope)
        .then(
          (result) =>
            result.ok
              ? {
                  ok: true as const,
                  diff: result.result.diff,
                  truncated: result.result.truncated,
                }
              : { ok: false as const, message: result.error.message },
          (failure: unknown) => ({
            ok: false as const,
            message:
              failure instanceof Error
                ? failure.message
                : "The changes could not be loaded.",
          }),
        );
    },
    [stableScope],
  );

  if (path === null) {
    return (
      <EditorPane
        scope={stableScope}
        path={null}
        content={null}
        onSave={() => Promise.resolve({ ok: true, result: null })}
      />
    );
  }

  const reload = () => setReloadTick((tick) => tick + 1);
  const openDirty = drafts.isDirty(stableScope, path);
  const restoredDraft = openDirty
    ? {
        draft: drafts.draftOf(stableScope, path) ?? "",
        lastSaved: drafts.savedContentOf(stableScope, path),
      }
    : null;
  // The confirmed baseline is the freshest service-confirmed content, never
  // the original read: branching on openDirty flapped between the two on
  // every dirty flip (undo/redo, save), refiring the pane's file-opened
  // effect, whose clean branch then adopted the stale read over fresh
  // post-save state and orphaned the model from the draft
  // (clioo/drogon#144). savedContentOf advances on every confirmed read
  // AND every confirmed save, so it is always at least as fresh as the
  // read; the read only matters before any confirmation exists.
  //
  // A disagreeing external read while dirty is the one exception: the
  // store's dirty-keep rule correctly leaves the baseline unchanged, which
  // would shadow the fresh read forever — the pane's content prop would
  // never change, its same-spot rules would never raise the changed-on-disk
  // mark, and autosave would silently overwrite the newer disk content.
  // The retained external read leads instead; the pane keeps the draft
  // (the model follows the draft, never this prop) and raises the mark,
  // which suspends autosave until an explicit Save resolves the conflict.
  const baselineContent =
    drafts.externalContentOf(stableScope, path) ??
    drafts.savedContentOf(stableScope, path) ??
    readContentFor(read, stableScope, path);
  const saveDraft = makeFileSaver(
    bridge,
    { ...stableScope, path },
    requestIds,
    scopedFileKey(stableScope, path),
  );
  const onSave = (content: string): Promise<Result<null>> => {
    const result = saveDraft(content);
    drafts.recordDraft(stableScope, path, content);
    observeSaveResult(result, drafts, stableScope, path, content);
    void result.then((outcome) => {
      if (outcome.ok) onDirtyChange?.(path, false);
    });
    return result;
  };

  return (
    <EditorPane
      scope={stableScope}
      path={path}
      restoredDraft={restoredDraft}
      content={baselineContent}
      readError={
        // Tombstone honesty rule: with a snapshot to show, the stale
        // content + struck tab is the whole story (fork parity — its
        // deleted tab keeps the last content and never re-reads). Only a
        // tab with NO confirmed content (deleted before its first read)
        // still surfaces the load error, matching the fork's
        // "Unable to load file" revisit state.
        missing !== undefined && baselineContent !== null
          ? null
          : readErrorFor(read, stableScope, path)
      }
      onReload={reload}
      onSave={onSave}
      loadChanges={loadChanges}
      initialView={initialView}
      onViewModeChange={onViewModeChange}
      onClose={onClose}
      onDraftChange={(draft) => {
        drafts.recordDraft(stableScope, path, draft);
        // Freshest-confirmed first, like baselineContent above: after a
        // save the read is stale, and comparing against it would report
        // the just-saved draft dirty again.
        const baseline = drafts.savedContentOf(stableScope, path) ?? readContentFor(read, stableScope, path);
        onDirtyChange?.(path, draft !== baseline);
      }}
    />
  );
}
