// Shared Mentu state (journey J9): the right-panel surface and the wider
// tab opened from "+" must show the same selected recipe, draft, run,
// inspector mode and selected graph node for a workspace. A tiny external
// store (useSyncExternalStore) rather than a new state-management
// dependency: this module is the one place both mounts read/write.

import { useSyncExternalStore } from "react";
import type { MentuRun, MentuStepEvidence } from "../../../../shared/mentu-contract";
import type { MentuPaneMode } from "../../../../shared/persistence-contracts/mentu-pane-types";

export type MentuState = {
  selectedRecipeId: string | null;
  draftSource: string;
  activeRunId: string | null;
  /** The newest known run row, published by whichever mount (panel or tab)
   *  started, retried, cancelled or polled it last; every mount showing the
   *  same recipe adopts it so the two never disagree about run status. */
  activeRun: MentuRun | null;
  mode: MentuPaneMode;
  selectedNodeId: string | null;
  /** Loaded stdio evidence per daemon run id, shared by the panel and tab
   *  mounts so selecting the same run twice never re-reads its files. */
  evidenceByRunId: Record<string, MentuStepEvidence[]>;
};

const EMPTY_STATE: MentuState = {
  selectedRecipeId: null,
  draftSource: "",
  activeRunId: null,
  activeRun: null,
  mode: "graph",
  selectedNodeId: null,
  evidenceByRunId: {},
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
