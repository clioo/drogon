// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/sync/compare-summary.tsx
// ("Unable to load branch compare." / "Branch compare unavailable" — the
// fork never surfaces raw git stderr in the panel).
// Adapter: the daemon reports git failures as command echoes wrapped in
// `exited with exit status: N`; the UI shows the fork's short copy while
// the raw text stays in the console log only (see #136).

export const NOT_A_GIT_REPOSITORY_COPY = "This workspace is not a git repository.";

/** Matches the daemon's `… exited with exit status: N …` wrapper. */
const EXIT_STATUS_WRAPPER = /exited with exit status:?\s*\d+:?/i;
/** Matches a leading `git --flags … <subcommand>` command echo. */
const COMMAND_ECHO = /^\s*git(\s+--[^\s:]+(\s*=\s*\S+)?)*(\s+-c\s+\S+=\S*)*\s+[a-z][a-z-]*\b[^:a-z]*:?\s*/i;
/** Daemon copy that must never reach the UI. */
const RAW_GIT_INTERNALS = /exited with exit status|git\s+--no-pager/i;

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
