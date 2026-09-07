// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page-localized-options.tsx — GitHub-only
// adaptation. The source icon set shrinks to GitHub (no Linear/Jira/GitLab
// in this repo), and the reference's GitHub search-qualifier presets map
// onto the daemon's `state` filter (open|closed|all), which is what the
// mode-control row drives.

import { GithubIcon } from "./github-icon";

export type GitHubTaskKind = "issues";

export type SourceOption = {
  id: "github";
  label: string;
  Icon: (props: { className?: string }) => React.JSX.Element;
  disabled?: boolean;
};

export type GitHubStateFilterId = "open" | "closed" | "all";

export type GitHubStateFilter = {
  id: GitHubStateFilterId;
  label: string;
};

export function getSourceOptions(): SourceOption[] {
  return [
    {
      id: "github",
      label: "GitHub",
      Icon: ({ className }) => <GithubIcon className={className} />,
    },
  ];
}

export function getGitHubStateFilters(): GitHubStateFilter[] {
  return [
    { id: "open", label: "Open" },
    { id: "closed", label: "Closed" },
    { id: "all", label: "All" },
  ];
}
