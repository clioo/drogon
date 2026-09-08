// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/sync/compare-summary.tsx
// ("Unable to load branch compare." / "Branch compare unavailable" — the
// fork never surfaces raw git stderr in the panel).
// Adapter: the daemon reports git failures as command echoes wrapped in
// `exited with exit status: N`; the UI shows the fork's short copy while
// the raw text stays in the console log only (see #136).

export const NOT_A_GIT_REPOSITORY_COPY = "This workspace is not a git repository.";

export const PR_CREATE_FALLBACK_COPY = "Could not create a pull request.";

/** Matches the daemon's `… exited with exit status: N …` wrapper. */
const EXIT_STATUS_WRAPPER = /exited with exit status:?\s*\d+:?/i;
/** Matches a leading `git --flags … <subcommand>` command echo. */
const COMMAND_ECHO = /^\s*git(\s+--[^\s:]+(\s*=\s*\S+)?)*(\s+-c\s+\S+=\S*)*\s+[a-z][a-z-]*\b[^:a-z]*:?\s*/i;
/** Daemon copy that must never reach the UI. */
const RAW_GIT_INTERNALS = /exited with exit status|git\s+--no-pager/i;
/** Daemon `gh` argv that must never reach the UI (see #176). */
const RAW_GH_INTERNALS = /gh\s+pr\s+create\b/i;
/** Leading `gh: ` prefix on gh's own stderr lines. */
const GH_PREFIX = /^\s*gh:\s*/i;
/** Fork's remote-failure detail cap (source-control-remote-error.ts). */
const REMOTE_DETAIL_MAX_LENGTH = 200;
/** gh auth-failure markers, mirroring the daemon's is_gh_auth_failure. */
const GH_AUTH_MARKERS = [
  "not authenticated",
  "not logged in",
  "gh auth login",
  "bad credentials",
  "http 401",
  "http 403",
  "missing token",
  "no oauth",
];
/** gh could not run at all. */
const GH_MISSING_MARKERS = [
  "could not be spawned",
  "command not found",
  "no such file",
  "install gh",
  "not installed",
];

/** Strips command echoes, exit-status wrappers and `fatal:` prefixes. */
export function sanitizeGitDetail(raw: string): string {
  let detail = raw;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = detail.replace(EXIT_STATUS_WRAPPER, " ").replace(COMMAND_ECHO, " ");
    if (next === detail) break;
    detail = next;
  }
  const fatal = detail.match(/fatal:\s*([\s\S]*)$/i);
  if (fatal) detail = fatal[1];
  return detail.replace(/\s+/g, " ").replace(/^[:\-–—….\s]+/, "").trim();
}

/**
 * Maps a daemon git failure to the short copy the panel shows. The raw
 * text is logged (never rendered) so support keeps the full context.
 * The returned string never contains exit-status or command-echo internals.
 */
export function toGitDisplayError(raw: string, fallback: string): string {
  const text = raw.trim();
  console.error(`[source-control] git failure: ${raw}`);
  if (/not a git repository/i.test(text)) return NOT_A_GIT_REPOSITORY_COPY;
  if (text === "") return fallback;
  const detail = sanitizeGitDetail(text);
  if (detail === "" || RAW_GIT_INTERNALS.test(detail)) return fallback;
  return detail;
}

function truncateRemoteDetail(detail: string): string {
  if (detail.length <= REMOTE_DETAIL_MAX_LENGTH) return detail;
  return `${detail.slice(0, REMOTE_DETAIL_MAX_LENGTH).trimEnd()}...`;
}

function containsMarker(text: string, markers: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return markers.some((marker) => lower.includes(marker));
}

/**
 * Maps a daemon `git.pr_create` (`gh`) failure to the short copy the panel
 * shows, following the fork (which keeps the raw error separate and shows
 * `<Op> failed` copy). The raw text is logged (never rendered) so support
 * keeps the full context. The returned string never contains the `gh`
 * argv, exit-status wrappers or `fatal:` prefixes.
 */
export function toPrCreateDisplayError(
  raw: string,
  fallback: string = PR_CREATE_FALLBACK_COPY,
): string {
  const text = raw.trim();
  console.error(`[source-control] pr create failure: ${raw}`);
  if (text === "") return fallback;
  if (/no git remotes? found|no remote/i.test(text)) {
    return `${fallback} This repository has no remote — add one with git remote add, then try again.`;
  }
  if (containsMarker(text, GH_AUTH_MARKERS)) {
    return `${fallback} Authenticate with GitHub first, then try again.`;
  }
  if (containsMarker(text, GH_MISSING_MARKERS)) {
    return `${fallback} Install the GitHub CLI first, then try again.`;
  }
  // Why the last segment: the daemon formats failures as
  // `gh <argv> exited with <status>: <stderr>`, so everything before the
  // wrapper is the echoed command (titles can contain colons, so splitting
  // anywhere earlier would leak half the argv into the UI).
  const segments = text.split(EXIT_STATUS_WRAPPER);
  const detail = sanitizeGitDetail(
    segments[segments.length - 1].replace(GH_PREFIX, ""),
  );
  if (
    detail === "" ||
    RAW_GIT_INTERNALS.test(detail) ||
    RAW_GH_INTERNALS.test(detail)
  ) {
    return fallback;
  }
  return `${fallback} ${truncateRemoteDetail(detail)}`;
}
