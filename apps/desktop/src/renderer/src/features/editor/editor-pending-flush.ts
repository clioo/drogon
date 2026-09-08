// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/editor/editor-pending-flush.ts (verbatim
// logic; keyed here by the editor's scoped file key instead of a tab id).

const pendingEditorFlushes = new Map<string, () => void>();

/** Registers the flush for the given scoped key; returns an unregister function. */
export function registerPendingEditorFlush(key: string, flush: () => void): () => void {
  pendingEditorFlushes.set(key, flush);
  return () => {
    if (pendingEditorFlushes.get(key) === flush) {
      pendingEditorFlushes.delete(key);
    }
  };
}

/** Forces any debounced draft-record for `key` out immediately, if one is pending. */
export function flushPendingEditorChange(key: string): void {
  pendingEditorFlushes.get(key)?.();
}
