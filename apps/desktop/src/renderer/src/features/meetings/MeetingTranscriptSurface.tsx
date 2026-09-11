// MIT Copyright (c) 2026 Lovecast Inc.
// The note itself, rendered with this repo's EXISTING editor component
// (features/editor/MonacoFileEditor) in read-only mode — not a new viewer.
// The fork opens a transcript as a read-only editor tab inside a folder
// workspace it registers for the notes root; this build has no read-only
// editor tab mode and registering that folder would put the owner's notes
// one autosave away from being modified, which the read-only boundary
// forbids. So the same component renders here, and the same large-content
// fallback EditorPane uses applies (shouldUseLargeFileFallback).
import { Suspense, lazy } from "react";
import { useEditorScheme } from "../editor/editor-theme";
import {
  LARGE_FILE_MONACO_CHAR_LIMIT,
  shouldUseLargeFileFallback,
} from "../editor/editor-large-file-guard";

const MonacoFileEditor = lazy(async () => {
  const module = await import("../editor/MonacoFileEditor");
  return { default: module.MonacoFileEditor };
});

/**
 * Which surface a note gets. Pure so the decision is testable and so the
 * Node render (no DOM, e.g. server-rendered contract tests) never imports
 * Monaco.
 */
export function transcriptSurfaceKind(input: {
  contentLength: number;
  hasDom: boolean;
}): "monaco" | "plain" {
  if (!input.hasDom) return "plain";
  return shouldUseLargeFileFallback(input.contentLength) ? "plain" : "monaco";
}

function hasDom(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function MeetingTranscriptSurface({
  filePath,
  fileName,
  content,
}: {
  filePath: string;
  fileName: string;
  content: string;
}): React.JSX.Element {
  const scheme = useEditorScheme();
  const kind = transcriptSurfaceKind({ contentLength: content.length, hasDom: hasDom() });
  if (kind === "plain") {
    return (
      <textarea
        className="editor-pane-large-file-fallback"
        readOnly
        aria-label={`Read-only preview of ${fileName} ${
          content.length > LARGE_FILE_MONACO_CHAR_LIMIT
            ? "(too large for the code editor)"
            : ""
        }`.trim()}
        value={content}
      />
    );
  }
  return (
    <Suspense fallback={<div className="editor-pane-loading">Loading editor…</div>}>
      <MonacoFileEditor
        key={filePath}
        path={filePath}
        content={content}
        scheme={scheme}
        readOnly
        onChange={() => {
          // Read-only: the owner's notes are never edited from Drogon. The
          // editor is mounted with readOnly, so this is unreachable in the
          // product path; it exists because the component's contract
          // requires the handler.
        }}
        onRequestSave={() => {
          // Read-only surface: there is no save path at all.
        }}
      />
    </Suspense>
  );
}
