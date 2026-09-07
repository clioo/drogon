// Shared Mentu state (journey J9): the right-panel surface and the wider
// tab opened from "+" must show the same selected recipe, draft and run
// state for a workspace. A tiny external store (useSyncExternalStore)
// rather than a new state-management dependency: this module is the one
// place both mounts read/write, per the task's "one store module in
// features/mentu" instruction.

import { useSyncExternalStore } from "react";

export type MentuState = {
  selectedRecipeId: string | null;
  draftSource: string;
  activeRunId: string | null;
};

const EMPTY_STATE: MentuState = {
  selectedRecipeId: null,
  draftSource: "",
  activeRunId: null,
};

type Listener = () => void;

class MentuStore {
  private statesByWorkspace = new Map<string, MentuState>();
  private listeners = new Set<Listener>();

  get(workspaceId: string): MentuState {
    return this.statesByWorkspace.get(workspaceId) ?? EMPTY_STATE;
  }

  set(workspaceId: string, patch: Partial<MentuState>): void {
    const next = { ...this.get(workspaceId), ...patch };
    this.statesByWorkspace.set(workspaceId, next);
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** Process-wide singleton: both the panel mount and the tab mount import
 *  this exact module instance, so a selection made in one shows up in the
 *  other immediately. */
export const mentuStore = new MentuStore();

export function useMentuState(
  workspaceId: string,
): [MentuState, (patch: Partial<MentuState>) => void] {
  const state = useSyncExternalStore(
    (listener) => mentuStore.subscribe(listener),
    () => mentuStore.get(workspaceId),
  );
  const setState = (patch: Partial<MentuState>) =>
    mentuStore.set(workspaceId, patch);
  return [state, setState];
}
