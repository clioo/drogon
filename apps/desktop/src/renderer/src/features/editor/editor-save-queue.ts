// MIT Copyright (c) 2026 Lovecast Inc. Adapted from Orca's
// src/renderer/src/components/editor/editor-save-queue.ts. The source queue
// is coupled to a zustand `OpenFile`/`editorDrafts` store and a runtime file
// client; this rewrite has neither, so the queue is generic over an
// injected `run` callback keyed by the editor's scoped file key. The
// per-key promise chaining and the debounce timers are kept together for
// the same reason the source keeps them together: an autosave timer must
// never race a manual save for the same file.

export type EditorSaveQueue = {
  /**
   * Chains `run` onto any save already queued for `key`, so overlapping
   * saves for the SAME file always execute one at a time, in order — never
   * concurrently, never dropped. A prior failure never blocks the next
   * queued save (the chain recovers via `.catch`).
   */
  queueSave(key: string, run: () => Promise<void>): Promise<void>;
  /** Resolves once any in-flight/queued save for `key` has settled, without scheduling a new one. */
  quiesce(key: string): Promise<void>;
  /** (Re)schedules a debounced autosave for `key`, cancelling any pending one first. */
  scheduleAutosave(key: string, delayMs: number, run: () => Promise<void>): void;
  /** Cancels a pending autosave timer for `key`, if any. */
  cancelAutosave(key: string): void;
  /** Clears every pending timer and forgets every tracked chain (unmount). */
  dispose(): void;
};

export function createEditorSaveQueue(): EditorSaveQueue {
  const saveChains = new Map<string, Promise<void>>();
  const autosaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const queueSave = (key: string, run: () => Promise<void>): Promise<void> => {
    const previous = saveChains.get(key) ?? Promise.resolve();
    const chained = previous.catch(() => undefined).then(run);
    const tracked: Promise<void> = chained.finally(() => {
      if (saveChains.get(key) === tracked) {
        saveChains.delete(key);
      }
    });
    saveChains.set(key, tracked);
    return tracked;
  };

  const quiesce = (key: string): Promise<void> => {
    return (saveChains.get(key) ?? Promise.resolve()).catch(() => undefined);
  };

  const cancelAutosave = (key: string): void => {
    const timer = autosaveTimers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      autosaveTimers.delete(key);
    }
  };

  const scheduleAutosave = (key: string, delayMs: number, run: () => Promise<void>): void => {
    cancelAutosave(key);
    const timer = setTimeout(() => {
      autosaveTimers.delete(key);
      void queueSave(key, run);
    }, delayMs);
    autosaveTimers.set(key, timer);
  };

  const dispose = (): void => {
    for (const timer of autosaveTimers.values()) {
      clearTimeout(timer);
    }
    autosaveTimers.clear();
    saveChains.clear();
  };

  return { queueSave, quiesce, scheduleAutosave, cancelAutosave, dispose };
}
