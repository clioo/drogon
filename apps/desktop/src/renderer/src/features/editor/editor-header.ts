// MIT Copyright (c) 2026 Lovecast Inc. Adapted from Orca's
// src/renderer/src/components/editor/editor-header.ts. The source computes
// copy/open-file state across many OpenFile tab modes (diff, check-details,
// combined diff, conflict review); this rewrite's EditorPane only shows a
// single plain-edit file (diffs live in the separate source-control
// DiffViewer), so the header projection collapses to one path label plus
// the dirty/changed-on-disk/save-in-flight/error state the pane already
// tracks in its reducer.
import { getEditorDisplayLabel } from "./editor-labels";

export type EditorHeaderSaveLabel = "Save" | "Saving…" | "Retry save";

export type EditorHeaderState = {
  pathLabel: string;
  pathTitle: string;
  copyText: string;
  copyToastLabel: string;
  dirty: boolean;
  changedOnDisk: boolean;
  saveLabel: EditorHeaderSaveLabel;
  saveDisabled: boolean;
};

export function getEditorHeaderState(input: {
  path: string;
  dirty: boolean;
  changedOnDisk: boolean;
  saveInFlight: boolean;
  hasSaveError: boolean;
  canSave: boolean;
}): EditorHeaderState {
  const pathLabel = getEditorDisplayLabel(input.path, "relativePath");
  return {
    pathLabel,
    pathTitle: pathLabel,
    copyText: input.path,
    copyToastLabel: "File path copied",
    dirty: input.dirty,
    changedOnDisk: input.changedOnDisk,
    saveLabel: input.saveInFlight ? "Saving…" : input.hasSaveError ? "Retry save" : "Save",
    saveDisabled: !input.dirty || !input.canSave,
  };
}
