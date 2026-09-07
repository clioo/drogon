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

export interface EditorState {
  openPath: string | null;
  draft: string;
  /** Content the service last confirmed for `openPath`. */
  lastSaved: string | null;
  /** Snapshot of the draft covered by an in-flight save. */
  savingDraft: string | null;
  saveInFlight: boolean;
  saveError: string;
}

export type EditorAction =
  | { type: "file-opened"; path: string | null; content: string | null }
  | { type: "edited"; value: string }
  | { type: "save-started"; draft: string }
  | { type: "save-succeeded" }
  | { type: "save-failed"; message: string };

export function initialEditorState(): EditorState {
  return {
    openPath: null,
    draft: "",
    lastSaved: null,
    savingDraft: null,
    saveInFlight: false,
    saveError: "",
  };
}

/** The draft differs from the last service-confirmed content. */
export function isDirty(state: EditorState): boolean {
  return state.draft !== state.lastSaved;
}

/**
 * A save only covers the exact draft snapshot it was started with: edits
 * typed while the save is in flight keep the pane dirty. A failed save
 * never discards the draft — retry re-sends the current draft.
 */
export function applyEditorAction(
  state: EditorState,
  action: EditorAction,
): EditorState {
  switch (action.type) {
    case "file-opened": {
      const samePath = action.path !== null && action.path === state.openPath;
      // Same path + clean pane: adopt the refreshed content. Same path with
      // unsaved edits: keep the draft (external-refresh merge is out of
      // scope here and must never silently drop the user's work).
      if (samePath && state.draft !== state.lastSaved) return state;
      return {
        openPath: action.path,
        draft: action.content ?? "",
        lastSaved: action.content,
        savingDraft: null,
        saveInFlight: false,
        saveError: "",
      };
    }
    case "edited":
      return { ...state, draft: action.value };
    case "save-started":
      return {
        ...state,
        saveInFlight: true,
        savingDraft: action.draft,
        saveError: "",
      };
    case "save-succeeded": {
      if (state.savingDraft === null) return state;
      return {
        ...state,
        lastSaved: state.savingDraft,
        savingDraft: null,
        saveInFlight: false,
        saveError: "",
      };
    }
    case "save-failed":
      return {
        ...state,
        saveInFlight: false,
        savingDraft: null,
        saveError: action.message,
      };
  }
}

/**
 * The component's exact save pipeline, exported so tests can drive it with
 * an injected fake instead of a real backend. Dispatches `save-started`
 * first so a hang is visible, then exactly one terminal outcome.
 */
export async function runSave(
  draft: string,
  onSave: EditorPaneProps["onSave"],
  dispatch: (action: EditorAction) => void,
): Promise<void> {
  dispatch({ type: "save-started", draft });
  let result: Result<null>;
  try {
    result = await onSave(draft);
  } catch {
    dispatch({ type: "save-failed", message: "The file could not be saved." });
    return;
  }
  if (result.ok) {
    dispatch({ type: "save-succeeded" });
  } else {
    dispatch({ type: "save-failed", message: result.error.message });
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
      openPath: initial.path,
      draft: initial.content ?? "",
      lastSaved: initial.content,
      savingDraft: null,
      saveInFlight: false,
      saveError: "",
    }),
  );
  useEffect(() => {
    dispatch({ type: "file-opened", path, content });
  }, [path, content]);

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
          onClick={() => void runSave(state.draft, onSave, dispatch)}
        >
          <Save aria-hidden />
          {state.saveInFlight
            ? "Saving…"
            : state.saveError
              ? "Retry save"
              : "Save"}
        </Button>
      </header>
      {state.saveError && (
        <div className="error-banner" role="alert">
          <span>{state.saveError}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={state.saveInFlight}
            onClick={() => void runSave(state.draft, onSave, dispatch)}
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
