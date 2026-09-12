// MIT Copyright (c) 2026 Lovecast Inc.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_GRAPH_POLICY,
  resolveGraphPolicy,
  type GraphBridge,
  type GraphPolicy,
  type DesignableIntentNode,
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
  allowEmptyStart?: boolean;
  onSaved?: () => void;
}) {
  const remote = document
    ? resolveGraphPolicy(document.intent)
    : DEFAULT_GRAPH_POLICY;
  const [draft, setDraft] = useState<{
    workspaceId: string;
    policy: GraphPolicy;
  } | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const queue = useRef(Promise.resolve(true));
  const generation = useRef(0);
  const currentWorkspace = useRef(workspaceId);
  currentWorkspace.current = workspaceId;
  const canWrite = document !== null || allowEmptyStart;
  useEffect(() => {
    generation.current++;
    setSaveStatus("idle");
    setSaveError(null);
  }, [workspaceId]);
  const save = useCallback(
    (next: GraphPolicy, main?: DesignableIntentNode) => {
      if (!graphBridge?.graphWritePolicy || !canWrite) return;
      const gen = ++generation.current;
      setDraft({ workspaceId, policy: next });
      setSaveStatus("saving");
      setSaveError(null);
      // Serialize edits; policy-only writes preserve concurrently added nodes.
      queue.current = queue.current
        .catch(() => false)
        .then(async () => {
          try {
            const result = await graphBridge.graphWritePolicy!({
              workspaceId,
              policy: next,
              ...(main ? { main } : {}),
            });
            if (
              currentWorkspace.current === workspaceId &&
              generation.current === gen
            ) {
              setSaveStatus(result.ok ? "saved" : "error");
              setSaveError(result.ok ? null : result.error.message);
              if (result.ok) onSaved?.();
            }
            return result.ok;
          } catch (error) {
            if (
              currentWorkspace.current === workspaceId &&
              generation.current === gen
            ) {
              setSaveStatus("error");
              setSaveError(
                error instanceof Error ? error.message : String(error),
              );
            }
            return false;
          }
        });
    },
    [graphBridge, workspaceId, canWrite, onSaved],
  );
  const flush = useCallback(async () => {
    let pending;
    do {
      pending = queue.current;
      await pending;
    } while (pending !== queue.current);
    return pending;
  }, []);
  return {
    policy: draft?.workspaceId === workspaceId ? draft.policy : remote,
    saveStatus,
    saveError,
    interactive: Boolean(graphBridge?.graphWritePolicy && canWrite),
    save,
    flush,
  };
}
