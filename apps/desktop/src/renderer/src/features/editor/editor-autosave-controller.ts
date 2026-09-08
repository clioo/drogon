// MIT Copyright (c) 2026 Lovecast Inc. Adapted from Orca's
// src/renderer/src/components/editor/editor-autosave-controller.ts. The
// source controller wires a zustand store subscription plus a handful of
// window-level save/quiesce/hot-exit events across the whole multi-tab
// editor. This rewrite has one EditorPane and one open file at a time, so
// the controller collapses to: whenever the open file is dirty and
// admissible to save, (re)schedule a debounced autosave through the same
// `editor-save-queue.ts` queue the Save button and Cmd+S use; whenever it
// stops being dirty (or a save starts), cancel the pending timer. The
// decision is a pure function (`computeAutosavePlan`) so it is testable
// without mounting React at all.
import { useEffect, useRef } from "react";
import type { EditorSaveQueue } from "./editor-save-queue";

/** Matches the source's default: long enough to not fight typing, short enough to feel automatic. */
export const AUTOSAVE_DELAY_MS = 800;

export type EditorAutosavePlan =
  | { action: "cancel"; key: string | null }
  | { action: "schedule"; key: string };

/**
 * Whether the currently open file should have a debounced autosave pending.
 * Mirrors `saveAdmission` minus the dirty check itself (the caller passes
 * `dirty` so this can decide "cancel because clean" distinctly from
 * "cancel because not admissible for another reason"), plus the fork's
 * conflict suspension (source
 * src/renderer/src/components/editor/editor-autosave.ts
 * `isAutosaveSuspendedForFile`): while the disk moved out from under a
 * dirty draft, autosave must not silently overwrite the newer external
 * content — only an explicit user save may resolve the conflict.
 */
export function computeAutosavePlan(input: {
  key: string | null;
  dirty: boolean;
  saveInFlight: boolean;
  readConfirmedOrAllowEmpty: boolean;
  /** The pane's changed-on-disk mark for the open file. */
  suspended?: boolean;
}): EditorAutosavePlan {
  if (
    input.key === null ||
    input.saveInFlight ||
    !input.dirty ||
    !input.readConfirmedOrAllowEmpty ||
    input.suspended === true
  ) {
    return { action: "cancel", key: input.key };
  }
  return { action: "schedule", key: input.key };
}

/**
 * Wires `computeAutosavePlan` to the save queue's debounce timer. Depends
 * on `draft` (not just `dirty`) so every keystroke re-debounces the timer —
 * the save fires `delayMs` after the LAST edit, not the first.
 */
export function useEditorAutosaveController(input: {
  queue: EditorSaveQueue;
  key: string | null;
  draft: string;
  dirty: boolean;
  saveInFlight: boolean;
  readConfirmedOrAllowEmpty: boolean;
  /** Fork parity: suspend while the disk moved under a dirty draft. */
  suspended?: boolean;
  delayMs?: number;
  run: () => Promise<void>;
}): void {
  const runRef = useRef(input.run);
  runRef.current = input.run;
  const delayMs = input.delayMs ?? AUTOSAVE_DELAY_MS;

  useEffect(() => {
    const plan = computeAutosavePlan(input);
    if (plan.key === null) return;
    if (plan.action === "cancel") {
      input.queue.cancelAutosave(plan.key);
      return;
    }
    input.queue.scheduleAutosave(plan.key, delayMs, () => runRef.current());
    return () => input.queue.cancelAutosave(plan.key as string);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.queue, input.key, input.draft, input.dirty, input.saveInFlight, input.readConfirmedOrAllowEmpty, input.suspended, delayMs]);
}
