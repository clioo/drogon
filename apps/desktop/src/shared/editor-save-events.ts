// Source provenance: Lovecast Inc. MIT source c97906287bb7a390b25e2025b600d9fb3c25d9c3,
// src/shared/editor-save-events.ts (SHA256 2fb1adac742aa3795ad7ef0d9ae4982da9c30134be5059ee6a0d3cd9d22bacf2).

export const ORCA_EDITOR_SAVE_DIRTY_FILES_EVENT =
  "orca:editor-save-dirty-files";
export const ORCA_EDITOR_PREPARE_HOT_EXIT_EVENT =
  "orca:editor-prepare-hot-exit";

export type EditorSaveDirtyFilesDetail = {
  claim: () => void;
  resolve: () => void;
  reject: (message: string) => void;
};

export type EditorPrepareHotExitDetail = EditorSaveDirtyFilesDetail;
