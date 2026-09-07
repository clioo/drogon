// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/github/Avatars.tsx.
import type { JSX } from "react";
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
