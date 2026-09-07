import { useEffect, useReducer, useRef } from "react";
import { FileWarning, RefreshCw, Save } from "lucide-react";
import { Button } from "../../components/ui/button";
import type { Result } from "../../../../shared/session-contract";

/**
 * The editor touches the backend only through the injected `onSave`/`onReload`
 * callbacks; file content itself arrives via the `content` prop. Nothing here
 * may import Node/Electron APIs — the preload bridge is owned centrally.
 */
export interface EditorScope {
  hostId: string;
  workspaceId: string;
}

export interface EditorPaneProps {
  /** Which host+workspace the open file belongs to (required, drives draft identity). */
  scope: EditorScope;
  /** Open file path, or null when no file is open. */
  path: string | null;
  /** Last-known saved content for `path`, or null while unread/absent. */
  content: string | null;
  /** Set when the file could not be read; the draft is not clobbered. */
  readError?: string | null;
  /** Re-request the read (retry affordance for `readError`). */
  onReload?(): void;
  /** Persist the draft; resolves with the service's Result, never throws. */
  onSave(content: string): Promise<Result<null>>;
  /**
   * Explicit new-file intent: allows saving before any read has confirmed
   * content. Default false — without it, an unread file can never be
   * saved, so a pending read can never blank-overwrite a real file.
   */
  allowEmptySave?: boolean;
  /**
   * Truthful draft restoration (descriptor-owned store -> panel): the
   * retained draft PLUS the retained lastSaved, consumed once (at mount
   * for the initially open file) so a restored dirty draft presents as
   * DIRTY from the first paint — never as a clean baseline.
   */
  restoredDraft?: { draft: string; lastSaved: string | null } | null;
}

/** Per-file retained editing state; survives switching between files. */
export interface EditorFileState {
  draft: string;
  /** Content the service last confirmed for this file. */
  lastSaved: string | null;
}

/**
 * All retained draft state is keyed by the FULL scope triple
 * hostId/workspaceId/path: the same relative path under a different
 * host or workspace is a different file and can never restore or
 * receive another scope's draft.
 */
export function scopedFileKey(
  scope: EditorScope,
  path: string,
): string {
  return `${scope.hostId}/${scope.workspaceId}/${path}`;
}

export interface EditorState {
  openScope: EditorScope | null;
  openPath: string | null;
  /** Active mirror of the open file's draft for cheap render/read. */
  draft: string;
  /** Active mirror of the open file's lastSaved; null until a read confirms content. */
  lastSaved: string | null;
  /** Retained drafts keyed by scopedFileKey; a dirty entry is never silently dropped. */
  files: Readonly<Record<string, EditorFileState>>;
  saveInFlight: boolean;
  /** Scoped key the in-flight save belongs to. */
  savingKey: string | null;
  /** Snapshot of the draft covered by the in-flight save. */
  savingDraft: string | null;
  /** Monotonic save request id; completions are fenced against it. */
  saveGeneration: number;
  /** Failure of the most recent fenced save attempt, with its own key+path. */
  saveError: { key: string; path: string; message: string } | null;
}

export type EditorAction =
  | {
      type: "file-opened";
      scope: EditorScope;
      path: string | null;
      content: string | null;
    }
  | {
      type: "draft-restored";
      scope: EditorScope;
      path: string;
      draft: string;
      lastSaved: string | null;
    }
  | { type: "edited"; value: string }
  | {
      type: "save-started";
      key: string;
      path: string;
      draft: string;
      generation: number;
      allowEmpty: boolean;
    }
  | { type: "save-succeeded"; key: string; generation: number }
  | { type: "save-failed"; key: string; generation: number; message: string };

export function initialEditorState(): EditorState {
  return {
    openScope: null,
    openPath: null,
    draft: "",
    lastSaved: null,
    files: {},
    saveInFlight: false,
    savingKey: null,
    savingDraft: null,
    saveGeneration: 0,
    saveError: null,
  };
}

/** The draft differs from the last service-confirmed content. */
export function isDirty(state: EditorState): boolean {
  return state.draft !== state.lastSaved;
}

/** The generation the next save request will carry. */
export function nextSaveGeneration(state: EditorState): number {
  return state.saveGeneration + 1;
}

/** The scoped key of whatever file is currently open, or null. */
export function openFileKey(state: EditorState): string | null {
  return state.openScope !== null && state.openPath !== null
    ? scopedFileKey(state.openScope, state.openPath)
    : null;
}

/** Has a read positively confirmed content for the open file? */
export function isReadConfirmed(state: EditorState): boolean {
  return state.lastSaved !== null;
}

function pathFromFileKey(key: string): string {
  const first = key.indexOf("/");
  const second = key.indexOf("/", first + 1);
  return second === -1 ? "" : key.slice(second + 1);
}

/**
 * The single admission decision for saving, used by BOTH the rendered
 * Save gate and startSave so a stale prop/state frame can never invoke
 * onSave. Requires: the editor state to belong to the exact scope+path
 * being rendered, no save in flight, a confirmed read (or explicit
 * new-file intent), and a dirty draft.
 */
export function saveAdmission(
  state: EditorState,
  scope: EditorScope,
  path: string | null,
  allowEmptySave: boolean,
): boolean {
  if (path === null) return false;
  if (state.openPath !== path) return false;
  if (
    state.openScope === null ||
    state.openScope.hostId !== scope.hostId ||
    state.openScope.workspaceId !== scope.workspaceId
  )
    return false;
  if (state.saveInFlight) return false;
  if (state.lastSaved === null && !allowEmptySave) return false;
  return isDirty(state);
}

function withFile(
  state: EditorState,
  key: string,
  entry: EditorFileState,
): Readonly<Record<string, EditorFileState>> {
  return { ...state.files, [key]: entry };
}

/**
 * Save completions are fenced by THREE identities: the scoped file key
 * captured at save-started, the save generation, AND the file still being
 * open at completion time (state.openKey === key). A completion whose
 * open path/scope has moved on is dropped entirely — it can never mark a
 * foreign draft saved or set an error on it. A failed save never discards
 * the draft — retry re-sends the current draft. Saves of unread files are
 * refused at start (lastSaved === null) unless the new-file intent
 * (`allowEmpty`) is explicit, so a pending read can never blank a file.
 */
export function applyEditorAction(
  state: EditorState,
  action: EditorAction,
): EditorState {
  switch (action.type) {
    case "file-opened": {
      const key =
        action.path !== null ? scopedFileKey(action.scope, action.path) : null;
      const sameSpot =
        key !== null &&
        state.openPath === action.path &&
        state.openScope !== null &&
        state.openScope.hostId === action.scope.hostId &&
        state.openScope.workspaceId === action.scope.workspaceId;
      if (sameSpot) {
        const hasRead = state.lastSaved !== null;
        // Same file, read confirmed, unsaved edits: keep the draft — an
        // external refresh must never silently drop the user's work.
        if (hasRead && state.draft !== state.lastSaved) return state;
        // Same file, read confirmed, clean: adopt the refreshed content.
        if (hasRead) {
          const entry = { draft: action.content ?? "", lastSaved: action.content };
          return {
            ...state,
            draft: entry.draft,
            lastSaved: entry.lastSaved,
            files: withFile(state, key as string, entry),
          };
        }
        // Same file, unread: adopt only while the draft is still the empty
        // placeholder; typed work (new-file intent) is never clobbered.
        if (state.draft !== "") return state;
        const entry = { draft: action.content ?? "", lastSaved: action.content };
        return {
          ...state,
          draft: entry.draft,
          lastSaved: entry.lastSaved,
          files: withFile(state, key as string, entry),
        };
      }
      // Switching (file or scope): retain the current file's editing state
      // under ITS scoped key first — entries from other scopes are kept,
      // never reset.
      let files = state.files;
      const currentKey = openFileKey(state);
      if (currentKey !== null) {
        files = withFile(state, currentKey, {
          draft: state.draft,
          lastSaved: state.lastSaved,
        });
      }
      if (action.path === null) {
        return {
          ...state,
          openScope: null,
          openPath: null,
          draft: "",
          lastSaved: null,
          files,
          saveError: null,
        };
      }
      const retained = files[key as string];
      if (retained !== undefined) {
        // Restore the retained entry — dirty (nothing silently dropped) or
        // clean (it reflects our own latest confirmed write, which is newer
        // than a stale content prop; a fresh read still adopts on arrival
        // through the same-spot clean rule). Only the exact scoped key
        // restores it, so a cross-scope same-path file can never inherit a
        // foreign draft. The in-flight save (if any) stays fenced to its
        // own key and its completion retires against that key.
        return {
          ...state,
          openScope: action.scope,
          openPath: action.path,
          draft: retained.draft,
          lastSaved: retained.lastSaved,
          files,
          saveError: null,
        };
      }
      const entry = { draft: action.content ?? "", lastSaved: action.content };
      return {
        ...state,
        openScope: action.scope,
        openPath: action.path,
        draft: entry.draft,
        lastSaved: entry.lastSaved,
        files: { ...files, [key as string]: entry },
        saveError: null,
      };
    }
    case "draft-restored": {
      const key = scopedFileKey(action.scope, action.path);
      // Open file: present the restored draft truthfully dirty (its
      // lastSaved is the service-confirmed content, not the draft).
      if (openFileKey(state) === key) {
        return {
          ...state,
          draft: action.draft,
          lastSaved: action.lastSaved,
          files: withFile(state, key, {
            draft: action.draft,
            lastSaved: action.lastSaved,
          }),
        };
      }
      // Not open: seed the retained entry without switching files, and
      // never clobber an entry that already exists.
      if (state.files[key] !== undefined) return state;
      return {
        ...state,
        files: withFile(state, key, {
          draft: action.draft,
          lastSaved: action.lastSaved,
        }),
      };
    }
    case "edited": {
      const key = openFileKey(state);
      if (key === null) return state;
      return {
        ...state,
        draft: action.value,
        files: withFile(state, key, {
          draft: action.value,
          lastSaved: state.lastSaved,
        }),
      };
    }
    case "save-started": {
      // Unread gate: an unread file (lastSaved null) may only be saved
      // with explicit new-file intent.
      if (state.lastSaved === null && !action.allowEmpty) return state;
      // Transition fence at start: the request must be for the file that
      // is actually open, under the actual scope.
      if (action.key !== openFileKey(state)) return state;
      return {
        ...state,
        saveInFlight: true,
        savingKey: action.key,
        savingDraft: action.draft,
        saveGeneration: action.generation,
        saveError: null,
      };
    }
    case "save-succeeded": {
      if (!state.saveInFlight) return state;
      if (state.saveGeneration !== action.generation || state.savingKey !== action.key)
        return state;
      const snapshot = state.savingDraft ?? "";
      // Still open: apply to the active pane and retained entry together.
      if (action.key === openFileKey(state)) {
        const files = withFile(state, action.key, {
          draft: state.draft,
          lastSaved: snapshot,
        });
        return {
          ...state,
          lastSaved: snapshot,
          files,
          saveInFlight: false,
          savingKey: null,
          savingDraft: null,
          saveError: null,
        };
      }
      // Switched away: RETIRE the exact completed operation so no future
      // save stays locked, and update ONLY the original file's retained
      // entry — never the now-active draft of another file.
      const retained = state.files[action.key];
      const files = withFile(state, action.key, {
        draft: retained?.draft ?? snapshot,
        lastSaved: snapshot,
      });
      return {
        ...state,
        files,
        saveInFlight: false,
        savingKey: null,
        savingDraft: null,
      };
    }
    case "save-failed": {
      if (!state.saveInFlight) return state;
      if (state.saveGeneration !== action.generation || state.savingKey !== action.key)
        return state;
      // Retire the operation in both branches so the pane never locks.
      if (action.key === openFileKey(state)) {
        return {
          ...state,
          saveInFlight: false,
          savingKey: null,
          savingDraft: null,
          saveError: {
            key: action.key,
            path: state.openPath ?? "",
            message: action.message,
          },
        };
      }
      // The failure is recorded against its own key (shown again if that
      // file is reopened); the active file is never touched.
      return {
        ...state,
        saveInFlight: false,
        savingKey: null,
        savingDraft: null,
        saveError: {
          key: action.key,
          path: pathFromFileKey(action.key),
          message: action.message,
        },
      };
    }
  }
}

/**
 * The component's exact save pipeline, exported so tests can drive it with
 * injected deferred fakes instead of a real backend. Dispatches
 * `save-started` (with the scoped key+generation identity and the new-file
 * intent) first so a hang is visible, then exactly one terminal outcome
 * carrying the same identity; the reducer discards any request or
 * completion that no longer matches the open file.
 */
export async function runSave(input: {
  draft: string;
  scope: EditorScope;
  path: string;
  generation: number;
  allowEmpty: boolean;
  onSave: EditorPaneProps["onSave"];
  dispatch: (action: EditorAction) => void;
}): Promise<void> {
  const { draft, scope, path, generation, allowEmpty, onSave, dispatch } = input;
  const key = scopedFileKey(scope, path);
  dispatch({ type: "save-started", key, path, draft, generation, allowEmpty });
  let result: Result<null>;
  try {
    result = await onSave(draft);
  } catch {
    dispatch({
      type: "save-failed",
      key,
      generation,
      message: "The file could not be saved.",
    });
    return;
  }
  if (result.ok) {
    dispatch({ type: "save-succeeded", key, generation });
  } else {
    dispatch({
      type: "save-failed",
      key,
      generation,
      message: result.error.message,
    });
  }
}

export function EditorPane({
  scope,
  path,
  content,
  readError = null,
  onReload,
  onSave,
  allowEmptySave = false,
  restoredDraft = null,
}: EditorPaneProps) {
  const restoredAtInit =
    path !== null && restoredDraft !== undefined && restoredDraft !== null;
  const restoredConsumed = useRef(restoredAtInit);
  const [state, dispatch] = useReducer(
    applyEditorAction,
    { scope, path, content, restoredDraft },
    // Initialize from props so the first paint (and SSR snapshot) already
    // shows the opened file — and a restored draft presents TRUTHFULLY
    // dirty: draft from the store, lastSaved from the store's confirmed
    // content, never the draft masquerading as saved.
    (initial) => {
      const restored =
        initial.path !== null && initial.restoredDraft
          ? initial.restoredDraft
          : null;
      return {
        ...initialEditorState(),
        openScope: initial.scope,
        openPath: initial.path,
        draft: restored ? restored.draft : (initial.content ?? ""),
        lastSaved: restored ? restored.lastSaved : initial.content,
        files:
          initial.path !== null
            ? {
                [scopedFileKey(initial.scope, initial.path)]: restored
                  ? { draft: restored.draft, lastSaved: restored.lastSaved }
                  : {
                      draft: initial.content ?? "",
                      lastSaved: initial.content,
                    },
              }
            : {},
      };
    },
  );
  useEffect(() => {
    // Consume the restored draft exactly once (at mount for the initially
    // open file, if init did not already use it); later navigation relies
    // on the editor's own scope-keyed retention.
    if (path !== null && restoredDraft && !restoredConsumed.current) {
      dispatch({
        type: "draft-restored",
        scope,
        path,
        draft: restoredDraft.draft,
        lastSaved: restoredDraft.lastSaved,
      });
    }
    restoredConsumed.current = true;
    dispatch({ type: "file-opened", scope, path, content });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, path, content]);

  const readConfirmed = isReadConfirmed(state);
  // Prop/state fence: before the effect dispatches, state still describes
  // the PREVIOUS scope+path. The textarea, dirty flag and save admission
  // are all gated on exact state/props agreement so neither the old draft
  // nor the old lastSaved can be rendered or saved under the new label.
  const stateMatchesProps =
    state.openScope !== null &&
    state.openScope.hostId === scope.hostId &&
    state.openScope.workspaceId === scope.workspaceId &&
    state.openPath === path;
  const canSave = saveAdmission(state, scope, path, allowEmptySave);
  const startSave = () => {
    // Admission is checked again here: reducer rejection alone would not
    // stop onSave from hitting the bridge.
    if (path === null || !canSave) return;
    void runSave({
      draft: state.draft,
      scope,
      path,
      generation: nextSaveGeneration(state),
      allowEmpty: allowEmptySave,
      onSave,
      dispatch,
    });
  };

  if (readError) {
    return (
      <section className="editor-pane" aria-label="Editor">
        <div className="error-banner" role="alert">
          <span>{readError}</span>
          {onReload && (
            <Button variant="outline" size="sm" onClick={onReload}>
              <RefreshCw aria-hidden /> Retry read
            </Button>
          )}
        </div>
      </section>
    );
  }
  if (!path) {
    return (
      <section className="editor-pane" aria-label="Editor">
        <div className="empty-state">
          <FileWarning size={32} aria-hidden />
          <h1>No file open</h1>
          <p>Select a file in the explorer to edit it here.</p>
        </div>
      </section>
    );
  }
  if (!stateMatchesProps || (!readConfirmed && !allowEmptySave)) {
    // Either the state has not caught up with the rendered scope+path yet
    // (prop/state fence), or the content has not been confirmed by a read.
    // Both show the same honest waiting state: no editable surface, no
    // enabled Save — a blank or foreign overwrite is impossible.
    return (
      <section className="editor-pane" aria-label={`Editor: ${path}`}>
        <header className="editor-pane-header">
          <span className="path">{path}</span>
          <span
            className="editor-pane-unread"
            role="status"
            aria-label="Waiting for file content"
          >
            Waiting for file content…
          </span>
        </header>
      </section>
    );
  }
  const dirty = isDirty(state);
  const currentKey = scopedFileKey(scope, path);
  const activeSaveError =
    state.saveError !== null && state.saveError.key === currentKey
      ? state.saveError.message
      : "";
  return (
    <section className="editor-pane" aria-label={`Editor: ${path}`}>
      <header className="editor-pane-header">
        <span className="path">{path}</span>
        {dirty && (
          <span
            className="editor-pane-dirty"
            role="status"
            aria-label="Unsaved changes"
          >
            ● Unsaved changes
          </span>
        )}
        <Button
          size="sm"
          disabled={!dirty || !canSave}
          onClick={startSave}
        >
          <Save aria-hidden />
          {state.saveInFlight
            ? "Saving…"
            : activeSaveError
              ? "Retry save"
              : "Save"}
        </Button>
      </header>
      {activeSaveError && (
        <div className="error-banner" role="alert">
          <span>{activeSaveError}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={state.saveInFlight}
            onClick={startSave}
          >
            <RefreshCw aria-hidden /> Retry
          </Button>
        </div>
      )}
      <textarea
        className="editor-pane-surface"
        aria-label={`Contents of ${path}`}
        spellCheck={false}
        value={state.draft}
        onChange={(event) =>
          dispatch({ type: "edited", value: event.target.value })
        }
      />
    </section>
  );
}
