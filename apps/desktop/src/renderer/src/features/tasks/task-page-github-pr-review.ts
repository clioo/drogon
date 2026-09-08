// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/github-pr-reviewer-display.ts — the read-only
// subset (decision label). The daemon's `gh pr list` fields carry the review
// decision but no reviewer logins (`reviewRequests`/`latestReviews` are never
// fetched), so the login-list arms and the mutation helpers have no data to
// read and are not ported: the cell renders the decision, never invented
// reviewer names.
import type { PRReviewDecision } from "../../../../shared/tasks-contract";

export function getGitHubPRReviewLabel(
  reviewDecision: PRReviewDecision | null | undefined,
): string {
  if (reviewDecision === "APPROVED") {
    return "Approved";
  }
  if (reviewDecision === "CHANGES_REQUESTED") {
    return "Changes requested";
  }
  if (reviewDecision === "REVIEW_REQUIRED") {
    return "Reviewers";
  }
  return "No reviewers";
}
