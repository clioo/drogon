// MIT Copyright (c) 2026 Lovecast Inc. The "Changes" half of the fork's
// Edit/Changes toggle (EditorViewToggle 'changes': uncommitted changes,
// working tree vs HEAD). Loading mirrors
// features/source-control/ChangesPanel.tsx's gitDiff effect (same
// `gitDiff` RPC, same `reconstructDiffContent` excerpt reconstruction,
// same read-only Monaco DiffViewer); the side-by-side/inline switch and
// diff prev/next navigation from the fork's diff-surface header are NOT
// ported (no backend-free equivalent in this task's scope), so the view
// renders side-by-side like the Changes panel's default.
import { lazy, Suspense, useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import type { EditorScheme } from "./editor-theme";
import { reconstructDiffContent } from "../source-control/diff/diff-hunk-reconstruction";

// Why lazy: `@monaco-editor/react` assumes browser globals (see
// EditorPane.tsx's MonacoFileEditor note). The dynamic import only fires
// once a real renderer mounts the Suspense boundary, so plain-Node
// `renderToString` specs never load Monaco.
const DiffViewer = lazy(() =>
  import("../source-control/diff/DiffViewer").then((mod) => ({
    default: mod.DiffViewer,
  })),
);

/** Outcome of the injected per-file uncommitted-changes load. */
export type ChangesLoadResult =
  | { ok: true; diff: string; truncated: boolean }
  | { ok: false; message: string };

type ChangesPhase =
  | { kind: "loading" }
  | { kind: "ready"; diff: string }
  | { kind: "error"; message: string };

export function EditorChangesView({
  path,
  scheme,
  wordWrap,
  showWhitespace,
  loadChanges,
  onBackToEdit,
}: {
  path: string;
  scheme: EditorScheme;
  wordWrap: boolean;
  showWhitespace: boolean;
  /** Injected git-diff load (the pane never touches the bridge itself). */
  loadChanges: (path: string) => Promise<ChangesLoadResult>;
  onBackToEdit: () => void;
}): React.JSX.Element {
  const [phase, setPhase] = useState<ChangesPhase>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setPhase({ kind: "loading" });
    void loadChanges(path).then((result) => {
      if (cancelled) return;
      setPhase(
        result.ok
          ? { kind: "ready", diff: result.diff }
          : { kind: "error", message: result.message },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [path, loadChanges]);

  if (phase.kind === "loading") {
    return (
      <div className="editor-pane-loading" role="status">
        Loading changes…
      </div>
    );
  }
  if (phase.kind === "error") {
    return (
      <div className="error-banner" role="alert">
        <span>{phase.message}</span>
        <Button variant="outline" size="sm" onClick={onBackToEdit}>
          Back to Edit
        </Button>
      </div>
    );
  }
  const reconstructed = reconstructDiffContent(phase.diff);
  if (!reconstructed.hasContent) {
    return (
      <div className="editor-pane-loading" role="status">
        No uncommitted changes for this file.
      </div>
    );
  }
  if (typeof document === "undefined") {
    return <div className="editor-pane-loading">Loading editor…</div>;
  }
  return (
    <Suspense fallback={<div className="editor-pane-loading">Loading editor…</div>}>
      <DiffViewer
        path={path}
        original={reconstructed.original}
        modified={reconstructed.modified}
        scheme={scheme}
        sideBySide
        wordWrap={wordWrap}
        showWhitespace={showWhitespace}
      />
    </Suspense>
  );
}
