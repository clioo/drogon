import type { TasksBridge } from "../../../../shared/tasks-contract";
import { setWorktreeIssueLinks } from "../shell/project-adapter";

/**
 * Refreshes the sidebar issue badges (journey J6) from `tasks.links` for
 * every project id given. When any project fails, the whole store keeps
 * its previous badges — the Tasks page itself surfaces that error; the
 * sidebar never invents links and never clears ones it did not re-read.
 */
export async function refreshWorktreeIssueLinks(
  bridge: TasksBridge,
  projectIds: readonly string[],
): Promise<void> {
  const links: { worktreeId: string; issueNumber: number }[] = [];
  for (const projectId of projectIds) {
    const result = await bridge.tasksLinks({ projectId });
    if (!result.ok) return;
    for (const link of result.result.links)
      links.push({
        worktreeId: link.worktreeId,
        issueNumber: link.issueNumber,
      });
  }
  setWorktreeIssueLinks(links);
}
