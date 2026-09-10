// MIT Copyright (c) 2026 Lovecast Inc.
// Re-exported controller entry point, mirroring the read-only reference
// `src/renderer/src/components/mentu/use-recipe-pane-controller.ts`.
export { useMentuPaneController } from "./recipe-pane-controller";
export type { MentuPaneController, MentuReview } from "./recipe-pane-controller";
// C03 consumption path: the approved-selection binding/conflict helpers
// the inspector and its editor share (the controller owns the live
// bridge/store wiring; these pure helpers stay importable from the same
// entry point siblings already use).
export {
  bindApproval,
  classifySelection,
  conflictMessage,
  detectSaveConflict,
  isBindingValid,
} from "./mentu-approved-selection";
export type {
  ApprovalBinding,
  ApprovedSelection,
  ApprovedSelectionVerdict,
  ApprovedSelectionVerdictKind,
  SaveConflict,
} from "./mentu-approved-selection";
