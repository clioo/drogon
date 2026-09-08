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
import { useEffect, useRef, useState } from "react";
import { EditorPane, scopedFileKey, type EditorScope } from "./EditorPane";
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
import { MAX_FILE_BYTES, type FileBridge } from "../../../../shared/file-contract";
import type { Result } from "../../../../shared/session-contract";

export interface EditorHostProps {
  bridge: FileBridge;
  scope: EditorScope;
  /** The active editor tab's path, or null while no editor tab is active. */
  path: string | null;
  /** Close affordance in the editor header; wired to the active tab's close. */
  onClose?: () => void;
  /** Fires whenever the open path's dirty state changes, for the tab dot. */
  onDirtyChange?: (path: string, dirty: boolean) => void;
}

export function EditorHost({
  bridge,
  scope,
  path,
  onClose,
  onDirtyChange,
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
    if (path === null) {
      setRead({ key: null, phase: "idle", content: null, message: "" });
      return invalidate;
    }
    const generation = ++readGeneration.current;
    const key = scopedFileKey(scope, path);
    setRead({ key, phase: "loading", content: null, message: "" });
    void runFilesRead({
      bridge,
      scope: { ...scope, path },
      maxBytes: MAX_FILE_BYTES,
      generation,
      isCurrent: () => readGeneration.current === generation,
      onDone: (outcome) => {
        setRead(
          outcome.ok
            ? { key, phase: "ready", content: outcome.content, message: "" }
            : { key, phase: "error", content: null, message: outcome.message },
        );
        if (outcome.ok) drafts.confirmRead(scope, path, outcome.content);
      },
    });
    return invalidate;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, scope.hostId, scope.workspaceId, path, reloadTick, drafts]);

  // Seeds the tab dot for a path that already had a dirty retained draft
  // when it becomes active again (e.g. reselecting a tab after typing in
  // another one) — the per-keystroke report below covers the live case.
  useEffect(() => {
    if (path !== null) onDirtyChange?.(path, drafts.isDirty(scope, path));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  if (path === null) {
    return (
      <EditorPane
        scope={scope}
        path={null}
        content={null}
        onSave={() => Promise.resolve({ ok: true, result: null })}
      />
    );
  }

  const reload = () => setReloadTick((tick) => tick + 1);
  const openDirty = drafts.isDirty(scope, path);
  const restoredDraft = openDirty
    ? {
        draft: drafts.draftOf(scope, path) ?? "",
        lastSaved: drafts.savedContentOf(scope, path),
      }
    : null;
  const baselineContent = openDirty
    ? drafts.savedContentOf(scope, path)
    : readContentFor(read, scope, path);
  const saveDraft = makeFileSaver(
    bridge,
    { ...scope, path },
    requestIds,
    scopedFileKey(scope, path),
  );
  const onSave = (content: string): Promise<Result<null>> => {
    const result = saveDraft(content);
    drafts.recordDraft(scope, path, content);
    observeSaveResult(result, drafts, scope, path, content);
    void result.then((outcome) => {
      if (outcome.ok) onDirtyChange?.(path, false);
    });
    return result;
  };

  return (
    <EditorPane
      scope={scope}
      path={path}
      restoredDraft={restoredDraft}
      content={baselineContent}
      readError={readErrorFor(read, scope, path)}
      onReload={reload}
      onSave={onSave}
      onClose={onClose}
      onDraftChange={(draft) => {
        drafts.recordDraft(scope, path, draft);
        const baseline = readContentFor(read, scope, path) ?? drafts.savedContentOf(scope, path);
        onDirtyChange?.(path, draft !== baseline);
      }}
    />
  );
}
