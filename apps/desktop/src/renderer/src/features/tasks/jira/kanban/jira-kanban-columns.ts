// C09 Jira kanban lanes: group loaded issues into columns keyed by the
// real (site, status id) pair — never by status name, workspace status or
// agent state. Two instances' same-named statuses land in distinct lanes,
// and a lane always renders its issues with their composed identities so
// filters, pagination and selection cannot misattribute a card.
//
// MIT Copyright (c) 2026 Lovecast Inc.

import type { JiraIssue } from "../../../../../../shared/jira-contract";
import {
  composeJiraIssueIdentity,
  composeJiraLaneIdentity,
  parseJiraLaneIdentity,
} from "./jira-issue-identity";

export type JiraKanbanLane = {
  /** `percentEncoded(siteId)|statusId` — the DOM/selection key. */
  identity: string;
  siteId: string | null;
  statusId: string;
  statusName: string;
  categoryKey: string;
  colorName?: string;
  issues: JiraIssue[];
  /** Composed issue identities in lane order (drop targets, tests). */
  issueIdentities: string[];
};

/**
 * Group issues into lanes in first-seen (site, statusId) order. The board
 * re-renders stable across pages: an existing lane keeps its position,
 * newly discovered statuses append. Issues keep their input order inside a
 * lane; a pending move does NOT relocate the card — the overlay renders
 * the target lane's pending state on the card in its origin lane until the
 * server confirms.
 */
export function buildJiraKanbanLanes(
  issues: readonly JiraIssue[],
): JiraKanbanLane[] {
  const lanes = new Map<string, JiraKanbanLane>();
  for (const issue of issues) {
    const siteId = issue.siteId ?? null;
    const laneIdentity = composeJiraLaneIdentity(siteId, issue.status.id);
    let lane = lanes.get(laneIdentity);
    if (!lane) {
      lane = {
        identity: laneIdentity,
        siteId,
        statusId: issue.status.id,
        statusName: issue.status.name,
        categoryKey: issue.status.categoryKey,
        colorName: issue.status.colorName,
        issues: [],
        issueIdentities: [],
      };
      lanes.set(laneIdentity, lane);
    }
    lane.issues.push(issue);
    lane.issueIdentities.push(composeJiraIssueIdentity(siteId, issue.id));
  }
  return [...lanes.values()];
}

/** The lane an issue belongs to, by composed identity. */
export function findJiraLaneForIssue(
  lanes: readonly JiraKanbanLane[],
  issueIdentity: string,
): JiraKanbanLane | null {
  return (
    lanes.find((lane) => lane.issueIdentities.includes(issueIdentity)) ?? null
  );
}

/** The target lane for a lane drop, resolved by composed identity; `null`
 *  for a malformed or foreign identity — never a guessed lane. */
export function findJiraLaneByIdentity(
  lanes: readonly JiraKanbanLane[],
  laneIdentity: string,
): JiraKanbanLane | null {
  return lanes.find((lane) => lane.identity === laneIdentity) ?? null;
}

// --- honest data-coverage labeling ------------------------------------------

/** Data state of the board's issue set: never is a page or partial cache
 *  labeled as the full issue set. */
export type JiraBoardCoverage = {
  /** `issues.length` currently loaded (all pages appended). */
  loadedCount: number;
  /** Server `total` when the latest response supplied one. */
  total: number | null;
  /** Server `isLast` when the latest response supplied one. */
  isLast: boolean | null;
  /** `moreAvailable`: the loaded set is KNOWN incomplete or unverifiable. */
  complete: boolean;
};

export function buildJiraBoardCoverage(args: {
  loadedCount: number;
  total?: number | null;
  isLast?: boolean | null;
}): JiraBoardCoverage {
  const { loadedCount, total = null, isLast = null } = args;
  // The set is only complete when the server positively says so; an absent
  // `isLast` with a short page is treated as complete (the daemon's list
  // contract), with `total` still able to contradict it.
  const complete =
    total !== null ? loadedCount >= total : isLast !== null ? isLast : true;
  return { loadedCount, total, isLast: isLast ?? null, complete };
}

/** The coverage line the board renders — honest about pages and caches. */
export function describeJiraBoardCoverage(coverage: JiraBoardCoverage): string {
  if (coverage.loadedCount === 0) {
    return "No issues loaded.";
  }
  if (coverage.total !== null && coverage.loadedCount < coverage.total) {
    return `Showing ${coverage.loadedCount} of ${coverage.total} issues.`;
  }
  if (!coverage.complete) {
    return `Showing ${coverage.loadedCount} issues — more may exist; refine the query to see them.`;
  }
  return `Showing all ${coverage.loadedCount} issues.`;
}
