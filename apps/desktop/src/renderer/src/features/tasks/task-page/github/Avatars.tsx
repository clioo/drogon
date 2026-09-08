// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/github/Avatars.tsx.
import type { JSX } from "react";
import { Users } from "lucide-react";
import { GitHubUserAvatar } from "../../github-user-avatar";
import type { TaskPageWorkItem } from "../../task-page-model";

export function GitHubAssigneeAvatar({
  assignee,
}: {
  assignee: TaskPageWorkItem["assignees"][number];
}): JSX.Element {
  return (
    <GitHubUserAvatar
      login={assignee.login}
      name={assignee.name}
      avatarUrl={assignee.avatarUrl}
      title={assignee.name ? `${assignee.name} (${assignee.login})` : assignee.login}
      className="size-5"
    />
  );
}

// Why: the daemon's PR rows carry reviewer logins at most (never avatar
// URLs), so the chip falls back to the PR host's avatar URL before the
// initials placeholder, exactly like the source.
export function ReviewChipAvatar({
  reviewer,
}: {
  reviewer: { login: string; name?: string | null; avatarUrl?: string | null } | null;
}): JSX.Element {
  if (reviewer?.login) {
    const avatarUrl = reviewer.avatarUrl || `https://github.com/${reviewer.login}.png?size=40`;
    return (
      <GitHubUserAvatar
        login={reviewer.login}
        name={reviewer.name}
        avatarUrl={avatarUrl}
        title={reviewer.name ? `${reviewer.name} (${reviewer.login})` : reviewer.login}
        className="size-5"
      />
    );
  }
  return <Users className="size-5 shrink-0" />;
}
