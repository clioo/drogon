// MIT Copyright (c) 2026 Lovecast Inc.
// The Orchestrator's ONLY write path for the Subagent policy panel:
// `graph.write_intent` with the CURRENT nodes resent unchanged alongside
// the edited policy (see `graph-contract.ts`'s doc on why a write that
// silently dropped `nodes` would wipe the human's own graph). Tracks
// whether the most recent save actually succeeded so the canvas's
// "Saved automatically" label can be honest — never a checkmark for a
// write that failed.

import { useCallback, useRef, useState } from "react";
import type {
  GraphBridge,
  GraphPolicy,
} from "../../../../shared/graph-contract";
import {
  DEFAULT_GRAPH_POLICY,
  resolveGraphPolicy,
} from "../../../../shared/graph-contract";
import type { WorkGraphDocument } from "../../../../shared/work-graph-contract";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export function useSubagentPolicy({
  graphBridge,
  workspaceId,
  document,
  allowEmptyStart = false,
  onSaved,
}: {
  graphBridge: GraphBridge | null;
  workspaceId: string;
  document: WorkGraphDocument | null;
  /** True exactly when `document` is null because the workspace genuinely
   *  has no `.drogon/graph.json` yet (`useWorkGraphSource`'s `"missing"`
   *  read outcome) — safe to start `nodes: []` from. False for every other
   *  reason `document` is null (an unreadable or too-large file): writing
   *  `nodes: []` there would silently REPLACE real content the pane simply
   *  could not read, exactly the trap `WorkGraphDesigner`'s own
   *  `designBlockedReason` guards against — this hook applies the same
   *  rule to the policy panel's writes. */
  allowEmptyStart?: boolean;
  /** Called after a successful save so the caller can re-poll the graph. */
  onSaved?: () => void;
}): {
  policy: GraphPolicy;
  saveStatus: SaveStatus;
  saveError: string | null;
  interactive: boolean;
  save: (next: GraphPolicy) => void;
} {
  const policy = document
    ? resolveGraphPolicy(document.intent)
    : DEFAULT_GRAPH_POLICY;
  const canWrite = document !== null || allowEmptyStart;
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  // Only the LATEST save's outcome matters for the status chip; an older
  // in-flight write settling after a newer one must never overwrite it.
  const generation = useRef(0);

  const save = useCallback(
    (next: GraphPolicy) => {
      if (!graphBridge || !canWrite) return;
      const gen = (generation.current += 1);
      setSaveStatus("saving");
      setSaveError(null);
      void graphBridge
        .graphWriteIntent({
          workspaceId,
          intent: {
            nodes: (document?.intent.nodes ?? []) as unknown[],
            policy: next,
          },
        })
        .then((result) => {
          if (generation.current !== gen) return;
          if (!result.ok) {
            setSaveStatus("error");
            setSaveError(result.error.message);
            return;
          }
          setSaveStatus("saved");
          onSaved?.();
        });
    },
    [graphBridge, workspaceId, document, canWrite, onSaved],
  );

  return {
    policy,
    saveStatus,
    saveError,
    interactive: Boolean(graphBridge && canWrite),
    save,
  };
}
