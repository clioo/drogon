// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/Surface.tsx (R17-B: the Jira
// dialogs joined the frame — the fork mounts the create and connect
// dialogs beside the frame, so the Jira source does too).
import { TaskPageFrame } from "./Frame";
import { JiraIssueCreateDialog } from "../jira/jira-issue-create-dialog";
import { TaskPageJiraConnectDialog } from "../jira/jira-connect-dialog";
import type { TaskPageModelProps } from "../task-page-model";

export function TaskPageSurface({
  model,
}: TaskPageModelProps): React.JSX.Element {
  return (
    <div className="relative flex h-full min-h-0 flex-1 overflow-hidden bg-background text-foreground">
      <TaskPageFrame model={model} />

      <JiraIssueCreateDialog model={model.jiraCreationDialog} />

      <TaskPageJiraConnectDialog
        bridge={model.jiraWorkspaceBridge}
        open={model.jiraConnectOpen}
        onOpenChange={model.setJiraConnectOpen}
        onConnected={model.refreshJiraStatus}
      />
    </div>
  );
}
