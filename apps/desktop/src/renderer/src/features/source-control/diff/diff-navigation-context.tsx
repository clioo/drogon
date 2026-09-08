// MIT Copyright (c) 2026 Lovecast Inc. Adapted from Orca's
// src/renderer/src/components/editor/diff-navigation-context.tsx. Dropped:
// `installMonacoDiffChangeNavigationShortcut` (F7/Shift+F7), which lives in
// the source's editor-shortcuts.ts — not named by this task, and Monaco's
// diff editor already binds Alt+F5/Shift+Alt+F5 "Go to Next/Previous
// Difference" by default, so change navigation works without it. The
// Context/Provider split is kept even though this rewrite only ever mounts
// one DiffViewer at a time (single-file selection in Source Control): it
// costs nothing extra and is exactly the seam the deferred multi-file
// CombinedDiffViewer would plug into.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { editor } from "monaco-editor";

export type DiffEditorRegistrationContextValue = {
  registerDiffEditor: (editor: editor.IStandaloneDiffEditor) => void;
  unregisterDiffEditor: (editor: editor.IStandaloneDiffEditor) => void;
};

export type DiffNavigationContextValue = {
  goToPreviousDiff: () => void;
  goToNextDiff: () => void;
  changeCount: number;
};

const noop = (): void => {};

// Why: registration stays separate from changeCount so diff recomputation only
// rerenders the header controls, not the heavy Monaco DiffViewer consumer.
const DiffEditorRegistrationContext =
  createContext<DiffEditorRegistrationContextValue>({
    registerDiffEditor: noop,
    unregisterDiffEditor: noop,
  });

const DiffNavigationContext = createContext<DiffNavigationContextValue>({
  goToPreviousDiff: noop,
  goToNextDiff: noop,
  changeCount: 0,
});

function countChanges(diffEditor: editor.IStandaloneDiffEditor): number {
  return diffEditor.getLineChanges()?.length ?? 0;
}

export function DiffNavigationProvider({ children }: { children: ReactNode }) {
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const updateSubRef = useRef<{ dispose: () => void } | null>(null);
  const [changeCount, setChangeCount] = useState(0);

  const registerDiffEditor = useCallback(
    (diffEditor: editor.IStandaloneDiffEditor) => {
      editorRef.current = diffEditor;
      // Hold at most one update subscription; replace any prior editor's.
      updateSubRef.current?.dispose();
      updateSubRef.current = diffEditor.onDidUpdateDiff(() => {
        // Why: ignore updates from an editor that is no longer current so a stale
        // subscription in the fast-swap case can't write a wrong count.
        if (editorRef.current === diffEditor) {
          setChangeCount(countChanges(diffEditor));
        }
      });
      setChangeCount(countChanges(diffEditor));
    },
    [],
  );

  const unregisterDiffEditor = useCallback(
    (diffEditor: editor.IStandaloneDiffEditor) => {
      // Why: identity guard for the fast-swap race — a stale dispose carrying the
      // old editor must not wipe a freshly-registered new one.
      if (editorRef.current !== diffEditor) {
        return;
      }
      updateSubRef.current?.dispose();
      updateSubRef.current = null;
      editorRef.current = null;
      setChangeCount(0);
    },
    [],
  );

  const goToPreviousDiff = useCallback(() => {
    editorRef.current?.goToDiff("previous");
  }, []);

  const goToNextDiff = useCallback(() => {
    editorRef.current?.goToDiff("next");
  }, []);

  useEffect(() => {
    return () => {
      updateSubRef.current?.dispose();
      updateSubRef.current = null;
    };
  }, []);

  const registrationValue = useMemo(
    () => ({ registerDiffEditor, unregisterDiffEditor }),
    [registerDiffEditor, unregisterDiffEditor],
  );
  const navigationValue = useMemo(
    () => ({ goToPreviousDiff, goToNextDiff, changeCount }),
    [goToPreviousDiff, goToNextDiff, changeCount],
  );

  return (
    <DiffEditorRegistrationContext.Provider value={registrationValue}>
      <DiffNavigationContext.Provider value={navigationValue}>
        {children}
      </DiffNavigationContext.Provider>
    </DiffEditorRegistrationContext.Provider>
  );
}

export function useDiffEditorRegistration(): DiffEditorRegistrationContextValue {
  return useContext(DiffEditorRegistrationContext);
}

export function useDiffNavigation(): DiffNavigationContextValue {
  return useContext(DiffNavigationContext);
}
