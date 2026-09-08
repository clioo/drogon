// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/jira-issue-workspace-actions.ts — labels,
// branch-name derivation and the copy-prompt shape are verbatim; the
// clipboard and URL openers are props (this repo's bridge surface) instead
// of the fork's window.api globals, and toasts ride the app-wide sonner.
import { Clipboard, ExternalLink, GitBranch } from "lucide-react";
import { toast } from "sonner";
import type { JiraIssue } from "../../../../../shared/jira-contract";
import type { JiraIssueWorkspaceAction } from "./jira-issue-workspace-content";

function buildJiraBranchName(issue: JiraIssue): string {
  const slug = issue.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 52);
  return `${issue.key.toLowerCase()}${slug ? `-${slug}` : ""}`;
}

export function getJiraIssueWorkspaceActions(
  issue: JiraIssue,
  {
    openUrl,
    writeClipboardText,
  }: {
    openUrl: (url: string) => Promise<unknown> | unknown;
    writeClipboardText: (text: string) => Promise<unknown> | unknown;
  },
): JiraIssueWorkspaceAction[] {
  const copyTextToClipboard = async (text: string, label: string): Promise<void> => {
    try {
      await writeClipboardText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Failed to copy ${label.toLowerCase()}`);
    }
  };
  return [
    {
      label: "Open in Jira",
      icon: ExternalLink,
      action: () => void openUrl(issue.url),
    },
    {
      label: "Copy URL",
      icon: Clipboard,
      action: () => void copyTextToClipboard(issue.url, "URL"),
    },
    {
      label: "Copy key",
      icon: Clipboard,
      action: () => void copyTextToClipboard(issue.key, "Key"),
    },
    {
      label: "Copy suggested branch name",
      icon: GitBranch,
      action: () => void copyTextToClipboard(buildJiraBranchName(issue), "Branch name"),
    },
    {
      label: "Copy prompt",
      icon: Clipboard,
      action: () =>
        void copyTextToClipboard(
          `Complete Jira issue ${issue.key}: ${issue.title}\n\n${issue.url}`,
          "Prompt",
        ),
    },
  ];
}
