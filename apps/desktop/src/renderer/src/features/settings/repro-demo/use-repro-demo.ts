// The panel's view over the demo store. The run itself lives outside React
// (`repro-demo-store.ts`) because the tour unmounts this panel mid-run when it
// takes the viewer to the Work Graph; this hook only reads that state and
// starts or cancels a run.

import { useSyncExternalStore } from "react";

import {
  cancelReproDemo,
  getReproDemoState,
  runReproDemo,
  subscribeReproDemo,
  type ReproDemoBridge,
  type ReproDemoDeps,
  type ReproDemoOptions,
  type ReproDemoState,
} from "./repro-demo-store";

export type {
  BotRunReceiptView,
  EvidenceEntry,
  ReproDemoBridge,
  ReproDemoDeps,
  ReproDemoOptions,
  ReproDemoState,
  UsageEntry,
} from "./repro-demo-store";
export {
  dispatchPrompt,
  mainNodeFor,
  policyFor,
  releaseInstructions,
  resetReproDemo,
} from "./repro-demo-store";

export function useReproDemo(
  bridge: ReproDemoBridge | null,
  deps: ReproDemoDeps = {},
): {
  state: ReproDemoState;
  run: (options: ReproDemoOptions) => Promise<void>;
  cancel: () => void;
} {
  const state = useSyncExternalStore(subscribeReproDemo, getReproDemoState);
  return {
    state,
    run: (options: ReproDemoOptions) => runReproDemo(bridge, options, deps),
    cancel: cancelReproDemo,
  };
}
