/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/WorktreeCardMetaBadges.tsx and
   worktree-card-meta-row.tsx (adapter: the reference badges cover issue,
   Linear, Jira, review, comment, automation and CLI provenance over store
   state; the MVP subset projects branch, ahead/behind from `git.status`,
   the linked-issue badge, the PR chip when a PR is known, and the agent
   summary from card sessions. Pure projection over props.) */
import { GitBranch, GitPullRequest } from "lucide-react";
import {
  getPrChipAccessibleLabel,
  getPrChipLabel,
  type WorktreeCardPrDisplay,
} from "./worktree-card-pr-display";

/** Everything the meta row can show; each badge hides when its input is absent. */
export type WorktreeCardMetaBadgesProps = {
  branch: string;
  ahead: number | null;
  behind: number | null;
  upstream: string | null;
  issueNumber: number | null;
  pr: WorktreeCardPrDisplay | null;
  agentSummary: string;
};

/** True when at least one badge has something to show. */
export function hasWorktreeCardMetaBadges(args: {
  issueNumber: number | null;
  pr: WorktreeCardPrDisplay | null;
  agentSummary: string;
  ahead: number | null;
  behind: number | null;
}): boolean {
  return Boolean(
    args.issueNumber !== null ||
      args.pr ||
      args.agentSummary ||
      (args.ahead ?? 0) > 0 ||
      (args.behind ?? 0) > 0,
  );
}

/** Accessible ahead/behind text, e.g. "ahead 2, behind 1". */
export function formatAheadBehindLabel(
  ahead: number | null,
  behind: number | null,
): string | null {
  const parts: string[] = [];
  if ((ahead ?? 0) > 0) parts.push(`ahead ${ahead}`);
  if ((behind ?? 0) > 0) parts.push(`behind ${behind}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

export function WorktreeCardMetaBadges({
  branch,
  ahead,
  behind,
  upstream,
  issueNumber,
  pr,
  agentSummary,
}: WorktreeCardMetaBadgesProps) {
  const aheadBehind = formatAheadBehindLabel(ahead, behind);
  return (
    <span className="shell-worktree-card-meta">
      {issueNumber !== null && (
        <span
          className="shell-worktree-card-issue"
          title={`Started from issue #${issueNumber}`}
        >
          #{issueNumber}
        </span>
      )}
      {branch ? (
        <span className="shell-worktree-card-branch">
          <GitBranch size={12} aria-hidden="true" />
          <span>{branch}</span>
        </span>
      ) : null}
      {aheadBehind && (
        <span
          className="shell-worktree-card-ahead-behind"
          title={
            upstream ? `Upstream ${upstream}: ${aheadBehind}` : aheadBehind
          }
          aria-label={aheadBehind}
        >
          {(ahead ?? 0) > 0 && <span>↑{ahead}</span>}
          {(behind ?? 0) > 0 && <span>↓{behind}</span>}
        </span>
      )}
      {pr && (
        <span
          className="shell-worktree-card-pr"
          role="img"
          aria-label={getPrChipAccessibleLabel(pr)}
          title={pr.title}
        >
          <GitPullRequest size={12} aria-hidden="true" />
          <span>{getPrChipLabel(pr)}</span>
        </span>
      )}
      {agentSummary && (
        <span
          className="shell-worktree-card-agents"
          title={`${agentSummary} in this worktree`}
        >
          {agentSummary}
        </span>
      )}
    </span>
  );
}
