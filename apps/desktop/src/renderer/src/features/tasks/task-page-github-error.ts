/**
 * Display copy for GitHub-backed Tasks failures (journey J6). The daemon
 * reports a missing `gh` binary as `gh_unavailable` and a signed-out `gh`
 * as `gh_unauthenticated`, but their messages carry spawn/argv internals;
 * every other failure (API outage, rate limit, network down) stays
 * `io_error` with the daemon's own text. This maps only the two typed
 * codes to an actionable sentence and passes everything else through
 * untouched, so a real outage is never mislabeled "install gh".
 */
export function toGitHubTasksDisplayError(code: string, message: string): string {
  const fix = githubFixClause(code);
  if (fix === null) return message;
  return `Could not load GitHub tasks. ${fix}`;
}

/** Same mapping for "start work from an issue", which fails on the same codes. */
export function toGitHubTaskStartDisplayError(code: string, message: string): string {
  const fix = githubFixClause(code);
  if (fix === null) return message;
  return `Could not start the task. ${fix}`;
}

function githubFixClause(code: string): string | null {
  if (code === "gh_unavailable") return "Install the GitHub CLI first, then try again.";
  if (code === "gh_unauthenticated") return "Authenticate with GitHub first, then try again.";
  return null;
}
