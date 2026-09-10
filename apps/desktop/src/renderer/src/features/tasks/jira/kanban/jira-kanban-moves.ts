// C09 Jira kanban moves: request validation, response classification and
// reconciliation for board moves, on top of the daemon's real
// `jira.transitions` / `jira.updateIssue` bridge. Every move resolves to a
// transition id the connected site actually offers for that exact issue;
// display names, lane labels and workspace statuses are never mutation
// handles. An uncertain outcome (timeout / network loss — the POST may have
// landed) is never retried blindly: the board reconciles against a fresh
// server read first.
//
// Semantics mirror `crates/drogon-core/src/jira/transitions.rs` (the
// daemon-side seam): the daemon validates again at wiring time.
//
// MIT Copyright (c) 2026 Lovecast Inc.

import type {
  JiraIssue,
  JiraStatus,
  JiraTransition,
} from "../../../../../../shared/jira-contract";
import type { Result } from "../../../../../../shared/session-contract";

/** What the user asked for: a lane drop (target status) or an explicit
 *  transition choice from the card menu. */
export type JiraMoveTarget =
  | { kind: "status"; statusId: string }
  | { kind: "transition"; transitionId: string };

/** Why a move cannot be posted. Every variant is a showable, truthful
 *  reason — the board never guesses around one (stop condition). */
export type JiraBlockedReason =
  | { kind: "no-transitions" }
  | { kind: "transition-not-offered"; transitionId: string }
  | { kind: "status-not-reachable"; statusId: string }
  | { kind: "ambiguous-status"; statusId: string; transitionIds: string[] }
  | { kind: "required-fields"; transitionId: string; fields: string[] }
  | { kind: "already-in-status"; statusId: string };

export type JiraTransitionPlan = {
  transitionId: string;
  transitionName: string;
  targetStatus: JiraStatus;
};

export type JiraMovePlan =
  | { ok: true; plan: JiraTransitionPlan }
  | { ok: false; reason: JiraBlockedReason };

/**
 * Resolve a board move against the transitions Jira actually offers for
 * this issue. `availableTransitions` MUST be the card's own site's set —
 * colliding keys/status names on two instances never cross here because
 * the transitions are fetched per issue identity and the plan only reads
 * that set.
 */
export function planJiraMove(args: {
  issue: Pick<JiraIssue, "status">;
  availableTransitions: readonly JiraTransition[];
  target: JiraMoveTarget;
}): JiraMovePlan {
  const { issue, availableTransitions, target } = args;
  if (availableTransitions.length === 0) {
    return { ok: false, reason: { kind: "no-transitions" } };
  }
  let transition: JiraTransition;
  if (target.kind === "transition") {
    const match = availableTransitions.find(
      (t) => t.id === target.transitionId,
    );
    if (!match) {
      return {
        ok: false,
        reason: {
          kind: "transition-not-offered",
          transitionId: target.transitionId,
        },
      };
    }
    transition = match;
  } else {
    const matches = availableTransitions.filter(
      (t) => t.to.id === target.statusId,
    );
    if (matches.length === 0) {
      return {
        ok: false,
        reason: { kind: "status-not-reachable", statusId: target.statusId },
      };
    }
    if (matches.length > 1) {
      // Two real transitions reach the same status with different side
      // effects: the user picks the exact one, never the board.
      return {
        ok: false,
        reason: {
          kind: "ambiguous-status",
          statusId: target.statusId,
          transitionIds: matches.map((t) => t.id),
        },
      };
    }
    transition = matches[0]!;
  }
  if (transition.to.id === issue.status.id) {
    return {
      ok: false,
      reason: { kind: "already-in-status", statusId: issue.status.id },
    };
  }
  return {
    ok: true,
    plan: {
      transitionId: transition.id,
      transitionName: transition.name,
      targetStatus: transition.to,
    },
  };
}

/** How a posted move ended up. `rejected` means Jira answered and refused
 *  (nothing applied); `uncertain` means the outcome is unknown and the
 *  board must reconcile before anything else happens to the issue. */
export type JiraMoveVerdict =
  | { kind: "applied" }
  | { kind: "rejected"; reason: string }
  | { kind: "uncertain" };

/** The `Result<JiraMutationResult>` the JiraBridge resolves with. */
type JiraMoveBridgeResult = Result<{ ok: boolean; error?: string }>;

/**
 * Classify one `jira.updateIssue` transition POST against the bridge
 * envelopes: business failures ride `{ ok: false, error }` ("Error 403:
 * …"-shaped); transport failures ride the Result error. Only
 * `jira_unreachable` (timeout / network loss) is uncertain — the request
 * may have been applied server-side, so a re-POST would be a blind
 * duplicate.
 */
export function classifyJiraMoveResult(
  result: JiraMoveBridgeResult,
): JiraMoveVerdict {
  if (result.ok) {
    return result.result.ok
      ? { kind: "applied" }
      : {
          kind: "rejected",
          reason: result.result.error ?? "Jira refused the move.",
        };
  }
  if (result.error.code === "jira_unreachable") {
    return { kind: "uncertain" };
  }
  return { kind: "rejected", reason: result.error.message };
}

/** One unresolved board move, keyed by composed issue identity. It exists
 *  from POST issue until the board knows the truth. */
export type JiraPendingMove = {
  identity: string;
  transitionId: string;
  transitionName: string;
  targetStatusId: string;
  originStatusId: string;
  state: "in-flight" | "awaiting-reconciliation";
};

/**
 * Reconcile an uncertain move against the issue's fresh server read (a
 * real `jira.getIssue`, never the board's own projection). Every outcome
 * carries the fresh issue so the board adopts server truth — a concurrent
 * remote mutation is shown, never hidden behind local success.
 */
export type JiraMoveReconciliation =
  | { kind: "applied"; issue: JiraIssue }
  | { kind: "not-applied"; issue: JiraIssue }
  | { kind: "superseded"; issue: JiraIssue };

export function reconcileJiraMove(
  pending: Pick<JiraPendingMove, "targetStatusId" | "originStatusId">,
  freshIssue: JiraIssue,
): JiraMoveReconciliation {
  if (freshIssue.status.id === pending.targetStatusId) {
    return { kind: "applied", issue: freshIssue };
  }
  if (freshIssue.status.id === pending.originStatusId) {
    return { kind: "not-applied", issue: freshIssue };
  }
  return { kind: "superseded", issue: freshIssue };
}

/** Human line for a blocked move (menu hint / toast). */
export function describeJiraBlockedReason(
  reason: JiraBlockedReason,
  availableTransitions: readonly JiraTransition[],
): string {
  switch (reason.kind) {
    case "no-transitions":
      return "Jira offers no transitions for this issue right now.";
    case "transition-not-offered":
      return `Jira does not offer transition ${reason.transitionId} for this issue.`;
    case "status-not-reachable":
      return "This issue's Jira workflow has no transition to that status. Use the card menu to pick a real transition.";
    case "ambiguous-status": {
      const names = reason.transitionIds
        .map((id) => availableTransitions.find((t) => t.id === id)?.name ?? id)
        .join(", ");
      return `Several Jira transitions reach this status (${names}). Use the card menu to choose one.`;
    }
    case "required-fields":
      return `This transition needs fields first: ${reason.fields.join(", ")}.`;
    case "already-in-status":
      return "The issue is already in that status.";
  }
}

/** A status reference narrowed to what lanes render by. */
export type JiraLaneStatus = Pick<JiraStatus, "id" | "name" | "categoryKey"> & {
  colorName?: string;
};
