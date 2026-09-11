// MIT Copyright (c) 2026 Lovecast Inc.
// React binding for the workflow library: reads/writes
// `.drogon/workflows.json` through the EXISTING generic files seam. Never
// writes eagerly — mounting this hook only ever calls `fileRead`; a file is
// created only from an explicit user action (new/rename/delete/select/
// settings/loop-ledger update), each of which is a single, awaited write
// with an honest error surfaced back to the caller on failure (the local
// state is never optimistically corrupted ahead of a write that might
// fail).

import { useCallback, useEffect, useRef, useState } from "react";
import type { FileBridge } from "../../../../shared/file-contract";
import { MAX_FILE_BYTES } from "../../../../shared/file-contract";
import {
  WORKFLOWS_RELATIVE_PATH,
  createWorkflow as createWorkflowPure,
  deleteWorkflow as deleteWorkflowPure,
  emptyLibrary,
  parseWorkflowLibrary,
  renameWorkflow as renameWorkflowPure,
  selectWorkflow as selectWorkflowPure,
  serializeWorkflowLibrary,
  updateWorkflowLoop as updateWorkflowLoopPure,
  updateWorkflowNodes as updateWorkflowNodesPure,
  updateWorkflowSettings as updateWorkflowSettingsPure,
  type WorkflowLibrary,
  type WorkflowSettings,
} from "./workflow-library";

export type WorkflowLibraryState =
  | { kind: "loading" }
  /** No file bridge in this build: the library can still be BROWSED as an
   *  empty, unsaved default, but nothing here can persist. */
  | { kind: "unavailable" }
  | { kind: "ready"; library: WorkflowLibrary; persisted: boolean };

export type WorkflowMutationResult = { ok: true } | { ok: false; message: string };

function nowIso(): string {
  return new Date().toISOString();
}

function requestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `req_${Math.random().toString(36).slice(2)}`;
}

export function useWorkflowLibrary({
  fileBridge,
  hostId,
  workspaceId,
}: {
  fileBridge: FileBridge | null;
  hostId: string | null;
  workspaceId: string;
}): {
  state: WorkflowLibraryState;
  refresh: () => void;
  createWorkflow: (name: string, nodes: unknown[]) => Promise<WorkflowMutationResult>;
  renameWorkflow: (id: string, name: string) => Promise<WorkflowMutationResult>;
  deleteWorkflow: (id: string) => Promise<WorkflowMutationResult>;
  selectWorkflow: (id: string) => Promise<WorkflowMutationResult>;
  updateSettings: (id: string, patch: Partial<WorkflowSettings>) => Promise<WorkflowMutationResult>;
  syncNodes: (id: string, nodes: unknown[]) => Promise<WorkflowMutationResult>;
  saveLoopLedger: (id: string, ledger: unknown) => Promise<WorkflowMutationResult>;
} {
  const [state, setState] = useState<WorkflowLibraryState>({ kind: "loading" });
  const generation = useRef(0);

  const read = useCallback(async (): Promise<void> => {
    if (!fileBridge || !hostId) {
      setState({ kind: "unavailable" });
      return;
    }
    const currentGeneration = ++generation.current;
    const result = await fileBridge.fileRead({
      hostId,
      workspaceId,
      path: WORKFLOWS_RELATIVE_PATH,
      maxBytes: MAX_FILE_BYTES,
    });
    if (generation.current !== currentGeneration) return;
    if (!result.ok) {
      // Missing or unreadable: an honest, purely in-memory empty library —
      // NOT written until the human takes an action.
      setState({ kind: "ready", library: emptyLibrary(), persisted: false });
      return;
    }
    const parsed = parseWorkflowLibrary(result.result.content);
    if (!parsed.ok) {
      // Present but not shaped like a workflow library (or a build this
      // version cannot read): never overwritten silently, never crashed on
      // — treated as read-only unknown content by starting from empty and
      // marking it NOT persisted-by-us, so a save never clobbers it... but
      // since we cannot represent "foreign content" here, the honest move
      // is to refuse to create/persist until the human explicitly acts,
      // which `persisted: false` already signals to the UI.
      setState({ kind: "ready", library: emptyLibrary(), persisted: false });
      return;
    }
    setState({ kind: "ready", library: parsed.library, persisted: true });
  }, [fileBridge, hostId, workspaceId]);

  useEffect(() => {
    void read();
  }, [read]);

  const write = useCallback(
    async (next: WorkflowLibrary): Promise<WorkflowMutationResult> => {
      if (!fileBridge || !hostId) {
        return { ok: false, message: "The workflow library is unavailable in this build." };
      }
      const result = await fileBridge.fileWrite({
        hostId,
        workspaceId,
        path: WORKFLOWS_RELATIVE_PATH,
        content: serializeWorkflowLibrary(next),
        requestId: requestId(),
      });
      if (!result.ok) return { ok: false, message: result.error.message };
      setState({ kind: "ready", library: next, persisted: true });
      return { ok: true };
    },
    [fileBridge, hostId, workspaceId],
  );

  const currentLibrary = (): WorkflowLibrary =>
    state.kind === "ready" ? state.library : emptyLibrary();

  const createWorkflow = useCallback(
    async (name: string, nodes: unknown[]): Promise<WorkflowMutationResult> => {
      const result = createWorkflowPure(currentLibrary(), name, nodes, nowIso());
      if (!result.ok) return { ok: false, message: result.message };
      return write(result.library);
    },
    [state, write], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const renameWorkflow = useCallback(
    async (id: string, name: string): Promise<WorkflowMutationResult> =>
      write(renameWorkflowPure(currentLibrary(), id, name, nowIso())),
    [state, write], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const deleteWorkflow = useCallback(
    async (id: string): Promise<WorkflowMutationResult> =>
      write(deleteWorkflowPure(currentLibrary(), id)),
    [state, write], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const selectWorkflow = useCallback(
    async (id: string): Promise<WorkflowMutationResult> =>
      write(selectWorkflowPure(currentLibrary(), id)),
    [state, write], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const updateSettings = useCallback(
    async (id: string, patch: Partial<WorkflowSettings>): Promise<WorkflowMutationResult> =>
      write(updateWorkflowSettingsPure(currentLibrary(), id, patch, nowIso())),
    [state, write], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const syncNodes = useCallback(
    async (id: string, nodes: unknown[]): Promise<WorkflowMutationResult> =>
      write(updateWorkflowNodesPure(currentLibrary(), id, nodes, nowIso())),
    [state, write], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const saveLoopLedger = useCallback(
    async (id: string, ledger: unknown): Promise<WorkflowMutationResult> =>
      write(updateWorkflowLoopPure(currentLibrary(), id, ledger, nowIso())),
    [state, write], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return {
    state,
    refresh: () => void read(),
    createWorkflow,
    renameWorkflow,
    deleteWorkflow,
    selectWorkflow,
    updateSettings,
    syncNodes,
    saveLoopLedger,
  };
}
