import {
  applyEditorAction,
  externalContentFor,
  initialEditorState,
  isDirty,
  openFileKey,
  scopedFileKey,
  type EditorAction,
  type EditorScope,
  type EditorState,
} from "../editor/EditorPane";

/**
 * Descriptor-owned, IN-MEMORY ONLY draft store.
 *
 * Why: the V2 mount (commit 002f7ca, route-panel-contract) unmounts the
 * Files panel on Terminals navigation, which would otherwise discard the
 * editor's useReducer state (and its retained drafts). The panel factory
 * owns one store for the descriptor's lifetime, so drafts keyed by
 * hostId+workspaceId+path survive unmount/remount and same-workspace
 * refresh.
 *
 * Guarantees:
 * - Pure memory: no localStorage/sessionStorage/IndexedDB — no
 *   browser-persistent plaintext content store of any kind.
 * - No backend: the store never receives or calls the bridge; reads and
 *   writes stay gated behind the panel's availability checks, and while
 *   files.v1 is absent nothing touches file methods at all.
 * - The SERVICE remains saved-truth: the store caches drafts and the last
 *   content it saw confirmed; `confirmRead` adopts service content only
 *   over a CLEAN entry and never clobbers a dirty retained draft.
 * - State/reducer shapes are reused verbatim from EditorPane
 *   (EditorState/applyEditorAction), so the panel consults and updates
 *   with exactly the editor's own semantics (scope-keyed retention,
 *   dirty-keep on refresh, save fencing).
 */
export interface FilesDraftStore {
  /** Current editor state (identity-stable between mutations). */
  state(): EditorState;
  /** Apply any editor action through the editor's own reducer. */
  dispatch(action: EditorAction): void;
  /** Record a service read for a file: adopts content only over a clean entry. */
  confirmRead(scope: EditorScope, path: string, content: string | null): void;
  /** Record the current draft at save-attempt time ("update on edit"). */
  recordDraft(scope: EditorScope, path: string, draft: string): void;
  /** Mark a service-confirmed write: the payload is no longer dirty. */
  markSaved(scope: EditorScope, path: string, draft: string): void;
  /** Retained draft for the exact scope+path, or null. */
  draftOf(scope: EditorScope, path: string): string | null;
  /** Last content confirmed for the exact scope+path, or null. */
  savedContentOf(scope: EditorScope, path: string): string | null;
  /**
   * The disagreeing external read retained for the open file, or null.
   * Set when a confirmed read disagrees with a dirty draft's baseline
   * (the draft is kept, the flag raised); cleared on save, switch and
   * clean adoption, exactly like the flag. The host prefers this over
   * `savedContentOf` for the pane's content prop so the conflict is not
   * shadowed by the (correctly unchanged) baseline.
   */
  externalContentOf(scope: EditorScope, path: string): string | null;
  /** True when the retained draft differs from the last confirmed content. */
  isDirty(scope: EditorScope, path: string): boolean;
}

export function createFilesDraftStore(): FilesDraftStore {
  let state: EditorState = initialEditorState();
  let storeGeneration = 0;
  return {
    state: () => state,
    dispatch(action: EditorAction): void {
      state = applyEditorAction(state, action);
    },
    confirmRead(scope: EditorScope, path: string, content: string | null): void {
      // The editor reducer's same-spot rules do the right thing: a dirty
      // retained draft is kept, a clean entry adopts the fresh read.
      state = applyEditorAction(state, {
        type: "file-opened",
        scope,
        path,
        content,
      });
    },
    recordDraft(scope: EditorScope, path: string, draft: string): void {
      // Make the requested file the store's open file FIRST (restoring its
      // retained entry when it has one), then apply the edit so the draft
      // lands on the right scoped entry — never on a foreign open file.
      if (openFileKey(state) !== scopedFileKey(scope, path)) {
        state = applyEditorAction(state, {
          type: "file-opened",
          scope,
          path,
          content: null,
        });
      }
      state = applyEditorAction(state, { type: "edited", value: draft });
    },
    markSaved(scope: EditorScope, path: string, draft: string): void {
      const key = scopedFileKey(scope, path);
      // Drive the editor's own save fencing so retained state updates only
      // for the exact scoped file, never the wrong active draft.
      if (openFileKey(state) !== key) {
        state = applyEditorAction(state, {
          type: "file-opened",
          scope,
          path,
          content: null,
        });
      }
      const generation = ++storeGeneration;
      state = applyEditorAction(state, {
        type: "save-started",
        key,
        path,
        draft,
        generation,
        allowEmpty: true,
      });
      state = applyEditorAction(state, {
        type: "save-succeeded",
        key,
        generation,
      });
    },
    draftOf(scope: EditorScope, path: string): string | null {
      const entry = state.files[scopedFileKey(scope, path)];
      return entry?.draft ?? null;
    },
    savedContentOf(scope: EditorScope, path: string): string | null {
      const entry = state.files[scopedFileKey(scope, path)];
      return entry?.lastSaved ?? null;
    },
    externalContentOf(scope: EditorScope, path: string): string | null {
      // Open-file-scoped, like the flag it mirrors: a retained conflict
      // for another file must never leak into this pane's content prop.
      if (openFileKey(state) !== scopedFileKey(scope, path)) return null;
      return externalContentFor(state);
    },
    isDirty(scope: EditorScope, path: string): boolean {
      const entry = state.files[scopedFileKey(scope, path)];
      return entry !== undefined && entry.draft !== entry.lastSaved;
    },
  };
}

/**
 * What the editor should display for a file: a dirty retained draft from
 * the store (so unmount/remount never loses the user's work), otherwise
 * the service's confirmed content. Clean files always follow the service —
 * it remains saved-truth.
 */
export function editorContentFor(
  store: FilesDraftStore,
  scope: EditorScope,
  path: string | null,
  serviceContent: string | null,
): string | null {
  if (path === null) return null;
  if (store.isDirty(scope, path)) return store.draftOf(scope, path);
  return serviceContent;
}
