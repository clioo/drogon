// C09 Jira kanban selection: multi-selection over composed issue
// identities, built on the C02 kanban selection core (the exact seam from
// the pinned C02 source checkpoint — replace/toggle/range intents, prune
// and rendered-subset anchoring are C02's real bodies, not a re-write).
//
// MIT Copyright (c) 2026 Lovecast Inc.

import { useCallback, useMemo, useState } from "react";
import type { JiraIssue } from "../../../../../../shared/jira-contract";
import {
  areWorktreeSelectionsEqual,
  getWorktreeSelectionIntent,
  pruneWorktreeSelection,
  updateWorktreeAreaSelection,
  updateWorktreeSelection,
} from "../../../kanban/worktree-multi-selection";
import { getJiraIssueIdentity } from "./jira-issue-identity";

export function useJiraKanbanSelection(
  boardIssues: readonly JiraIssue[],
  renderedIssues: readonly JiraIssue[] = boardIssues,
) {
  const boardIdentities = useMemo(
    () => boardIssues.map(getJiraIssueIdentity),
    [boardIssues],
  );
  const renderedIdentities = useMemo(
    () => renderedIssues.map(getJiraIssueIdentity),
    [renderedIssues],
  );
  const [selectedIdentities, setSelectedIdentities] = useState<Set<string>>(
    () => new Set(),
  );
  const [anchorIdentity, setAnchorIdentity] = useState<string | null>(null);
  const selectedIssues = useMemo(
    () =>
      boardIssues.filter((issue) =>
        selectedIdentities.has(getJiraIssueIdentity(issue)),
      ),
    [boardIssues, selectedIdentities],
  );

  // Prune stale selection (issues unloaded by pagination replacement) so
  // children never see identities that no longer exist on the board.
  const pruned = pruneWorktreeSelection(
    selectedIdentities,
    anchorIdentity,
    boardIdentities,
  );
  if (!areWorktreeSelectionsEqual(selectedIdentities, pruned.selectedIds)) {
    setSelectedIdentities(pruned.selectedIds);
  }
  if (anchorIdentity !== pruned.anchorId) {
    setAnchorIdentity(pruned.anchorId);
  }

  /** Pointer gesture on one card: plain click replaces, cmd/ctrl toggles,
   *  shift ranges across the rendered subset (C02 semantics). Returns
   *  whether the gesture was additive (for drag start suppression). */
  const updateSelectionForGesture = useCallback(
    (event: React.MouseEvent<HTMLElement>, issueIdentity: string): boolean => {
      const intent = getWorktreeSelectionIntent(
        event,
        navigator.userAgent.includes("Mac"),
      );
      const result = updateWorktreeSelection({
        visibleIds: renderedIdentities,
        previousSelectedIds: selectedIdentities,
        previousAnchorId: anchorIdentity,
        targetId: issueIdentity,
        intent,
      });
      setSelectedIdentities(result.selectedIds);
      setAnchorIdentity(result.anchorId);
      return intent !== "replace";
    },
    [renderedIdentities, selectedIdentities, anchorIdentity],
  );

  const updateSelectionForArea = useCallback(
    (areaIds: readonly string[], additive: boolean): void => {
      const result = updateWorktreeAreaSelection({
        visibleIds: renderedIdentities,
        previousSelectedIds: selectedIdentities,
        previousAnchorId: anchorIdentity,
        areaIds,
        additive,
      });
      setSelectedIdentities(result.selectedIds);
      setAnchorIdentity(result.anchorId);
    },
    [renderedIdentities, selectedIdentities, anchorIdentity],
  );

  const clearSelection = useCallback(() => {
    setSelectedIdentities((previous) =>
      previous.size === 0 ? previous : new Set(),
    );
    setAnchorIdentity((previous) => (previous === null ? previous : null));
  }, []);

  const selectOnly = useCallback((issueIdentity: string): void => {
    setSelectedIdentities(new Set([issueIdentity]));
    setAnchorIdentity(issueIdentity);
  }, []);

  return {
    selectedIdentities,
    selectedIssues,
    anchorIdentity,
    updateSelectionForGesture,
    updateSelectionForArea,
    clearSelection,
    selectOnly,
  };
}
