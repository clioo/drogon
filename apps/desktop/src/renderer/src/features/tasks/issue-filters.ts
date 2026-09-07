import type { TaskIssue } from "../../../../shared/tasks-contract";

export type IssueChipFilters = {
  label: string | null;
  assignee: string | null;
};

/**
 * Narrows already-loaded issues by the local text draft and the active
 * label/assignee chips. The server applies the submitted query too; this
 * pure helper owns the chip narrowing and the unsubmitted-draft preview so
 * both stay testable without a bridge.
 */
export function filterIssues(
  issues: TaskIssue[],
  query: string,
  filters: IssueChipFilters,
): TaskIssue[] {
  const needle = query.trim().toLowerCase();
  return issues.filter((issue) => {
    if (
      needle &&
      !issue.title.toLowerCase().includes(needle) &&
      issue.number.toString() !== needle.trimStart().replace(/^#/, "")
    )
      return false;
    if (
      filters.label &&
      !issue.labels.some((label) => label.name === filters.label)
    )
      return false;
    if (filters.assignee && !issue.assignees.includes(filters.assignee))
      return false;
    return true;
  });
}

/** Sorted unique label names across the loaded issues, for the chip row. */
export function collectLabels(issues: TaskIssue[]): string[] {
  const names = new Set<string>();
  for (const issue of issues)
    for (const label of issue.labels) names.add(label.name);
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Sorted unique assignee logins across the loaded issues. */
export function collectAssignees(issues: TaskIssue[]): string[] {
  const logins = new Set<string>();
  for (const issue of issues) for (const login of issue.assignees) logins.add(login);
  return [...logins].sort((a, b) => a.localeCompare(b));
}

/**
 * Honest disabled reason for "Start task", or null when starting is
 * allowed. Every refusal names its cause: folder projects have no GitHub
 * remote, and a missing selection is a missing selection — never a silent
 * disabled button.
 */
export function startDisabledReason(input: {
  projectKind: "git" | "folder" | null;
  busy: boolean;
}): string | null {
  if (input.busy) return "Starting the worktree…";
  if (input.projectKind === null) return "Add a Git project to start a task.";
  if (input.projectKind === "folder")
    return "Tasks needs a GitHub remote: folder projects have none.";
  return null;
}
