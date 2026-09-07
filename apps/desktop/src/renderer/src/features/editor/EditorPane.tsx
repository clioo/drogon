import { useEffect, useReducer } from "react";
import { FileWarning, RefreshCw, Save } from "lucide-react";
import { Button } from "../../components/ui/button";
import type { Result } from "../../../../shared/session-contract";

/**
 * The editor touches the backend only through the injected `onSave`/`onReload`
 * callbacks; file content itself arrives via the `content` prop. Nothing here
 * may import Node/Electron APIs — the preload bridge is owned centrally.
 */
export interface EditorPaneProps {
  /** Open file path, or null when no file is open. */
  path: string | null;
  /** Last-known saved content for `path`, or null when unread/absent. */
  content: string | null;
  /** Set when the file could not be read; the draft is not clobbered. */
  readError?: string | null;
  /** Re-request the read (retry affordance for `readError`). */
  onReload?(): void;
  /** Persist the draft; resolves with the service's Result, never throws. */
  onSave(content: string): Promise<Result<null>>;
}

/** Per-file retained editing state; survives switching between files. */
export interface EditorFileState {
  draft: string;
  /** Content the service last confirmed for this path. */
  lastSaved: string | null;
}

export interface EditorState {
  openPath: string | null;
  /** Active mirror of `files[openPath].draft` for cheap render/read. */
  draft: string;
  /** Active mirror of `files[openPath].lastSaved`. */
  lastSaved: string | null;
  /** Retained per-path drafts; a dirty entry is never silently dropped. */
  files: Readonly<Record<string, EditorFileState>>;
  saveInFlight: boolean;
  /** The path the in-flight save belongs to (may differ from openPath). */
  savingPath: string | null;
  /** Snapshot of the draft covered by the in-flight save. */
  savingDraft: string | null;
  /** Monotonic save request id; completions are fenced against it. */
  saveGeneration: number;
  /** Failure of the most recent fenced save attempt, with its own path. */
  saveError: { path: string; message: string } | null;
}

export type EditorAction =
  | { type: "file-opened"; path: string | null; content: string | null }
  | { type: "edited"; value: string }
  | {
      type: "save-started";
      path: string;
      draft: string;
      generation: number;
    }
  | { type: "save-succeeded"; path: string; generation: number }
  | {
      type: "save-failed";
      path: string;
      generation: number;
      message: string;
    };

export function initialEditorState(): EditorState {
  return {
    openPath: null,
    draft: "",
    lastSaved: null,
    files: {},
    saveInFlight: false,
    savingPath: null,
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

function withFile(
  state: EditorState,
  path: string,
  entry: EditorFileState,
): Readonly<Record<string, EditorFileState>> {
  return { ...state.files, [path]: entry };
}

/**
 * Save completions are fenced by both the save generation and the path
 * snapshot taken at save-started: a completion that does not match the
 * most recent save request is discarded, so a slow save of file A can
 * never mark file B saved or fail B. A failed save never discards the
 * draft — retry re-sends the current draft.
 */
export function applyEditorAction(
  state: EditorState,
  action: EditorAction,
): EditorState {
  switch (action.type) {
    case "file-opened": {
      const samePath = action.path !== null && action.path === state.openPath;
      if (samePath) {
        // Same path + clean pane: adopt the refreshed content. Same path
        // with unsaved edits: keep the draft — an external refresh must
        // never silently drop the user's work.
        if (state.draft !== state.lastSaved) return state;
        const path = action.path as string;
        const entry = { draft: action.content ?? "", lastSaved: action.content };
        return { ...state, draft: entry.draft, lastSaved: entry.lastSaved, files: withFile(state, path, entry) };
      }
      // Switching files: retain the current file's editing state first.
      let files = state.files;
      if (state.openPath !== null) {
        files = withFile(state, state.openPath, {
          draft: state.draft,
          lastSaved: state.lastSaved,
        });
      }
      if (action.path === null) {
        return {
          ...state,
          openPath: null,
          draft: "",
          lastSaved: null,
          files,
          saveError: null,
        };
      }
      const retained = files[action.path];
      const retainedDirty =
        retained !== undefined && retained.draft !== retained.lastSaved;
      if (retainedDirty) {
        // Restore the retained dirty draft; nothing is silently dropped.
        // The in-flight save (if any) stays fenced to its own path.
        return {
          ...state,
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
        openPath: action.path,
        draft: entry.draft,
        lastSaved: entry.lastSaved,
        files: { ...files, [action.path]: entry },
        saveError: null,
      };
    }
    case "edited": {
      if (state.openPath === null) return state;
      return {
        ...state,
        draft: action.value,
        files: withFile(state, state.openPath, {
          draft: action.value,
          lastSaved: state.lastSaved,
        }),
      };
    }
    case "save-started":
      return {
        ...state,
        saveInFlight: true,
        savingPath: action.path,
        savingDraft: action.draft,
        saveGeneration: action.generation,
        saveError: null,
      };
    case "save-succeeded": {
      if (!state.saveInFlight) return state;
      if (
        state.saveGeneration !== action.generation ||
        state.savingPath !== action.path
      )
        return state;
      const current =
        state.openPath === action.path
          ? state.draft
          : (state.files[action.path]?.draft ?? state.savingDraft ?? "");
      const files = withFile(state, action.path, {
        draft: current,
        lastSaved: state.savingDraft ?? "",
      });
      return {
        ...state,
        lastSaved: state.openPath === action.path ? (state.savingDraft ?? "") : state.lastSaved,
        files,
        saveInFlight: false,
        savingPath: null,
        savingDraft: null,
        saveError: null,
      };
    }
    case "save-failed": {
      if (!state.saveInFlight) return state;
      if (
        state.saveGeneration !== action.generation ||
        state.savingPath !== action.path
      )
        return state;
      // The failure belongs to the saved path, not to whatever is open now;
      // the banner only shows it when that path is open again.
      return {
        ...state,
        saveInFlight: false,
        savingPath: null,
        savingDraft: null,
        saveError: { path: action.path, message: action.message },
      };
    }
  }
}

/**
 * The component's exact save pipeline, exported so tests can drive it with
 * injected deferred fakes instead of a real backend. Dispatches
 * `save-started` (with the request's path+generation identity) first so a
 * hang is visible, then exactly one terminal outcome carrying the same
 * identity; the reducer discards any completion that no longer matches.
 */
export async function runSave(input: {
  draft: string;
  path: string;
  generation: number;
  onSave: EditorPaneProps["onSave"];
  dispatch: (action: EditorAction) => void;
}): Promise<void> {
  const { draft, path, generation, onSave, dispatch } = input;
  dispatch({ type: "save-started", path, draft, generation });
  let result: Result<null>;
  try {
    result = await onSave(draft);
  } catch {
    dispatch({
      type: "save-failed",
      path,
      generation,
      message: "The file could not be saved.",
    });
    return;
  }
  if (result.ok) {
    dispatch({ type: "save-succeeded", path, generation });
  } else {
    dispatch({
      type: "save-failed",
      path,
      generation,
      message: result.error.message,
    });
  }
}

export function EditorPane({
  path,
  content,
  readError = null,
  onReload,
  onSave,
}: EditorPaneProps) {
  const [state, dispatch] = useReducer(
    applyEditorAction,
    { path, content },
    // Initialize from props so the first paint (and SSR snapshot) already
    // shows the opened file instead of a "no file" flash before effects run.
    (initial) => ({
      ...initialEditorState(),
      openPath: initial.path,
      draft: initial.content ?? "",
      lastSaved: initial.content,
      files:
        initial.path !== null
          ? {
              [initial.path]: {
                draft: initial.content ?? "",
                lastSaved: initial.content,
              },
            }
          : {},
    }),
  );
  useEffect(() => {
    dispatch({ type: "file-opened", path, content });
  }, [path, content]);

  const startSave = () => {
    if (path === null) return;
    void runSave({
      draft: state.draft,
      path,
      generation: nextSaveGeneration(state),
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
  const dirty = isDirty(state);
  const activeSaveError =
    state.saveError !== null && state.saveError.path === path
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
          disabled={!dirty || state.saveInFlight}
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
